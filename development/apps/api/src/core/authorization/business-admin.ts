import type {
  DevelopmentAccessRecord,
  RoleAssignmentRecord,
  RoleRecord,
  SubjectRecord,
} from '../database/types.js';
import type { DirectoryUser, UserDirectory } from '../auth/user-directory.js';
import { DEVELOPMENT_ADMIN_ROLE_KEYS, platformRootAdminUids } from '@freebbs-development/contracts';

export const isDevelopmentAdministratorRole = (key: string) =>
  DEVELOPMENT_ADMIN_ROLE_KEYS.some((role) => role === key);
export const configuredRootAdminUids = () =>
  platformRootAdminUids(process.env.PLATFORM_ROOT_ADMIN_UIDS);

/** Call under the canonical platform.admin role-row lock before identity writes. */
export async function lockBusinessAdministratorAssignments(
  store: Pick<import('../database/types.js').DevelopmentStore, 'roleAssignments'>,
) {
  const assignments: RoleAssignmentRecord[] = [];
  for (const roleKey of DEVELOPMENT_ADMIN_ROLE_KEYS)
    assignments.push(...(await store.roleAssignments.listForUpdate({ roleKey })));
  return assignments;
}

export async function businessAdminIdentities(
  assignments: readonly RoleAssignmentRecord[],
  directory?: UserDirectory,
): Promise<DirectoryUser[] | undefined> {
  if (!directory) return undefined;
  const uids = [
    ...new Set([
      ...assignments
        .filter(
          (row) =>
            isDevelopmentAdministratorRole(row.roleKey) &&
            row.status === 'active' &&
            row.scope.type === 'public' &&
            row.scope.id === '*',
        )
        .map(({ subjectUid }) => subjectUid),
      ...configuredRootAdminUids(),
    ]),
  ];
  const users = await Promise.all(uids.map((uid) => directory.get(uid)));
  return users.filter((user): user is DirectoryUser => user !== null);
}

export function effectiveGlobalBusinessAdmins(
  assignments: readonly RoleAssignmentRecord[],
  roles: readonly RoleRecord[],
  subjects: readonly SubjectRecord[],
  access: readonly DevelopmentAccessRecord[],
  now = new Date(),
  // Undefined supports directory-free demo/internal callers; an empty snapshot is authoritative.
  identities?: readonly DirectoryUser[],
  allowedUids: readonly string[] = [],
): Set<string> {
  // Retain the legacy call contract; ordinary entry no longer depends on admission records.
  void access;
  void allowedUids;
  const activeRoles = new Set(
    roles.filter((role) => role.status === 'active').map((role) => role.key),
  );
  const admins = new Set(
    assignments
      .filter(
        (row) =>
          isDevelopmentAdministratorRole(row.roleKey) &&
          activeRoles.has(row.roleKey) &&
          row.status === 'active' &&
          row.scope.type === 'public' &&
          row.scope.id === '*' &&
          (identities === undefined || identities.some(({ uid }) => uid === row.subjectUid)) &&
          (row.expiresAt === null || Date.parse(row.expiresAt) > now.getTime()) &&
          subjects.some((subject) => subject.uid === row.subjectUid && subject.status === 'active'),
      )
      .map(({ subjectUid }) => subjectUid),
  );
  for (const uid of configuredRootAdminUids())
    if (
      subjects.some((subject) => subject.uid === uid && subject.status === 'active') &&
      (identities === undefined || identities.some((identity) => identity.uid === uid))
    )
      admins.add(uid);
  return admins;
}
