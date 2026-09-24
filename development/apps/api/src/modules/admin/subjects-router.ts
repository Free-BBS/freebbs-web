import type { ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { paginationQuerySchema, subjectUidSchema } from './schemas.js';

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(status).json(envelope);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

export function createSubjectsRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    const query = parse(paginationQuerySchema, request.query);
    const page = await store.subjects.page(
      {
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
        ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
      },
      { page: query.page ?? 1, pageSize: query.pageSize ?? 20 },
    );
    send(response, 200, page);
  });

  router.get('/:uid', async (request, response) => {
    const uid = parse(subjectUidSchema, request.params.uid);
    const subject = (await store.subjects.list({ query: uid })).find(
      (candidate) => candidate.uid === uid,
    );
    if (subject === undefined) throw new HttpError(404, 'subject_not_found', 'Subject not found');
    send(response, 200, subject);
  });

  return router;
}

export function adminActor(response: Response): AuthorizationContext {
  return response.locals.user as AuthorizationContext;
}
