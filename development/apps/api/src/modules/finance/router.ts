import { SOCIAL_ORGANIZATION_IDS, type ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { FinanceService } from './service.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;
export interface FinanceRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
}
interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const scope = z.object({ type: identifier.regex(/^[a-z][a-z0-9_]*$/), id: identifier }).strict();
const status = z.enum(['draft', 'submitted', 'approved', 'rejected', 'archived']);
const kind = z.enum(['budget', 'settlement']);
const amountCents = z.number().int().safe().nonnegative();
const organizationId = z.enum(SOCIAL_ORGANIZATION_IDS);
const querySchema = z
  .object({
    status: status.optional(),
    scopeType: identifier.regex(/^[a-z][a-z0-9_]*$/).optional(),
    scopeId: identifier.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const createSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind,
    amountCents,
    activityId: identifier.nullable().default(null),
    organizationId: organizationId.nullable().default(null),
    status: z.literal('draft').default('draft'),
    scope,
  })
  .strict();
const patchSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(200).optional(),
    kind: kind.optional(),
    amountCents: amountCents.optional(),
    activityId: identifier.nullable().optional(),
    organizationId: organizationId.nullable().optional(),
    scope: scope.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.kind !== undefined ||
      value.amountCents !== undefined ||
      value.activityId !== undefined ||
      value.scope !== undefined ||
      value.organizationId !== undefined,
  );
const routeSchema = z.object({ recordId: identifier }).strict();
const transitionSchema = z.object({ to: status }).strict();
const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']) }).strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}
function send<T>(response: Response, statusCode: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(statusCode).json(envelope);
}
function sendAuthError(response: Response, result: Exclude<AuthenticationResult, { status: 200 }>) {
  send<ErrorData>(response, result.status, {
    error: { code: result.code, message: result.message },
  });
}
async function requireActor(
  options: FinanceRouterOptions,
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
function forbid(response: Response): void {
  send<ErrorData>(response, 403, {
    error: { code: 'forbidden', message: 'Explicit finance permission is required' },
  });
}

export function createFinanceRouter(options: FinanceRouterOptions): Router {
  const router = Router();
  const service = new FinanceService(options.store);

  router.use(async (_request, response, next) => {
    try {
      const module = (await options.store.modules.list({ query: 'finance' })).find(
        (record) => record.moduleId === 'finance',
      );
      if (module === undefined || !module.enabled || module.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Finance module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/records', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const result = await service.list(actor, parse(querySchema, request.query));
    if (!result.authorized) return forbid(response);
    send(response, 200, result.records);
  });

  router.post('/records', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(createSchema, request.body);
    send(response, 201, await service.create(actor, input));
  });

  router.patch('/records', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(patchSchema, request.body);
    const { id, ...patch } = input;
    send(response, 200, await service.update(actor, id, patch));
  });

  router.post('/records/:recordId/reviews', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { recordId } = parse(routeSchema, request.params);
    const { decision } = parse(reviewSchema, request.body);
    send(response, 200, await service.review(actor, recordId, decision));
  });

  router.post('/records/:recordId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const { recordId } = parse(routeSchema, request.params);
    const { to } = parse(transitionSchema, request.body);
    send(response, 200, await service.transition(actor, recordId, to));
  });

  return router;
}
