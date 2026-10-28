import type { UserContext } from './auth.js';
import type { OrganizationGroupClass } from './organization-group.js';
import type { RoleKey } from './modules.js';
import type { ScopeRef } from './permissions.js';
import { DEVELOPMENT_ADMIN_ROLE_KEYS, isDevelopmentBusinessAdmin } from './system-settings.js';

export const CLASS_SECRETARY_TAG = 'class.youth_league_secretary';
const organizationRoles: readonly RoleKey[] = [
  'youth_league.organization.deputy_secretary',
  'youth_league.organization.leader',
  'youth_league.organization.member',
];

/** Tags must come from the server's active-definition authorization projection. */
export function secretaryClassIds(user: Pick<UserContext, 'tags'>, at = new Date()): string[] {
  return [
    ...new Set(
      user.tags
        .filter(
          (tag) =>
            tag.key === CLASS_SECRETARY_TAG &&
            tag.scope?.type === 'class' &&
            typeof tag.scope.id === 'string' &&
            /^[a-zA-Z0-9_-]{1,80}$/.test(tag.scope.id) &&
            tag.scope.id !== 'prototype' &&
            !Object.prototype.hasOwnProperty.call(Object.prototype, tag.scope.id) &&
            (tag.expiresAt == null || Date.parse(tag.expiresAt) > at.getTime()),
        )
        .map((tag) => tag.scope!.id),
    ),
  ];
}

type ScopedUser = Pick<
  UserContext,
  'uid' | 'roles' | 'businessAdmin' | 'rootAdmin' | 'previewing'
> & {
  roleScopes?: ReadonlyArray<{
    subjectUid: string;
    roleKey: RoleKey;
    scope: ScopeRef;
    expiresAt: string | null;
  }>;
};

/** This delegates only the class-secretary appointment, never other identity grants. */
export function canGrantClassSecretaries(user: ScopedUser): boolean {
  if (user.previewing) return false;
  if (user.rootAdmin) return true;
  if (
    isDevelopmentBusinessAdmin(user) &&
    (user.roleScopes === undefined ||
      user.roleScopes.some(
        (row) =>
          row.subjectUid === user.uid &&
          DEVELOPMENT_ADMIN_ROLE_KEYS.some((key) => key === row.roleKey) &&
          user.roles.includes(row.roleKey) &&
          row.scope.type === 'public' &&
          row.scope.id === '*' &&
          (row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()),
      ))
  )
    return true;
  if (user.roleScopes !== undefined)
    return user.roleScopes.some(
      (row) =>
        row.subjectUid === user.uid &&
        organizationRoles.includes(row.roleKey) &&
        user.roles.includes(row.roleKey) &&
        (row.expiresAt === null || Date.parse(row.expiresAt) > Date.now()) &&
        ((row.scope.type === 'public' && row.scope.id === '*') ||
          (row.scope.type === 'department' && row.scope.id === 'youth_league.organization') ||
          (row.scope.type === 'social_organization' && row.scope.id === 'tuanwei')),
    );
  return organizationRoles.some((role) => user.roles.includes(role));
}

export interface ClassSecretaryUser {
  uid: string;
  username: string;
  displayName: string;
  studentId: string | null;
  classIds: string[];
  revision: string;
}
export interface ClassSecretaryDirectory {
  items: ClassSecretaryUser[];
  total: number;
  page: number;
  pageSize: number;
  classes: OrganizationGroupClass[];
}
export interface ClassSecretaryUpdate {
  classIds: string[];
  revision: string;
}
