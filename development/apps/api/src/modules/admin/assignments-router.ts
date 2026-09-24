import type { ApiEnvelope } from '@freebbs-development/contracts';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import type { DevelopmentStore, ListFilters } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import {
  archiveRoleAssignment,
  archiveTagAssignment,
  createRoleAssignment,
  createTagAssignment,
} from './assignment-service.js';
import {
  assignmentIdSchema,
  paginationQuerySchema,
  roleAssignmentSchema,
  tagAssignmentSchema,
} from './schemas.js';
import { adminActor } from './subjects-router.js';

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

function filters(query: {
  query?: string;
  status?: string;
  scopeType?: string;
  scopeId?: string;
}): ListFilters {
  return {
    ...(query.query === undefined ? {} : { query: query.query }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
    ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
  };
}

export function createAssignmentsRouter(store: DevelopmentStore): Router {
  const router = Router();

  router.get('/role-assignments', async (request, response) => {
    const query = parse(paginationQuerySchema, request.query);
    send(
      response,
      200,
      await store.roleAssignments.page(filters(query), {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      }),
    );
  });

  router.post('/role-assignments', async (request, response) => {
    const input = parse(roleAssignmentSchema, request.body);
    const assignment = await createRoleAssignment(store, input, {
      actorUid: adminActor(response).uid,
    });
    send(response, 201, assignment);
  });

  router.delete('/role-assignments/:assignmentId', async (request: Request, response) => {
    const assignmentId = parse(assignmentIdSchema, request.params.assignmentId);
    const assignment = await archiveRoleAssignment(store, assignmentId, {
      actorUid: adminActor(response).uid,
    });
    send(response, 200, { id: assignment.id, status: assignment.status, archived: true });
  });

  router.get('/tag-assignments', async (request, response) => {
    const query = parse(paginationQuerySchema, request.query);
    send(
      response,
      200,
      await store.tagAssignments.page(filters(query), {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      }),
    );
  });

  router.post('/tag-assignments', async (request, response) => {
    const input = parse(tagAssignmentSchema, request.body);
    const assignment = await createTagAssignment(store, input, {
      actorUid: adminActor(response).uid,
    });
    send(response, 201, assignment);
  });

  router.delete('/tag-assignments/:assignmentId', async (request: Request, response) => {
    const assignmentId = parse(assignmentIdSchema, request.params.assignmentId);
    const assignment = await archiveTagAssignment(store, assignmentId, {
      actorUid: adminActor(response).uid,
    });
    send(response, 200, { id: assignment.id, status: assignment.status, archived: true });
  });

  return router;
}
