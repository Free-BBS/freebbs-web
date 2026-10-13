import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  canEditDepartment,
  departmentById,
  type UserContext,
} from '@freebbs-development/contracts';
import { PUBLISHING_CATEGORIES, type PublishingContent } from '@freebbs-development/contracts';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import type { CollectionsRouterOptions } from '../collections/router.js';
import { canCreateCollection } from '../collections/access.js';
import { safePublishingUrl } from './domain.js';
interface Stored extends PublishingContent {
  reactions: Array<{ uid: string; liked: boolean; rating: number }>;
}
const url = z.string().max(2048).refine(safePublishingUrl, '请使用不含凭据的 HTTPS 链接');
const definition = z
  .object({
    category: z.enum(PUBLISHING_CATEGORIES),
    title: z.string().trim().min(1).max(160),
    text: z.string().max(30000).default(''),
    departmentId: z.string().max(100).nullable().default(null),
    audience: z.enum(['all', 'department']).default('all'),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
    links: z
      .array(z.object({ label: z.string().max(100), url }).strict())
      .max(30)
      .default([]),
    images: z.array(url).max(12).default([]),
    tags: z.array(z.string().max(60)).max(15).default([]),
    course: z.string().max(120).default(''),
    year: z.string().max(20).default(''),
    author: z.string().max(100).default(''),
    recommendation: z.string().max(4000).default(''),
    schedule: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            title: z.string().min(1).max(160),
            url: z.union([url, z.literal('')]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  if (Buffer.byteLength(JSON.stringify(value ?? {})) > 65536)
    throw new HttpError(413, 'too_large', '内容超过 64 KiB');
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, 'invalid_request', parsed.error.issues[0]?.message ?? '输入无效');
  return parsed.data;
}
export function managesContent(item: PublishingContent, user: UserContext) {
  return (
    item.ownerUid === user.uid ||
    user.roles.includes('platform.admin') ||
    Boolean(item.departmentId && canEditDepartment(user.roles, item.departmentId))
  );
}
export function visibleContent(item: PublishingContent, user: UserContext) {
  return (
    managesContent(item, user) ||
    (item.status === 'published' &&
      (item.audience === 'all' ||
        Boolean(item.departmentId && canEditDepartment(user.roles, item.departmentId))))
  );
}
export function createPublishingRouter(
  options: Pick<CollectionsRouterOptions, 'authenticate' | 'uploadDirectory' | 'nodeEnvironment'> &
    Partial<Pick<CollectionsRouterOptions, 'store'>>,
) {
  const router = Router();
  const storage = featureStorage<Stored>(
    options.uploadDirectory ?? resolve('.data/collection-uploads'),
    'publishing',
  );
  const moduleFor = (category: PublishingContent['category']) =>
    ['article', 'notices', 'schedules', 'public_info'].includes(category)
      ? 'information'
      : 'knowledge';
  const enabled = (res: Response, category: PublishingContent['category']) =>
    (res.locals.publishingModules as string[]).includes(moduleFor(category));
  const requireModule = (res: Response, category: PublishingContent['category']) => {
    if (!enabled(res, category)) throw new HttpError(503, 'module_disabled', '该资料模块尚未开放');
  };
  const actor = (res: Response) => res.locals.actor as UserContext;
  const send = (res: Response, data: unknown, status = 200) =>
    res.status(status).json({ data, requestId: res.locals.requestId });
  const bounded = (item: Stored) => {
    if (Buffer.byteLength(JSON.stringify(item)) > 65536)
      throw new HttpError(413, 'too_large', '内容与互动记录超过 64 KiB');
    return item;
  };
  const view = (item: Stored, user: UserContext): PublishingContent => {
    const { reactions, ...data } = item;
    const mine = reactions.find((r) => r.uid === user.uid);
    const ratings = reactions.filter((r) => r.rating > 0);
    return {
      ...data,
      canManage: managesContent(item, user),
      liked: mine?.liked ?? false,
      myRating: mine?.rating ?? 0,
      likeCount: reactions.filter((r) => r.liked).length,
      ratingCount: ratings.length,
      ratingAverage: ratings.length
        ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
        : 0,
    };
  };
  function validate(value: z.infer<typeof definition>, user: UserContext) {
    if (
      value.departmentId &&
      (!departmentById(value.departmentId) || !canEditDepartment(user.roles, value.departmentId))
    )
      throw new HttpError(403, 'department_forbidden', '只能发布到自己的部门');
    if (value.category === 'contacts') value.audience = 'department';
    if (value.audience === 'department' && !value.departmentId)
      throw new HttpError(400, 'missing_department', '部门内容需要选择所属部门');
  }
  router.use(async (req, res, next) => {
    const identity = await options.authenticate(req.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (
      options.nodeEnvironment === 'production' &&
      (!options.uploadDirectory || !isAbsolute(options.uploadDirectory))
    )
      throw new HttpError(503, 'storage_not_configured', '内容存储尚未配置');
    res.locals.publishingModules = options.store
      ? (await options.store.modules.list())
          .filter((record) => record.enabled && record.status === 'enabled')
          .map((record) => record.moduleId)
      : ['information', 'knowledge'];
    res.locals.actor = identity.user;
    next();
  });
  router.get('/', async (_req, res) => {
    const user = actor(res);
    send(res, {
      canCreate:
        canCreateCollection(user) && PUBLISHING_CATEGORIES.some((key) => enabled(res, key)),
      availableCategories: PUBLISHING_CATEGORIES.filter((key) => enabled(res, key)),
      items: (await storage.list())
        .filter((item) => enabled(res, item.category) && visibleContent(item, user))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) => view(item, user)),
    });
  });
  router.post('/', async (req, res) => {
    const user = actor(res);
    if (!canCreateCollection(user)) throw new HttpError(403, 'forbidden', '当前身份不能创建内容');
    const value = parse(definition, req.body);
    requireModule(res, value.category);
    validate(value, user);
    const at = new Date().toISOString();
    const item: Stored = {
      ...value,
      id: randomUUID(),
      ownerUid: user.uid,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      reactions: [],
      likeCount: 0,
      ratingCount: 0,
      ratingAverage: 0,
    };
    await storage.change(item.id, () => ({ record: bounded(item), result: null }));
    send(res, view(item, user), 201);
  });
  router.get('/:id', async (req, res) => {
    const item = await storage.get(String(req.params.id));
    if (!item || !visibleContent(item, actor(res)))
      throw new HttpError(404, 'not_found', '未找到内容');
    requireModule(res, item.category);
    send(res, view(item, actor(res)));
  });
  router.patch('/:id', async (req, res) => {
    const user = actor(res);
    const input = parse(
      definition
        .partial()
        .extend({ revision: z.number().int().min(1) })
        .strict(),
      req.body,
    );
    const result = await storage.change(String(req.params.id), (item) => {
      if (!item) throw new HttpError(404, 'not_found', '未找到内容');
      requireModule(res, item.category);
      if (!managesContent(item, user))
        throw new HttpError(403, 'forbidden', '只有创建者、本部门成员和管理员可以编辑');
      if (item.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '内容已更新，请重新加载');
      if (input.departmentId !== undefined && input.departmentId !== item.departmentId)
        throw new HttpError(400, 'department_locked', '所属部门不能变更');
      const changes = Object.fromEntries(
        Object.entries(input).filter(([key]) => key !== 'revision'),
      );
      const value = parse(definition, {
        ...Object.fromEntries(
          Object.keys(definition.shape).map((key) => [key, item[key as keyof Stored]]),
        ),
        ...changes,
      });
      requireModule(res, value.category);
      validate(value, user);
      const next = {
        ...item,
        ...value,
        revision: item.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      return { record: bounded(next), result: view(next, user) };
    });
    send(res, result);
  });
  router.post('/:id/reaction', async (req, res) => {
    const user = actor(res);
    const input = parse(
      z
        .object({
          revision: z.number().int().min(1),
          liked: z.boolean().optional(),
          rating: z.number().int().min(1).max(5).optional(),
        })
        .strict(),
      req.body,
    );
    const result = await storage.change(String(req.params.id), (item) => {
      if (!item || !visibleContent(item, user)) throw new HttpError(404, 'not_found', '未找到内容');
      requireModule(res, item.category);
      if (item.status !== 'published') throw new HttpError(409, 'not_published', '内容尚未发布');
      if (item.revision !== input.revision)
        throw new HttpError(409, 'revision_conflict', '内容已更新，请重新加载');
      if (input.rating !== undefined && item.category !== 'book_share')
        throw new HttpError(400, 'not_book', '只有书籍可以评分');
      const previous = item.reactions.find((r) => r.uid === user.uid);
      if (!previous && item.reactions.length >= 10000)
        throw new HttpError(409, 'capacity_limit', '互动记录已达上限');
      item.reactions = item.reactions.filter((r) => r.uid !== user.uid);
      item.reactions.push({
        uid: user.uid,
        liked: input.liked ?? previous?.liked ?? false,
        rating: input.rating ?? previous?.rating ?? 0,
      });
      item.revision++;
      return { record: bounded(item), result: view(item, user) };
    });
    send(res, result);
  });
  return router;
}
