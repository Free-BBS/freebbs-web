import type { ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';

import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

const identifier = z.string().trim().min(1).max(128);
const auditQuerySchema = z
  .object({
    actorUid: identifier.optional(),
    action: identifier.optional(),
    resourceType: identifier.optional(),
    resourceId: identifier.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    ({ from, to }) => from === undefined || to === undefined || Date.parse(from) <= Date.parse(to),
    'from must not be later than to',
  );

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = {
    data,
    requestId: response.locals.requestId as string,
  };
  response.status(status).json(envelope);
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', 'Request validation failed');
  return result.data;
}

export function createAuditRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.get('/audit-logs', async (request, response) => {
    const query = parse(auditQuerySchema, request.query);
    send(response, 200, await store.queryAuditLogs(query));
  });

  return router;
}
