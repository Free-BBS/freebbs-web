import {
  isGlobalOrganizationBusinessSupervisor,
  SOCIAL_ORGANIZATION_IDS,
  organizationMembershipsForRoles,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { FinanceRecord } from '../../core/database/types.js';

function organizationScope(organizationId: SocialOrganizationId) {
  return { type: 'social_organization', id: organizationId } as const;
}

export function isFinanceSuperAdmin(actor: AuthorizationContext): boolean {
  return isGlobalOrganizationBusinessSupervisor(actor);
}

export function leadOrganizations(actor: AuthorizationContext): SocialOrganizationId[] {
  return SOCIAL_ORGANIZATION_IDS.filter((id) => canAccessFinanceOrganization(actor, id, 'update'));
}

function eligibleOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId | null | undefined,
  action: 'read' | 'create' | 'update' | 'review',
): boolean {
  if (actor.previewing === true) return false;
  if (isGlobalOrganizationBusinessSupervisor(actor)) return true;
  // Scoped administrators keep their explicit grants; authorize still intersects
  // every operation with the current assignment's concrete organization scope.
  if (actor.roles.includes('platform.admin')) return true;
  if (organizationId == null) return false;
  if (organizationId === 'sast' && actor.roles.includes('counselor.innovation')) return true;
  const membership = organizationMembershipsForRoles(actor.roles).find(
    (item) => item.organizationId === organizationId,
  );
  if (membership === undefined) return false;
  if (action === 'read' || membership.level === 'lead') return true;
  return actor.roles.some(
    (role) =>
      (role === 'student_union.finance' &&
        ['arts_center', 'liaison_center', 'sports_center', 'rights_development_center'].includes(
          organizationId,
        )) ||
      (role === 'youth_league.finance' && organizationId === 'tuanwei') ||
      (role === 'media_center.finance' && organizationId === 'media_center'),
  );
}

export function hasFinanceAccess(actor: AuthorizationContext): boolean {
  return (
    canAccessFinanceOrganization(actor, null) ||
    SOCIAL_ORGANIZATION_IDS.some((id) => canAccessFinanceOrganization(actor, id))
  );
}

export function canReviewFinance(
  actor: AuthorizationContext,
  organizationId?: SocialOrganizationId | null,
): boolean {
  if (organizationId === undefined) {
    return [...SOCIAL_ORGANIZATION_IDS, null].some((id) => canReviewFinance(actor, id));
  }
  if (!eligibleOrganization(actor, organizationId, 'review')) return false;
  return authorize(actor, {
    action: 'finance.record.review',
    resource: 'finance_record',
    scope:
      organizationId === null ? { type: 'public', id: '*' } : organizationScope(organizationId),
  }).allowed;
}

export function canAccessFinanceOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId | null | undefined,
  action: 'read' | 'create' | 'update' = 'read',
): boolean {
  return (
    eligibleOrganization(actor, organizationId, action) &&
    authorize(actor, {
      action: `finance.record.${action}`,
      resource: 'finance_record',
      scope:
        organizationId == null ? { type: 'public', id: '*' } : organizationScope(organizationId),
    }).allowed
  );
}

export function canAccessFinanceRecord(
  actor: AuthorizationContext,
  record: Pick<FinanceRecord, 'organizationId'>,
): boolean {
  return canAccessFinanceOrganization(actor, record.organizationId);
}
