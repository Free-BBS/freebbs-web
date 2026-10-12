import { createHash } from 'node:crypto';
import {
  validateIdentitySelection,
  type SystemSettingsUser,
  type SystemSettingsUserInput,
} from '@freebbs-development/contracts';
import { synchronizeSubject } from '../../core/auth/auth-middleware.js';
import {
  directoryUserContext,
  type DirectoryUser,
  type UserDirectory,
} from '../../core/auth/user-directory.js';
import type {
  DevelopmentStore,
  DevelopmentAccessRecord,
  RoleAssignmentRecord,
  TagAssignmentRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

const scope = { type: 'public', id: '*' } as const;
const current = (row: { status: string; expiresAt: string | null }, now = Date.now()) =>
  row.status === 'active' && (row.expiresAt === null || Date.parse(row.expiresAt) > now);
export function hasRecipientAccess(user: DirectoryUser, access: DevelopmentAccessRecord[]) {
  return access.some(
    (grant) =>
      grant.status === 'active' &&
      (grant.subjectUid
        ? grant.subjectUid === user.uid
        : grant.studentId
          ? grant.studentId === user.studentId
          : Boolean(
              grant.username &&
              grant.username.toLocaleLowerCase() === user.username.toLocaleLowerCase(),
            )),
  );
}
export function identitySnapshot(
  user: DirectoryUser,
  roles: RoleAssignmentRecord[],
  tags: TagAssignmentRecord[],
  access: DevelopmentAccessRecord[] = [],
  demo = false,
): SystemSettingsUser {
  const now = Date.now();
  const currentlyActive = (row: { status: string; expiresAt: string | null }) => current(row, now);
  const ownedRoles = roles.filter(
    (row) => row.subjectUid === user.uid && row.roleKey !== 'platform.super_admin',
  );
  const ownedTags = tags.filter(
    (row) => row.subjectUid === user.uid && row.tagKey === 'sports.team_captain',
  );
  // Include effective expiry state too: an old checked grant expiring while the
  // editor is open must cause a stale revision, not become a new permanent grant.
  const revision = createHash('sha256')
    .update(
      JSON.stringify([
        ownedRoles
          .map((row) => [
            row.id,
            row.roleKey,
            row.status,
            row.scope,
            row.expiresAt,
            row.updatedAt,
            currentlyActive(row),
          ])
          .sort(),
        ownedTags
          .map((row) => [
            row.id,
            row.scope,
            row.status,
            row.expiresAt,
            row.updatedAt,
            currentlyActive(row),
          ])
          .sort(),
      ]),
    )
    .digest('hex');
  return {
    ...user,
    roles: [
      ...new Set(ownedRoles.filter(currentlyActive).map((row) => row.roleKey)),
    ].sort() as SystemSettingsUser['roles'],
    captainTeamIds: [
      ...new Set(
        ownedTags
          .filter((row) => currentlyActive(row) && row.scope.type === 'sports_team')
          .map((row) => row.scope.id),
      ),
    ].sort(),
    revision,
    canReceiveNotifications: demo || hasRecipientAccess(user, access),
  };
}
export async function listSettingsUsers(
  store: DevelopmentStore,
  directory: UserDirectory,
  query = '',
  demo = false,
) {
  const [users, roles, tags, access] = await Promise.all([
    directory.list(query),
    store.roleAssignments.list(),
    store.tagAssignments.list(),
    store.developmentAccess.list(),
  ]);
  return users.map((user) => identitySnapshot(user, roles, tags, access, demo));
}
export async function updateSettingsUser(
  store: DevelopmentStore,
  directory: UserDirectory,
  uid: string,
  input: SystemSettingsUserInput,
  actorUid: string,
) {
  const target = await directory.get(uid);
  if (!target) throw new HttpError(404, 'user_not_found', 'Main-site user was not found');
  const validation = validateIdentitySelection(input.roles);
  if (!validation.ok) throw new HttpError(400, 'identity_group_conflict', validation.message);
  return store.transaction(async (tx) => {
    const [roles, tags, teams, access, subjects] = await Promise.all([
      tx.roleAssignments.listForUpdate(),
      tx.tagAssignments.listForUpdate(),
      tx.sportsTeams.listForUpdate(),
      tx.developmentAccess.listForUpdate(),
      tx.subjects.listForUpdate(),
    ]);
    const previous = identitySnapshot(target, roles, tags, access);
    if (previous.revision !== input.revision)
      throw new HttpError(409, 'stale_revision', '用户身份已被修改，请重新加载');
    if (
      input.captainTeamIds.some(
        (id) => !teams.some((team) => team.id === id && team.status === 'active'),
      )
    )
      throw new HttpError(400, 'invalid_sports_team', '代表队不存在或不可用');
    const losingAdmin =
      previous.roles.includes('platform.admin') && !input.roles.includes('platform.admin');
    if (
      losingAdmin &&
      !roles.some(
        (row) =>
          row.subjectUid !== uid &&
          row.roleKey === 'platform.admin' &&
          current(row) &&
          subjects.some(
            (subject) => subject.uid === row.subjectUid && subject.status === 'active',
          ) &&
          access.some((grant) => grant.subjectUid === row.subjectUid && grant.status === 'active'),
      )
    ) {
      throw new HttpError(409, 'last_platform_admin', '至少保留一位可访问发展端的平台管理员');
    }
    await synchronizeSubject(tx, directoryUserContext(target), new Date());
    const existing = roles.filter(
      (row) => row.subjectUid === uid && row.roleKey !== 'platform.super_admin',
    );
    const desired = new Set(input.roles);
    for (const row of existing) {
      const wanted = desired.has(row.roleKey as SystemSettingsUser['roles'][number]);
      if (!wanted && current(row)) await tx.roleAssignments.update(row.id, { status: 'archived' });
    }
    for (const roleKey of desired) {
      // A checked role represents existing current grants, not authority to
      // restore every historical scope or replace a future expiry with null.
      if (previous.roles.includes(roleKey)) continue;
      const canonical = existing.find(
        (row) =>
          row.roleKey === roleKey && row.scope.type === scope.type && row.scope.id === scope.id,
      );
      if (canonical) {
        await tx.roleAssignments.update(canonical.id, {
          status: 'active',
          expiresAt: null,
          ownerUid: actorUid,
        });
      } else {
        await tx.roleAssignments.create({
          subjectUid: uid,
          roleKey,
          expiresAt: null,
          status: 'active',
          ownerUid: actorUid,
          scope,
        });
      }
    }
    const captainTags = tags.filter(
      (row) => row.subjectUid === uid && row.tagKey === 'sports.team_captain',
    );
    for (const row of captainTags) {
      const wanted =
        row.scope.type === 'sports_team' && input.captainTeamIds.includes(row.scope.id);
      if (!wanted && current(row)) await tx.tagAssignments.update(row.id, { status: 'archived' });
    }
    for (const id of input.captainTeamIds) {
      if (previous.captainTeamIds.includes(id)) continue;
      const canonical = captainTags.find(
        (row) => row.scope.type === 'sports_team' && row.scope.id === id,
      );
      if (canonical) {
        await tx.tagAssignments.update(canonical.id, {
          status: 'active',
          expiresAt: null,
          ownerUid: actorUid,
        });
      } else {
        await tx.tagAssignments.create({
          subjectUid: uid,
          tagKey: 'sports.team_captain',
          expiresAt: null,
          status: 'active',
          ownerUid: actorUid,
          scope: { type: 'sports_team', id },
        });
      }
    }
    const next = identitySnapshot(
      target,
      await tx.roleAssignments.list(),
      await tx.tagAssignments.list(),
      access,
    );
    await tx.auditLogs.create({
      actorUid,
      action: 'system_settings.user.update',
      resourceType: 'development_user',
      resourceId: uid,
      details: { previous, next },
      status: 'active',
      ownerUid: actorUid,
      scope,
    });
    return next;
  });
}
