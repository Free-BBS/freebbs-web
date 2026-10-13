import { ROLE_KEYS, type ApiEnvelope } from '@freebbs-development/contracts';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { synchronizeSubject } from '../../core/auth/auth-middleware.js';
import { upsertDevelopmentAccessInTransaction } from '../../core/auth/development-access.js';
import { directoryUserContext, type UserDirectory } from '../../core/auth/user-directory.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { adminActor } from './subjects-router.js';
import { hasRecipientAccess } from '../system-settings/users.js';
import {
  businessAdminIdentities,
  effectiveGlobalBusinessAdmins,
} from '../../core/authorization/business-admin.js';

const ASSIGNABLE_ROLES = ROLE_KEYS.filter((key) => key !== 'platform.super_admin');
const publicScope = { type: 'public', id: '*' } as const;
const updateSchema = z.object({ accessLevel: z.enum(['member', 'lead']).nullable() }).strict();
function send<T>(response: Response, status: number, data: T): void {
  const envelope: ApiEnvelope<T> = { data, requestId: response.locals.requestId as string };
  response.status(status).json(envelope);
}
export function createDevelopmentUsersRouter(
  store: DevelopmentStore,
  directory: UserDirectory,
  allowedUids: readonly string[] = [],
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
        const grant = grants.find((candidate) => hasRecipientAccess(user, [candidate]));
        return {
          ...user,
          accessLevel: grant?.accessLevel ?? (allowedUids.includes(user.uid) ? 'member' : null),
          roles: assignments
            .filter(
              (row) =>
                row.subjectUid === user.uid &&
                row.status === 'active' &&
                row.roleKey !== 'platform.super_admin',
            )
            .map((row) => row.roleKey),
          captainTeamIds: captainAssignments
            .filter(
              (row) =>
                row.subjectUid === user.uid &&
                row.status === 'active' &&
                row.tagKey === 'sports.team_captain',
            )
            .map((row) => row.scope.id),
        };
      }),
    );
  });
  router.put('/:uid', async (request, response) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', 'Invalid access settings');
    const target = await directory.get(String(request.params.uid));
    if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
    const actor = adminActor(response);
    await store.transaction(async (transactionStore) => {
      const definitions = await transactionStore.roles.listForUpdate();
      await synchronizeSubject(transactionStore, directoryUserContext(target), new Date());
      const records = await transactionStore.developmentAccess.listForUpdate();
      const previous = records.find((record) => hasRecipientAccess(target, [record]));
      if (parsed.data.accessLevel === null) {
        const roles = await transactionStore.roleAssignments.listForUpdate();
        const activeSubjects = await transactionStore.subjects.listForUpdate({ status: 'active' });
        const identities = await businessAdminIdentities(roles, directory);
        const admins = effectiveGlobalBusinessAdmins(
          roles,
          definitions,
          activeSubjects,
          records,
          new Date(),
          identities,
          allowedUids,
        );
        if (admins.has(target.uid) && admins.size === 1 && !allowedUids.includes(target.uid)) {
          throw new HttpError(409, 'last_platform_admin', '至少保留一位可访问发展端的平台管理员');
        }
      }
      await upsertDevelopmentAccessInTransaction(transactionStore, {
        user: directoryUserContext(target),
        accessLevel: parsed.data.accessLevel,
        actorUid: actor.uid,
      });
      await transactionStore.auditLogs.create({
        actorUid: actor.uid,
        action: 'admin.development_access.update',
        resourceType: 'development_access',
        resourceId: target.uid,
        details: {
          previous: { accessLevel: previous?.accessLevel ?? null },
          next: { accessLevel: parsed.data.accessLevel },
        },
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
