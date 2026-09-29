import {
  COMMUNITY_CHANNELS,
  COMMUNITY_WISH_STATUSES,
  type ApiEnvelope,
} from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { CommunityService } from './service.js';
import { CommunityTrendingCache } from './trending.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

export interface CommunityRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  now?: () => Date;
}

interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(20_000);
const tag = z.string().trim().min(1).max(32);
const displayMode = z.enum(['named', 'anonymous']);
const createPostSchema = z
  .object({
    kind: z.enum(['daily', 'wish']),
    title,
    body,
    tags: z.array(tag).max(5).default([]),
    displayMode,
  })
  .strict();
const patchPostSchema = z
  .object({
    title: title.optional(),
    body: body.optional(),
    tags: z.array(tag).max(5).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((part) => part !== undefined));
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(5_000), parentId: identifier.nullable(), displayMode })
  .strict();
const supplementSchema = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();
const reportSchema = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
const responseSchema = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();
const transitionSchema = z.object({ to: z.enum(COMMUNITY_WISH_STATUSES) }).strict();
const conversionSchema = z
  .object({
    title,
    description: body,
    organizationId: z.enum([
      'arts_center',
      'liaison_center',
      'sports_center',
      'rights_development_center',
      'tuanwei',
      'sast',
      'tms',
    ]),
    startsAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
const feedQuerySchema = z
  .object({ channel: z.enum(COMMUNITY_CHANNELS).default('all'), cursor: identifier.optional() })
  .strict();
const postRouteSchema = z.object({ postId: identifier }).strict();
const targetRouteSchema = z.object({ targetType: z.enum(['post', 'comment']), targetId: identifier }).strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

function send<T>(response: Response, statusCode: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(statusCode).json(envelope);
}

async function requireActor(
  options: CommunityRouterOptions,
  request: Request,
  response: Response,
): Promise<AuthorizationContext | null> {
  const result = await options.authenticate(request.headers);
  if (result.status === 200) return result.user;
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
  return null;
}

export function createCommunityRouter(options: CommunityRouterOptions): Router {
  const router = Router();
  const service = new CommunityService(options.store, options.now);
  const trending = new CommunityTrendingCache(
    async () => ({
      posts: await options.store.communityPosts.list(),
      likes: await options.store.communityLikes.list(),
      comments: await options.store.communityComments.list(),
      views: await options.store.communityViews.list(),
    }),
    options.now,
  );

  router.use(async (_request, response, next) => {
    try {
      const module = (await options.store.modules.list({ query: 'community' })).find(
        (record) => record.moduleId === 'community',
      );
      if (module === undefined || !module.enabled || module.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Community module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/feed', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const query = parse(feedQuerySchema, request.query);
    const items = await service.listFeed(actor, query.channel);
    const start = query.cursor === undefined ? 0 : Math.max(0, items.findIndex(({ id }) => id === query.cursor) + 1);
    send(response, 200, items.slice(start, start + 20));
  });

  router.get('/trending', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    void actor;
    send(response, 200, await trending.get());
  });

  router.post('/posts', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(response, 201, await service.createPost(actor, parse(createPostSchema, request.body)));
  });

  router.get('/posts/:postId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    send(response, 200, await service.getThread(actor, postId));
  });

  router.patch('/posts/:postId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    send(response, 200, await service.updatePost(actor, postId, parse(patchPostSchema, request.body)));
  });

  router.delete('/posts/:postId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    await service.deletePost(actor, postId);
    response.status(204).end();
  });

  router.post('/posts/:postId/comments', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    send(response, 201, await service.createComment(actor, postId, parse(commentSchema, request.body)));
  });

  router.post('/posts/:postId/supplements', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    const input = parse(supplementSchema, request.body);
    send(response, 201, await service.createSupplement(actor, postId, input.body));
  });

  router.put('/targets/:targetType/:targetId/like', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const target = parse(targetRouteSchema, request.params);
    send(response, 200, await service.setLike(actor, target.targetType, target.targetId, true));
  });

  router.delete('/targets/:targetType/:targetId/like', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const target = parse(targetRouteSchema, request.params);
    send(response, 200, await service.setLike(actor, target.targetType, target.targetId, false));
  });

  router.post('/posts/:postId/reports', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    const input = parse(reportSchema, request.body);
    send(response, 201, await service.report(actor, postId, input.reason));
  });

  router.post('/posts/:postId/views', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    await service.recordView(actor, postId);
    response.status(204).end();
  });

  router.post('/wishes/:postId/responses', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    const input = parse(responseSchema, request.body);
    send(response, 200, await service.respondToWish(actor, postId, input.body));
  });

  router.post('/wishes/:postId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    const input = parse(transitionSchema, request.body);
    send(response, 200, await service.transitionWish(actor, postId, input.to));
  });

  router.post('/wishes/:postId/conversion-requests', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    send(
      response,
      200,
      await service.requestWishConversion(actor, postId, parse(conversionSchema, request.body)),
    );
  });

  router.post('/wishes/:postId/conversion-requests/approve', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { postId } = parse(postRouteSchema, request.params);
    const existing = (await options.store.activities.list()).find(
      (activity) => activity.sourceCommunityPostId === postId,
    );
    const activity = await service.approveWishConversion(actor, postId);
    send(response, existing === undefined ? 201 : 200, activity);
  });

  return router;
}
