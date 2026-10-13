import type {
  DevelopmentAccessRecord,
  RoleAssignmentRecord,
  RoleRecord,
  SubjectRecord,
} from '../database/types.js';
import type { DirectoryUser, UserDirectory } from '../auth/user-directory.js';

export async function businessAdminIdentities(
  assignments: readonly RoleAssignmentRecord[],
  directory?: UserDirectory,
): Promise<DirectoryUser[] | undefined> {
  if (!directory) return undefined;
  const uids = [
    ...new Set(
      assignments
        .filter(
          (row) =>
            row.roleKey === 'platform.admin' &&
            row.status === 'active' &&
            row.scope.type === 'public' &&
            row.scope.id === '*',
        )
        .map(({ subjectUid }) => subjectUid),
    ),
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
  if (!roles.some((role) => role.key === 'platform.admin' && role.status === 'active'))
    return new Set();
  return new Set(
    assignments
      .filter(
        (row) =>
          row.roleKey === 'platform.admin' &&
          row.status === 'active' &&
          row.scope.type === 'public' &&
          row.scope.id === '*' &&
          (identities === undefined || identities.some(({ uid }) => uid === row.subjectUid)) &&
          (row.expiresAt === null || Date.parse(row.expiresAt) > now.getTime()) &&
          subjects.some(
            (subject) => subject.uid === row.subjectUid && subject.status === 'active',
          ) &&
          (allowedUids.includes(row.subjectUid) ||
            access.some((grant) => {
              if (grant.status !== 'active') return false;
              if (grant.subjectUid) return grant.subjectUid === row.subjectUid;
              const identity = identities?.find(({ uid }) => uid === row.subjectUid);
              if (!identity) return false;
              return grant.studentId
                ? grant.studentId === identity.studentId
                : Boolean(
                    grant.username &&
                    grant.username.toLocaleLowerCase() === identity.username.toLocaleLowerCase(),
                  );
            })),
      )
      .map(({ subjectUid }) => subjectUid),
  );
}
