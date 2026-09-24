import {
  SOCIAL_ORGANIZATION_IDS,
  type ApiEnvelope,
  type ScopeRef,
} from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  contentCategory,
  knowledgeReadabilitySchema,
} from '../../core/validation/content-fields.js';
import { KnowledgeService } from './service.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

export interface KnowledgeRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
}

interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(20_000);
const status = z.enum(['draft', 'published', 'archived']);
const type = z.enum(['workflow', 'faq', 'contact', 'retrospective', 'notice']);
const audience = z.enum(['general', 'social_org']);
const organizationId = z.enum(SOCIAL_ORGANIZATION_IDS);
const scope = z
  .object({
    type: identifier.regex(/^[a-z][a-z0-9_]*$/),
    id: identifier,
  })
  .strict();
const querySchema = z
  .object({
    category: contentCategory.optional(),
    tag: contentCategory.optional(),
    organizationId: organizationId.optional(),
    status: status.optional(),
    type: type.optional(),
    audience: audience.default('general'),
    scopeType: identifier.regex(/^[a-z][a-z0-9_]*$/).optional(),
    scopeId: identifier.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const createSchema = z
  .object({
    ...knowledgeReadabilitySchema.shape,
    type,
    title,
    body,
    status: z.literal('draft').default('draft'),
    audience: audience.default('general'),
    organizationId: organizationId.nullable().default(null),
    scope: scope.optional(),
  })
  .strict();
const patchSchema = z
  .object({
    ...knowledgeReadabilitySchema.partial().shape,
    id: identifier,
    type: type.optional(),
    title: title.optional(),
    body: body.optional(),
    scope: scope.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.category !== undefined ||
      value.tags !== undefined ||
      value.summary !== undefined ||
      value.maintainedAt !== undefined ||
      value.maintainerUid !== undefined ||
      value.type !== undefined ||
      value.title !== undefined ||
      value.body !== undefined ||
      value.scope !== undefined,
  );
const transitionSchema = z.object({ to: status }).strict();

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

function sendAuthError(response: Response, result: Exclude<AuthenticationResult, { status: 200 }>) {
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
}

async function requireActor(
  options: KnowledgeRouterOptions,
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
  options: KnowledgeRouterOptions,
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

function allowed(actor: AuthorizationContext, action: string, scopeRef?: ScopeRef): boolean {
  return authorize(actor, {
    action,
    resource: 'knowledge_entry',
    scope: scopeRef,
  }).allowed;
}

function forbid(response: Response, message = 'Knowledge permission is required'): void {
  send<ErrorData>(response, 403, { error: { code: 'forbidden', message } });
}

export function createKnowledgeRouter(options: KnowledgeRouterOptions): Router {
  const router = Router();
  const service = new KnowledgeService(options.store);

  router.use(async (_request, response, next) => {
    try {
      const record = (await options.store.modules.list({ query: 'knowledge' })).find(
        (candidate) => candidate.moduleId === 'knowledge',
      );
      if (record === undefined || !record.enabled || record.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Knowledge module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/entries', async (request, response) => {
    const filters = parse(querySchema, request.query);
    const authentication = await optionalActor(options, request, response);
    if (authentication === null) return;
    if (
      filters.audience === 'social_org' &&
      (authentication.actor === null || !service.canReadSocialAudience(authentication.actor))
    ) {
      forbid(response);
      return;
    }
    const scopeRef = requestedScope(filters);
    const canMaintain =
      authentication.actor !== null &&
      (allowed(authentication.actor, 'knowledge.create', scopeRef) ||
        allowed(authentication.actor, 'knowledge.publish', scopeRef));
    send(response, 200, await service.list(filters, !canMaintain, authentication.actor));
  });

  router.post('/entries', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(createSchema, request.body);
    send(response, 201, await service.create(actor, input));
  });

  router.patch('/entries', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(patchSchema, request.body);
    const { id, ...patch } = input;
    const updated = await service.update(actor, id, patch);
    if (updated === null) throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
    send(response, 200, updated);
  });

  router.post('/entries/:entryId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const entryId = parse(identifier, request.params.entryId);
    const input = parse(transitionSchema, request.body);
    const updated = await service.transition(actor, entryId, input.to);
    if (updated === null) throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
    send(response, 200, updated);
  });

  return router;
}
