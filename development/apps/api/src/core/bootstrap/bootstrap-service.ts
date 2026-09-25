import { ROLE_KEYS } from '@freebbs-development/contracts';
import { recordAuditEvent } from '../audit/audit-service.js';
import type { DevelopmentStore } from '../database/types.js';
import {
  BUILT_IN_MODULES,
  BUILT_IN_PERMISSIONS,
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_TAG_DEFINITIONS,
  BUILT_IN_TAG_PERMISSIONS,
} from './built-in-definitions.js';

const publicScope = { type: 'public', id: '*' } as const;
const superAdminRoleKey = ROLE_KEYS[0];

export interface BootstrapInput {
  uid: string;
  recovery: boolean;
  version: string;
  now: Date;
}

export interface BootstrapResult {
  uid: string;
  subjectId: string;
  roleAssignmentId: string;
  recovered: boolean;
}

export class BootstrapError extends Error {
  override readonly name = 'BootstrapError';

  constructor(
    readonly code: 'super_admin_already_exists' | 'super_admin_assignment_exists',
    message: string,
  ) {
    super(message);
  }
}

interface BootstrapReconciliation {
  roles: string[];
  permissions: string[];
  rolePermissions: string[];
  tagDefinitions: string[];
  tagPermissions: string[];
  modules: string[];
  subjects: string[];
}

function emptyReconciliation(): BootstrapReconciliation {
  return {
    roles: [],
    permissions: [],
    rolePermissions: [],
    tagDefinitions: [],
    tagPermissions: [],
    modules: [],
    subjects: [],
  };
}

function identity(...parts: string[]): string {
  return parts.join('\u0000');
}

function reconciliationIdentity(...parts: string[]): string {
  return parts.join(':');
}

function sameScope(
  left: { type: string; id: string },
  right: { type: string; id: string },
): boolean {
  return left.type === right.type && left.id === right.id;
}

function sameMetadata(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEffectiveActiveSuperAdmin(
  assignment: { status: string; expiresAt: string | null },
  now: Date,
): boolean {
  if (assignment.status !== 'active') return false;
  if (assignment.expiresAt === null) return true;
  const expiresAt = Date.parse(assignment.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

async function ensureBuiltInDefinitions(
  store: DevelopmentStore,
  ownerUid: string,
  reconcile: boolean,
): Promise<BootstrapReconciliation> {
  const changes = emptyReconciliation();
  const roles = await store.roles.list();
  for (const definition of BUILT_IN_ROLES) {
    const existing = roles.find(({ key }) => key === definition.key);
    if (existing === undefined) {
      await store.roles.create({
        ...definition,
        status: 'active',
        ownerUid,
        scope: publicScope,
      });
      changes.roles.push(definition.key);
      continue;
    }
    if (
      reconcile &&
      (existing.name !== definition.name ||
        existing.status !== 'active' ||
        !sameScope(existing.scope, publicScope))
    ) {
      await store.roles.update(existing.id, {
        name: definition.name,
        status: 'active',
        scope: publicScope,
      });
      changes.roles.push(definition.key);
    }
  }

  const permissions = await store.permissions.list();
  for (const definition of BUILT_IN_PERMISSIONS) {
    const key = identity(definition.action, definition.resource);
    const existing = permissions.find(({ action, resource }) => identity(action, resource) === key);
    if (existing === undefined) {
      await store.permissions.create({
        ...definition,
        status: 'active',
        ownerUid,
        scope: publicScope,
      });
      changes.permissions.push(reconciliationIdentity(definition.action, definition.resource));
      continue;
    }
    if (reconcile && (existing.status !== 'active' || !sameScope(existing.scope, publicScope))) {
      await store.permissions.update(existing.id, {
        status: 'active',
        scope: publicScope,
      });
      changes.permissions.push(reconciliationIdentity(definition.action, definition.resource));
    }
  }

  const rolePermissions = await store.rolePermissions.list();
  for (const definition of BUILT_IN_ROLE_PERMISSIONS) {
    const key = identity(
      definition.roleKey,
      definition.action,
      definition.resource,
      definition.scope.type,
      definition.scope.id,
    );
    const auditKey = reconciliationIdentity(
      definition.roleKey,
      definition.action,
      definition.resource,
      definition.scope.type,
      definition.scope.id,
    );
    const existing = rolePermissions.find(
      ({ roleKey, action, resource, scope }) =>
        identity(roleKey, action, resource, scope.type, scope.id) === key,
    );
    if (existing === undefined) {
      await store.rolePermissions.create({
        ...definition,
        status: 'active',
        ownerUid,
      });
      changes.rolePermissions.push(auditKey);
      continue;
    }
    if (reconcile && (existing.effect !== definition.effect || existing.status !== 'active')) {
      await store.rolePermissions.update(existing.id, {
        effect: definition.effect,
        status: 'active',
      });
      changes.rolePermissions.push(auditKey);
    }
  }

  const tagDefinitions = await store.tagDefinitions.list();
  for (const definition of BUILT_IN_TAG_DEFINITIONS) {
    const existing = tagDefinitions.find(({ key }) => key === definition.key);
    if (existing === undefined) {
      await store.tagDefinitions.create({
        ...definition,
        metadata: { ...definition.metadata },
        status: 'active',
        ownerUid,
        scope: publicScope,
      });
      changes.tagDefinitions.push(definition.key);
      continue;
    }
    if (
      reconcile &&
      (existing.name !== definition.name ||
        existing.description !== definition.description ||
        existing.requiredScopeType !== definition.requiredScopeType ||
        !sameMetadata(existing.metadata, definition.metadata) ||
        existing.status !== 'active' ||
        !sameScope(existing.scope, publicScope))
    ) {
      await store.tagDefinitions.update(existing.id, {
        name: definition.name,
        description: definition.description,
        requiredScopeType: definition.requiredScopeType,
        metadata: { ...definition.metadata },
        status: 'active',
        scope: publicScope,
      });
      changes.tagDefinitions.push(definition.key);
    }
  }

  const tagPermissions = await store.tagPermissions.list();
  for (const definition of BUILT_IN_TAG_PERMISSIONS) {
    const key = identity(
      definition.tagKey,
      definition.action,
      definition.resource,
      definition.scope.type,
      definition.scope.id,
    );
    const auditKey = reconciliationIdentity(
      definition.tagKey,
      definition.action,
      definition.resource,
      definition.scope.type,
      definition.scope.id,
    );
    const existing = tagPermissions.find(
      ({ tagKey, action, resource, scope }) =>
        identity(tagKey, action, resource, scope.type, scope.id) === key,
    );
    if (existing === undefined) {
      await store.tagPermissions.create({
        ...definition,
        status: 'active',
        ownerUid,
      });
      changes.tagPermissions.push(auditKey);
      continue;
    }
    if (reconcile && (existing.effect !== definition.effect || existing.status !== 'active')) {
      await store.tagPermissions.update(existing.id, {
        effect: definition.effect,
        status: 'active',
      });
      changes.tagPermissions.push(auditKey);
    }
  }

  const modules = await store.modules.list();
  for (const definition of BUILT_IN_MODULES) {
    const existing = modules.find(({ moduleId }) => moduleId === definition.moduleId);
    if (existing === undefined) {
      await store.modules.create({
        ...definition,
        status: 'enabled',
        ownerUid,
        scope: publicScope,
      });
      changes.modules.push(definition.moduleId);
      continue;
    }
    if (
      reconcile &&
      (existing.name !== definition.name ||
        existing.description !== definition.description ||
        existing.enabled !== definition.enabled ||
        existing.status !== 'enabled' ||
        !sameScope(existing.scope, publicScope))
    ) {
      await store.modules.update(existing.id, {
        name: definition.name,
        description: definition.description,
        enabled: definition.enabled,
        status: 'enabled',
        scope: publicScope,
      });
      changes.modules.push(definition.moduleId);
    }
  }

  return changes;
}

export async function ensurePlatformDefinitions(
  store: DevelopmentStore,
  ownerUid: string,
): Promise<void> {
  await store.transaction(async (transactionStore) => {
    await ensureBuiltInDefinitions(transactionStore, ownerUid, true);
  });
}

export async function bootstrapPlatform(
  store: DevelopmentStore,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  return store.transaction(async (transactionStore) => {
    const reconciliation = await ensureBuiltInDefinitions(
      transactionStore,
      input.uid,
      input.recovery,
    );
    const canonicalSuperAdminRole = (
      await transactionStore.roles.list({ query: superAdminRoleKey })
    ).find(({ key }) => key === superAdminRoleKey);
    if (canonicalSuperAdminRole === undefined) {
      throw new Error('Canonical platform super administrator role is missing');
    }
    const lockedSuperAdminRole = await transactionStore.roles.getForUpdate(
      canonicalSuperAdminRole.id,
    );
    if (lockedSuperAdminRole?.key !== superAdminRoleKey) {
      throw new Error('Failed to lock canonical platform super administrator role');
    }

    const superAdminAssignments = (await transactionStore.roleAssignments.list()).filter(
      ({ roleKey }) => roleKey === superAdminRoleKey,
    );
    if (
      !input.recovery &&
      superAdminAssignments.some((assignment) => isEffectiveActiveSuperAdmin(assignment, input.now))
    ) {
      throw new BootstrapError(
        'super_admin_already_exists',
        'An active platform super administrator already exists',
      );
    }
    if (superAdminAssignments.some(({ subjectUid }) => subjectUid === input.uid)) {
      throw new BootstrapError(
        'super_admin_assignment_exists',
        'The target subject already has a platform super administrator assignment',
      );
    }

    const existingSubject = (await transactionStore.subjects.list({ query: input.uid })).find(
      ({ uid }) => uid === input.uid,
    );
    let subject = existingSubject;
    if (subject === undefined) {
      subject = await transactionStore.subjects.create({
        uid: input.uid,
        displayName: input.uid,
        avatarUrl: null,
        status: 'active',
        ownerUid: input.uid,
        scope: publicScope,
      });
    } else if (subject.status !== 'active') {
      const reactivated = await transactionStore.subjects.update(subject.id, {
        status: 'active',
      });
      if (reactivated === null) throw new Error('Failed to reactivate bootstrap subject');
      subject = reactivated;
      if (input.recovery) reconciliation.subjects.push(input.uid);
    }
    const assignment = await transactionStore.roleAssignments.create({
      subjectUid: input.uid,
      roleKey: superAdminRoleKey,
      expiresAt: null,
      status: 'active',
      ownerUid: input.uid,
      scope: publicScope,
    });
    await recordAuditEvent(transactionStore, {
      actorUid: input.uid,
      action: input.recovery ? 'platform.bootstrap.recovery' : 'platform.bootstrap',
      resourceType: 'platform',
      resourceId: input.uid,
      details: {
        version: input.version,
        occurredAt: input.now.toISOString(),
        recovered: input.recovery,
        ...(input.recovery ? { reconciliation } : {}),
      },
    });

    return {
      uid: input.uid,
      subjectId: subject.id,
      roleAssignmentId: assignment.id,
      recovered: input.recovery,
    };
  });
}
