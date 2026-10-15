import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  systemSettingsIdentitySections,
  DEMO_USERS,
  MODULE_IDS,
  ROLE_KEYS,
  SOCIAL_ORGANIZATIONS,
  SOCIAL_ORGANIZATION_IDS,
  isDevelopmentBusinessAdmin,
  type ApiEnvelope,
  type DevelopmentRewardProvider,
  type DevelopmentRewardInput,
  type DevelopmentRewardResult,
  type SystemSettingsOrganizations,
  type SystemSettingsRecipient,
} from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DirectoryUser, UserDirectory } from '../../core/auth/user-directory.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { listModuleManifests } from '../../core/modules/registry.js';
import { ASSIGNABLE_ROLES } from '../admin/development-users-router.js';
import { hasRecipientAccess, listSettingsUsers, updateSettingsUser } from './users.js';
import {
  appendFeatureAudit,
  ownInbox,
  systemSettingsStorage,
  type SettingsState,
} from './storage.js';

export interface SystemSettingsOptions {
  store: DevelopmentStore;
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
  userDirectory?: UserDirectory;
  allowedUids?: readonly string[];
  directory?: string;
  nodeEnvironment: string;
  authMode: 'demo' | 'main';
  rewardProvider?: DevelopmentRewardProvider;
}
const uid = z.string().trim().min(1).max(128);
const requestId = z.string().trim().min(1).max(128);
const roles = z.enum(
  ASSIGNABLE_ROLES as [(typeof ASSIGNABLE_ROLES)[number], ...(typeof ASSIGNABLE_ROLES)[number][]],
);
const recipients = z
  .array(uid)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, 'Recipients must be unique');
const userInput = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    roles: z
      .array(roles)
      .max(ROLE_KEYS.length)
      .refine((values) => new Set(values).size === values.length),
    captainTeamIds: z
      .array(uid)
      .max(20)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();
function validLink(value: string) {
  return (
    /^\/development(?:\/[a-zA-Z0-9/_-]*)?$/.test(value) &&
    !value.includes('//') &&
    !value.includes('..')
  );
}
const noticeInput = z
  .object({
    requestId,
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(4000),
    recipientUids: recipients,
    link: z.string().max(500).refine(validLink).nullable().optional(),
  })
  .strict();
const rewardInput = z
  .object({
    requestId,
    recipientUids: recipients,
    title: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(1).max(1000),
    electric: z.number().int().min(0).max(1_000_000),
    magnetic: z.number().int().min(0).max(1_000_000),
  })
  .strict()
  .refine((value) => value.electric > 0 || value.magnetic > 0);
const organizationsInput = z
  .object({
    revision: z.number().int().min(0),
    organizations: z
      .array(
        z
          .object({
            id: z.enum(SOCIAL_ORGANIZATION_IDS),
            name: z.string().trim().min(1).max(80),
            description: z.string().trim().max(1000),
          })
          .strict(),
      )
      .max(SOCIAL_ORGANIZATION_IDS.length)
      .optional(),
    roles: z
      .array(z.object({ key: roles, name: z.string().trim().min(1).max(80) }).strict())
      .max(ROLE_KEYS.length)
      .optional(),
  })
  .strict()
  .refine((value) => value.organizations !== undefined || value.roles !== undefined);
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', '请求参数无效');
  return result.data;
}
function send<T>(response: Response, status: number, data: T) {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}
function actor(response: Response): AuthorizationContext {
  return response.locals.user as AuthorizationContext;
}
function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function demoDirectory(): UserDirectory {
  const users: DirectoryUser[] = DEMO_USERS.map((user) => ({
    uid: user.uid,
    username: user.uid,
    displayName: user.displayName,
    studentId: null,
    avatarUrl: null,
  }));
  return {
    list: async (query) =>
      users.filter((user) => !query || `${user.uid} ${user.displayName}`.includes(query)),
    get: async (uid) => users.find((user) => user.uid === uid) ?? null,
  };
}
export function createDemoDevelopmentRewardProvider(): DevelopmentRewardProvider {
  const results = new Map<string, { fingerprint: string; result: DevelopmentRewardResult }>();
  return {
    grant: async (actorUid, input) => {
      const key = fingerprint([actorUid, input.requestId]);
      const hash = fingerprint({ ...input, recipientUids: [...input.recipientUids].sort() });
      const existing = results.get(key);
      if (existing) {
        if (existing.fingerprint !== hash)
          throw new HttpError(409, 'idempotency_conflict', '重试内容与原请求不一致');
        return { ...existing.result, replayed: true };
      }
      const result = {
        batchId: `demo-${key.slice(0, 24)}`,
        recipientCount: input.recipientUids.length,
        electric: input.electric,
        magnetic: input.magnetic,
        totalElectric: input.electric * input.recipientUids.length,
        totalMagnetic: input.magnetic * input.recipientUids.length,
        replayed: false,
      };
      results.set(key, { fingerprint: hash, result });
      return result;
    },
  };
}

export function createSystemSettingsRouters(options: SystemSettingsOptions) {
  const settings = Router();
  const inbox = Router();
  const directory =
    options.userDirectory ?? (options.authMode === 'demo' ? demoDirectory() : undefined);
  const root =
    options.directory ??
    (options.nodeEnvironment === 'production'
      ? undefined
      : mkdtempSync(join(tmpdir(), 'development-system-settings-')));
  const storage =
    root && (options.nodeEnvironment !== 'production' || isAbsolute(root))
      ? systemSettingsStorage(resolve(root))
      : undefined;
  const provider =
    options.rewardProvider ??
    (options.authMode === 'demo' ? createDemoDevelopmentRewardProvider() : undefined);
  const requireStorage = () => {
    if (!storage)
      throw new HttpError(503, 'system_settings_storage_unavailable', '发展端设置存储尚未配置');
    return storage;
  };
  const requireDirectory = () => {
    if (!directory) throw new HttpError(503, 'user_directory_unavailable', '主站用户目录暂不可用');
    return directory;
  };
  for (const [router, admin] of [
    [settings, true],
    [inbox, false],
  ] as const)
    router.use(async (request, response, next) => {
      const result = await options.authenticate(request.headers);
      if (result.status !== 200) {
        send(response, result.status, { error: { code: result.code, message: result.message } });
        return;
      }
      const leadPreview =
        result.user.previewing === true &&
        result.user.developmentAccess === 'lead' &&
        result.user.viewer?.canManageDevelopment === true &&
        result.user.viewer.canPreviewDevelopment === true;
      if (
        (admin &&
          (!isDevelopmentBusinessAdmin(result.user) || (result.user.previewing && !leadPreview))) ||
        (result.user.previewing && !['GET', 'HEAD'].includes(request.method))
      )
        throw new HttpError(403, 'forbidden', '此身份无操作权限');
      response.locals.user = result.user;
      next();
    });
  async function metadata(state: SettingsState): Promise<SystemSettingsOrganizations> {
    const saved = state.organizations;
    const definitions = (await options.store.roles.list()).filter(
      (role) => role.key !== 'platform.super_admin',
    );
    return {
      revision: saved?.revision ?? 0,
      organizations: SOCIAL_ORGANIZATIONS.map((org) => ({
        id: org.id,
        name: saved?.organizations.find((row) => row.id === org.id)?.name ?? org.name,
        description: saved?.organizations.find((row) => row.id === org.id)?.description ?? '',
      })),
      roles: definitions.map((role) => ({
        key: role.key as (typeof ASSIGNABLE_ROLES)[number],
        name: saved?.roles.find((row) => row.key === role.key)?.name ?? role.name,
      })),
    };
  }
  async function auditPage(query: Record<string, unknown>, state: SettingsState) {
    const parsed = parse(
      z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          actorUid: uid.optional(),
          action: uid.optional(),
          resourceType: uid.optional(),
          resourceId: uid.optional(),
        })
        .strict(),
      query,
    );
    const logs = [...(await options.store.auditLogs.list()), ...state.audits]
      .filter((log) =>
        Object.entries(parsed).every(
          ([key, value]) =>
            key === 'page' ||
            key === 'pageSize' ||
            log[key as 'actorUid' | 'action' | 'resourceType' | 'resourceId'] === value,
        ),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return {
      items: logs.slice((parsed.page - 1) * parsed.pageSize, parsed.page * parsed.pageSize),
      page: parsed.page,
      pageSize: parsed.pageSize,
      total: logs.length,
    };
  }
  async function trustedRecipients(uids: string[]): Promise<SystemSettingsRecipient[]> {
    const grants = await options.store.developmentAccess.list();
    const result = [];
    for (const userUid of [...uids].sort()) {
      const user = await requireDirectory().get(userUid);
      const admitted =
        user &&
        (options.authMode === 'demo' || hasRecipientAccess(user, grants, options.allowedUids));
      if (!user || !admitted)
        throw new HttpError(400, 'invalid_recipient', '接收者不存在或尚未获准进入发展端');
      result.push({
        uid: user.uid,
        displayName: user.displayName,
        username: user.username,
        studentId: user.studentId,
      });
    }
    return result;
  }
  const history = (state: SettingsState) =>
    state.notifications.map(({ fingerprint: hash, reads, ...notice }) => {
      void hash;
      void reads;
      return notice;
    });
  const rewards = (state: SettingsState) =>
    state.rewards.map(({ fingerprint: hash, ...reward }) => {
      void hash;
      return reward;
    });
  settings.get('/', async (_request, response) => {
    const state = await requireStorage().read();
    const [users, organizations, teams, modules, audits] = await Promise.all([
      listSettingsUsers(
        options.store,
        requireDirectory(),
        '',
        options.authMode === 'demo',
        options.allowedUids,
      ),
      metadata(state),
      options.store.sportsTeams.list(),
      listModuleManifests(options.store),
      auditPage({}, state),
    ]);
    send(response, 200, {
      users,
      identitySections: systemSettingsIdentitySections(organizations),
      organizations,
      sportsTeams: teams
        .filter((team) => team.status === 'active')
        .map((team) => ({ id: team.id, name: team.name })),
      modules,
      notifications: history(state),
      rewards: rewards(state),
      audits,
      rewardMode: options.rewardProvider ? 'shared-wallet' : provider ? 'demo' : 'unavailable',
    });
  });
  settings.get('/users', async (request, response) =>
    send(
      response,
      200,
      await listSettingsUsers(
        options.store,
        requireDirectory(),
        String(request.query.query ?? '')
          .trim()
          .slice(0, 80),
        options.authMode === 'demo',
        options.allowedUids,
      ),
    ),
  );
  settings.put('/users/:uid', async (request, response) =>
    send(
      response,
      200,
      await updateSettingsUser(
        options.store,
        requireDirectory(),
        String(request.params.uid),
        parse(userInput, request.body),
        actor(response).uid,
        options.allowedUids,
      ),
    ),
  );
  settings.get('/organizations', async (_request, response) =>
    send(response, 200, await metadata(await requireStorage().read())),
  );
  settings.patch('/organizations', async (request, response) => {
    const input = parse(organizationsInput, request.body);
    if (
      new Set(input.organizations?.map((row) => row.id)).size !==
        (input.organizations?.length ?? 0) ||
      new Set(input.roles?.map((row) => row.key)).size !== (input.roles?.length ?? 0)
    )
      throw new HttpError(400, 'invalid_request', '元数据标识重复');
    const result = await requireStorage().change(async (state) => {
      const previous = await metadata(state);
      if (previous.revision !== input.revision)
        throw new HttpError(409, 'stale_revision', '组织配置已被修改，请重新加载');
      const next = {
        revision: previous.revision + 1,
        organizations: previous.organizations.map(
          (row) => input.organizations?.find((next) => next.id === row.id) ?? row,
        ),
        roles: previous.roles.map(
          (row) => input.roles?.find((next) => next.key === row.key) ?? row,
        ),
      };
      state.organizations = next;
      appendFeatureAudit(
        state,
        actor(response),
        'system_settings.organizations.update',
        'organization_metadata',
        'organizations',
        previous,
        next,
      );
      return next;
    });
    send(response, 200, result);
  });
  settings.get('/modules', async (_request, response) =>
    send(response, 200, await listModuleManifests(options.store)),
  );
  settings.patch('/modules', async (request, response) => {
    const input = parse(
      z
        .object({
          moduleId: z.enum(MODULE_IDS).refine((id) => id !== 'admin'),
          enabled: z.boolean(),
        })
        .strict(),
      request.body,
    );
    await options.store.transaction(async (tx) => {
      const previous = (await tx.modules.listForUpdate()).find(
        (row) => row.moduleId === input.moduleId,
      );
      if (!previous) throw new HttpError(404, 'module_not_found', '模块不存在');
      const next = await tx.modules.update(previous.id, {
        enabled: input.enabled,
        status: input.enabled ? 'enabled' : 'disabled',
        ownerUid: actor(response).uid,
      });
      await tx.auditLogs.create({
        actorUid: actor(response).uid,
        action: 'system_settings.module.update',
        resourceType: 'module',
        resourceId: input.moduleId,
        details: { previous, next },
        status: 'active',
        ownerUid: actor(response).uid,
        scope: { type: 'public', id: '*' },
      });
    });
    send(
      response,
      200,
      (await listModuleManifests(options.store)).find((row) => row.id === input.moduleId),
    );
  });
  settings.get('/audit-logs', async (request, response) =>
    send(response, 200, await auditPage(request.query, await requireStorage().read())),
  );
  settings.get('/notifications', async (_request, response) =>
    send(response, 200, history(await requireStorage().read())),
  );
  settings.post('/notifications', async (request, response) => {
    const input = parse(noticeInput, request.body);
    const user = actor(response);
    const id = fingerprint(['notification', user.uid, input.requestId]);
    const hash = fingerprint({
      ...input,
      recipientUids: [...input.recipientUids].sort(),
      link: input.link ?? null,
    });
    const result = await requireStorage().change(async (state) => {
      const old = state.notifications.find((row) => row.id === id);
      if (old) {
        if (old.fingerprint !== hash)
          throw new HttpError(409, 'idempotency_conflict', '重试内容与原请求不一致');
        return { id, recipientCount: old.recipientCount, replayed: true };
      }
      const recipients = await trustedRecipients(input.recipientUids);
      const notice = {
        id,
        kind: 'announcement' as const,
        requestId: input.requestId,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        authorUid: user.uid,
        authorDisplayName: user.displayName,
        createdAt: new Date().toISOString(),
        recipients,
        recipientCount: recipients.length,
        fingerprint: hash,
        reads: {},
      };
      state.notifications.unshift(notice);
      appendFeatureAudit(
        state,
        user,
        'system_settings.notification.publish',
        'development_notification',
        id,
        null,
        { ...notice, reads: undefined, fingerprint: undefined },
      );
      return { id, recipientCount: recipients.length, replayed: false };
    });
    send(response, result.replayed ? 200 : 201, result);
  });
  settings.get('/rewards', async (_request, response) =>
    send(response, 200, rewards(await requireStorage().read())),
  );
  settings.post('/rewards', async (request, response) => {
    const input = parse(rewardInput, request.body);
    const user = actor(response);
    const id = fingerprint(['reward', user.uid, input.requestId]);
    const canonical: DevelopmentRewardInput = {
      ...input,
      recipientUids: [...input.recipientUids].sort(),
    };
    const hash = fingerprint(canonical);
    let locallyReplayed = false;
    const result = await requireStorage().change(async (state) => {
      const old = state.rewards.find((row) => row.id === id);
      if (old) {
        if (old.fingerprint !== hash)
          throw new HttpError(409, 'idempotency_conflict', '重试内容与原请求不一致');
        locallyReplayed = true;
        return {
          batchId: old.batchId,
          recipientCount: old.recipientCount,
          electric: old.electric,
          magnetic: old.magnetic,
          totalElectric: old.totalElectric,
          totalMagnetic: old.totalMagnetic,
          replayed: true,
        };
      }
      if (!provider)
        throw new HttpError(503, 'reward_provider_unavailable', '共享奖励服务暂不可用');
      const recipients = await trustedRecipients(canonical.recipientUids);
      let granted: DevelopmentRewardResult;
      try {
        granted = await provider.grant(user.uid, canonical);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'reward_provider_unavailable', '共享奖励服务暂不可用');
      }
      const reward = {
        ...granted,
        id,
        requestId: input.requestId,
        title: input.title,
        reason: input.reason,
        recipients,
        actorUid: user.uid,
        actorDisplayName: user.displayName,
        createdAt: new Date().toISOString(),
        fingerprint: hash,
      };
      state.rewards.unshift(reward);
      state.notifications.unshift({
        id: `reward-${id}`,
        kind: 'reward',
        requestId: input.requestId,
        title: input.title,
        body: `${input.reason}\n电 ${granted.electric}，磁 ${granted.magnetic}`,
        link: null,
        authorUid: user.uid,
        authorDisplayName: user.displayName,
        createdAt: reward.createdAt,
        recipients,
        recipientCount: recipients.length,
        fingerprint: hash,
        reads: {},
      });
      appendFeatureAudit(
        state,
        user,
        'system_settings.reward.grant',
        'development_reward',
        id,
        null,
        { ...reward, fingerprint: undefined },
      );
      return granted;
    });
    send(response, locallyReplayed ? 200 : 201, result);
  });
  inbox.get('/', async (_request, response) =>
    send(response, 200, ownInbox(await requireStorage().read(), actor(response).uid)),
  );
  inbox.get('/unread-count', async (_request, response) =>
    send(response, 200, {
      unreadCount: ownInbox(await requireStorage().read(), actor(response).uid).filter(
        (notice) => !notice.readAt,
      ).length,
    }),
  );
  inbox.post('/read-all', async (_request, response) => {
    const updated = await requireStorage().change((state) => {
      let updated = 0;
      for (const notice of state.notifications)
        if (
          notice.recipients.some((row) => row.uid === actor(response).uid) &&
          !notice.reads[actor(response).uid]
        ) {
          notice.reads[actor(response).uid] = new Date().toISOString();
          updated++;
        }
      return updated;
    });
    send(response, 200, { updated });
  });
  inbox.post('/:id/read', async (request, response) => {
    const id = String(request.params.id);
    await requireStorage().change((state) => {
      const notice = state.notifications.find(
        (row) =>
          row.id === id &&
          row.recipients.some((recipient) => recipient.uid === actor(response).uid),
      );
      if (!notice) throw new HttpError(404, 'notification_not_found', '通知不存在');
      notice.reads[actor(response).uid] ??= new Date().toISOString();
    });
    send(response, 200, { updated: true, id });
  });
  return { settings, inbox };
}
