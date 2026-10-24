import {
  DEVELOPMENT_ADMIN_ROLE_KEYS,
  LEARNING_ADMIN_ROLE_KEYS,
  platformRootAdminUids,
} from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../database/types.js';

export interface PlatformAuthority {
  rootAdmin: boolean;
  learningAdmin: boolean;
  developmentAdmin: boolean;
  developmentLead: boolean;
}

/** Shared, read-only authority from the existing identity store, never provider flags. */
export async function resolvePlatformAuthority(
  store: DevelopmentStore,
  uid: string,
  now = new Date(),
  additionalRootUids?: string,
): Promise<PlatformAuthority> {
  const rootAdmin = platformRootAdminUids(additionalRootUids).includes(uid);
  if (rootAdmin)
    return { rootAdmin: true, learningAdmin: true, developmentAdmin: true, developmentLead: true };
  const none = {
    rootAdmin: false,
    learningAdmin: false,
    developmentAdmin: false,
    developmentLead: false,
  };
  const [subjects, roles, assignments] = await Promise.all([
    store.subjects.list({ query: uid }),
    store.roles.list(),
    store.roleAssignments.list({ query: uid }),
  ]);
  if (!subjects.some((subject) => subject.uid === uid && subject.status === 'active')) return none;
  const enabled = new Set(roles.filter((role) => role.status === 'active').map((role) => role.key));
  const currentRoles = new Set(
    assignments
      .filter(
        (assignment) =>
          assignment.subjectUid === uid &&
          assignment.status === 'active' &&
          enabled.has(assignment.roleKey) &&
          assignment.scope.type === 'public' &&
          assignment.scope.id === '*' &&
          (assignment.expiresAt === null || Date.parse(assignment.expiresAt) > now.getTime()),
      )
      .map((assignment) => assignment.roleKey),
  );
  return {
    rootAdmin: false,
    learningAdmin: LEARNING_ADMIN_ROLE_KEYS.some((role) => currentRoles.has(role)),
    developmentAdmin: DEVELOPMENT_ADMIN_ROLE_KEYS.some((role) => currentRoles.has(role)),
    developmentLead:
      currentRoles.has('counselor.youth_league_secretary') ||
      currentRoles.has('counselor.youth_league'),
  };
}
