import {
  DEPARTMENT_DIRECTORY,
  SOCIAL_ORGANIZATION_IDS,
  canEditDepartment,
  organizationMembershipsForRoles,
  type ScopeRef,
} from '@freebbs-development/contracts';
import type { AuthorizationContext } from './policy.js';

function currentRoles(actor: AuthorizationContext, accepts: (scope: ScopeRef) => boolean) {
  // Legacy in-process callers can still supply an explicitly constructed context.
  // Every authenticated store-backed context supplies roleScopes, including [].
  if (actor.roleScopes === undefined) return actor;
  const roles = [
    ...new Set(
      actor.roleScopes
        .filter(
          ({ subjectUid, scope, expiresAt }) =>
            subjectUid === actor.uid &&
            (expiresAt === null || Date.parse(expiresAt) > Date.now()) &&
            accepts(scope),
        )
        .map(({ roleKey }) => roleKey),
    ),
  ];
  return { ...actor, roles };
}
export function roleContextForScopes(
  actor: AuthorizationContext,
  scopes: readonly ScopeRef[],
): AuthorizationContext {
  return currentRoles(
    actor,
    (scope) =>
      (scope.type === 'public' && scope.id === '*') ||
      (scope.id !== '*' &&
        scopes.some((target) => target.type === scope.type && target.id === scope.id)),
  );
}
export function generalRoleContext(actor: AuthorizationContext): AuthorizationContext {
  const context = currentRoles(
    actor,
    (scope) =>
      (scope.type === 'public' && scope.id === '*') ||
      (scope.id !== '*' && ['department', 'social_organization'].includes(scope.type)),
  );
  return { ...context, roles: context.roles.filter((role) => actor.roles.includes(role)) };
}
export function departmentsForActor(
  actor: AuthorizationContext,
  resourceScopes: readonly ScopeRef[] = [],
) {
  return DEPARTMENT_DIRECTORY.filter((department) =>
    canEditDepartment(
      roleContextForScopes(actor, [
        { type: 'department', id: department.id },
        ...(department.organizationId
          ? [{ type: 'social_organization', id: department.organizationId }]
          : []),
        ...resourceScopes,
      ]),
      department.id,
    ),
  );
}
export function canEditActorDepartment(actor: AuthorizationContext, id: string): boolean {
  return departmentsForActor(actor).some((department) => department.id === id);
}
export function organizationMembershipsForActor(actor: AuthorizationContext) {
  const departments = departmentsForActor(actor);
  return SOCIAL_ORGANIZATION_IDS.flatMap((id) =>
    organizationMembershipsForRoles(
      roleContextForScopes(actor, [
        { type: 'social_organization', id },
        ...departments
          .filter((department) => department.organizationId === id)
          .map((department) => ({ type: 'department', id: department.id })),
      ]).roles,
    ).filter((item) => item.organizationId === id),
  );
}
