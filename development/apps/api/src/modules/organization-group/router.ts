import { randomUUID, createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Router, type Response } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type {
  OrganizationGroupCoreField,
  OrganizationGroupEntryQuery,
  OrganizationGroupVersionInput,
  OrganizationGroupYear,
  UserContext,
} from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { UserDirectory } from '../../core/auth/user-directory.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  audit,
  ACTIVITY_PHOTO_BYTES,
  bindAssets,
  classActivityTemplate,
  deadlineDto,
  editReason,
  entryDto,
  fail,
  fileDto,
  filteredEntries,
  grantAdministrator,
  initialState,
  manages,
  entryTypeIds,
  photoBytes,
  now,
  requireAccess,
  requireManager,
  resourceDto,
  revision,
  statistics,
  submissionReason,
  validDate,
  validateDateBounds,
  validateScope,
  validateValues,
  version,
  visibleEntry,
  viewsAll,
  visibleResource,
  visibleScope,
  WORKSPACE_ID,
  workspaceDto,
  year,
  type OrganizationState,
  type StoredEntry,
} from './domain.js';
import {
  cleanPending,
  inspectFile,
  removeFile,
  sendFile,
  storeFile,
  visibleAsset,
} from './files.js';
import { createClassSecretariesRouter } from './secretaries-router.js';
export interface OrganizationGroupOptions {
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
  uploadDirectory?: string;
  nodeEnvironment?: string;
  store?: DevelopmentStore;
  userDirectory?: UserDirectory;
}

const key = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/)
  .refine(
    (value) =>
      value !== 'prototype' && !Object.prototype.hasOwnProperty.call(Object.prototype, value),
  );
const uid = z.string().trim().min(1).max(100);
const rev = z.number().int().min(1);
const date = z.string().refine(validDate, '日期格式无效');
const scope = z.union([
  z.object({ kind: z.enum(['all', 'department']) }).strict(),
  z.object({ kind: z.enum(['classes', 'users']), ids: z.array(uid).min(1).max(1000) }).strict(),
]);
const viewScope = z.union([
  z.object({ kind: z.enum(['own', 'same_class', 'all']) }).strict(),
  z.object({ kind: z.literal('users'), ids: z.array(uid).min(1).max(1000) }).strict(),
]);
const field = z
  .object({
    id: key,
    label: z.string().trim().min(1).max(120),
    help: z.string().max(2000).optional(),
    kind: z.enum(['text', 'long_text', 'integer', 'date', 'choice', 'multi_choice', 'image']),
    required: z.boolean(),
    options: z.array(z.string().min(1).max(200)).max(100).optional(),
    maxLength: z.number().int().min(1).max(10000).optional(),
    min: z.number().int().safe().optional(),
    max: z.number().int().safe().optional(),
  })
  .strict();
const presentation = z
  .object({ label: z.string().trim().min(1).max(120), help: z.string().max(2000).optional() })
  .strict();
const definition = z
  .object({
    template: z.literal('class_activity_v2').optional(),
    activityTypes: z
      .array(z.object({ id: key, label: z.string().trim().min(1).max(120) }).strict())
      .min(1)
      .max(100),
    fields: z.array(field).max(40),
    corePresentation: z
      .object({
        classId: presentation.optional(),
        participantCount: presentation.optional(),
        activityTypeId: presentation.optional(),
        activityTypeIds: presentation.optional(),
        participantNames: presentation.optional(),
        activityDate: presentation.optional(),
        summary: presentation.optional(),
        photos: presentation.optional(),
        difficulties: presentation.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const values = z
  .object({
    classId: key,
    participantCount: z.number().int().min(1).max(1000000),
    activityTypeId: key.optional(),
    activityTypeIds: z.array(key).min(1).max(100).optional(),
    participantNames: z.string().max(16000).optional(),
    activityDate: date.nullable().optional(),
    summary: z.string().min(1).max(800),
    difficulties: z
      .string()
      .refine((value) => Array.from(value).length <= 2000, '备注最多 2000 个字符')
      .default(''),
    photoIds: z.array(z.string().uuid()).max(30),
    extraAnswers: z
      .record(
        z.union([
          z.string().max(20000),
          z.number().finite(),
          z.array(z.string().max(500)).max(100),
        ]),
      )
      .default({}),
  })
  .strict();
const settings = z
  .object({
    revision: rev,
    activeYearId: key.optional(),
    viewScope: viewScope.optional(),
    hideDifficulties: z.boolean().optional(),
    ordinaryExport: z.boolean().optional(),
    maxPhotos: z.number().int().min(1).max(30).optional(),
    maxPhotoBytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 ** 2)
      .optional(),
    maxResourceBytes: z
      .number()
      .int()
      .min(1)
      .max(100 * 1024 ** 2)
      .optional(),
    classes: z
      .array(z.object({ id: key, label: z.string().trim().min(1).max(120) }).strict())
      .max(1000)
      .optional(),
    members: z
      .array(
        z
          .object({
            uid,
            studentId: z.string().trim().min(1).max(100),
            classId: key,
            submitClassIds: z.array(key).max(1000),
          })
          .strict(),
      )
      .max(20000)
      .optional(),
    managerUids: z.array(uid).max(100).optional(),
  })
  .strict();
const yearChanges = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    startDate: date.nullable().optional(),
    endDate: date.nullable().optional(),
    archived: z.boolean().optional(),
    submissionOpen: z.boolean().optional(),
    editOpen: z.boolean().optional(),
  })
  .strict();
const deadlineInput = z
  .object({
    yearId: key,
    title: z.string().trim().min(1).max(160),
    description: z.string().max(10000).default(''),
    dueAt: z.string().datetime({ offset: true }),
    scope,
    status: z.enum(['active', 'cancelled']).default('active'),
  })
  .strict();
const resourceInput = z
  .object({
    yearId: key,
    title: z.string().trim().min(1).max(160),
    description: z.string().max(10000).default(''),
    fileId: z.string().uuid(),
    deadlineId: z.string().uuid().nullable().default(null),
    scope,
  })
  .strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, 'invalid_request', result.error.issues[0]?.message ?? '输入内容无效');
  return result.data as z.output<S>;
}
function unique(ids: string[], message: string) {
  if (new Set(ids).size !== ids.length) fail(400, 'duplicate_id', message);
}
function omitKeys<T extends object, K extends keyof T>(input: T, keys: K[]): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(input).filter(([name]) => !keys.includes(name as K)),
  ) as Omit<T, K>;
}
function validateDefinition(s: OrganizationState, input: OrganizationGroupVersionInput) {
  unique(
    input.activityTypes.map((row) => row.id),
    '活动类型 ID 重复',
  );
  unique(
    input.fields.map((row) => row.id),
    '题目 ID 重复',
  );
  for (const f of input.fields) {
    if (
      [
        'classId',
        'participantCount',
        'activityTypeId',
        'activityTypeIds',
        'participantNames',
        'activityDate',
        'summary',
        'photos',
        'difficulties',
      ].includes(f.id)
    )
      fail(400, 'core_field_reserved', '核心字段不能被替换或停用');
    if (['choice', 'multi_choice'].includes(f.kind) && !f.options?.length)
      fail(400, 'missing_options', '选择题需要至少一个选项');
    if (f.options) unique(f.options, '题目选项重复');
    if (f.min !== undefined && f.max !== undefined && f.min > f.max)
      fail(400, 'invalid_constraint', '题目范围无效');
    if (s.versions.some((v) => v.fields.some((old) => old.id === f.id && old.kind !== f.kind)))
      fail(409, 'field_kind_changed', '变更题型须使用新的稳定字段 ID');
  }
}
function validateYear(y: OrganizationGroupYear) {
  if (y.startDate && y.endDate && y.startDate > y.endDate)
    fail(400, 'invalid_year_dates', '学年结束日期不能早于开始日期');
}
function queryInput(value: unknown): OrganizationGroupEntryQuery {
  return parse(
    z
      .object({
        yearId: key.optional(),
        classId: key.optional(),
        activityTypeId: key.optional(),
        authorUid: uid.optional(),
        dateFrom: date.optional(),
        dateTo: date.optional(),
        query: z.string().max(500).optional(),
        sort: z
          .enum([
            'created_desc',
            'created_asc',
            'date_asc',
            'date_desc',
            'participants_asc',
            'participants_desc',
          ])
          .optional(),
        page: z.coerce.number().int().min(1).max(1000000).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
      })
      .strict()
      .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, '日期筛选范围无效'),
    value,
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function attachVersion(
  s: OrganizationState,
  user: UserContext,
  y: OrganizationGroupYear,
  input: OrganizationGroupVersionInput,
) {
  validateDefinition(s, input);
  const published = {
    ...input,
    id: randomUUID(),
    yearId: y.id,
    number: s.versions.filter((v) => v.yearId === y.id).length + 1,
    publishedAt: now(),
    publishedBy: user.uid,
  };
  s.versions.push(published);
  y.currentVersionId = published.id;
  y.draft = null;
  y.revision++;
  audit(s, user, 'version_published', published.id, y.revision);
  return published;
}
export function createOrganizationGroupRouter(options: OrganizationGroupOptions) {
  const router = Router();
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const storage = featureStorage<OrganizationState>(directory, 'organization-group');
  const read = async () => (await storage.get(WORKSPACE_ID)) ?? initialState();
  const change = <T>(operation: (state: OrganizationState) => T | Promise<T>) =>
    storage.change(WORKSPACE_ID, async (current) => {
      const state = current ?? initialState();
      const result = await operation(state);
      return { record: state, result };
    });
  const actor = (response: Response) => response.locals.actor as UserContext;
  const send = (response: Response, data: unknown, status = 200) =>
    response
      .setHeader('Cache-Control', 'private, no-store')
      .status(status)
      .json({ data, requestId: response.locals.requestId });
  router.use(async (request, response, next) => {
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      fail(503, 'storage_not_configured', '组织组独立存储尚未配置');
    response.locals.actor = identity.user;
    next();
  });
  if (options.store) {
    router.use(
      '/secretaries',
      createClassSecretariesRouter({
        store: options.store,
        directory: options.userDirectory,
        readClasses: async () => (await read()).classes,
      }),
    );
  }
  router.get('/workspace', async (_request, response) =>
    send(response, workspaceDto(await read(), actor(response))),
  );
  router.patch('/settings', async (request, response) => {
    const user = actor(response);
    const input = parse(settings, request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        revision(s.revision, input.revision);
        const before = {
          ...s.settings,
          classes: s.classes,
          members: s.members,
          managerUids: s.managerUids,
        };
        if (input.managerUids !== undefined && !grantAdministrator(user))
          fail(403, 'grant_forbidden', '只有平台超级管理员或非预览开发负责人可以授予管理权限');
        const classes = input.classes ?? s.classes;
        const members = input.members ?? s.members;
        unique(
          classes.map((row) => row.id),
          '班级 ID 重复',
        );
        unique(
          members.map((row) => row.uid),
          'UID 重复',
        );
        unique(
          members.map((row) => row.studentId),
          '学号重复',
        );
        if (input.managerUids) unique(input.managerUids, '管理者 UID 重复');
        for (const row of members) {
          unique(row.submitClassIds, '允许班级重复');
          if (![row.classId, ...row.submitClassIds].every((id) => classes.some((c) => c.id === id)))
            fail(400, 'unknown_class', '用户映射包含未配置班级');
        }
        if (s.entries.some((e) => !classes.some((c) => c.id === e.classId)))
          fail(409, 'class_in_use', '已有历史记录的班级不能移除');
        if (input.activeYearId) year(s, input.activeYearId);
        s.classes = classes;
        s.members = members;
        if (input.managerUids) s.managerUids = input.managerUids;
        const config = omitKeys(input, ['revision', 'classes', 'members', 'managerUids']);
        s.settings = { ...s.settings, ...config };
        if (s.settings.viewScope.kind === 'users') validateScope(s, s.settings.viewScope);
        // Existing scopes may never reference a class removed from the directory.
        for (const item of [...s.deadlines, ...s.resources]) validateScope(s, item.scope);
        s.revision++;
        audit(s, user, 'settings_updated', s.id, s.revision, before, {
          ...s.settings,
          classes: s.classes,
          members: s.members,
          managerUids: s.managerUids,
        });
        return workspaceDto(s, user);
      }),
    );
  });
  router.post('/years', async (request, response) => {
    const user = actor(response);
    const input = parse(
      z
        .object({
          revision: rev,
          label: z.string().trim().min(1).max(100),
          startDate: date.nullable().optional(),
          endDate: date.nullable().optional(),
          copyFromYearId: key.optional(),
        })
        .strict(),
      request.body,
    );
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        revision(s.revision, input.revision);
        const y: OrganizationGroupYear = {
          id: randomUUID(),
          label: input.label,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          revision: 1,
          archived: false,
          submissionOpen: true,
          editOpen: true,
          currentVersionId: null,
          draft: null,
        };
        validateYear(y);
        const source = input.copyFromYearId ? year(s, input.copyFromYearId) : null;
        s.years.push(y);
        if (source?.currentVersionId) {
          const v = version(s, source.currentVersionId);
          attachVersion(s, user, y, {
            activityTypes: v.activityTypes,
            fields: v.fields,
            ...(v.corePresentation ? { corePresentation: v.corePresentation } : {}),
          });
        }
        s.settings.activeYearId = y.id;
        s.revision++;
        audit(s, user, 'year_created', y.id, y.revision);
        return y;
      }),
      201,
    );
  });
  router.patch('/years/:id', async (request, response) => {
    const user = actor(response);
    const input = parse(yearChanges.extend({ revision: rev }).strict(), request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const y = year(s, String(request.params.id));
        revision(y.revision, input.revision);
        const changes = omitKeys(input, ['revision']);
        const next = { ...y, ...changes, revision: y.revision + 1 };
        validateYear(next);
        for (const e of s.entries.filter((e) => e.yearId === y.id))
          validateDateBounds(next, e.activityDate);
        Object.assign(y, next);
        audit(s, user, 'year_updated', y.id, y.revision);
        return y;
      }),
    );
  });
  router.put('/years/:id/draft', async (request, response) => {
    const user = actor(response);
    const input = parse(definition.extend({ revision: rev }).strict(), request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const y = year(s, String(request.params.id));
        revision(y.revision, input.revision);
        const schema = omitKeys(input, ['revision']);
        validateDefinition(s, schema);
        y.draft = schema;
        y.revision++;
        audit(s, user, 'draft_saved', y.id, y.revision);
        return y;
      }),
    );
  });
  router.post('/years/:id/versions', async (request, response) => {
    const user = actor(response);
    const input = parse(definition.extend({ revision: rev }).strict(), request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const y = year(s, String(request.params.id));
        revision(y.revision, input.revision);
        const schema = omitKeys(input, ['revision']);
        return attachVersion(s, user, y, schema);
      }),
      201,
    );
  });
  router.post('/years/:id/template', async (request, response) => {
    const user = actor(response);
    const input = parse(z.object({ revision: rev }).strict(), request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const y = year(s, String(request.params.id));
        revision(y.revision, input.revision);
        if (y.archived) fail(409, 'year_archived', '归档学年不能发布新问卷');
        return attachVersion(s, user, y, classActivityTemplate());
      }),
      201,
    );
  });
  router.get('/entries', async (request, response) => {
    const s = await read();
    const user = actor(response);
    requireAccess(s, user);
    const q = queryInput(request.query);
    year(s, q.yearId ?? s.settings.activeYearId);
    const rows = filteredEntries(s, user, q);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    send(response, {
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((e) => entryDto(s, user, e)),
      total: rows.length,
      page,
      pageSize,
      statistics: statistics(rows),
    });
  });
  router.get('/entries/statistics', async (request, response) => {
    const s = await read();
    const user = actor(response);
    requireAccess(s, user);
    const q = queryInput(request.query);
    year(s, q.yearId ?? s.settings.activeYearId);
    send(response, statistics(filteredEntries(s, user, q)));
  });
  router.get('/export.xlsx', async (request, response) => {
    const s = await read();
    const user = actor(response);
    requireAccess(s, user);
    if (!viewsAll(s, user) && !s.settings.ordinaryExport)
      fail(403, 'export_forbidden', '当前未开放普通用户导出');
    const q = queryInput(request.query);
    year(s, q.yearId ?? s.settings.activeYearId);
    const rows = filteredEntries(s, user, q);
    const showDifficulties = !s.settings.hideDifficulties || viewsAll(s, user);
    const fields = s.versions
      .filter((v) => v.yearId === (q.yearId ?? s.settings.activeYearId))
      .flatMap((v) => v.fields)
      .filter((f, i, all) => all.findIndex((row) => row.id === f.id) === i);
    const currentYear = year(s, q.yearId ?? s.settings.activeYearId);
    const currentVersion = currentYear.currentVersionId
      ? version(s, currentYear.currentVersionId)
      : null;
    const label = (field: OrganizationGroupCoreField, fallback: string) =>
      currentVersion?.corePresentation?.[field]?.label ?? fallback;
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('活动台账');
    sheet.addRow([
      label('classId', '班级'),
      label('participantCount', '参与人数'),
      label('activityDate', '活动时间'),
      label('activityTypeIds', label('activityTypeId', '活动标签')),
      label('summary', '活动内容'),
      label('photos', '活动照片'),
      ...(showDifficulties ? [label('difficulties', '备注')] : []),
      label('participantNames', '具体参与人员'),
      '提交时间（上海）',
      '填报人',
      ...fields.map((f) => f.label),
    ]);
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/u.test(text) ? `'${text}` : text;
    };
    for (const e of rows) {
      const dto = entryDto(s, user, e);
      const v = version(s, e.versionId);
      sheet.addRow([
        safe(dto.classLabel),
        e.participantCount,
        safe(e.activityDate),
        safe(dto.activityTypeLabels?.join('、') ?? dto.activityTypeLabel),
        safe(e.summary),
        e.photoIds.length ? `${e.photoIds.length} 张` : '',
        ...(showDifficulties ? [safe(e.difficulties)] : []),
        safe(e.participantNames),
        new Date(e.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
        safe(e.authorName),
        ...fields.map((f) =>
          v.fields.some((old) => old.id === f.id)
            ? safe(
                Array.isArray(e.extraAnswers[f.id])
                  ? (e.extraAnswers[f.id] as string[]).join('、')
                  : e.extraAnswers[f.id],
              )
            : '该版本无此题',
        ),
      ]);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
    };
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    sheet.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true };
    });
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', 'attachment; filename=organization-group.xlsx');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(Buffer.from(await book.xlsx.writeBuffer()));
  });
  router.post('/entries', async (request, response) => {
    const user = actor(response);
    const input = parse(
      values.extend({ yearId: key, expectedVersionId: z.string().uuid() }).strict(),
      request.body,
    );
    const retryKey = request.get('Idempotency-Key');
    if (!retryKey || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(retryKey))
      fail(400, 'idempotency_key_required', '请携带本次提交的唯一重试标识');
    const digest = createHash('sha256').update(canonical(input)).digest('hex');
    const result = await change((s) => {
      requireAccess(s, user);
      const prior = s.retries.find((row) => row.uid === user.uid && row.key === retryKey);
      if (prior) {
        if (prior.digest !== digest)
          fail(409, 'idempotency_conflict', '该重试标识已用于不同提交内容');
        const e = s.entries.find((row) => row.id === prior.entryId);
        if (!e || !visibleEntry(s, user, e)) fail(404, 'not_found', '未找到该活动');
        return { entry: entryDto(s, user, e), retry: true };
      }
      const y = year(s, input.yearId);
      const reason = submissionReason(s, user, y);
      if (reason) fail(409, 'submission_closed', reason);
      if (y.currentVersionId !== input.expectedVersionId)
        fail(409, 'form_version_changed', '问卷版本已更新，请重新加载并确认后提交');
      const v = version(s, input.expectedVersionId);
      const extraPhotoIds = validateValues(s, user, y, v, input);
      const id = randomUUID();
      const at = now();
      bindAssets(
        s,
        user,
        [...input.photoIds, ...extraPhotoIds],
        y.id,
        'activity_photo',
        'entry',
        id,
        v,
      );
      const e: StoredEntry = {
        id,
        yearId: y.id,
        versionId: v.id,
        authorUid: user.uid,
        authorName: user.displayName,
        classId: input.classId,
        participantCount: input.participantCount,
        activityTypeId: entryTypeIds(input)[0]!,
        activityTypeIds: entryTypeIds(input),
        participantNames: input.participantNames ?? '',
        activityDate: input.activityDate ?? null,
        summary: input.summary,
        difficulties: input.difficulties,
        photoIds: input.photoIds,
        extraAnswers: input.extraAnswers,
        extraPhotoIds,
        locked: false,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      };
      s.entries.push(e);
      s.retries.push({ uid: user.uid, key: retryKey, digest, entryId: id });
      audit(s, user, 'entry_created', id, 1);
      return { entry: entryDto(s, user, e), retry: false };
    });
    send(response, result.entry, result.retry ? 200 : 201);
  });
  router.get('/entries/:id', async (request, response) => {
    const s = await read();
    const user = actor(response);
    const e = s.entries.find((row) => row.id === request.params.id);
    if (!e || !visibleEntry(s, user, e)) fail(404, 'not_found', '未找到该活动');
    send(response, entryDto(s, user, e));
  });
  router.get('/entries/:id/edit-context', async (request, response) => {
    const s = await read();
    const user = actor(response);
    const e = s.entries.find((row) => row.id === request.params.id);
    if (!e || !visibleEntry(s, user, e)) fail(404, 'not_found', '未找到该活动');
    if (e.authorUid !== user.uid) fail(403, 'edit_forbidden', '只能修改本人记录');
    const reason = editReason(s, user, e);
    if (reason) fail(409, 'entry_locked', reason);
    send(response, { entry: entryDto(s, user, e, true), version: version(s, e.versionId) });
  });
  router.patch('/entries/:id', async (request, response) => {
    const user = actor(response);
    const input = parse(values.partial().extend({ revision: rev }).strict(), request.body);
    send(
      response,
      await change((s) => {
        const e = s.entries.find((row) => row.id === request.params.id);
        if (!e) fail(404, 'not_found', '未找到该活动');
        if (e.authorUid !== user.uid) fail(403, 'edit_forbidden', '只能修改本人记录');
        if (!visibleEntry(s, user, e)) fail(404, 'not_found', '未找到该活动');
        revision(e.revision, input.revision);
        const reason = editReason(s, user, e);
        if (reason) fail(409, 'entry_locked', reason);
        const changes = omitKeys(input, ['revision']);
        const next = { ...e, ...changes };
        if (input.activityTypeId !== undefined && input.activityTypeIds === undefined) {
          next.activityTypeIds = [input.activityTypeId];
        }
        const extraPhotoIds = validateValues(
          s,
          user,
          year(s, e.yearId),
          version(s, e.versionId),
          next,
        );
        bindAssets(
          s,
          user,
          [...next.photoIds, ...extraPhotoIds],
          e.yearId,
          'activity_photo',
          'entry',
          e.id,
          version(s, e.versionId),
        );
        const before = { ...e };
        Object.assign(e, next, {
          activityTypeId: entryTypeIds(next)[0]!,
          activityTypeIds: entryTypeIds(next),
          extraPhotoIds,
          revision: e.revision + 1,
          updatedAt: now(),
        });
        audit(s, user, 'entry_updated', e.id, e.revision, before, e);
        return entryDto(s, user, e);
      }),
    );
  });
  router.patch('/entries/:id/lock', async (request, response) => {
    const user = actor(response);
    const input = parse(z.object({ revision: rev, locked: z.boolean() }).strict(), request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const e = s.entries.find((row) => row.id === request.params.id);
        if (!e) fail(404, 'not_found', '未找到该活动');
        revision(e.revision, input.revision);
        const before = { locked: e.locked, revision: e.revision };
        e.locked = input.locked;
        e.revision++;
        e.updatedAt = now();
        audit(s, user, e.locked ? 'entry_locked' : 'entry_unlocked', e.id, e.revision, before, {
          locked: e.locked,
          revision: e.revision,
        });
        return entryDto(s, user, e);
      }),
    );
  });
  router.post(
    '/uploads',
    async (request, response, next) => {
      const s = await read();
      const user = actor(response);
      requireAccess(s, user);
      // Multipart fields are unavailable until parsed; allow the largest possible photo rule,
      // then enforce the actual original questionnaire version before accepting the upload.
      const maximumPhotoBytes = Math.max(s.settings.maxPhotoBytes, ACTIVITY_PHOTO_BYTES);
      const maximum = manages(s, user)
        ? Math.max(s.settings.maxResourceBytes, maximumPhotoBytes)
        : maximumPhotoBytes;
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maximum, files: 1, fields: 3, fieldSize: 200, parts: 4 },
      }).single('file');
      upload(request, response, (error) => {
        if (error)
          return next(
            new HttpError(
              error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
              'upload_failed',
              '上传文件超过限制或表单内容无效',
            ),
          );
        next();
      });
    },
    async (request, response) => {
      const user = actor(response);
      const input = parse(
        z
          .object({
            yearId: key,
            purpose: z.enum(['activity_photo', 'resource']),
            entryId: z.string().uuid().optional(),
          })
          .strict(),
        request.body,
      );
      if (!request.file) fail(400, 'missing_file', '请选择一个文件');
      const file = request.file;
      const id = randomUUID();
      let written = false;
      try {
        const dto = await change(async (s) => {
          requireAccess(s, user);
          const y = year(s, input.yearId);
          if (input.purpose === 'resource') {
            requireManager(s, user);
            if (input.entryId) fail(400, 'invalid_upload_context', '公共资料不能关联活动编辑');
          } else if (input.entryId) {
            const e = s.entries.find((row) => row.id === input.entryId && row.yearId === y.id);
            if (!e || !visibleEntry(s, user, e)) fail(404, 'not_found', '未找到该活动');
            const reason = editReason(s, user, e);
            if (reason) fail(e.authorUid === user.uid ? 409 : 403, 'entry_locked', reason);
          } else {
            const reason = submissionReason(s, user, y);
            if (reason) fail(409, 'submission_closed', reason);
          }
          const currentVersion = input.entryId
            ? version(s, s.entries.find((e) => e.id === input.entryId)!.versionId)
            : y.currentVersionId
              ? version(s, y.currentVersionId)
              : null;
          const maximum =
            input.purpose === 'activity_photo'
              ? currentVersion
                ? photoBytes(s, currentVersion)
                : s.settings.maxPhotoBytes
              : s.settings.maxResourceBytes;
          if (file.size < 1 || file.size > maximum)
            fail(413, 'file_too_large', `文件不得超过 ${maximum} 字节`);
          const inspected = await inspectFile(file, input.purpose);
          await cleanPending(directory, s);
          if (s.assets.filter((a) => a.ownerUid === user.uid && !a.binding).length >= 100)
            fail(409, 'pending_asset_limit', '待绑定文件过多，请完成提交或等待清理');
          await storeFile(directory, id, file.buffer);
          written = true;
          const asset = {
            ...inspected,
            id,
            purpose: input.purpose,
            yearId: y.id,
            createdAt: now(),
            ownerUid: user.uid,
            binding: null,
          };
          s.assets.push(asset);
          return fileDto(asset);
        });
        send(response, dto, 201);
      } catch (error) {
        if (written) await removeFile(directory, id);
        throw error;
      }
    },
  );
  router.get('/files/:id', async (request, response) => {
    const s = await read();
    const user = actor(response);
    const asset = s.assets.find((row) => row.id === request.params.id);
    if (!asset || !visibleAsset(s, user, asset)) fail(404, 'not_found', '未找到文件');
    await sendFile(directory, asset, response, request.query.preview === '1');
  });
  router.get('/deadlines', async (request, response) => {
    const s = await read();
    const user = actor(response);
    requireAccess(s, user);
    const q = parse(z.object({ yearId: key.optional() }).strict(), request.query);
    const yearId = q.yearId ?? s.settings.activeYearId;
    year(s, yearId);
    const items = s.deadlines
      .filter((d) => d.yearId === yearId && visibleScope(s, user, d.scope))
      .map(deadlineDto);
    const order = { upcoming: 0, expired: 1, cancelled: 2 };
    items.sort(
      (a, b) =>
        order[a.displayStatus] - order[b.displayStatus] ||
        (a.displayStatus === 'upcoming'
          ? a.dueAt.localeCompare(b.dueAt)
          : b.dueAt.localeCompare(a.dueAt)) ||
        a.id.localeCompare(b.id),
    );
    send(response, { items });
  });
  router.post('/deadlines', async (request, response) => {
    const user = actor(response);
    const input = parse(deadlineInput, request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        year(s, input.yearId);
        validateScope(s, input.scope);
        const d = {
          ...input,
          dueAt: new Date(input.dueAt).toISOString(),
          id: randomUUID(),
          revision: 1,
          createdBy: user.uid,
          updatedAt: now(),
        };
        s.deadlines.push(d);
        audit(s, user, 'deadline_created', d.id, d.revision);
        return deadlineDto(d);
      }),
      201,
    );
  });
  router.patch('/deadlines/:id', async (request, response) => {
    const user = actor(response);
    const input = parse(
      deadlineInput.omit({ yearId: true }).partial().extend({ revision: rev }).strict(),
      request.body,
    );
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const d = s.deadlines.find((row) => row.id === request.params.id);
        if (!d) fail(404, 'not_found', '未找到截止事项');
        revision(d.revision, input.revision);
        if (input.scope) validateScope(s, input.scope);
        const before = { ...d };
        const changes = omitKeys(input, ['revision']);
        Object.assign(d, changes, {
          dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : d.dueAt,
          revision: d.revision + 1,
          updatedAt: now(),
        });
        audit(s, user, 'deadline_updated', d.id, d.revision, before, d);
        return deadlineDto(d);
      }),
    );
  });
  router.get('/resources', async (request, response) => {
    const s = await read();
    const user = actor(response);
    requireAccess(s, user);
    const q = parse(
      z.object({ yearId: key.optional(), deadlineId: z.string().uuid().optional() }).strict(),
      request.query,
    );
    const yearId = q.yearId ?? s.settings.activeYearId;
    year(s, yearId);
    const items = s.resources
      .filter(
        (r) =>
          r.yearId === yearId &&
          (!q.deadlineId || r.deadlineId === q.deadlineId) &&
          visibleResource(s, user, r),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map((r) => resourceDto(s, r));
    send(response, { items });
  });
  function checkParent(s: OrganizationState, yearId: string, deadlineId: string | null) {
    if (deadlineId && !s.deadlines.some((d) => d.id === deadlineId && d.yearId === yearId))
      fail(400, 'invalid_deadline', '关联截止事项必须属于同一学年');
  }
  router.post('/resources', async (request, response) => {
    const user = actor(response);
    const input = parse(resourceInput, request.body);
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        year(s, input.yearId);
        validateScope(s, input.scope);
        checkParent(s, input.yearId, input.deadlineId);
        const r = {
          ...input,
          id: randomUUID(),
          revision: 1,
          createdBy: user.uid,
          updatedAt: now(),
        };
        bindAssets(s, user, [r.fileId], r.yearId, 'resource', 'resource', r.id);
        s.resources.push(r);
        audit(s, user, 'resource_created', r.id, r.revision);
        return resourceDto(s, r);
      }),
      201,
    );
  });
  router.patch('/resources/:id', async (request, response) => {
    const user = actor(response);
    const input = parse(
      resourceInput.omit({ yearId: true }).partial().extend({ revision: rev }).strict(),
      request.body,
    );
    send(
      response,
      await change((s) => {
        requireManager(s, user);
        const r = s.resources.find((row) => row.id === request.params.id);
        if (!r) fail(404, 'not_found', '未找到资料');
        revision(r.revision, input.revision);
        if (input.scope) validateScope(s, input.scope);
        const changes = omitKeys(input, ['revision']);
        const next = { ...r, ...changes };
        checkParent(s, r.yearId, next.deadlineId);
        if (next.fileId !== r.fileId)
          bindAssets(s, user, [next.fileId], r.yearId, 'resource', 'resource', r.id);
        const before = { ...r };
        Object.assign(r, next, { revision: r.revision + 1, updatedAt: now() });
        audit(s, user, 'resource_updated', r.id, r.revision, before, r);
        return resourceDto(s, r);
      }),
    );
  });
  return router;
}
