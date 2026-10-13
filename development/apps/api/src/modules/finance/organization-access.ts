import { isDevelopmentBusinessAdmin } from '@freebbs-development/contracts';
import {
  SOCIAL_ORGANIZATION_IDS,
  organizationForRole,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { FinanceRecord } from '../../core/database/types.js';

function organizationScope(organizationId: SocialOrganizationId) {
  return { type: 'social_organization', id: organizationId } as const;
}

export function isFinanceSuperAdmin(actor: AuthorizationContext): boolean {
  return isDevelopmentBusinessAdmin(actor);
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
  return (
    canAccessFinanceOrganization(actor, null) ||
    SOCIAL_ORGANIZATION_IDS.some((id) => canAccessFinanceOrganization(actor, id))
  );
}

export function canReviewFinance(
  actor: AuthorizationContext,
  organizationId?: SocialOrganizationId | null,
): boolean {
  return authorize(actor, {
    action: 'finance.record.review',
    resource: 'finance_record',
    ...(organizationId === undefined
      ? {}
      : {
          scope:
            organizationId === null
              ? { type: 'public', id: '*' }
              : organizationScope(organizationId),
        }),
  }).allowed;
}

export function canAccessFinanceOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId | null | undefined,
  action: 'read' | 'create' | 'update' = 'read',
): boolean {
  const eligible = actor.roles.some(
    (role) =>
      role === 'platform.admin' ||
      role === 'counselor.youth_league_secretary' ||
      role === 'counselor.youth_league' ||
      organizationForRole(role)?.level === 'lead',
  );
  return (
    eligible &&
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
