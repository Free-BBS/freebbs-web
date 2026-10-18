import {
  departmentById,
  isGlobalOrganizationBusinessSupervisor,
  organizationMembershipsForRoles,
  SOCIAL_ORGANIZATION_IDS,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { ScopeRef } from '@freebbs-development/contracts';
import type { ActivityRecord } from '../../core/database/types.js';

export function canActOnOrganizationActivity(
  actor: AuthorizationContext,
  action: string,
  scope: ScopeRef,
  organizationId?: SocialOrganizationId | null,
): boolean {
  if (scope.type === 'social_organization' && scope.id !== organizationId) return false;
  if (scope.type === 'department' && departmentById(scope.id)?.organizationId !== organizationId)
    return false;
  const scopes: ScopeRef[] = [scope];
  if (organizationId) scopes.push({ type: 'social_organization', id: organizationId });
  const decisions = scopes.map((target) =>
    authorize(actor, { action, resource: 'activity', scope: target }),
  );
  return (
    !decisions.some(({ reason }) => reason === 'explicit-deny' || reason === 'invalid-scope') &&
    decisions.some(({ allowed }) => allowed)
  );
}

export function canProvideActivityTechnicalSupport(
  actor: AuthorizationContext,
  record: Pick<ActivityRecord, 'scope' | 'organizationId'>,
): boolean {
  const sastSupport = organizationMembershipsForRoles(actor.roles).some(
    ({ organizationId }) => organizationId === 'sast',
  );
  if (!sastSupport && !canUpdateOrganization(actor, record)) return false;
  if (record.scope.type === 'social_organization' && record.scope.id !== record.organizationId)
    return false;
  const scopes: ScopeRef[] = [record.scope];
  if (record.organizationId)
    scopes.push({ type: 'social_organization', id: record.organizationId });
  if (sastSupport) scopes.push({ type: 'social_organization', id: 'sast' });
  const decisions = scopes.map((scope) =>
    authorize(actor, { action: 'events.technical_support', resource: 'activity', scope }),
  );
  return (
    !decisions.some(({ reason }) => reason === 'explicit-deny' || reason === 'invalid-scope') &&
    decisions.some(({ allowed }) => allowed)
  );
}

export function organizationsForActor(actor: AuthorizationContext): SocialOrganizationId[] {
  return isGlobalOrganizationBusinessSupervisor(actor)
    ? [...SOCIAL_ORGANIZATION_IDS]
    : [
        ...new Set([
          ...organizationMembershipsForRoles(actor.roles).map(
            ({ organizationId }) => organizationId,
          ),
          ...(actor.roles.includes('counselor.innovation') ? ['sast' as const] : []),
        ]),
      ];
}

export function isSuperAdmin(actor: AuthorizationContext): boolean {
  return isGlobalOrganizationBusinessSupervisor(actor);
}

export function canCreateForOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId | null | undefined,
): boolean {
  return (
    organizationId === null ||
    organizationId === undefined ||
    isSuperAdmin(actor) ||
    organizationsForActor(actor).includes(organizationId)
  );
}

export function canUpdateOrganization(
  actor: AuthorizationContext,
  record: Pick<ActivityRecord, 'organizationId'>,
): boolean {
  if (record.organizationId === null || record.organizationId === undefined) return true;
  if (isSuperAdmin(actor)) return true;
  if (actor.roles.includes('counselor.innovation') && record.organizationId === 'sast') return true;
  for (const membership of organizationMembershipsForRoles(actor.roles)) {
    if (
      membership.organizationId === record.organizationId &&
      (membership.level === 'director' || membership.level === 'lead')
    ) {
      return true;
    }
  }
  return false;
}
