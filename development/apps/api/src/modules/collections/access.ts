import { organizationForRole } from '@freebbs-development/contracts';

import type { AuthorizationContext } from '../../core/authorization/policy.js';

const SOCIAL_ROLE_PREFIXES = [
  'counselor.',
  'student_union.',
  'youth_league.',
  'science_association.',
  'media_center.',
] as const;

export function canCreateCollection(actor: AuthorizationContext): boolean {
  if (actor.roles.includes('platform.super_admin')) return true;
  return actor.roles.some(
    (role) =>
      organizationForRole(role) !== null ||
      SOCIAL_ROLE_PREFIXES.some((prefix) => role.startsWith(prefix)),
  );
}

export function canManageCollection(actor: AuthorizationContext, ownerUid: string): boolean {
  return actor.roles.includes('platform.super_admin') || actor.uid === ownerUid;
}
