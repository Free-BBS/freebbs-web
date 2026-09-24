import { ROLE_KEYS, type ApiEnvelope, type RoleKey } from '@freebbs-development/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';

import { synchronizeSubject } from '../../core/auth/auth-middleware.js';
import { upsertDevelopmentAccessInTransaction } from '../../core/auth/development-access.js';
import { directoryUserContext, type UserDirectory } from '../../core/auth/user-directory.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { adminActor } from './subjects-router.js';

const ASSIGNABLE_ROLES = ROLE_KEYS.filter((key) => key !== 'platform.super_admin');
const publicScope = { type: 'public', id: '*' } as const;

const updateSchema = z.object({
  accessLevel: z.enum(['member', 'lead']).nullable(),
  roles: z.array(z.enum(ASSIGNABLE_ROLES as [RoleKey, ...RoleKey[]])).max(ROLE_KEYS.length),
  captainTeamIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
});

function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}

export function createDevelopmentUsersRouter(
  store: DevelopmentStore,
  directory: UserDirectory,
): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    const query = String(request.query.query ?? '')
      .trim()
      .slice(0, 80);
    const [users, grants, assignments, captainAssignments] = await Promise.all([
      directory.list(query),
      store.developmentAccess.list(),
      store.roleAssignments.list(),
      store.tagAssignments.list({ query: 'sports.team_captain' }),
    ]);
    send(
      response,
      200,
      users.map((user) => {
        const grant = grants.find(
          (candidate) =>
            candidate.status === 'active' &&
            (candidate.subjectUid === user.uid ||
              (user.studentId && candidate.studentId === user.studentId)),
        );
        return {
          ...user,
          accessLevel: grant?.accessLevel ?? null,
          roles: assignments
            .filter(
              (assignment) =>
                assignment.subjectUid === user.uid &&
                assignment.status === 'active' &&
                assignment.roleKey !== 'platform.super_admin',
            )
            .map(({ roleKey }) => roleKey),
          captainTeamIds: captainAssignments
            .filter(
              (assignment) =>
                assignment.subjectUid === user.uid &&
                assignment.status === 'active' &&
                assignment.tagKey === 'sports.team_captain',
            )
            .map(({ scope }) => scope.id),
        };
      }),
    );
  });

  router.put('/:uid', async (request, response) => {
    const target = await directory.get(String(request.params.uid));
    if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Invalid access settings');
    const actor = adminActor(response);

    await store.transaction(async (transactionStore) => {
      await synchronizeSubject(transactionStore, directoryUserContext(target), new Date());
      await upsertDevelopmentAccessInTransaction(transactionStore, {
        user: directoryUserContext(target),
        accessLevel: parsed.data.accessLevel,
        actorUid: actor.uid,
      });

      const desiredRoles = new Set(parsed.data.roles);
      const currentRoles = await transactionStore.roleAssignments.listForUpdate({
        query: target.uid,
      });
      for (const assignment of currentRoles) {
        if (assignment.subjectUid !== target.uid || assignment.roleKey === 'platform.super_admin')
          continue;
        const wanted = desiredRoles.has(assignment.roleKey);
        if (wanted && assignment.status !== 'active') {
          await transactionStore.roleAssignments.update(assignment.id, {
            status: 'active',
            expiresAt: null,
          });
        } else if (!wanted && assignment.status === 'active') {
          await transactionStore.roleAssignments.update(assignment.id, { status: 'archived' });
        }
        desiredRoles.delete(assignment.roleKey);
      }
      for (const roleKey of desiredRoles) {
        await transactionStore.roleAssignments.create({
          subjectUid: target.uid,
          roleKey,
          expiresAt: null,
          status: 'active',
          ownerUid: actor.uid,
          scope: publicScope,
        });
      }

      const desiredTeams = new Set(parsed.data.captainTeamIds);
      const currentTags = await transactionStore.tagAssignments.listForUpdate({
        query: target.uid,
      });
      for (const assignment of currentTags) {
        if (assignment.subjectUid !== target.uid || assignment.tagKey !== 'sports.team_captain')
          continue;
        const wanted = desiredTeams.has(assignment.scope.id);
        if (wanted && assignment.status !== 'active') {
          await transactionStore.tagAssignments.update(assignment.id, { status: 'active' });
        } else if (!wanted && assignment.status === 'active') {
          await transactionStore.tagAssignments.update(assignment.id, { status: 'archived' });
        }
        desiredTeams.delete(assignment.scope.id);
      }
      for (const teamId of desiredTeams) {
        await transactionStore.tagAssignments.create({
          subjectUid: target.uid,
          tagKey: 'sports.team_captain',
          expiresAt: null,
          status: 'active',
          ownerUid: actor.uid,
          scope: { type: 'sports_team', id: teamId },
        });
      }

      await transactionStore.auditLogs.create({
        actorUid: actor.uid,
        action: 'admin.development_user.update',
        resourceType: 'development_user',
        resourceId: target.uid,
        details: parsed.data,
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
    });
    send(response, 200, { updated: true, uid: target.uid });
  });

  return router;
}

export { ASSIGNABLE_ROLES };
