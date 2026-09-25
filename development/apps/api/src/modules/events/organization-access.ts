import { organizationForRole, type SocialOrganizationId } from '@freebbs-development/contracts';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { ActivityRecord } from '../../core/database/types.js';

export function organizationsForActor(actor: AuthorizationContext): SocialOrganizationId[] {
  return [
    ...new Set(
      actor.roles
        .map((role) => organizationForRole(role)?.organizationId)
        .filter((value): value is SocialOrganizationId => value !== undefined),
    ),
  ];
}

export function isSuperAdmin(actor: AuthorizationContext): boolean {
  return actor.roles.includes('platform.super_admin');
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
  for (const role of actor.roles) {
    const membership = organizationForRole(role);
    if (
      membership?.organizationId === record.organizationId &&
      (membership.level === 'director' || membership.level === 'lead')
    ) {
      return true;
    }
  }
  return false;
}
