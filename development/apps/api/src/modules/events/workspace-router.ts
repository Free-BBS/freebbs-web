import { randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve, extname } from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type {
  ActivityContentBlock,
  ActivityWorkspace,
  ApiEnvelope,
} from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  deleteCollectionUpload,
  readCollectionUpload,
  storeCollectionUpload,
} from '../collections/uploads.js';
import { resolveWorkspaceActivity, type LearningSurveyResolver } from './workspace-activity.js';
import { activityPath, notificationsFor, readableWorkspaces } from './workspace-inbox.js';
import {
  changeActivityWorkspace,
  readActivityWorkspace,
  type SavedActivityWorkspace,
} from './workspace-storage.js';

interface Options {
  store: DevelopmentStore;
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
  learning: LearningSurveyResolver;
  uploadDirectory?: string;
  nodeEnvironment?: string;
}
const sourceSchema = z.enum(['learning_survey', 'development_activity', 'native_collection']);
const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const blocks = z
  .array(
    z
      .object({
        id: idSchema,
        kind: z.enum(['heading', 'paragraph', 'image', 'video']),
        text: z.string().max(20000),
        assetId: z.string().max(128).nullable(),
        caption: z.string().max(500),
      })
      .strict(),
  )
  .max(100);
const introSchema = z.object({ revision, blocks }).strict();
const updateSchema = z
  .object({
    revision,
    label: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\r\n]+$/),
    occursAt: z.string().datetime({ offset: true }),
    description: z.string().max(4000),
  })
  .strict();
const recapSchema = z
  .object({ revision, title: z.string().trim().min(1).max(200), blocks })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, 'invalid_request', '内容格式不正确，请检查日期、标题和段落');
  return result.data;
}
function send<T>(response: Response, data: T, status = 200) {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}
function validateBlocks(value: ActivityContentBlock[], saved: SavedActivityWorkspace) {
  if (new Set(value.map((b) => b.id)).size !== value.length)
    throw new HttpError(400, 'duplicate_block', '段落编号不能重复');
  for (const block of value) {
    if (block.kind === 'image' || block.kind === 'video') {
      const asset = saved.assets.find((a) => a.id === block.assetId);
      if (!asset || !asset.mimeType.startsWith(`${block.kind}/`))
        throw new HttpError(400, 'invalid_asset', '图片或视频必须来自此活动');
    } else if (block.assetId !== null)
      throw new HttpError(400, 'invalid_asset', '文字段落不能附带媒体');
  }
}
export function createActivityWorkspaceRouter(options: Options): Router {
  const router = Router();
  const directory = options.uploadDirectory ?? resolve('.data/collection-uploads');
  const mediaDirectory = join(directory, 'activity-media');
  const configured =
    options.nodeEnvironment !== 'production' ||
    (options.uploadDirectory !== undefined && isAbsolute(options.uploadDirectory));
  function requireStorage() {
    if (!configured) throw new HttpError(503, 'upload_not_configured', '活动内容存储尚未配置');
  }
  async function actorFor(request: Request) {
    const result = await options.authenticate(request.headers);
    if (result.status !== 200) throw new HttpError(result.status, result.code, result.message);
    return result.user;
  }
  async function context(request: Request, edit = false) {
    const actor = await actorFor(request);
    const source = parse(sourceSchema, request.params.source);
    const id = parse(idSchema, request.params.activityId);
    const resolved = await resolveWorkspaceActivity(
      options.store,
      actor,
      source,
      id,
      options.learning,
    );
    if (edit && !resolved.canEdit)
      throw new HttpError(403, 'forbidden', '只有所属组织的社工成员可以编辑活动');
    return { actor, source, id, ...resolved };
  }
  type Context = Awaited<ReturnType<typeof context>>;
  function withSchedule(saved: SavedActivityWorkspace, ctx: Context): Context {
    const schedule = saved.schedule;
    if (!schedule) return ctx;
    const ended =
      ctx.ended ||
      schedule.finished ||
      (schedule.endsAt !== null && Date.parse(schedule.endsAt) <= Date.now());
    return {
      ...ctx,
      ended,
      activity: {
        ...ctx.activity,
        startsAt: schedule.startsAt,
        endsAt: schedule.endsAt,
        activityStatus: ended ? 'finished' : ctx.activity.activityStatus,
      },
    };
  }
  function envelope(saved: SavedActivityWorkspace, ctx: Context): ActivityWorkspace {
    const current = withSchedule(saved, ctx);
    return {
      source: ctx.source,
      activityId: ctx.id,
      revision: saved.revision,
      activity: current.activity,
      schedule: saved.schedule ?? {
        startsAt: ctx.activity.startsAt ?? null,
        endsAt: ctx.activity.endsAt ?? null,
        finished: ctx.ended,
      },
      intro: saved.intro,
      updates: saved.updates,
      recaps: saved.recaps,
      assets: saved.assets,
      following: saved.followers.includes(ctx.actor.uid),
      canEdit: current.canEdit,
      canRecap: current.canEdit && current.ended,
      ended: current.ended,
    };
  }
  function notify(saved: SavedActivityWorkspace, ctx: Context, body: string) {
    const recipients = saved.followers.filter((uid) => uid !== ctx.actor.uid);
    if (!recipients.length) return;
    saved.notices.push({
      id: randomUUID(),
      source: ctx.source,
      activityId: ctx.id,
      title: `${ctx.activity.title} · 新动态`,
      body,
      link: activityPath(ctx.source, ctx.id),
      createdAt: new Date().toISOString(),
      recipients,
      reads: [],
    });
  }
  async function mutate(
    request: Request,
    response: Response,
    expected: number,
    callback: (saved: SavedActivityWorkspace, ctx: Context) => void,
    status = 200,
    recap = false,
  ) {
    const ctx = await context(request, true);
    requireStorage();
    const result = await changeActivityWorkspace(directory, ctx.source, ctx.id, async (saved) => {
      // Recheck the activity inside the serialized transaction: completion and scope can change.
      const baseCurrent = {
        ...ctx,
        ...(await resolveWorkspaceActivity(
          options.store,
          ctx.actor,
          ctx.source,
          ctx.id,
          options.learning,
        )),
      };
      const current = withSchedule(saved, baseCurrent);
      if (!current.canEdit) throw new HttpError(403, 'forbidden', '当前身份不能编辑此活动');
      if (recap && !current.ended)
        throw new HttpError(409, 'activity_not_ended', '活动结束后才可以发布复盘');
      if (saved.revision !== expected)
        throw new HttpError(409, 'revision_conflict', '内容已被其他同学更新，请重新加载后合并');
      callback(saved, current);
      saved.revision++;
      return envelope(saved, baseCurrent);
    });
    send(response, result, status);
  }
  router.get('/following', async (request, response) => {
    const actor = await actorFor(request);
    const entries = await readableWorkspaces(directory, options.store, actor, options.learning);
    send(
      response,
      entries
        .filter((w) => w.followers.includes(actor.uid))
        .map((w) => ({ source: w.source, activityId: w.activityId })),
    );
  });
  router.get('/activity-states', async (request, response) => {
    const actor = await actorFor(request);
    const entries = await readableWorkspaces(
      directory,
      options.store,
      actor,
      options.learning,
      true,
    );
    send(
      response,
      entries
        .filter((w) => w.schedule)
        .map((w) => ({ source: w.source, activityId: w.activityId, ...w.schedule })),
    );
  });
  router.get('/notifications', async (request, response) => {
    const actor = await actorFor(request);
    const query = parse(
      z
        .object({
          before: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict(),
      request.query,
    );
    const all = notificationsFor(
      await readableWorkspaces(directory, options.store, actor, options.learning),
      actor.uid,
    );
    let filtered = all;
    if (query.before) {
      const cursor = all.findIndex((n) => `${n.createdAt}|${n.id}` === query.before);
      if (cursor < 0) throw new HttpError(400, 'invalid_cursor', '通知游标无效');
      filtered = all.slice(cursor + 1);
    }
    const page = filtered.slice(0, query.limit);
    const last = page.at(-1);
    send(response, {
      notifications: page,
      unreadCount: all.filter((n) => !n.readAt).length,
      nextCursor: filtered.length > page.length && last ? `${last.createdAt}|${last.id}` : null,
    });
  });
  router.post('/notifications/read-all', async (request, response) => {
    const actor = await actorFor(request);
    requireStorage();
    const entries = await readableWorkspaces(directory, options.store, actor, options.learning);
    const now = new Date().toISOString();
    for (const entry of entries)
      await changeActivityWorkspace(directory, entry.source, entry.activityId, (saved) => {
        for (const n of saved.notices)
          if (n.recipients.includes(actor.uid) && !n.reads.some((r) => r.uid === actor.uid))
            n.reads.push({ uid: actor.uid, readAt: now });
      });
    send(response, { unreadCount: 0 });
  });
  router.post(
    '/notifications/:source/:activityId/:notificationId/read',
    async (request, response) => {
      const ctx = await context(request);
      requireStorage();
      const id = parse(z.string().uuid(), request.params.notificationId);
      const readAt = await changeActivityWorkspace(directory, ctx.source, ctx.id, (saved) => {
        const notice = saved.notices.find(
          (n) => n.id === id && n.recipients.includes(ctx.actor.uid),
        );
        if (!notice) throw new HttpError(404, 'notification_not_found', '通知不存在');
        const existing = notice.reads.find((r) => r.uid === ctx.actor.uid);
        if (existing) return existing.readAt;
        const now = new Date().toISOString();
        notice.reads.push({ uid: ctx.actor.uid, readAt: now });
        return now;
      });
      send(response, { readAt });
    },
  );
  const route = '/workspaces/:source/:activityId';
  router.get(route, async (request, response) => {
    const ctx = await context(request);
    send(response, envelope(await readActivityWorkspace(directory, ctx.source, ctx.id), ctx));
  });
  router.put(`${route}/schedule`, async (request, response) => {
    const value = parse(
      z
        .object({
          revision,
          startsAt: z.string().datetime({ offset: true }).nullable(),
          endsAt: z.string().datetime({ offset: true }).nullable(),
          finished: z.boolean(),
        })
        .strict()
        .refine((v) => !v.startsAt || !v.endsAt || Date.parse(v.startsAt) <= Date.parse(v.endsAt)),
      request.body,
    );
    await mutate(request, response, value.revision, (saved, ctx) => {
      saved.schedule = { startsAt: value.startsAt, endsAt: value.endsAt, finished: value.finished };
      notify(saved, ctx, value.finished ? '活动已结束，欢迎查看复盘' : '活动安排已更新');
    });
  });
  router.put(`${route}/intro`, async (request, response) => {
    const value = parse(introSchema, request.body);
    await mutate(request, response, value.revision, (saved) => {
      validateBlocks(value.blocks, saved);
      saved.intro = value.blocks;
    });
  });
  router.post(`${route}/updates`, async (request, response) => {
    const value = parse(updateSchema, request.body);
    await mutate(
      request,
      response,
      value.revision,
      (saved, ctx) => {
        const now = new Date().toISOString();
        saved.updates.push({
          id: randomUUID(),
          label: value.label,
          occursAt: value.occursAt,
          description: value.description,
          authorUid: ctx.actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        saved.updates.sort((a, b) => Date.parse(a.occursAt) - Date.parse(b.occursAt));
        notify(saved, ctx, `${value.label}${value.description ? ' · ' + value.description : ''}`);
      },
      201,
    );
  });
  router.patch(`${route}/updates/:updateId`, async (request, response) => {
    const value = parse(updateSchema, request.body);
    const id = parse(z.string().uuid(), request.params.updateId);
    await mutate(request, response, value.revision, (saved, ctx) => {
      const item = saved.updates.find((u) => u.id === id);
      if (!item) throw new HttpError(404, 'update_not_found', '动态不存在');
      Object.assign(item, {
        label: value.label,
        occursAt: value.occursAt,
        description: value.description,
        updatedAt: new Date().toISOString(),
      });
      saved.updates.sort((a, b) => Date.parse(a.occursAt) - Date.parse(b.occursAt));
      notify(saved, ctx, `动态调整：${value.label}`);
    });
  });
  router.delete(`${route}/updates/:updateId`, async (request, response) => {
    const value = parse(z.object({ revision }).strict(), request.body);
    const id = parse(z.string().uuid(), request.params.updateId);
    await mutate(request, response, value.revision, (saved) => {
      if (!saved.updates.some((u) => u.id === id))
        throw new HttpError(404, 'update_not_found', '动态不存在');
      saved.updates = saved.updates.filter((u) => u.id !== id);
    });
  });
  router.post(`${route}/recaps`, async (request, response) => {
    const value = parse(recapSchema, request.body);
    await mutate(
      request,
      response,
      value.revision,
      (saved, ctx) => {
        validateBlocks(value.blocks, saved);
        const now = new Date().toISOString();
        saved.recaps.push({
          id: randomUUID(),
          title: value.title,
          blocks: value.blocks,
          authorUid: ctx.actor.uid,
          createdAt: now,
          updatedAt: now,
        });
        notify(saved, ctx, `复盘发布：${value.title}`);
      },
      201,
      true,
    );
  });
  router.put(`${route}/recaps/:recapId`, async (request, response) => {
    const value = parse(recapSchema, request.body);
    const id = parse(z.string().uuid(), request.params.recapId);
    await mutate(
      request,
      response,
      value.revision,
      (saved) => {
        validateBlocks(value.blocks, saved);
        const item = saved.recaps.find((r) => r.id === id);
        if (!item) throw new HttpError(404, 'recap_not_found', '复盘不存在');
        Object.assign(item, {
          title: value.title,
          blocks: value.blocks,
          updatedAt: new Date().toISOString(),
        });
      },
      200,
      true,
    );
  });
  router.put(`${route}/following`, async (request, response) => {
    const ctx = await context(request);
    requireStorage();
    const value = parse(z.object({ following: z.boolean() }).strict(), request.body);
    await changeActivityWorkspace(directory, ctx.source, ctx.id, (saved) => {
      saved.followers = saved.followers.filter((uid) => uid !== ctx.actor.uid);
      if (value.following) saved.followers.push(ctx.actor.uid);
    });
    send(response, value);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  }).single('file');
  router.post(
    `${route}/assets`,
    async (request, response, next) => {
      response.locals.activityContext = await context(request, true);
      requireStorage();
      next();
    },
    (request, response, next) => {
      upload(request, response, (error: unknown) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
          return next(new HttpError(413, 'upload_too_large', '视频最大 100 MiB'));
        next(new HttpError(400, 'invalid_multipart', '上传格式不正确'));
      });
    },
    async (request, response) => {
      const ctx = response.locals.activityContext as Context;
      const file = request.file;
      if (!file) throw new HttpError(400, 'missing_upload', '请选择图片或视频');
      const extensions = new Set([
        '.png',
        '.jpg',
        '.jpeg',
        '.webp',
        '.gif',
        '.mp4',
        '.webm',
        '.mov',
      ]);
      if (
        !extensions.has(extname(file.originalname).toLowerCase()) ||
        !/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.mimetype)
      )
        throw new HttpError(
          400,
          'unsupported_file_type',
          '仅支持 PNG、JPG、WebP、GIF 图片及 MP4、WebM、MOV 视频',
        );
      if (file.mimetype.startsWith('image/') && file.size > 20 * 1024 * 1024)
        throw new HttpError(413, 'upload_too_large', '图片最大 20 MiB');
      const asset = await storeCollectionUpload({
        buffer: file.buffer,
        originalName: file.originalname,
        mimeType: file.mimetype,
        directory: mediaDirectory,
      });
      asset.url = `/api/development/v1/events/workspaces/${ctx.source}/${encodeURIComponent(ctx.id)}/assets/${asset.id}`;
      try {
        await changeActivityWorkspace(directory, ctx.source, ctx.id, (saved) => {
          saved.assets.push(asset);
        });
      } catch (error) {
        await deleteCollectionUpload(mediaDirectory, asset.id);
        throw error;
      }
      send(response, asset, 201);
    },
  );
  router.get(`${route}/assets/:assetId`, async (request, response) => {
    const ctx = await context(request);
    const id = parse(z.string().uuid(), request.params.assetId);
    const saved = await readActivityWorkspace(directory, ctx.source, ctx.id);
    const asset = saved.assets.find((a) => a.id === id);
    if (!asset) throw new HttpError(404, 'asset_not_found', '媒体不存在');
    const buffer = await readCollectionUpload(mediaDirectory, id);
    if (!buffer) throw new HttpError(404, 'asset_not_found', '媒体不存在');
    response.setHeader('Cache-Control', 'private, no-store');
    response.type(asset.mimeType).send(buffer);
  });
  return router;
}
