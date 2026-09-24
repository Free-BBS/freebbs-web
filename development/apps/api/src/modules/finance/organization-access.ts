import { organizationForRole, type SocialOrganizationId } from '@freebbs-development/contracts';

import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { FinanceRecord } from '../../core/database/types.js';

function organizationScope(organizationId: SocialOrganizationId) {
  return { type: 'social_organization', id: organizationId } as const;
}

export function isFinanceSuperAdmin(actor: AuthorizationContext): boolean {
  return actor.roles.includes('platform.super_admin');
}

export function leadOrganizations(actor: AuthorizationContext): SocialOrganizationId[] {
  return [
    ...new Set(
      actor.roles.flatMap((role) => {
        const membership = organizationForRole(role);
        if (membership?.level !== 'lead') return [];
        const allowed = authorize(actor, {
          action: 'finance.record.read',
          resource: 'finance_record',
          scope: organizationScope(membership.organizationId),
        }).allowed;
        return allowed ? [membership.organizationId] : [];
      }),
    ),
  ];
}

export function hasFinanceAccess(actor: AuthorizationContext): boolean {
  return isFinanceSuperAdmin(actor) || leadOrganizations(actor).length > 0;
}

export function canReviewFinance(actor: AuthorizationContext): boolean {
  return isFinanceSuperAdmin(actor) || leadOrganizations(actor).includes('tuanwei');
}

export function canAccessFinanceOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId | null | undefined,
): boolean {
  if (canReviewFinance(actor)) return true;
  return organizationId != null && leadOrganizations(actor).includes(organizationId);
}

export function canAccessFinanceRecord(
  actor: AuthorizationContext,
  record: Pick<FinanceRecord, 'organizationId'>,
): boolean {
  return canAccessFinanceOrganization(actor, record.organizationId);
}
