import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { UserContext } from '@freebbs-development/contracts';
import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import { HttpError } from '../../core/errors/http-error.js';
import { fail, type OrganizationState } from './domain.js';
import { classRoster, classRosterHistory, replaceClassRosters } from './roster-service.js';

const classId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/)
  .refine(
    (value) =>
      value !== 'prototype' && !Object.prototype.hasOwnProperty.call(Object.prototype, value),
  );
const text = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) =>
        [...value].every(
          (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      '文字不能包含控制字符',
    );
const member = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/)
      .optional(),
    displayName: text(120).refine((value) => value.length > 0, '姓名不能为空'),
    studentId: text(100).optional(),
  })
  .strict();
const replacement = z
  .object({
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    members: z.array(member).max(2000),
  })
  .strict();
const imported = z
  .object({
    batches: z.array(replacement.extend({ classId }).strict()).min(1).max(100),
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, 'invalid_request', result.error.issues[0]?.message ?? '名单参数无效');
  return result.data;
}

export function createClassRostersRouter(options: {
  readState: () => Promise<OrganizationState>;
  changeState: <T>(operation: (state: OrganizationState) => T | Promise<T>) => Promise<T>;
  authenticate: (headers: AuthHeaders) => Promise<AuthenticationResult>;
}): Router {
  const router = Router();
  const actor = (response: Response) => response.locals.actor as UserContext;
  const send = (response: Response, data: unknown) =>
    response.json({ data, requestId: response.locals.requestId });
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  async function freshActor(request: Request, response: Response) {
    const original = actor(response);
    if (original.previewing) fail(403, 'roster_forbidden', '预览模式不能修改名单');
    // A write may wait behind a configuration update: reload current shared grants inside the lock.
    const identity = await options.authenticate(request.headers);
    if (identity.status !== 200)
      throw new HttpError(identity.status, identity.code, identity.message);
    if (identity.user.uid !== original.uid || identity.user.previewing)
      fail(403, 'roster_forbidden', '当前身份不能修改名单');
    return identity.user;
  }
  router.get('/:classId', async (request, response) => {
    const id = parse(classId, request.params.classId);
    send(response, classRoster(await options.readState(), actor(response), id));
  });
  router.get('/:classId/history', async (request, response) => {
    const id = parse(classId, request.params.classId);
    send(response, classRosterHistory(await options.readState(), actor(response), id));
  });
  router.put('/:classId', async (request, response) => {
    const id = parse(classId, request.params.classId);
    const input = parse(replacement, request.body);
    send(
      response,
      await options.changeState(async (state) => {
        const user = await freshActor(request, response);
        return replaceClassRosters(state, user, [{ classId: id, ...input }])[0];
      }),
    );
  });
  router.post('/import', async (request, response) => {
    const input = parse(imported, request.body);
    send(
      response,
      await options.changeState(async (state) => {
        const user = await freshActor(request, response);
        return { items: replaceClassRosters(state, user, input.batches, true) };
      }),
    );
  });
  return router;
}
