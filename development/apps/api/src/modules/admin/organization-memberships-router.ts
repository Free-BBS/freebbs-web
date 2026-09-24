import { SOCIAL_ORGANIZATION_IDS, type ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';

import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  revokeOrganizationMembership,
  setOrganizationMembership,
} from './organization-membership-service.js';
import { adminActor } from './subjects-router.js';

import type { Response } from 'express';

const organizationIdSchema = z.enum(SOCIAL_ORGANIZATION_IDS);
const membershipSchema = z
  .object({
    subjectUid: z.string().trim().min(1).max(128),
    organizationId: organizationIdSchema,
    level: z.enum(['member', 'director', 'lead']),
  })
  .strict();
const routeSchema = z
  .object({
    subjectUid: z.string().trim().min(1).max(128),
    organizationId: organizationIdSchema,
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'invalid_request', 'Request validation failed');
  }
  return result.data;
}

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(status).json(envelope);
}

export function createOrganizationMembershipsRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.post('/', async (request, response) => {
    const input = parse(membershipSchema, request.body);
    send(
      response,
      201,
      await setOrganizationMembership(store, input, {
        actorUid: adminActor(response).uid,
      }),
    );
  });

  router.delete('/:subjectUid/:organizationId', async (request, response) => {
    const { subjectUid, organizationId } = parse(routeSchema, request.params);
    await revokeOrganizationMembership(store, subjectUid, organizationId, {
      actorUid: adminActor(response).uid,
    });
    response.status(204).end();
  });

  return router;
}
