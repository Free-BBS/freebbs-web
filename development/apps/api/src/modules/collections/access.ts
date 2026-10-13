import { isDevelopmentBusinessAdmin } from '@freebbs-development/contracts';
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
  if (isDevelopmentBusinessAdmin(actor)) return true;
  return actor.roles.some(
    (role) =>
      organizationForRole(role) !== null ||
      SOCIAL_ROLE_PREFIXES.some((prefix) => role.startsWith(prefix)),
  );
}

export function canManageCollection(actor: AuthorizationContext, ownerUid: string): boolean {
  return isDevelopmentBusinessAdmin(actor) || actor.uid === ownerUid;
}

export function canManageCollectionModuleLibrary(actor: AuthorizationContext): boolean {
  return (
    isDevelopmentBusinessAdmin(actor) ||
    actor.roles.some(
      (role) =>
        role.startsWith('counselor.') ||
        role === 'student_union.executive_president' ||
        role === 'student_union.presidium' ||
        /(?:lead|director|leader|deputy_secretary|chair|vice_chair|minister|consultant)$/.test(
          role,
        ),
    )
  );
}
