import {
  canManageDevelopmentAccess,
  type DevelopmentBusinessAdminBootstrapStatus,
  type DevelopmentBusinessAdminBootstrapResult,
} from '@freebbs-development/contracts';
import { Router } from 'express';
import { z } from 'zod';
import type { UserDirectory } from '../../core/auth/user-directory.js';
import {
  businessAdminIdentities,
  effectiveGlobalBusinessAdmins,
} from '../../core/authorization/business-admin.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { hasRecipientAccess } from '../system-settings/users.js';
import { adminActor } from './subjects-router.js';

const publicScope = { type: 'public', id: '*' } as const;
const inputSchema = z
  .object({
    uid: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export function createBusinessAdminBootstrapRouter(
  store: DevelopmentStore,
  directory: UserDirectory,
  allowedUids: readonly string[] = [],
): Router {
  const router = Router();
  router.get('/', async (_request, response) => {
    const [roles, assignments, subjects, access] = await Promise.all([
      store.roles.list(),
      store.roleAssignments.list(),
      store.subjects.list(),
      store.developmentAccess.list(),
    ]);
    const identities = await businessAdminIdentities(assignments, directory);
    const globalAdminCount = effectiveGlobalBusinessAdmins(
      assignments,
      roles,
      subjects,
      access,
      new Date(),
      identities,
      allowedUids,
    ).size;
    const data: DevelopmentBusinessAdminBootstrapStatus = {
      canInitialize:
        globalAdminCount === 0 &&
        roles.some((role) => role.key === 'platform.admin' && role.status === 'active'),
      globalAdminCount,
    };
    response.json({ data, requestId: response.locals.requestId });
  });
  router.post('/', async (request, response) => {
    const actor = adminActor(response);
    if (!canManageDevelopmentAccess(actor))
      throw new HttpError(403, 'forbidden', 'Original development lead access is required');
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'invalid_request', '请选择首位业务管理员');
    const target = await directory.get(parsed.data.uid);
    if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
    await store.transaction(async (tx) => {
      // The canonical role exists before any assignment and serializes first appointments.
      const roles = await tx.roles.listForUpdate();
      const assignments = await tx.roleAssignments.listForUpdate();
      const access = await tx.developmentAccess.listForUpdate();
      const subjects = await tx.subjects.listForUpdate();
      const identities = await businessAdminIdentities(assignments, directory);
      if (!subjects.some((subject) => subject.uid === actor.uid && subject.status === 'active'))
        throw new HttpError(403, 'forbidden', 'Original development lead access is required');
      if (
        !access.some(
          (grant) =>
            grant.subjectUid === actor.uid &&
            grant.status === 'active' &&
            grant.accessLevel === 'lead',
        ) &&
        !(
          actor.mainSiteAdmin === true &&
          !access.some(
            (grant) =>
              grant.status === 'active' &&
              grant.accessLevel === 'lead' &&
              grant.ownerUid !== 'system',
          )
        )
      )
        throw new HttpError(403, 'forbidden', 'Original development lead access is required');
      if (
        effectiveGlobalBusinessAdmins(
          assignments,
          roles,
          subjects,
          access,
          new Date(),
          identities,
          allowedUids,
        ).size > 0
      )
        throw new HttpError(
          409,
          'business_admin_already_initialized',
          '已存在可访问发展端的全局业务管理员',
        );
      if (!roles.some((role) => role.key === 'platform.admin' && role.status === 'active'))
        throw new HttpError(409, 'role_definition_inactive', '业务管理员角色不可用');
      const subject = subjects.find(({ uid }) => uid === target.uid);
      if (subject?.status !== 'active')
        throw new HttpError(409, 'subject_inactive', '目标用户须为活跃成员');
      if (!hasRecipientAccess(target, access, allowedUids))
        throw new HttpError(409, 'development_access_required', '目标用户须有有效发展端准入');
      const grant = access.find((row) => hasRecipientAccess(target, [row]));
      if (grant && !grant.subjectUid)
        await tx.developmentAccess.update(grant.id, {
          subjectUid: target.uid,
          username: target.username,
        });
      const existing = assignments.find(
        (row) =>
          row.subjectUid === target.uid &&
          row.roleKey === 'platform.admin' &&
          row.scope.type === 'public' &&
          row.scope.id === '*',
      );
      if (existing)
        await tx.roleAssignments.update(existing.id, {
          status: 'active',
          expiresAt: null,
          ownerUid: actor.uid,
        });
      else
        await tx.roleAssignments.create({
          subjectUid: target.uid,
          roleKey: 'platform.admin',
          scope: publicScope,
          status: 'active',
          expiresAt: null,
          ownerUid: actor.uid,
        });
      await tx.auditLogs.create({
        actorUid: actor.uid,
        action: 'admin.business_admin.initialize',
        resourceType: 'development_user',
        resourceId: target.uid,
        details: {
          subjectUid: target.uid,
          reason: parsed.data.reason ?? null,
          scope: publicScope,
          previousGlobalAdminCount: 0,
        },
        status: 'active',
        ownerUid: actor.uid,
        scope: publicScope,
      });
    });
    const data: DevelopmentBusinessAdminBootstrapResult = { initialized: true, uid: target.uid };
    response.status(201).json({ data, requestId: response.locals.requestId });
  });
  return router;
}
