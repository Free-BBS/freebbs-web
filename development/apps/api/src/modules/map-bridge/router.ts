import { randomInt, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type {
  AchievementAtlas,
  MapEvidence,
  MapEvidenceInput,
  UserContext,
} from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { matchesMapBearer, resolveMapTokenDigest } from './credentials.js';
import {
  bindingStorage,
  BINDING_STATE_ID,
  emptyBindingState,
  connectionStatus,
  evidenceId,
  publicBinding,
  requestStatus,
  subjectDigest,
  type BindingState,
  type StoredConnection,
} from './storage.js';

export { readMapConnection } from './storage.js';

export interface MapBridgeOptions {
  authenticate(headers: AuthHeaders): Promise<AuthenticationResult>;
  store: DevelopmentStore;
  uploadDirectory?: string;
  nodeEnvironment?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  getAtlas(uid: string): Promise<AchievementAtlas>;
  saveShowcase(uid: string, ids: Array<string | null>, revision: number): Promise<AchievementAtlas>;
}
export const MAP_BADGE_IDS = [
  'first_arrival',
  'builder',
  'season_complete',
  'erudite',
  'pioneer_call',
  'autumn_trilogy',
  'winter_starlight',
  'four_seasons_traveler',
  'arts_debut',
  'sports_debut',
  'liaison_debut',
  'rights_debut',
] as const;
const subjectSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}:[a-zA-Z0-9_-]{1,128}$/);
const identifier = z.string().trim().min(1).max(128);
const evidenceSchema = z
  .object({
    id: identifier,
    landmarkId: identifier,
    periodId: identifier,
    type: z.enum(['activity', 'landmark', 'special']),
    title: z.string().trim().min(1).max(160),
    occurredAt: z.string().datetime({ offset: true }),
    domain: z.enum(['arts', 'sports', 'liaison', 'rights', 'tuanwei', 'sast', 'tms', 'other']),
    activityId: identifier.optional(),
    mapBadgeIds: z.array(z.enum(MAP_BADGE_IDS)).max(12).optional(),
  })
  .strict();
const subjectBody = z.object({ subject: subjectSchema }).strict();
const claimBody = z
  .object({
    code: z.string().regex(/^[A-Z2-9]{8}$/),
    subject: subjectSchema,
    publicId: z.string().trim().min(1).max(100),
  })
  .strict();
const syncBody = z
  .object({ subject: subjectSchema, items: z.array(evidenceSchema).max(100) })
  .strict();
const showcaseBody = z
  .object({
    subject: subjectSchema,
    ids: z.array(identifier.nullable()).max(6),
    revision: z.number().int().min(0),
  })
  .strict();
const emptyBody = z.object({}).strict();
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Map接入数据格式不正确');
  return parsed.data;
}
function send(response: Response, data: unknown, status = 200) {
  response.status(status).json({ data, requestId: response.locals.requestId });
}
function requireConnection(state: BindingState, hash: string): StoredConnection {
  const connection = state.connections.find((value) => value.subjectHash === hash && value.linked);
  if (!connection) throw new HttpError(409, 'map_not_linked', '请先在网页确认Map账号绑定');
  return connection;
}
function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
function evidenceCore(input: MapEvidenceInput): string {
  return JSON.stringify([input.landmarkId, input.periodId, input.type, input.occurredAt]);
}

export function createMapBridgeRouters(options: MapBridgeOptions) {
  const userRouter = Router();
  const serviceRouter = Router();
  const environment = options.environment ?? process.env;
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const tokenDigest = resolveMapTokenDigest(environment);
  const configured =
    Boolean(tokenDigest) &&
    ((options.nodeEnvironment ?? environment.NODE_ENV) !== 'production' ||
      Boolean(options.uploadDirectory && isAbsolute(options.uploadDirectory)));
  const now = options.now ?? (() => new Date());
  const stateStorage = bindingStorage(directory);
  const evidenceStorage = featureStorage<MapEvidence>(directory, 'map-evidence');
  function requireConfigured() {
    if (!configured) throw new HttpError(503, 'map_not_configured', 'Map绑定与同步尚未配置');
  }
  const changeState = <T>(operation: (state: BindingState) => T | Promise<T>) =>
    stateStorage.change(BINDING_STATE_ID, async (stored) => {
      const state = stored ?? emptyBindingState();
      return { record: state, result: await operation(state) };
    });
  userRouter.use(async (request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      identity.user.previewing ||
      (identity.user.viewer && identity.user.viewer.uid !== identity.user.uid)
    )
      throw new HttpError(403, 'preview_identity_denied', '请使用本人账号管理Map绑定');
    response.locals.mapActor = identity.user;
    next();
  });
  const uid = (response: Response) => (response.locals.mapActor as UserContext).uid;
  userRouter.get('/status', async (_request, response) => {
    if (!configured) return send(response, { configured: false, linked: false });
    const state = (await stateStorage.get(BINDING_STATE_ID)) ?? emptyBindingState();
    send(response, connectionStatus(state, uid(response), now()));
  });
  userRouter.post('/binding', async (request, response) => {
    requireConfigured();
    parse(emptyBody, request.body ?? {});
    const binding = await changeState((state) => {
      const owner = uid(response);
      const instant = now();
      if (state.connections.some((value) => value.uid === owner && value.linked))
        throw new HttpError(409, 'map_already_linked', '请先解除已有Map绑定');
      const previous = [...state.requests].reverse().find((value) => value.uid === owner);
      if (previous && instant.getTime() - Date.parse(previous.createdAt) < 30_000)
        throw new HttpError(429, 'binding_rate_limited', '请稍后再生成绑定码');
      for (const value of state.requests)
        if (value.uid === owner && (value.status === 'pending' || value.status === 'claimed'))
          value.status = 'expired';
      let code = makeCode();
      while (state.requests.some((value) => value.code === code)) code = makeCode();
      const value = {
        id: randomUUID(),
        uid: owner,
        code,
        createdAt: instant.toISOString(),
        expiresAt: new Date(instant.getTime() + 300_000).toISOString(),
        status: 'pending' as const,
      };
      state.requests.push(value);
      return publicBinding(value, instant);
    });
    send(response, binding, 201);
  });
  userRouter.post('/binding/:id/confirm', async (request, response) => {
    requireConfigured();
    parse(emptyBody, request.body ?? {});
    const status = await changeState((state) => {
      const owner = uid(response);
      const instant = now();
      const binding = state.requests.find(
        (value) => value.id === request.params.id && value.uid === owner,
      );
      if (!binding) throw new HttpError(404, 'binding_not_found', '绑定申请不存在');
      if (requestStatus(binding, instant) === 'expired')
        throw new HttpError(410, 'binding_expired', '绑定码已过期');
      if (binding.status !== 'claimed' || !binding.subjectHash || !binding.publicId)
        throw new HttpError(409, 'binding_not_claimed', '绑定申请尚未认领或已经使用');
      const existing = state.connections.find((value) => value.subjectHash === binding.subjectHash);
      if (
        (existing && existing.uid !== owner) ||
        state.connections.some((value) => value.uid === owner && value.linked)
      )
        throw new HttpError(409, 'identity_conflict', 'Map账号或网页账号已有绑定');
      if (existing) {
        existing.linked = true;
        existing.publicId = binding.publicId;
      } else
        state.connections.push({
          subjectHash: binding.subjectHash,
          uid: owner,
          linked: true,
          publicId: binding.publicId,
        });
      binding.status = 'confirmed';
      return connectionStatus(state, owner, instant);
    });
    send(response, status);
  });
  userRouter.delete('/binding', async (request, response) => {
    requireConfigured();
    parse(emptyBody, request.body ?? {});
    send(
      response,
      await changeState((state) => {
        const owner = uid(response);
        for (const value of state.connections) if (value.uid === owner) value.linked = false;
        for (const value of state.requests)
          if (value.uid === owner && (value.status === 'pending' || value.status === 'claimed'))
            value.status = 'expired';
        return connectionStatus(state, owner, now());
      }),
    );
  });
  serviceRouter.use((request, response, next) => {
    requireConfigured();
    response.setHeader('Cache-Control', 'private, no-store');
    if (!matchesMapBearer(request.headers.authorization, tokenDigest))
      throw new HttpError(401, 'invalid_token', '无效的Map接入令牌');
    next();
  });
  serviceRouter.post('/binding/claim', async (request, response) => {
    const input = parse(claimBody, request.body);
    send(
      response,
      await changeState((state) => {
        const instant = now();
        const hash = subjectDigest(input.subject);
        const binding = state.requests.find((value) => value.code === input.code);
        if (!binding) throw new HttpError(404, 'binding_not_found', '绑定码不存在');
        if (requestStatus(binding, instant) === 'expired')
          throw new HttpError(410, 'binding_expired', '绑定码已过期');
        if (binding.status !== 'pending')
          throw new HttpError(409, 'binding_code_used', '绑定码已被使用');
        const existing = state.connections.find((value) => value.subjectHash === hash);
        if (
          (existing && (existing.uid !== binding.uid || existing.linked)) ||
          state.connections.some((value) => value.uid === binding.uid && value.linked) ||
          state.requests.some(
            (value) =>
              value.subjectHash === hash &&
              value.id !== binding.id &&
              requestStatus(value, instant) === 'claimed',
          )
        )
          throw new HttpError(409, 'identity_conflict', 'Map账号或网页账号已有绑定');
        binding.subjectHash = hash;
        binding.publicId = input.publicId;
        binding.status = 'claimed';
        return {
          id: binding.id,
          status: binding.status,
          publicId: binding.publicId,
          expiresAt: binding.expiresAt,
        };
      }),
    );
  });
  serviceRouter.post('/sync', async (request, response) => {
    const input = parse(syncBody, request.body);
    const result = await changeState(async (state) => {
      const instant = now();
      const hash = subjectDigest(input.subject);
      const connection = requireConnection(state, hash);
      const prepared = new Map<string, MapEvidence>();
      let duplicates = 0;
      for (const entry of input.items) {
        if (Date.parse(entry.occurredAt) > instant.getTime())
          throw new HttpError(400, 'future_evidence', 'Map经历不能来自未来');
        if (entry.activityId) {
          const exists = entry.activityId.startsWith('collection:')
            ? await options.store.collectionForms.get(entry.activityId.slice('collection:'.length))
            : await options.store.activities.get(entry.activityId);
          if (!exists) throw new HttpError(400, 'activity_not_found', 'Map经历引用的活动不存在');
        }
        const id = evidenceId(hash, entry.id);
        const current = prepared.get(id) ?? (await evidenceStorage.get(id));
        if (
          current &&
          (current.uid !== connection.uid ||
            current.subjectHash !== hash ||
            evidenceCore(current) !== evidenceCore(entry) ||
            (current.activityId && entry.activityId && current.activityId !== entry.activityId) ||
            (current.domain !== 'other' &&
              entry.domain !== 'other' &&
              current.domain !== entry.domain))
        )
          throw new HttpError(409, 'evidence_conflict', '同一Map经历不能更换所有者或参与资料');
        // Rules belong to this service. Retain old persisted grants for archives,
        // but never mint achievements from newly uploaded badge IDs.
        const badgeIds = [...new Set(current?.mapBadgeIds ?? [])].sort();
        const domain = current && current.domain !== 'other' ? current.domain : entry.domain;
        const activityId = current?.activityId ?? entry.activityId;
        const unchanged =
          current &&
          current.title === entry.title &&
          current.domain === domain &&
          current.activityId === activityId &&
          JSON.stringify(current.mapBadgeIds ?? []) === JSON.stringify(badgeIds);
        if (unchanged) {
          duplicates++;
          continue;
        }
        prepared.set(id, {
          ...entry,
          domain,
          ...(activityId ? { activityId } : {}),
          id,
          uid: connection.uid,
          subjectHash: hash,
          mapBadgeIds: badgeIds,
          updatedAt: instant.toISOString(),
        });
      }
      // Validate the whole batch under the global binding lock before any evidence write.
      // Sync, unlink and confirmation all share this lock, preventing owner changes mid-batch.
      for (const [id, value] of prepared)
        await evidenceStorage.change(id, () => ({ record: value, result: null }));
      connection.lastSyncedAt = instant.toISOString();
      return { imported: prepared.size, duplicates, lastSyncedAt: connection.lastSyncedAt };
    });
    send(response, result);
  });
  serviceRouter.post('/atlas', async (request, response) => {
    const input = parse(subjectBody, request.body);
    const result = await changeState(async (state) =>
      options.getAtlas(requireConnection(state, subjectDigest(input.subject)).uid),
    );
    send(response, result);
  });
  serviceRouter.post('/showcase', async (request, response) => {
    const input = parse(showcaseBody, request.body);
    const result = await changeState(async (state) =>
      options.saveShowcase(
        requireConnection(state, subjectDigest(input.subject)).uid,
        input.ids,
        input.revision,
      ),
    );
    send(response, result);
  });
  return { userRouter, serviceRouter };
}
