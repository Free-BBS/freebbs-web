import {
  departmentById,
  departmentsForRoles,
  organizationForRole,
  type ScopeRef,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../database/types.js';
import { authorize } from './authorize.js';
import { ROLE_PERMISSION_CATALOG } from './permission-catalog.js';
import type { AuthorizationContext, AuthorizationPolicy, PermissionRule } from './policy.js';

interface EditTarget {
  departmentId?: string | null;
  organizationId?: SocialOrganizationId | null;
  ownerUid?: string;
  scopes: ScopeRef[];
}
const publicScope: ScopeRef = { type: 'public', id: '*' };
function global(scope: ScopeRef) {
  return scope.type === 'public' && scope.id === '*';
}
function combineScopes(left: ScopeRef, right: ScopeRef): ScopeRef | undefined | null {
  if (global(left) && global(right)) return undefined;
  if (global(left)) return right;
  if (global(right)) return left;
  if (left.type !== right.type) return null;
  if (left.id === right.id) return left;
  if (left.id === '*') return right;
  if (right.id === '*') return left;
  return null;
}
function patternMatches(pattern: string, value: string) {
  return (
    pattern === '*' ||
    pattern === value ||
    (pattern.endsWith('.*') && value.startsWith(pattern.slice(0, -1)))
  );
}
function matches(rule: PermissionRule, action: string, resource: string) {
  return patternMatches(rule.action, action) && patternMatches(rule.resource, resource);
}
function targetScopes(target: EditTarget) {
  return [
    ...target.scopes,
    ...(target.departmentId ? [{ type: 'department', id: target.departmentId }] : []),
    ...(target.organizationId ? [{ type: 'social_organization', id: target.organizationId }] : []),
  ];
}

// Only the two collaboration actions have runtime defaults. Existing production
// stores can use them immediately; governed inactive rows suppress the defaults.
async function canEdit(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  action: 'events.department_home.update' | 'events.workspace.update',
  resource: 'department_home' | 'activity',
  target: EditTarget,
): Promise<boolean> {
  const [assignments, roles, permissions, bindings, modules] = await Promise.all([
    store.roleAssignments.list({ query: actor.uid }),
    store.roles.list(),
    store.permissions.list(),
    store.rolePermissions.list(),
    store.modules.list(),
  ]);
  if (
    !modules.some(
      ({ moduleId, enabled, status }) => moduleId === 'events' && enabled && status === 'enabled',
    )
  )
    return false;
  const definitions = permissions.filter(
    (permission) => permission.action === action && permission.resource === resource,
  );
  if (definitions.length > 0 && !definitions.some(({ status }) => status === 'active'))
    return false;
  const now = Date.now();
  const scopes = targetScopes(target);
  const policies: AuthorizationPolicy[] = (actor.policies ?? []).filter(
    ({ effect }) => effect === 'deny',
  );
  // The main-site bootstrap administrator has an explicit trusted wildcard
  // policy before a persistent development-lead assignment exists.
  policies.push(
    ...(actor.policies ?? []).filter(
      (policy) =>
        policy.effect === 'allow' &&
        policy.id.startsWith('main-site-admin-bootstrap:') &&
        matches(policy, action, resource),
    ),
  );
  for (const assignment of assignments) {
    if (
      assignment.subjectUid !== actor.uid ||
      assignment.status !== 'active' ||
      !actor.roles.includes(assignment.roleKey) ||
      !roles.some(({ key, status }) => key === assignment.roleKey && status === 'active') ||
      authorize(actor, { action, resource, scope: assignment.scope }).reason === 'invalid-scope' ||
      (assignment.expiresAt !== null && !(Date.parse(assignment.expiresAt) > now))
    )
      continue;
    const catalog = ROLE_PERMISSION_CATALOG[assignment.roleKey] ?? [];
    const defaults = catalog.filter((rule) => matches(rule, action, resource));
    const governed = bindings.filter(
      (binding) => binding.roleKey === assignment.roleKey && matches(binding, action, resource),
    );
    const effective =
      governed.length > 0
        ? governed.filter((binding) => {
            if (binding.status !== 'active') return false;
            const sourceDefinitions = permissions.filter(
              ({ action, resource }) => action === binding.action && resource === binding.resource,
            );
            // Only the new exact action may be absent on an unmigrated store.
            return (
              sourceDefinitions.some(({ status }) => status === 'active') ||
              (binding.action === action &&
                binding.resource === resource &&
                sourceDefinitions.length === 0)
            );
          })
        : defaults.map((rule, index) => ({
            ...rule,
            id: `runtime:${index}`,
            scope: rule.scope ?? publicScope,
            effect: 'allow' as const,
          }));
    const departments = departmentsForRoles([assignment.roleKey]);
    const eligible =
      assignment.roleKey === 'platform.super_admin' ||
      (target.departmentId
        ? departments.some(({ id }) => id === target.departmentId)
        : target.organizationId != null &&
          (departments.some(({ organizationId }) => organizationId === target.organizationId) ||
            organizationForRole(assignment.roleKey)?.organizationId === target.organizationId)) ||
      (action === 'events.workspace.update' &&
        target.ownerUid === actor.uid &&
        defaults.length > 0);
    for (const binding of effective) {
      if (binding.effect === 'allow' && !eligible) continue;
      const scope = combineScopes(assignment.scope, binding.scope);
      if (scope === null) continue;
      policies.push({
        id: `scoped-edit:${assignment.id}:${binding.id}`,
        action,
        resource,
        effect: binding.effect,
        ...(scope === undefined ? {} : { scope }),
        expiresAt: assignment.expiresAt,
      });
    }
  }
  const context = { ...actor, policies };
  // Denies at any relevant concrete resource or publishing scope override every
  // alternative grant, including a different role and the owner path.
  if (
    scopes.some(
      (scope) => authorize(context, { action, resource, scope }).reason === 'explicit-deny',
    )
  )
    return false;
  if (
    action === 'events.workspace.update' &&
    scopes.some(
      (scope) =>
        authorize(actor, { action: 'events.update', resource: 'activity', scope }).reason ===
        'explicit-deny',
    )
  )
    return false;
  return scopes.some((scope) => authorize(context, { action, resource, scope }).allowed);
}

export async function canEditDepartmentHome(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  departmentId: string,
) {
  const department = departmentById(departmentId);
  if (!department) return false;
  return canEdit(store, actor, 'events.department_home.update', 'department_home', {
    departmentId,
    organizationId: department.organizationId,
    scopes: [],
  });
}

export async function canEditActivityWorkspace(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  target: Omit<EditTarget, 'scopes'> & {
    source: 'development_activity' | 'native_collection';
    id: string;
    scope: ScopeRef;
  },
) {
  return canEdit(store, actor, 'events.workspace.update', 'activity', {
    ...target,
    scopes: [
      target.scope,
      {
        type: target.source === 'native_collection' ? 'collection_form' : 'activity',
        id: target.id,
      },
    ],
  });
}
