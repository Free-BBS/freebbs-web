import {
  isDevelopmentBusinessAdmin,
  isGlobalOrganizationBusinessSupervisor,
  organizationMembershipsForRoles,
  type ScopeRef,
} from '@freebbs-development/contracts';
import { authorize } from '../../core/authorization/authorize.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore, SportsTeamRecord } from '../../core/database/types.js';

export function canonicalSportsTeam(
  record: SportsTeamRecord | null,
  id: string,
): record is SportsTeamRecord {
  return (
    record !== null &&
    id !== '*' &&
    record.id === id &&
    record.scope.type === 'sports_team' &&
    record.scope.id === id
  );
}
function covers(scope: ScopeRef, teamId?: string) {
  return (
    (scope.type === 'public' && scope.id === '*') ||
    (scope.type === 'department' && scope.id === 'student_union.sports_center') ||
    (scope.type === 'social_organization' && scope.id === 'sports_center') ||
    (teamId !== undefined && scope.type === 'sports_team' && scope.id === teamId)
  );
}
function matches(pattern: string, value: string) {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}
function combinedScope(left: ScopeRef, right: ScopeRef): ScopeRef | null {
  if (left.type === 'public' && left.id === '*')
    return right.id === '*' && right.type !== 'public' ? null : right;
  if (right.type === 'public' && right.id === '*')
    return left.id === '*' && left.type !== 'public' ? null : left;
  if (left.type !== right.type) return null;
  if (left.id === right.id) return left.id === '*' ? null : left;
  if (right.id === '*') return left.id === '*' ? null : left;
  return null;
}
function bindingCovers(left: ScopeRef, right: ScopeRef, teamId?: string): boolean {
  const scope = combinedScope(left, right);
  return scope !== null && covers(scope, teamId);
}
// Load once for a directory response; mutations reload the current assignments.
export async function loadSportsCardAuthorizer(
  store: DevelopmentStore,
  actor: AuthorizationContext,
) {
  const [
    subjects,
    assignments,
    roles,
    definitions,
    tags,
    modules,
    bindings,
    assignmentsWithTags,
    tagBindings,
    currentActor,
  ] = await Promise.all([
    store.subjects.list({ query: actor.uid }),
    store.roleAssignments.list({ query: actor.uid }),
    store.roles.list(),
    store.permissions.list(),
    store.tagDefinitions.list(),
    store.modules.list(),
    store.rolePermissions.list(),
    store.tagAssignments.list({ query: actor.uid }),
    store.tagPermissions.list(),
    loadAuthorizationContext(store, actor, new Date()),
  ]);
  // Current binding denies override every card grant, including cached identities
  // and business admins. The policy loader validates definitions, scopes and expiry.
  const denyContext = {
    ...actor,
    policies: [
      ...(actor.policies ?? []),
      ...(currentActor.policies ?? []).filter(({ effect }) => effect === 'deny'),
    ],
  };
  const enabled =
    subjects.some(({ uid, status }) => uid === actor.uid && status === 'active') &&
    modules.some(
      ({ moduleId, enabled, status }) => moduleId === 'sports' && enabled && status === 'enabled',
    );
  const now = Date.now();
  const currentAssignments = assignments.filter(
    (assignment) =>
      assignment.subjectUid === actor.uid &&
      assignment.status === 'active' &&
      actor.roles.includes(assignment.roleKey) &&
      roles.some(({ key, status }) => key === assignment.roleKey && status === 'active') &&
      (assignment.expiresAt === null || Date.parse(assignment.expiresAt) > now),
  );
  return (teamId?: string, operation?: 'sports.showcase.update'): boolean => {
    if (!enabled || actor.previewing) return false;
    const action =
      operation ?? (teamId === undefined ? 'sports.team.create' : 'sports.team.update');
    const resource = operation === 'sports.showcase.update' ? 'sports_showcase' : 'sports_team';
    const scope = teamId === undefined ? undefined : { type: 'sports_team', id: teamId };
    const decision = authorize(denyContext, { action, resource, scope });
    if (decision.reason === 'explicit-deny' || decision.reason === 'invalid-scope') return false;
    if (
      [
        { type: 'department', id: 'student_union.sports_center' },
        { type: 'social_organization', id: 'sports_center' },
        { type: 'public', id: '*' },
      ].some(
        (scope) => authorize(denyContext, { action, resource, scope }).reason === 'explicit-deny',
      )
    )
      return false;
    const permissions = definitions.filter(
      (row) => row.action === action && row.resource === resource,
    );
    if (permissions.length > 0 && !permissions.some(({ status }) => status === 'active'))
      return false;
    if (
      isDevelopmentBusinessAdmin(actor) &&
      currentAssignments.some(
        (assignment) =>
          assignment.roleKey === 'platform.admin' &&
          assignment.scope.type === 'public' &&
          assignment.scope.id === '*',
      )
    )
      return true;
    const supervisorRoles = currentAssignments
      .filter(
        ({ roleKey, scope }) =>
          scope.type === 'public' && scope.id === '*' && currentActor.roles.includes(roleKey),
      )
      .map(({ roleKey }) => roleKey);
    const supervisesSports =
      isGlobalOrganizationBusinessSupervisor({ roles: supervisorRoles, businessAdmin: false }) ||
      organizationMembershipsForRoles(supervisorRoles).some(
        ({ organizationId, level }) =>
          organizationId === 'sports_center' && (level === 'lead' || level === 'director'),
      );
    if (
      supervisesSports &&
      [
        scope,
        { type: 'public', id: '*' },
        { type: 'social_organization', id: 'sports_center' },
        { type: 'department', id: 'student_union.sports_center' },
      ].some((candidate) => authorize(currentActor, { action, resource, scope: candidate }).allowed)
    )
      return true;
    if (
      currentAssignments.some((assignment) => {
        if (
          ![
            'department.sports_member',
            'department.sports_director',
            'domain.sports_lead',
          ].includes(assignment.roleKey) ||
          !covers(assignment.scope, teamId)
        )
          return false;
        const governed = bindings.filter(
          (binding) =>
            binding.roleKey === assignment.roleKey &&
            matches(binding.action, action) &&
            matches(binding.resource, resource),
        );
        return (
          governed.length === 0 ||
          governed.some(
            (binding) =>
              binding.status === 'active' &&
              binding.effect === 'allow' &&
              definitions.some(
                (definition) =>
                  definition.status === 'active' &&
                  definition.action === binding.action &&
                  definition.resource === binding.resource,
              ) &&
              bindingCovers(assignment.scope, binding.scope, teamId),
          )
        );
      })
    )
      return true;
    if (
      teamId === undefined ||
      !tags.some(
        ({ key, status, requiredScopeType }) =>
          key === 'sports.team_captain' &&
          status === 'active' &&
          requiredScopeType === 'sports_team',
      )
    )
      return false;
    return assignmentsWithTags.some((tag) => {
      if (
        tag.subjectUid !== actor.uid ||
        tag.tagKey !== 'sports.team_captain' ||
        tag.status !== 'active' ||
        (tag.expiresAt !== null && !(Date.parse(tag.expiresAt) > now)) ||
        tag.scope.type !== 'sports_team' ||
        tag.scope.id !== teamId ||
        !actor.tags.some(
          ({ key, scope }) =>
            key === tag.tagKey && scope?.type === 'sports_team' && scope.id === teamId,
        )
      )
        return false;
      const governed = tagBindings.filter(
        (binding) =>
          binding.tagKey === tag.tagKey &&
          matches(binding.action, action) &&
          matches(binding.resource, resource),
      );
      return (
        governed.length === 0 ||
        governed.some(
          (binding) =>
            binding.status === 'active' &&
            binding.effect === 'allow' &&
            definitions.some(
              (definition) =>
                definition.status === 'active' &&
                definition.action === binding.action &&
                definition.resource === binding.resource,
            ) &&
            bindingCovers(tag.scope, binding.scope, teamId),
        )
      );
    });
  };
}
// This collaboration grant never supplies roster/captain/check-in authority.
export async function canMaintainSportsCard(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  teamId?: string,
  operation?: 'sports.showcase.update',
): Promise<boolean> {
  return (await loadSportsCardAuthorizer(store, actor))(teamId, operation);
}
