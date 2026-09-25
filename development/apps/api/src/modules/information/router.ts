import type { ApiEnvelope, ScopeRef } from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { contentCategory, nullableContentDateTime } from '../../core/validation/content-fields.js';
import { PROPOSAL_STATUSES, ProposalService } from './proposal-service.js';
import { InformationService } from './service.js';

import type { Request, Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

export interface InformationRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
}

interface ErrorData {
  error: { code: string; message: string };
}

const identifier = z.string().trim().min(1).max(128);
const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(20_000);
const scope = z
  .object({
    type: identifier.regex(/^[a-z][a-z0-9_]*$/),
    id: identifier,
  })
  .strict();
const announcementStatus = z.enum(['draft', 'published', 'archived']);
const consultationStatus = z.enum(['open', 'in_progress', 'resolved', 'closed']);
const informationFeedFilter = z.enum([
  'all',
  'official',
  'public_feedback',
  'mine',
  'in_progress',
  'resolved',
]);
const informationTargetType = z.enum(['announcement', 'consultation']);
const informationReplyCreateSchema = z
  .object({
    kind: z.enum(['reply', 'supplement']).default('reply'),
    body,
  })
  .strict();
const proposalStatus = z.enum(PROPOSAL_STATUSES);
const listQueryFields = {
  scopeType: identifier.regex(/^[a-z][a-z0-9_]*$/).optional(),
  scopeId: identifier.optional(),
  query: z.string().trim().min(1).max(200).optional(),
};
const announcementQuerySchema = z
  .object({ status: announcementStatus.optional(), ...listQueryFields })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const consultationQuerySchema = z
  .object({ status: consultationStatus.optional(), ...listQueryFields })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const proposalQuerySchema = z
  .object({
    status: proposalStatus.optional(),
    category: contentCategory.optional(),
    ...listQueryFields,
  })
  .strict()
  .refine((value) => (value.scopeType === undefined) === (value.scopeId === undefined));
const announcementCreateSchema = z
  .object({
    title,
    body,
    status: z.literal('draft').default('draft'),
    scope: scope.default({ type: 'public', id: '*' }),
  })
  .strict();
const announcementPatchSchema = z
  .object({
    id: identifier,
    title: title.optional(),
    body: body.optional(),
    scope: scope.optional(),
  })
  .strict()
  .refine(
    (value) => value.title !== undefined || value.body !== undefined || value.scope !== undefined,
  );
const consultationCreateSchema = z
  .object({ title, body, visibility: z.enum(['public', 'private']).default('private') })
  .strict();
const transitionAnnouncementSchema = z.object({ to: announcementStatus }).strict();
const transitionConsultationSchema = z.object({ to: consultationStatus }).strict();
const consultationHandlingSchema = z
  .object({
    dueAt: nullableContentDateTime.optional(),
    assigneeUid: identifier.nullable().optional(),
    reply: z.string().trim().max(20_000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.assigneeUid !== undefined || value.reply !== undefined || value.dueAt !== undefined,
  );
const consultationPatchSchema = z
  .object({
    id: identifier,
    title: title.optional(),
    body: body.optional(),
    visibility: z.enum(['public', 'private']).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined || value.body !== undefined || value.visibility !== undefined,
  );
const proposalCreateSchema = z
  .object({
    dueAt: nullableContentDateTime.default(null),
    title,
    problemDescription: body,
    proposedSolution: body,
    category: z.string().trim().min(1).max(80),
  })
  .strict();
const proposalMaintenanceSchema = z
  .object({
    dueAt: nullableContentDateTime.optional(),
    category: z.string().trim().min(1).max(80).optional(),
    status: proposalStatus.optional(),
    assigneeUid: identifier.nullable().optional(),
    publicProgress: z.string().trim().max(20_000).optional(),
    internalNote: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.dueAt !== undefined ||
      value.category !== undefined ||
      value.status !== undefined ||
      value.assigneeUid !== undefined ||
      value.publicProgress !== undefined ||
      value.internalNote !== undefined,
  );

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
  options: InformationRouterOptions,
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
  options: InformationRouterOptions,
  request: Request,
  response: Response,
): Promise<{ actor: AuthorizationContext | null } | null> {
  const result = await options.authenticate(request.headers);
  if (result.status === 200) return { actor: result.user };
  if (result.code === 'missing_identity') return { actor: null };
  sendAuthError(response, result);
  return null;
}

function allowed(
  actor: AuthorizationContext,
  action: string,
  resource: 'announcement' | 'consultation',
  scopeRef?: ScopeRef,
): boolean {
  return authorize(actor, { action, resource, scope: scopeRef }).allowed;
}

function forbid(response: Response, message = 'Information permission is required'): void {
  send<ErrorData>(response, 403, { error: { code: 'forbidden', message } });
}

export function createInformationRouter(options: InformationRouterOptions): Router {
  const router = Router();
  const service = new InformationService(options.store);
  const proposals = new ProposalService(options.store);

  router.use(async (_request, response, next) => {
    try {
      const record = (await options.store.modules.list({ query: 'information' })).find(
        (candidate) => candidate.moduleId === 'information',
      );
      if (record === undefined || !record.enabled || record.status !== 'enabled') {
        send<ErrorData>(response, 503, {
          error: { code: 'module_disabled', message: 'Information module is disabled' },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/announcements', async (request, response) => {
    const filters = parse(announcementQuerySchema, request.query);
    const authentication = await optionalActor(options, request, response);
    if (authentication === null) return;
    send(response, 200, await service.listAnnouncements(filters, authentication.actor));
  });

  router.get('/feed', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const filter = parse(informationFeedFilter.default('all'), request.query.filter);
    send(response, 200, await service.listFeed(actor, filter));
  });

  router.get('/feed/:kind/:id', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const kind = parse(informationTargetType, request.params.kind);
    const id = parse(identifier, request.params.id);
    const detail = await service.getFeedDetail(actor, kind, id);
    if (!detail) throw new HttpError(404, 'information_not_found', 'Information not found');
    send(response, 200, detail);
  });

  router.post('/feed/:kind/:id/replies', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const kind = parse(informationTargetType, request.params.kind);
    const id = parse(identifier, request.params.id);
    const reply = await service.createReply(
      actor,
      kind,
      id,
      parse(informationReplyCreateSchema, request.body),
    );
    if (!reply) throw new HttpError(404, 'information_not_found', 'Information not found');
    send(response, 201, reply);
  });

  router.put('/feed/:kind/:id/like', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(
      response,
      200,
      await service.setLike(
        actor,
        parse(informationTargetType, request.params.kind),
        parse(identifier, request.params.id),
        true,
      ),
    );
  });

  router.delete('/feed/:kind/:id/like', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    send(
      response,
      200,
      await service.setLike(
        actor,
        parse(informationTargetType, request.params.kind),
        parse(identifier, request.params.id),
        false,
      ),
    );
  });

  router.post('/announcements', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(announcementCreateSchema, request.body);
    if (!allowed(actor, 'information.announcement.create', 'announcement', input.scope)) {
      forbid(response);
      return;
    }
    if (
      input.status !== 'draft' &&
      !allowed(actor, 'information.announcement.publish', 'announcement', input.scope)
    ) {
      forbid(response, 'Announcement publication permission is required');
      return;
    }
    send(response, 201, await service.createAnnouncement(actor.uid, input));
  });

  router.patch('/announcements', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(announcementPatchSchema, request.body);
    const { id, ...patch } = input;
    const updated = await service.updateAnnouncement(actor, id, patch);
    if (updated === null)
      throw new HttpError(404, 'announcement_not_found', 'Announcement not found');
    send(response, 200, updated);
  });

  router.post('/announcements/:announcementId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const announcementId = parse(identifier, request.params.announcementId);
    const input = parse(transitionAnnouncementSchema, request.body);
    const updated = await service.transitionAnnouncement(actor, announcementId, input.to);
    if (updated === null)
      throw new HttpError(404, 'announcement_not_found', 'Announcement not found');
    send(response, 200, updated);
  });
  router.get('/consultations', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const filters = parse(consultationQuerySchema, request.query);
    send(response, 200, await service.listConsultations(filters, actor));
  });

  router.post('/consultations', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(consultationCreateSchema, request.body);
    const personalScope = { type: 'user', id: actor.uid } as const;
    if (!allowed(actor, 'information.consultation.create', 'consultation', personalScope)) {
      forbid(response, 'Consultation submission permission is required');
      return;
    }
    send(response, 201, await service.createConsultation(actor.uid, input));
  });

  router.patch('/consultations', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(consultationPatchSchema, request.body);
    const { id, ...patch } = input;
    const updated = await service.updateConsultation(actor, id, patch);
    if (updated === null)
      throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
    send(response, 200, updated);
  });

  router.patch('/consultations/:consultationId/handling', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const consultationId = parse(identifier, request.params.consultationId);
    const input = parse(consultationHandlingSchema, request.body);
    const updated = await service.updateConsultationHandling(actor, consultationId, input);
    if (updated === null)
      throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
    send(response, 200, updated);
  });

  router.post('/consultations/:consultationId/transitions', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const consultationId = parse(identifier, request.params.consultationId);
    const input = parse(transitionConsultationSchema, request.body);
    const updated = await service.transitionConsultation(actor, consultationId, input.to);
    if (updated === null)
      throw new HttpError(404, 'consultation_not_found', 'Consultation not found');
    send(response, 200, updated);
  });
  router.get('/proposals', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const filters = parse(proposalQuerySchema, request.query);
    send(response, 200, await proposals.list(filters, actor));
  });

  router.get('/proposals/:proposalId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const proposalId = parse(identifier, request.params.proposalId);
    const proposal = await proposals.get(proposalId, actor);
    if (proposal === null) throw new HttpError(404, 'proposal_not_found', 'Proposal not found');
    send(response, 200, proposal);
  });

  router.post('/proposals', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const input = parse(proposalCreateSchema, request.body);
    send(response, 201, await proposals.create(actor, input));
  });

  router.patch('/proposals/:proposalId', async (request, response) => {
    const actor = await requireActor(options, request, response);
    if (actor === null) return;
    const proposalId = parse(identifier, request.params.proposalId);
    const input = parse(proposalMaintenanceSchema, request.body);
    const proposal = await proposals.maintain(actor, proposalId, input);
    if (proposal === null) throw new HttpError(404, 'proposal_not_found', 'Proposal not found');
    send(response, 200, proposal);
  });

  return router;
}
