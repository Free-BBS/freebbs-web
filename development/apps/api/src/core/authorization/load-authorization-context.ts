import { validateTagScope } from '@freebbs-development/contracts';
import type { ScopeRef, UserContext } from '@freebbs-development/contracts';
import { ALL_PERMISSION_RULES, BASE_STUDENT_PERMISSIONS } from './permission-catalog.js';
import type { DevelopmentStore, PermissionRecord } from '../database/types.js';
import type { AuthorizationContext, AuthorizationPolicy, PermissionRule } from './policy.js';

const publicScope: ScopeRef = { type: 'public', id: '*' };

function identity(action: string, resource: string): string {
  return `${action}\u0000${resource}`;
}

function isCurrent(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return true;
  const value = Date.parse(expiresAt);
  return Number.isFinite(value) && value > now.getTime();
}

function isGlobal(scope: ScopeRef): boolean {
  return scope.type === publicScope.type && scope.id === publicScope.id;
}

function concreteScope(scope: ScopeRef): boolean {
  return scope.type.length > 0 && scope.id.length > 0 && scope.id !== '*';
}

function combineScopes(left: ScopeRef, right: ScopeRef): ScopeRef | undefined | null {
  if (isGlobal(left) && isGlobal(right)) return undefined;
  if (isGlobal(left)) return concreteScope(right) ? right : null;
  if (isGlobal(right)) return concreteScope(left) ? left : null;
  if (left.type !== right.type) return null;
  if (left.id === right.id) return concreteScope(left) ? left : null;
  if (left.id === '*') return concreteScope(right) ? right : null;
  if (right.id === '*') return concreteScope(left) ? left : null;
  return null;
}

function catalogDefinition(rule: PermissionRule): boolean {
  return ALL_PERMISSION_RULES.some(
    ({ action, resource }) => action === rule.action && resource === rule.resource,
  );
}

function actionModule(action: string): string | null {
  const separator = action.indexOf('.');
  return separator > 0 ? action.slice(0, separator) : null;
}

function permissionCandidates(
  binding: PermissionRule,
  permissions: readonly PermissionRecord[],
): PermissionRecord[] {
  if (binding.action === '*' && binding.resource === '*') {
    return permissions.filter(({ action, resource }) => action !== '*' || resource !== '*');
  }
  return permissions.filter(
    ({ action, resource }) => action === binding.action && resource === binding.resource,
  );
}

export async function loadAuthorizationContext(
  store: DevelopmentStore,
  identityContext: UserContext,
  now: Date,
): Promise<AuthorizationContext> {
  const [
    subjects,
    roles,
    permissions,
    roleBindings,
    roleAssignments,
    tagDefinitions,
    tagBindings,
    tagAssignments,
    modules,
  ] = await Promise.all([
    store.subjects.list({ query: identityContext.uid }),
    store.roles.list(),
    store.permissions.list(),
    store.rolePermissions.list(),
    store.roleAssignments.list({ query: identityContext.uid }),
    store.tagDefinitions.list(),
    store.tagPermissions.list(),
    store.tagAssignments.list({ query: identityContext.uid }),
    store.modules.list(),
  ]);

  const context: AuthorizationContext = {
    ...identityContext,
    roles: [],
    businessAdmin: false,
    tags: [],
    policies: [],
  };
  const subject = subjects.find(({ uid }) => uid === identityContext.uid);
  if (subject?.status !== 'active') return context;

  const enabledModules = new Set(
    modules
      .filter(({ enabled, status }) => enabled && status === 'enabled')
      .map(({ moduleId }) => moduleId),
  );
  const activePermissions = permissions.filter(
    (permission) =>
      permission.status === 'active' &&
      catalogDefinition(permission) &&
      enabledModules.has(actionModule(permission.action) as never),
  );
  const permissionKeys = new Set(
    activePermissions.map(({ action, resource }) => identity(action, resource)),
  );
  const policies: AuthorizationPolicy[] = [];

  for (const baseline of BASE_STUDENT_PERMISSIONS) {
    if (!permissionKeys.has(identity(baseline.action, baseline.resource))) continue;
    policies.push({
      id: `baseline:${baseline.action}:${baseline.resource}`,
      action: baseline.action,
      resource: baseline.resource,
      effect: 'allow',
      ...(baseline.scope === undefined ? {} : { scope: baseline.scope }),
    });
  }

  const activeRoles = new Set(
    roles.filter(({ status }) => status === 'active').map(({ key }) => key),
  );
  const currentRoleAssignments = roleAssignments.filter(
    (assignment) =>
      assignment.subjectUid === identityContext.uid &&
      assignment.status === 'active' &&
      activeRoles.has(assignment.roleKey) &&
      isCurrent(assignment.expiresAt, now),
  );
  context.roles = [...new Set(currentRoleAssignments.map(({ roleKey }) => roleKey))];
  const businessAdmin = currentRoleAssignments.some(
    (assignment) => assignment.roleKey === 'platform.admin' && isGlobal(assignment.scope),
  );
  const activeRoleBindings = roleBindings.filter(
    (binding) => binding.status === 'active' && catalogDefinition(binding),
  );
  for (const assignment of currentRoleAssignments) {
    // New counselor finance defaults work on existing stores. Any governed
    // finance row (including inactive rows) suppresses this runtime default.
    if (
      ['counselor.youth_league_secretary', 'counselor.youth_league'].includes(assignment.roleKey) &&
      !roleBindings.some(
        (binding) =>
          binding.roleKey === assignment.roleKey && binding.action.startsWith('finance.'),
      )
    ) {
      for (const permission of activePermissions.filter(
        (permission) => permission.action === 'finance.*' && permission.resource === '*',
      )) {
        policies.push({
          id: `counselor-finance:${assignment.id}:${permission.id}`,
          action: permission.action,
          resource: permission.resource,
          effect: 'allow',
          expiresAt: assignment.expiresAt,
          ...(isGlobal(assignment.scope) ? {} : { scope: assignment.scope }),
        });
      }
    }
    // Existing databases can retain legacy lead wildcard rows. The reserved lead
    // role never supplies business permissions, even before catalog reconciliation.
    if (assignment.roleKey === 'platform.admin') {
      for (const permission of activePermissions.filter(
        (permission) => !permission.action.startsWith('admin.'),
      )) {
        policies.push({
          id: `business-admin:${assignment.id}:${permission.id}`,
          action: permission.action,
          resource: permission.resource,
          effect: 'allow',
          expiresAt: assignment.expiresAt,
          ...(isGlobal(assignment.scope) ? {} : { scope: assignment.scope }),
        });
      }
    }
    for (const binding of activeRoleBindings) {
      if (binding.roleKey !== assignment.roleKey) continue;
      if (assignment.roleKey === 'platform.super_admin' && !binding.action.startsWith('admin.'))
        continue;
      const scope = combineScopes(assignment.scope, binding.scope);
      if (scope === null) continue;
      for (const permission of permissionCandidates(binding, activePermissions)) {
        if (assignment.roleKey === 'platform.admin' && permission.action.startsWith('admin.'))
          continue;
        policies.push({
          id: `role:${assignment.id}:${binding.id}:${permission.id}`,
          action: permission.action,
          resource: permission.resource,
          effect: binding.effect,
          ...(scope === undefined ? {} : { scope }),
          expiresAt: assignment.expiresAt,
        });
      }
    }
  }

  const activeTagDefinitions = new Map(
    tagDefinitions
      .filter(({ status }) => status === 'active')
      .map((definition) => [definition.key, definition]),
  );
  const activeTagBindings = tagBindings.filter(
    (binding) => binding.status === 'active' && catalogDefinition(binding),
  );
  for (const assignment of tagAssignments) {
    if (
      assignment.subjectUid !== identityContext.uid ||
      assignment.status !== 'active' ||
      !isCurrent(assignment.expiresAt, now)
    ) {
      continue;
    }
    const definition = activeTagDefinitions.get(assignment.tagKey);
    if (
      definition === undefined ||
      definition.requiredScopeType === null ||
      assignment.scope.type !== definition.requiredScopeType ||
      !validateTagScope(assignment.tagKey, assignment.scope)
    ) {
      continue;
    }
    context.tags.push({
      key: assignment.tagKey,
      scope: assignment.scope,
      expiresAt: assignment.expiresAt,
    });
    for (const binding of activeTagBindings) {
      if (binding.tagKey !== assignment.tagKey) continue;
      const scope = combineScopes(assignment.scope, binding.scope);
      if (scope === null) continue;
      for (const permission of permissionCandidates(binding, activePermissions)) {
        policies.push({
          id: `tag:${assignment.id}:${binding.id}:${permission.id}`,
          action: permission.action,
          resource: permission.resource,
          effect: binding.effect,
          ...(scope === undefined ? {} : { scope }),
          expiresAt: assignment.expiresAt,
        });
      }
    }
  }

  return { ...context, businessAdmin, policies };
}
