import type { ApiEnvelope, ScopeRef } from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { nullableContentDateTime } from '../../core/validation/content-fields.js';
import { LiaisonProblemService } from './problem-service.js';
import { LiaisonService } from './service.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

export interface LiaisonRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
}

interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(20_000);
const category = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
const visibility = z.enum(['public', 'organization', 'restricted']);
const status = z.enum(['active', 'archived']);
const scope = z
  .object({
    type: identifier.regex(/^[a-z][a-z0-9_]*$/),
    id: identifier,
  })
  .strict();
const querySchema = z
  .object({
    visibility: visibility.optional(),
    status: status.optional(),
    scopeType: identifier.regex(/^[a-z][a-z0-9_]*$/).optional(),
    scopeId: identifier.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const createSchema = z
  .object({
    name,
    description,
    category,
    visibility,
    status: status.default('active'),
    scope,
  })
  .strict();
const patchSchema = z
  .object({
    id: identifier,
    name: name.optional(),
    description: description.optional(),
    category: category.optional(),
    visibility: visibility.optional(),
    scope: scope.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.category !== undefined ||
      value.visibility !== undefined ||
      value.scope !== undefined,
  );
const resourceRouteSchema = z.object({ resourceId: identifier }).strict();
const transitionSchema = z.object({ to: status }).strict();
const problemStatus = z.enum([
  'draft',
  'pending_review',
  'rejected',
  'open',
  'paused',
  'closed',
  'archived',
]);
const problemText = z.string().trim().min(1).max(20_000);
const problemFields = {
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().min(1).max(500),
  background: problemText,
  sourceType: z.enum(['lab', 'company', 'campus', 'other']),
  sourceName: z.string().trim().min(1).max(255),
  tags: z.array(z.string().trim().min(1).max(64)).max(20),
  expectedOutcome: problemText,
  constraints: z.string().trim().max(20_000),
  startsAt: nullableContentDateTime,
  deadline: nullableContentDateTime,
  publicContact: z.string().trim().min(1).max(500),
  internalContactNote: z.string().trim().max(20_000),
};
const problemScheduleMessage = '开始时间不得晚于截止时间';
function validProblemSchedule(value: { startsAt?: string | null; deadline?: string | null }) {
  return (
    value.startsAt == null ||
    value.deadline == null ||
    Date.parse(value.startsAt) <= Date.parse(value.deadline)
  );
}
const problemCreateSchema = z
  .object(problemFields)
  .strict()
  .refine(validProblemSchedule, { message: problemScheduleMessage, path: ['deadline'] });
const problemPatchSchema = z
  .object({
    title: problemFields.title.optional(),
    summary: problemFields.summary.optional(),
    background: problemFields.background.optional(),
    sourceType: problemFields.sourceType.optional(),
    sourceName: problemFields.sourceName.optional(),
    tags: problemFields.tags.optional(),
    expectedOutcome: problemFields.expectedOutcome.optional(),
    constraints: problemFields.constraints.optional(),
    startsAt: problemFields.startsAt.optional(),
    deadline: problemFields.deadline.optional(),
    publicContact: problemFields.publicContact.optional(),
    internalContactNote: problemFields.internalContactNote.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)
  .refine(validProblemSchedule, { message: problemScheduleMessage, path: ['deadline'] });
const problemListSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    status: problemStatus.optional(),
    tag: z.string().trim().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const problemRouteSchema = z.object({ problemId: identifier }).strict();
const problemTransitionSchema = z.object({ to: problemStatus }).strict();
const problemReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(4_000).nullable().default(null),
  })
  .strict();
const teamRouteSchema = z.object({ problemId: identifier, teamId: identifier }).strict();
const teamMemberRouteSchema = z
  .object({ problemId: identifier, teamId: identifier, memberUid: identifier })
  .strict();
const postRouteSchema = z.object({ problemId: identifier, postId: identifier }).strict();
const outcomeRouteSchema = z.object({ problemId: identifier, outcomeId: identifier }).strict();
const teamCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    proposal: problemText,
  })
  .strict();
const teamMemberSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }).strict(),
  z.object({ action: z.literal('confirm'), memberUid: identifier }).strict(),
]);
const postCreateSchema = z
  .object({
    teamId: identifier.nullable().default(null),
    kind: z.enum(['discussion', 'progress']),
    body: problemText,
  })
  .strict();
const postPatchSchema = z.object({ body: problemText }).strict();
const postTransitionSchema = z.object({ to: z.literal('hidden') }).strict();
const outcomeCreateSchema = z
  .object({
    teamId: identifier,
    title: z.string().trim().min(1).max(255),
    description: problemText,
    linkUrl: z.string().url().max(2_048).nullable().default(null),
    attachmentRef: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();
const outcomePatchSchema = z.object({ status: z.literal('adopted') }).strict();

function send<T>(response: Response, statusCode: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(statusCode).json(envelope);
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

function parseProblemInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const scheduleIssue = result.error.issues.find(
      ({ message, path }) => message === problemScheduleMessage && path.includes('deadline'),
    );
    throw new HttpError(
      400,
      'invalid_request',
      scheduleIssue === undefined ? 'Request validation failed' : problemScheduleMessage,
    );
  }
  return result.data;
}

function sendAuthError(response: Response, result: Exclude<AuthenticationResult, { status: 200 }>) {
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
}

async function requireActor(
  options: LiaisonRouterOptions,
  request: Request,
  response: Response,
): Promise<AuthorizationContext | null> {
  const result = await options.authenticate(request.headers);
  if (result.status !== 200) {
    sendAuthError(response, result);
    return null;
  }
  return result.user;
}

async function optionalActor(
  options: LiaisonRouterOptions,
  request: Request,
  response: Response,
): Promise<{ actor: AuthorizationContext | null } | null> {
  const result = await options.authenticate(request.headers);
  if (result.status === 200) return { actor: result.user };
  if (result.code === 'missing_identity') return { actor: null };
  sendAuthError(response, result);
  return null;
}

function requestedScope(input: { scopeType?: string; scopeId?: string }): ScopeRef | undefined {
  return input.scopeType === undefined ? undefined : { type: input.scopeType, id: input.scopeId! };
}

function readDecision(actor: AuthorizationContext, scopeRef?: ScopeRef) {
  return authorize(actor, {
    action: 'liaison.resource.read',
    resource: 'liaison_resource',
    scope: scopeRef,
  });
}

function allowed(actor: AuthorizationContext, action: string, scopeRef: ScopeRef): boolean {
  return authorize(actor, {
    action,
    resource: 'liaison_resource',
    scope: scopeRef,
  }).allowed;
}

function validateVisibilityScope(visibilityValue: string, scopeValue: ScopeRef): void {
  const valid =
    visibilityValue === 'public'
      ? scopeValue.type === 'public' && scopeValue.id === '*'
      : visibilityValue === 'organization'
        ? scopeValue.type === 'organization' && scopeValue.id !== '*'
        : scopeValue.type !== 'public' && scopeValue.id !== '*';
  if (!valid) {
    throw new HttpError(400, 'invalid_visibility_scope', 'Visibility and scope do not match');
  }
}

function forbid(response: Response, message = 'Liaison permission is required'): void {
  send<ErrorData>(response, 403, { error: { code: 'forbidden', message } });
}

export function createLiaisonRouter(options: LiaisonRouterOptions): Router {
  const router = Router();
  const service = new LiaisonService(options.store);
  const problemService = new LiaisonProblemService(options.store);

  router.use(async (_request, response, next) => {
    try {
      const record = (await options.store.modules.list({ query: 'liaison' })).find(
        (candidate) => candidate.moduleId === 'liaison',
      );
      if (record === undefined || !record.enabled || record.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Liaison module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/problems', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const filters = parse(problemListSchema, request.query);
    send(response, 200, await problemService.list(actor, filters));
  });

  router.post('/problems', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(
      response,
      201,
      await problemService.create(actor, parseProblemInput(problemCreateSchema, request.body)),
    );
  });

  router.get('/problems/:problemId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(response, 200, await problemService.get(actor, problemId));
  });

  router.patch('/problems/:problemId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(
      response,
      200,
      await problemService.update(
        actor,
        problemId,
        parseProblemInput(problemPatchSchema, request.body),
      ),
    );
  });

  router.post('/problems/:problemId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    const { to } = parse(problemTransitionSchema, request.body);
    send(response, 200, await problemService.transition(actor, problemId, to));
  });

  router.post('/problems/:problemId/review', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    const review = parse(problemReviewSchema, request.body);
    send(
      response,
      200,
      await problemService.review(actor, problemId, review.decision, review.note),
    );
  });

  router.get('/problems/:problemId/teams', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(response, 200, await problemService.listTeams(actor, problemId));
  });

  router.post('/problems/:problemId/teams', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(
      response,
      201,
      await problemService.createTeam(actor, problemId, parse(teamCreateSchema, request.body)),
    );
  });

  router.post('/problems/:problemId/teams/:teamId/members', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId, teamId } = parse(teamRouteSchema, request.params);
    const input = parse(teamMemberSchema, request.body);
    if (input.action === 'request') {
      send(response, 201, await problemService.requestMembership(actor, problemId, teamId));
      return;
    }
    send(
      response,
      200,
      await problemService.confirmMembership(actor, problemId, teamId, input.memberUid),
    );
  });

  router.delete(
    '/problems/:problemId/teams/:teamId/members/:memberUid',
    async (request, response) => {
      const actor = await requireActor(options, request, response);
      if (actor === null) return;
      const { problemId, teamId, memberUid } = parse(teamMemberRouteSchema, request.params);
      await problemService.removeMember(actor, problemId, teamId, memberUid);
      response.status(204).end();
    },
  );

  router.get('/problems/:problemId/posts', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(response, 200, await problemService.listPosts(actor, problemId));
  });

  router.post('/problems/:problemId/posts', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(
      response,
      201,
      await problemService.createPost(actor, problemId, parse(postCreateSchema, request.body)),
    );
  });

  router.patch('/problems/:problemId/posts/:postId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId, postId } = parse(postRouteSchema, request.params);
    const { body } = parse(postPatchSchema, request.body);
    send(response, 200, await problemService.updatePost(actor, problemId, postId, body));
  });

  router.post('/problems/:problemId/posts/:postId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId, postId } = parse(postRouteSchema, request.params);
    parse(postTransitionSchema, request.body);
    send(response, 200, await problemService.hidePost(actor, problemId, postId));
  });

  router.get('/problems/:problemId/outcomes', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(response, 200, await problemService.listOutcomes(actor, problemId));
  });

  router.post('/problems/:problemId/outcomes', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId } = parse(problemRouteSchema, request.params);
    send(
      response,
      201,
      await problemService.submitOutcome(
        actor,
        problemId,
        parse(outcomeCreateSchema, request.body),
      ),
    );
  });

  router.patch('/problems/:problemId/outcomes/:outcomeId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { problemId, outcomeId } = parse(outcomeRouteSchema, request.params);
    parse(outcomePatchSchema, request.body);
    send(response, 200, await problemService.adoptOutcome(actor, problemId, outcomeId));
  });

  router.get('/resources', async (request, response) => {
    const filters = parse(querySchema, request.query);
    const authentication = await optionalActor(options, request, response);
    if (authentication === null) return;
    if (authentication.actor === null) {
      if (filters.visibility !== undefined && filters.visibility !== 'public') {
        send<ErrorData>(response, 401, {
          error: { code: 'missing_identity', message: 'Authentication is required' },
        });
        return;
      }
      send(response, 200, await service.listPublic(filters));
      return;
    }

    const scopeRef = requestedScope(filters);
    if (filters.visibility === 'organization' && scopeRef !== undefined) {
      if (!readDecision(authentication.actor, scopeRef).allowed) {
        forbid(response);
        return;
      }
    }
    if (filters.visibility === 'restricted' && scopeRef !== undefined) {
      const decision = readDecision(authentication.actor, scopeRef);
      if (!decision.allowed || decision.reason === 'base-role-grant') {
        await service.auditDeniedRead(authentication.actor.uid, scopeRef);
        forbid(response, 'Restricted liaison permission is required');
        return;
      }
    }
    send(response, 200, await service.listAuthorized(authentication.actor, filters));
  });

  router.post('/resources', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(createSchema, request.body);
    validateVisibilityScope(input.visibility, input.scope);
    if (!allowed(actor, 'liaison.resource.create', input.scope)) {
      forbid(response);
      return;
    }
    send(response, 201, await service.create(actor.uid, input));
  });

  router.post('/resources/:resourceId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { resourceId } = parse(resourceRouteSchema, request.params);
    const { to } = parse(transitionSchema, request.body);
    send(response, 200, await service.transition(actor, resourceId, to));
  });

  router.patch('/resources', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(patchSchema, request.body);
    const { id, ...patch } = input;
    const updated = await service.update(actor, id, patch);
    if (updated === null) {
      throw new HttpError(404, 'liaison_resource_not_found', 'Liaison resource not found');
    }
    send(response, 200, updated);
  });

  return router;
}
