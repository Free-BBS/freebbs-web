import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  ROLE_KEYS,
  canEditDepartment,
  departmentById,
  type CollaborationSpace,
  type CollaborationEntry,
  type UserContext,
} from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { HttpError } from '../../core/errors/http-error.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { canCreateCollection } from '../collections/access.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { allocatePreferences, assertBookingAvailable, validateTableRow } from './domain.js';

export interface CollaborationOptions {
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
  uploadDirectory?: string;
  nodeEnvironment?: string;
  store?: DevelopmentStore;
}
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
const column = z
  .object({
    id: key,
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['text', 'number', 'date', 'choice']),
    required: z.boolean().default(false),
    editRoleKeys: z.array(z.string().max(100)).max(20).optional(),
    options: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict();
const slot = z
  .object({
    id: key,
    title: z.string().trim().min(1).max(120),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    capacity: z.number().int().min(1).max(10000),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
    '结束时间应晚于开始时间',
  );
const definition = z
  .object({
    expectedReporterUids: z.array(z.string().trim().min(1).max(100)).max(500).default([]),

    kind: z.enum([
      'availability',
      'booking',
      'shared_table',
      'practice',
      'attendance',
      'review',
      'materials',
    ]),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(4000).default(''),
    departmentId: z.string().max(100).nullable().default(null),
    teamId: z.string().max(100).nullable().default(null),
    audience: z.enum(['all', 'department']).default('all'),
    status: z.enum(['draft', 'published', 'closed']).default('draft'),
    columns: z.array(column).max(32).default([]),
    slots: z.array(slot).max(100).default([]),
    stages: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            roleKeys: z.array(z.string().max(100)).min(1).max(20),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
const entryInput = z
  .object({
    revision: z.number().int().min(1),
    entryId: z.string().uuid().optional(),
    values: z.record(z.union([z.string().max(4000), z.number().finite(), z.boolean()])).default({}),
    choices: z.array(key).max(100).default([]),
    resource: z.string().trim().max(100).default(''),
    startsAt: z.string().max(40).default(''),
    endsAt: z.string().max(40).default(''),
    text: z.string().trim().max(6000).default(''),
  })
  .strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, 'invalid_request', result.error.issues[0]?.message ?? '输入内容无效');
  return result.data as z.output<S>;
}
export function manages(space: CollaborationSpace, actor: UserContext) {
  return (
    actor.uid === space.ownerUid ||
    actor.roles.includes('platform.super_admin') ||
    Boolean(space.departmentId && canEditDepartment(actor.roles, space.departmentId)) ||
    Boolean(
      space.teamId &&
      authorize(actor, {
        action: 'sports.showcase.update',
        resource: 'sports_showcase',
        scope: { type: 'sports_team', id: space.teamId },
      }).allowed,
    )
  );
}
export function canReviewEntry(
  space: CollaborationSpace,
  entry: CollaborationEntry,
  actor: UserContext,
) {
  return (
    entry.reviewStatus === 'pending' &&
    (space.kind === 'attendance'
      ? manages(space, actor)
      : space.kind === 'review' &&
        Boolean(
          space.stages[entry.stage]?.roleKeys.some((role) =>
            actor.roles.some((candidate) => candidate === role),
          ),
        ))
  );
}
function visible(space: CollaborationSpace, actor: UserContext) {
  return (
    manages(space, actor) ||
    (space.status !== 'draft' &&
      space.entries.some((entry) => canReviewEntry(space, entry, actor))) ||
    (space.status !== 'draft' &&
      (space.audience === 'all' ||
        Boolean(space.departmentId && canEditDepartment(actor.roles, space.departmentId))))
  );
}
function view(space: CollaborationSpace, actor: UserContext): CollaborationSpace {
  const canManage = manages(space, actor);
  const shared = space.kind === 'shared_table' && space.audience === 'department';
  return {
    ...space,
    canManage,
    expectedReporterUids: canManage ? space.expectedReporterUids : undefined,
    entries: (canManage || shared
      ? space.entries
      : space.entries.filter(
          (entry) => entry.uid === actor.uid || canReviewEntry(space, entry, actor),
        )
    ).map((entry) => ({ ...entry, canReview: canReviewEntry(space, entry, actor) })),
    history: canManage ? space.history.slice(-100) : [],
    bookingOccupancy:
      space.kind === 'booking'
        ? space.entries.map(({ resource, startsAt, endsAt }) => ({ resource, startsAt, endsAt }))
        : undefined,
    aggregates:
      space.kind === 'availability'
        ? Object.fromEntries(
            space.slots.map((s) => [
              s.id,
              space.entries.filter((entry) => entry.choices.includes(s.id)).length,
            ]),
          )
        : undefined,
  };
}
export function createCollaborationRouter(options: CollaborationOptions) {
  const router = Router();
  const storage = featureStorage<CollaborationSpace>(
    options.uploadDirectory ?? resolve('.data/collection-uploads'),
    'collaboration',
  );
  router.use(async (request, response, next) => {
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      throw new HttpError(503, 'storage_not_configured', '协作资料存储尚未配置');
    response.locals.actor = identity.user;
    next();
  });
  const actor = (response: Response) => response.locals.actor as UserContext;
  const send = (response: Response, data: unknown, status = 200) =>
    response.status(status).json({ data, requestId: response.locals.requestId });
  async function load(id: string, user: UserContext) {
    const space = await storage.get(id);
    if (!space || !visible(space, user)) throw new HttpError(404, 'not_found', '未找到该协作空间');
    return space;
  }
  function guard(space: CollaborationSpace, user: UserContext, revision: number) {
    if (!manages(space, user))
      throw new HttpError(403, 'forbidden', '只有创建者和本部门成员可以管理');
    if (space.revision !== revision)
      throw new HttpError(409, 'revision_conflict', '页面已更新，请重新加载后再保存');
  }
  function validateDefinition(value: z.infer<typeof definition>, user: UserContext) {
    if (value.departmentId && !canEditDepartment(user.roles, value.departmentId))
      throw new HttpError(403, 'department_forbidden', '只能为自己的部门创建协作空间');
    if (value.audience === 'department' && !value.departmentId)
      throw new HttpError(400, 'missing_department', '请选择所属部门');
    if (value.kind === 'shared_table' && value.audience !== 'department')
      throw new HttpError(400, 'table_audience', '共享统计表须限定部门访问');
    if (
      new Set(value.columns.map((c) => c.id)).size !== value.columns.length ||
      new Set(value.slots.map((s) => s.id)).size !== value.slots.length
    )
      throw new HttpError(400, 'duplicate_key', '字段或时间段编号重复');
    if (value.columns.some((c) => c.kind === 'choice' && !c.options?.length))
      throw new HttpError(400, 'missing_choices', '选择字段需要设置选项');
    if (['availability', 'practice'].includes(value.kind) && !value.slots.length)
      throw new HttpError(400, 'missing_slots', '请设置至少一个时间段或支队');
    if (value.kind === 'review' && !value.stages.length)
      throw new HttpError(400, 'missing_stages', '请设置审核步骤');
    const roles = value.departmentId
      ? (departmentById(value.departmentId)?.roleKeys ?? [])
      : user.roles;
    if (
      value.stages.some((stage) =>
        stage.roleKeys.some(
          (role) =>
            !roles.some((candidate) => candidate === role) &&
            !(role.startsWith('counselor.') && ROLE_KEYS.some((candidate) => candidate === role)),
        ),
      )
    )
      throw new HttpError(400, 'invalid_reviewer', '审核角色须属于该部门或辅导员');
  }
  router.get('/', async (_request, response) => {
    const user = actor(response);
    const items = (await storage.list())
      .filter((space) => visible(space, user))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    send(response, {
      canCreate:
        canCreateCollection(user) ||
        user.tags.some(
          (tag) =>
            tag.key === 'sports.team_captain' &&
            tag.scope?.type === 'sports_team' &&
            (!tag.expiresAt || Date.parse(tag.expiresAt) > Date.now()),
        ),
      items: items.map((space) => ({
        ...view(space, user),
        entries: [],
        history: [],
        bookingOccupancy: undefined,
      })),
    });
  });
  router.post('/', async (request, response) => {
    const user = actor(response);
    const input = parse(definition, request.body);
    if (input.teamId) {
      const team = await options.store?.sportsTeams.get(input.teamId);
      if (
        !team ||
        input.kind !== 'attendance' ||
        !authorize(user, {
          action: 'sports.showcase.update',
          resource: 'sports_showcase',
          scope: team.scope,
        }).allowed
      )
        throw new HttpError(
          403,
          'team_forbidden',
          '只有对应代表队队长或体育中心成员可以创建训练打卡',
        );
    }
    if (!canCreateCollection(user) && !input.teamId)
      throw new HttpError(403, 'forbidden', '只有社工同学或代表队队长可以创建');
    validateDefinition(input, user);
    const id = randomUUID();
    const at = new Date().toISOString();
    const space: CollaborationSpace = {
      ...input,
      id,
      ownerUid: user.uid,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      entries: [],
      history: [{ uid: user.uid, at, action: 'created' }],
    };
    await storage.change(id, () => ({ record: space, result: null }));
    send(response, view(space, user), 201);
  });
  router.get('/:id', async (request, response) =>
    send(response, view(await load(String(request.params.id), actor(response)), actor(response))),
  );
  router.patch('/:id', async (request, response) => {
    const user = actor(response);
    const input = parse(
      definition
        .partial()
        .extend({ revision: z.number().int().min(1) })
        .strict(),
      request.body,
    );
    const result = await storage.change(String(request.params.id), (current) => {
      if (!current) throw new HttpError(404, 'not_found', '未找到该协作空间');
      guard(current, user, input.revision);
      if (
        input.columns &&
        JSON.stringify(input.columns) !== JSON.stringify(current.columns) &&
        current.ownerUid !== user.uid &&
        !user.roles.includes('platform.super_admin')
      )
        throw new HttpError(403, 'column_configuration_forbidden', '只有创建者可以配置字段权限');
      if (input.teamId !== undefined && input.teamId !== (current.teamId ?? null))
        throw new HttpError(400, 'team_binding_locked', '代表队关联不能变更');
      const next = {
        ...current,
        ...input,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const check = definition.parse(
        Object.fromEntries(
          Object.keys(definition.shape).map((name) => [name, next[name as keyof typeof next]]),
        ),
      );
      validateDefinition(check, user);
      if (
        current.entries.length &&
        ((input.kind !== undefined && input.kind !== current.kind) ||
          (input.columns !== undefined &&
            JSON.stringify(input.columns) !== JSON.stringify(current.columns)) ||
          (input.slots !== undefined &&
            JSON.stringify(input.slots) !== JSON.stringify(current.slots)) ||
          (input.stages !== undefined &&
            JSON.stringify(input.stages) !== JSON.stringify(current.stages)))
      )
        throw new HttpError(
          409,
          'schema_locked',
          '已有记录的字段结构、时间段和审核步骤不能更改，请创建新空间',
        );
      next.history.push({ uid: user.uid, at: next.updatedAt, action: 'updated' });
      next.history = next.history.slice(-500);
      return { record: next, result: view(next, user) };
    });
    send(response, result);
  });
  router.post('/:id/entries', async (request, response) => {
    const user = actor(response);
    const input = parse(entryInput, request.body);
    const target = await load(String(request.params.id), user);
    if (target.teamId && !manages(target, user)) {
      const member = (
        await options.store?.sportsTeamMembers.list({
          scopeType: 'sports_team',
          scopeId: target.teamId,
        })
      )?.some(
        (row) =>
          row.teamId === target.teamId && row.memberUid === user.uid && row.status === 'active',
      );
      if (!member)
        throw new HttpError(403, 'team_member_required', '只有本代表队队员可以提交训练记录');
    }
    const result = await storage.change(String(request.params.id), (space) => {
      if (!space || !visible(space, user))
        throw new HttpError(404, 'not_found', '未找到该协作空间');
      if (space.status !== 'published')
        throw new HttpError(409, 'space_closed', '该空间尚未开放或已结束');
      if (space.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '页面已更新，请重新加载');
      if (space.entries.length >= 10000)
        throw new HttpError(409, 'capacity_limit', '记录数量已达上限');
      let previous = input.entryId
        ? space.entries.find((entry) => entry.id === input.entryId)
        : ['availability', 'practice'].includes(space.kind)
          ? space.entries.find((entry) => entry.uid === user.uid)
          : undefined;
      if (input.entryId && !previous) throw new HttpError(404, 'entry_not_found', '未找到记录');
      if (previous && previous.uid !== user.uid && !manages(space, user))
        throw new HttpError(403, 'forbidden', '不能修改其他同学的记录');
      if (previous && space.kind === 'attendance' && previous.reviewStatus === 'approved')
        throw new HttpError(409, 'verified_record', '已确认的训练记录不能修改');
      if (previous && space.kind === 'review' && previous.reviewStatus !== 'rejected')
        throw new HttpError(409, 'review_locked', '已提交的审核材料不可更改');
      const uniqueChoices = [...new Set(input.choices)];
      if (uniqueChoices.some((id) => !space.slots.some((s) => s.id === id)))
        throw new HttpError(400, 'invalid_slot', '选择了不存在的选项');
      if (['availability', 'practice'].includes(space.kind) && !uniqueChoices.length)
        throw new HttpError(400, 'missing_choice', '请选择可用时间或报名志愿');
      if (space.kind === 'shared_table') {
        if (space.ownerUid !== user.uid && !user.roles.includes('platform.super_admin'))
          for (const column of space.columns)
            if (
              column.editRoleKeys?.length &&
              !column.editRoleKeys.some((role) =>
                user.roles.some((candidate) => candidate === role),
              ) &&
              JSON.stringify(input.values[column.id]) !==
                JSON.stringify(previous?.values[column.id])
            )
              throw new HttpError(403, 'column_forbidden', `不能修改${column.label}`);
        validateTableRow(space.columns, input.values);
      }
      if (space.kind === 'materials' && space.columns.length)
        validateTableRow(space.columns, input.values);
      if (space.kind === 'practice' && previous?.assignedSlot)
        throw new HttpError(409, 'assignment_locked', '已安排后请联系组织调整');
      if (space.kind === 'booking')
        assertBookingAvailable(
          space.entries.filter((entry) => entry.id !== previous?.id),
          input,
        );
      if (['review', 'materials', 'attendance'].includes(space.kind) && !input.text)
        throw new HttpError(400, 'missing_material', '请填写提交内容');
      const at = new Date().toISOString();
      const entry: CollaborationEntry = {
        id: previous?.id ?? randomUUID(),
        uid: previous?.uid ?? user.uid,
        displayName: previous?.displayName ?? user.displayName,
        createdAt: previous?.createdAt ?? at,
        updatedAt: at,
        values: input.values,
        choices: uniqueChoices,
        resource: input.resource,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        text: input.text,
        assignedSlot: previous?.assignedSlot ?? null,
        stage: 0,
        reviewStatus: 'pending',
        decisions: previous?.decisions ?? [],
        files: previous?.files ?? [],
      };
      previous = space.entries.find((value) => value.id === entry.id);
      if (previous) space.entries[space.entries.indexOf(previous)] = entry;
      else space.entries.push(entry);
      space.updatedAt = at;
      space.revision++;
      space.history.push({
        uid: user.uid,
        at,
        action: previous ? 'entry_updated' : 'entry_created',
        entryId: entry.id,
      });
      space.history = space.history.slice(-500);
      return { record: space, result: view(space, user) };
    });
    send(response, result);
  });
  router.delete('/:id/entries/:entryId', async (request, response) => {
    const user = actor(response);
    const input = parse(z.object({ revision: z.number().int().min(1) }).strict(), request.body);
    const result = await storage.change(String(request.params.id), (space) => {
      if (!space || !visible(space, user)) throw new HttpError(404, 'not_found', '未找到空间');
      if (space.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '请重新加载后再操作');
      const entry = space.entries.find((value) => value.id === request.params.entryId);
      if (!entry || (entry.uid !== user.uid && !manages(space, user)))
        throw new HttpError(403, 'forbidden', '不能删除此记录');
      if (
        space.kind === 'shared_table' &&
        space.ownerUid !== user.uid &&
        !user.roles.includes('platform.super_admin') &&
        space.columns.some(
          (column) =>
            column.editRoleKeys?.length &&
            !column.editRoleKeys.some((role) => user.roles.some((candidate) => candidate === role)),
        )
      )
        throw new HttpError(403, 'column_forbidden', '该记录包含无权删除的受限字段');
      if (['review', 'attendance'].includes(space.kind) && entry.reviewStatus === 'approved')
        throw new HttpError(409, 'verified_record', '已确认的记录不能删除');
      space.entries = space.entries.filter((value) => value.id !== entry.id);
      space.revision++;
      space.updatedAt = new Date().toISOString();
      space.history.push({
        uid: user.uid,
        at: space.updatedAt,
        action: 'entry_deleted',
        entryId: entry.id,
      });
      space.history = space.history.slice(-500);
      return { record: space, result: view(space, user) };
    });
    send(response, result);
  });
  router.post('/:id/assign', async (request, response) => {
    const user = actor(response);
    const input = parse(z.object({ revision: z.number().int().min(1) }).strict(), request.body);
    const result = await storage.change(String(request.params.id), (space) => {
      if (!space) throw new HttpError(404, 'not_found', '未找到空间');
      guard(space, user, input.revision);
      if (space.kind !== 'practice')
        throw new HttpError(400, 'invalid_kind', '该功能仅适用于志愿双选');
      if (space.entries.some((entry) => entry.assignmentStatus === 'accepted'))
        throw new HttpError(409, 'accepted_assignment', '已有同学接受安排，请使用单条调整');
      const assigned = allocatePreferences(space.slots, space.entries);
      space.entries.forEach((entry) => {
        entry.assignedSlot = assigned[entry.uid] ?? null;
        entry.assignmentStatus = 'pending';
      });
      space.revision++;
      space.updatedAt = new Date().toISOString();
      space.history.push({ uid: user.uid, at: space.updatedAt, action: 'preferences_assigned' });
      space.history = space.history.slice(-500);
      return { record: space, result: view(space, user) };
    });
    send(response, result);
  });
  router.post('/:id/entries/:entryId/assignment', async (request, response) => {
    const user = actor(response);
    const input = parse(
      z
        .object({
          revision: z.number().int().min(1),
          slotId: key.nullable().optional(),
          decision: z.enum(['accepted', 'declined']).optional(),
        })
        .strict(),
      request.body,
    );
    const result = await storage.change(String(request.params.id), (space) => {
      if (!space || space.kind !== 'practice')
        throw new HttpError(404, 'not_found', '未找到双选空间');
      if (space.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '请刷新后重试');
      const entry = space.entries.find((value) => value.id === request.params.entryId);
      if (!entry) throw new HttpError(404, 'not_found', '未找到报名');
      if (input.slotId !== undefined) {
        guard(space, user, input.revision);
        const slot = space.slots.find((value) => value.id === input.slotId);
        if (input.slotId && !slot) throw new HttpError(400, 'invalid_slot', '支队不存在');
        if (
          slot &&
          space.entries.filter(
            (value) =>
              value.id !== entry.id &&
              value.assignedSlot === slot.id &&
              value.assignmentStatus !== 'declined',
          ).length >= slot.capacity
        )
          throw new HttpError(409, 'slot_full', '该支队名额已满');
        entry.assignedSlot = input.slotId;
        entry.assignmentStatus = 'pending';
      } else if (input.decision) {
        if (entry.uid !== user.uid) throw new HttpError(403, 'forbidden', '只能确认自己的安排');
        if (!entry.assignedSlot) throw new HttpError(409, 'unassigned', '尚未安排');
        entry.assignmentStatus = input.decision;
        if (input.decision === 'declined') entry.assignedSlot = null;
      } else throw new HttpError(400, 'missing_assignment', '请选择安排或确认结果');
      space.revision++;
      space.updatedAt = new Date().toISOString();
      entry.updatedAt = space.updatedAt;
      space.history.push({
        uid: user.uid,
        at: space.updatedAt,
        action: 'assignment_updated',
        entryId: entry.id,
      });
      return { record: space, result: view(space, user) };
    });
    send(response, result);
  });
  router.post('/:id/entries/:entryId/review', async (request, response) => {
    const user = actor(response);
    const input = parse(
      z
        .object({
          revision: z.number().int().min(1),
          decision: z.enum(['approved', 'rejected']),
          note: z.string().trim().max(2000).default(''),
        })
        .strict(),
      request.body,
    );
    const result = await storage.change(String(request.params.id), (space) => {
      if (!space) throw new HttpError(404, 'not_found', '未找到空间');
      const entry = space.entries.find((value) => value.id === request.params.entryId);
      if (!entry) throw new HttpError(404, 'not_found', '未找到记录');
      if (!['review', 'attendance'].includes(space.kind))
        throw new HttpError(400, 'invalid_kind', '该空间不支持审核');
      const allowed = canReviewEntry(space, entry, user);
      if (!allowed) throw new HttpError(403, 'forbidden', '当前身份不能审核这一步');
      if (space.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '请刷新后重新审核');
      if (entry.reviewStatus !== 'pending')
        throw new HttpError(409, 'already_reviewed', '记录已完成审核');
      const at = new Date().toISOString();
      entry.decisions.push({
        uid: user.uid,
        stage: entry.stage,
        decision: input.decision,
        note: input.note,
        at,
      });
      if (input.decision === 'rejected') entry.reviewStatus = 'rejected';
      else {
        entry.stage++;
        if (space.kind === 'attendance' || entry.stage >= space.stages.length)
          entry.reviewStatus = 'approved';
      }
      entry.updatedAt = at;
      space.revision++;
      space.updatedAt = at;
      space.history.push({
        uid: user.uid,
        at,
        action: `review_${input.decision}`,
        entryId: entry.id,
      });
      space.history = space.history.slice(-500);
      return { record: space, result: view(space, user) };
    });
    send(response, result);
  });
  return router;
}
