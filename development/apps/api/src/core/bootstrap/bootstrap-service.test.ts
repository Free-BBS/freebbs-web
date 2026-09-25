import { MODULE_IDS, ROLE_KEYS } from '@freebbs-development/contracts';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_PERMISSION_RULES,
  BASE_STUDENT_PERMISSIONS,
  ROLE_PERMISSION_CATALOG,
  SPORTS_CAPTAIN_RULES,
} from '../authorization/permission-catalog.js';
import { createMemoryStore } from '../database/memory-store.js';
import type { AuditLogRecord, DevelopmentStore, RecordRepository } from '../database/types.js';
import {
  BUILT_IN_MODULES,
  BUILT_IN_PERMISSIONS,
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_TAG_DEFINITIONS,
  BUILT_IN_TAG_PERMISSIONS,
} from './built-in-definitions.js';
import { bootstrapPlatform, ensurePlatformDefinitions } from './bootstrap-service.js';

const now = new Date('2026-07-27T08:30:00.000Z');
const publicScope = { type: 'public', id: '*' };

function runBootstrap(store: DevelopmentStore, input: ReturnType<typeof bootstrapInput>) {
  return bootstrapPlatform(store, input);
}
function bootstrapInput(uid: string, recovery = false) {
  return { uid, recovery, version: '834a804', now };
}

function permissionKey(value: { action: string; resource: string }): string {
  return `${value.action}\u0000${value.resource}`;
}

function storeWithMalformedSuperAdmin(store: DevelopmentStore): DevelopmentStore {
  return {
    ...store,
    transaction: (operation) =>
      store.transaction((transactionStore) => {
        const roleAssignments: RecordRepository<
          Awaited<ReturnType<typeof transactionStore.roleAssignments.create>>
        > = {
          create: transactionStore.roleAssignments.create.bind(transactionStore.roleAssignments),
          get: transactionStore.roleAssignments.get.bind(transactionStore.roleAssignments),
          getForUpdate: transactionStore.roleAssignments.getForUpdate.bind(
            transactionStore.roleAssignments,
          ),
          listForUpdate: transactionStore.roleAssignments.listForUpdate.bind(
            transactionStore.roleAssignments,
          ),
          list: async (filters) => [
            ...(await transactionStore.roleAssignments.list(filters)),
            {
              id: 'malformed-super-admin',
              subjectUid: 'u_malformed',
              roleKey: 'platform.super_admin',
              expiresAt: 'not-a-date',
              status: 'active',
              ownerUid: 'u_malformed',
              scope: publicScope,
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            },
          ],
          page: transactionStore.roleAssignments.page.bind(transactionStore.roleAssignments),
          update: transactionStore.roleAssignments.update.bind(transactionStore.roleAssignments),
          delete: transactionStore.roleAssignments.delete.bind(transactionStore.roleAssignments),
        };
        return operation({ ...transactionStore, roleAssignments });
      }),
  };
}

function storeObservingBootstrapOrder(store: DevelopmentStore, events: string[]): DevelopmentStore {
  return {
    ...store,
    transaction: (operation) =>
      store.transaction((transactionStore) => {
        const roles: RecordRepository<Awaited<ReturnType<typeof transactionStore.roles.create>>> = {
          create: transactionStore.roles.create.bind(transactionStore.roles),
          get: transactionStore.roles.get.bind(transactionStore.roles),
          getForUpdate: async (id) => {
            events.push('role-lock');
            return transactionStore.roles.getForUpdate(id);
          },
          listForUpdate: transactionStore.roles.listForUpdate.bind(transactionStore.roles),
          list: transactionStore.roles.list.bind(transactionStore.roles),
          page: transactionStore.roles.page.bind(transactionStore.roles),
          update: transactionStore.roles.update.bind(transactionStore.roles),
          delete: transactionStore.roles.delete.bind(transactionStore.roles),
        };
        const roleAssignments: RecordRepository<
          Awaited<ReturnType<typeof transactionStore.roleAssignments.create>>
        > = {
          create: async (input) => {
            events.push('assignment-create');
            return transactionStore.roleAssignments.create(input);
          },
          get: transactionStore.roleAssignments.get.bind(transactionStore.roleAssignments),
          getForUpdate: transactionStore.roleAssignments.getForUpdate.bind(
            transactionStore.roleAssignments,
          ),
          listForUpdate: transactionStore.roleAssignments.listForUpdate.bind(
            transactionStore.roleAssignments,
          ),
          list: async (filters) => {
            events.push('assignment-list');
            return transactionStore.roleAssignments.list(filters);
          },
          page: transactionStore.roleAssignments.page.bind(transactionStore.roleAssignments),
          update: transactionStore.roleAssignments.update.bind(transactionStore.roleAssignments),
          delete: transactionStore.roleAssignments.delete.bind(transactionStore.roleAssignments),
        };
        return operation({ ...transactionStore, roles, roleAssignments });
      }),
  };
}

function failingAuditStore(store: DevelopmentStore): DevelopmentStore {
  return {
    ...store,
    transaction: (operation) =>
      store.transaction((transactionStore) => {
        const auditLogs: RecordRepository<AuditLogRecord> = {
          create: async () => {
            throw new Error('simulated audit failure');
          },
          get: transactionStore.auditLogs.get.bind(transactionStore.auditLogs),
          getForUpdate: transactionStore.auditLogs.getForUpdate.bind(transactionStore.auditLogs),
          listForUpdate: transactionStore.auditLogs.listForUpdate.bind(transactionStore.auditLogs),
          list: transactionStore.auditLogs.list.bind(transactionStore.auditLogs),
          page: transactionStore.auditLogs.page.bind(transactionStore.auditLogs),
          update: transactionStore.auditLogs.update.bind(transactionStore.auditLogs),
          delete: transactionStore.auditLogs.delete.bind(transactionStore.auditLogs),
        };
        return operation({ ...transactionStore, auditLogs });
      }),
  };
}

describe('production governance bootstrap', () => {
  it('reconciles platform definitions without assigning a permanent administrator', async () => {
    const store = createMemoryStore({ seed: false });

    await ensurePlatformDefinitions(store, 'u_main_admin');

    expect(await store.roles.list()).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'platform.super_admin' })]),
    );
    expect(await store.permissions.list()).not.toHaveLength(0);
    expect(await store.modules.list()).not.toHaveLength(0);
    expect(await store.roleAssignments.list()).toEqual([]);
  });
  it('defines the exact built-in governance catalog', () => {
    expect(BUILT_IN_ROLES.map(({ key }) => key)).toEqual(ROLE_KEYS);
    expect(BUILT_IN_MODULES.map(({ moduleId }) => moduleId)).toEqual(MODULE_IDS);
    expect(BUILT_IN_TAG_DEFINITIONS.map(({ key }) => key)).toEqual([
      'social_org.arts_center',
      'social_org.liaison_center',
      'social_org.sports_center',
      'social_org.rights_development_center',
      'social_org.tuanwei',
      'social_org.sast',
      'social_org.tms',
      'sports.team_captain',
    ]);
    expect(BUILT_IN_TAG_DEFINITIONS.find(({ key }) => key === 'sports.team_captain')).toEqual(
      expect.objectContaining({
        key: 'sports.team_captain',
        requiredScopeType: 'sports_team',
      }),
    );
    expect(BUILT_IN_TAG_DEFINITIONS.map(({ key }) => key)).not.toContain('extension.custom');

    const catalogRules = [
      ...BASE_STUDENT_PERMISSIONS,
      ...Object.values(ROLE_PERMISSION_CATALOG).flat(),
      ...SPORTS_CAPTAIN_RULES,
      ...ADMIN_PERMISSION_RULES,
    ];
    expect(BUILT_IN_PERMISSIONS.map(permissionKey).sort()).toEqual(
      [...new Set(catalogRules.map(permissionKey))].sort(),
    );
    expect(BUILT_IN_ROLE_PERMISSIONS).toHaveLength(
      Object.values(ROLE_PERMISSION_CATALOG).flat().length,
    );
    expect(BUILT_IN_TAG_PERMISSIONS).toEqual(
      SPORTS_CAPTAIN_RULES.map((rule) =>
        expect.objectContaining({
          tagKey: 'sports.team_captain',
          action: rule.action,
          resource: rule.resource,
          effect: 'allow',
          scope: { type: 'sports_team', id: '*' },
        }),
      ),
    );
  });

  it('atomically bootstraps all definitions and the first super administrator', async () => {
    const store = createMemoryStore({ seed: false });

    const result = await runBootstrap(store, bootstrapInput('u_20260727_admin'));

    expect(result).toMatchObject({
      uid: 'u_20260727_admin',
      recovered: false,
      subjectId: expect.any(String),
      roleAssignmentId: expect.any(String),
    });
    expect((await store.roles.list()).map((role) => role.key)).toEqual(
      expect.arrayContaining([...ROLE_KEYS]),
    );
    expect(await store.roles.list()).toHaveLength(ROLE_KEYS.length);
    expect((await store.permissions.list()).map(permissionKey).sort()).toEqual(
      BUILT_IN_PERMISSIONS.map(permissionKey).sort(),
    );
    expect(await store.rolePermissions.list()).toHaveLength(BUILT_IN_ROLE_PERMISSIONS.length);
    expect(await store.tagPermissions.list()).toHaveLength(BUILT_IN_TAG_PERMISSIONS.length);
    const moduleIds = (await store.modules.list()).map((item) => item.moduleId);
    expect(moduleIds).toHaveLength(MODULE_IDS.length);
    expect(
      moduleIds.sort((left, right) => MODULE_IDS.indexOf(left) - MODULE_IDS.indexOf(right)),
    ).toEqual(MODULE_IDS);

    expect(await store.subjects.list({ query: 'u_20260727_admin' })).toEqual([
      expect.objectContaining({
        id: result.subjectId,
        uid: 'u_20260727_admin',
        displayName: 'u_20260727_admin',
        avatarUrl: null,
        status: 'active',
        ownerUid: 'u_20260727_admin',
        scope: publicScope,
      }),
    ]);
    expect(await store.roleAssignments.list({ query: 'u_20260727_admin' })).toEqual([
      expect.objectContaining({
        id: result.roleAssignmentId,
        subjectUid: 'u_20260727_admin',
        roleKey: 'platform.super_admin',
        expiresAt: null,
        status: 'active',
        ownerUid: 'u_20260727_admin',
        scope: publicScope,
      }),
    ]);
    expect(await store.auditLogs.list({ query: 'u_20260727_admin' })).toEqual([
      expect.objectContaining({
        actorUid: 'u_20260727_admin',
        action: 'platform.bootstrap',
        resourceType: 'platform',
        resourceId: 'u_20260727_admin',
        details: {
          version: '834a804',
          occurredAt: now.toISOString(),
          recovered: false,
        },
      }),
    ]);
  });

  it('refuses normal bootstrap when any active super administrator exists without mutation', async () => {
    const store = createMemoryStore({ seed: false });
    await runBootstrap(store, bootstrapInput('u_first'));
    const countsBefore = await Promise.all([
      store.subjects.list(),
      store.roles.list(),
      store.roleAssignments.list(),
      store.auditLogs.list(),
    ]);

    await expect(runBootstrap(store, bootstrapInput('u_second'))).rejects.toMatchObject({
      code: 'super_admin_already_exists',
    });

    const countsAfter = await Promise.all([
      store.subjects.list(),
      store.roles.list(),
      store.roleAssignments.list(),
      store.auditLogs.list(),
    ]);
    expect(countsAfter).toEqual(countsBefore);
  });

  it('separately audits recovery but refuses a duplicate target assignment', async () => {
    const store = createMemoryStore({ seed: false });
    await runBootstrap(store, bootstrapInput('u_first'));

    const recovered = await runBootstrap(store, bootstrapInput('u_recovered', true));

    expect(recovered).toMatchObject({ uid: 'u_recovered', recovered: true });
    expect(await store.roles.list()).toHaveLength(ROLE_KEYS.length);
    expect(await store.modules.list()).toHaveLength(MODULE_IDS.length);
    expect((await store.auditLogs.list()).map(({ action }) => action)).toContain(
      'platform.bootstrap.recovery',
    );
    const assignmentsBefore = await store.roleAssignments.list();
    await expect(runBootstrap(store, bootstrapInput('u_recovered', true))).rejects.toMatchObject({
      code: 'super_admin_assignment_exists',
    });
    expect(await store.roleAssignments.list()).toEqual(assignmentsBefore);
  });

  it('rolls back every definition when the final audit write fails', async () => {
    const rootStore = createMemoryStore({ seed: false });

    await expect(
      runBootstrap(failingAuditStore(rootStore), bootstrapInput('u_atomic')),
    ).rejects.toThrow('simulated audit failure');

    expect(await rootStore.subjects.list()).toEqual([]);
    expect(await rootStore.roles.list()).toEqual([]);
    expect(await rootStore.permissions.list()).toEqual([]);
    expect(await rootStore.rolePermissions.list()).toEqual([]);
    expect(await rootStore.roleAssignments.list()).toEqual([]);
    expect(await rootStore.tagDefinitions.list()).toEqual([]);
    expect(await rootStore.tagPermissions.list()).toEqual([]);
    expect(await rootStore.modules.list()).toEqual([]);
    expect(await rootStore.auditLogs.list()).toEqual([]);
  });

  it.each([
    ['expired', '2026-07-27T08:29:59.999Z'],
    ['expires exactly now', now.toISOString()],
  ])('does not let an %s active assignment block normal bootstrap', async (_label, expiresAt) => {
    const store = createMemoryStore({ seed: false });
    const first = await runBootstrap(store, bootstrapInput('u_first'));
    await store.roleAssignments.update(first.roleAssignmentId, { expiresAt });

    const second = await runBootstrap(store, bootstrapInput('u_second'));

    expect(second.uid).toBe('u_second');
    expect(await store.roleAssignments.list()).toHaveLength(2);
  });

  it('treats malformed super-admin expiry as ineffective instead of blocking bootstrap', async () => {
    const rootStore = createMemoryStore({ seed: false });

    const result = await runBootstrap(
      storeWithMalformedSuperAdmin(rootStore),
      bootstrapInput('u_valid'),
    );

    expect(result.uid).toBe('u_valid');
    expect(await rootStore.roleAssignments.list({ query: 'u_valid' })).toHaveLength(1);
  });

  it('still blocks a future active super-admin assignment', async () => {
    const store = createMemoryStore({ seed: false });
    const first = await runBootstrap(store, bootstrapInput('u_first'));
    await store.roleAssignments.update(first.roleAssignmentId, {
      expiresAt: '2026-07-27T08:30:00.001Z',
    });

    await expect(runBootstrap(store, bootstrapInput('u_second'))).rejects.toMatchObject({
      code: 'super_admin_already_exists',
    });
  });

  it('reconciles the canonical recovery minimum, reactivates the target and audits every repair', async () => {
    const store = createMemoryStore({ seed: false });
    await runBootstrap(store, bootstrapInput('u_first'));
    const roles = await store.roles.list();
    const permissions = await store.permissions.list();
    const rolePermissions = await store.rolePermissions.list();
    const tagDefinitions = await store.tagDefinitions.list();
    const tagPermissions = await store.tagPermissions.list();
    const modules = await store.modules.list();
    const superAdminRole = roles.find(({ key }) => key === 'platform.super_admin');
    const wildcardPermission = permissions.find(
      ({ action, resource }) => action === '*' && resource === '*',
    );
    const deniedBinding = rolePermissions.find(
      ({ roleKey, action }) => roleKey === 'platform.super_admin' && action === '*',
    );
    const inactiveBinding = rolePermissions.find(
      ({ roleKey, action }) => roleKey === 'domain.liaison_lead' && action === 'clubs.*',
    );
    const captainDefinition = tagDefinitions.find(({ key }) => key === 'sports.team_captain');
    const inactiveTagBinding = tagPermissions.find(
      ({ action }) => action === 'sports.checkin.read',
    );
    const deniedTagBinding = tagPermissions.find(
      ({ action }) => action === 'sports.checkin.create',
    );
    const adminModule = modules.find(({ moduleId }) => moduleId === 'admin');
    if (
      !superAdminRole ||
      !wildcardPermission ||
      !deniedBinding ||
      !inactiveBinding ||
      !captainDefinition ||
      !inactiveTagBinding ||
      !deniedTagBinding ||
      !adminModule
    ) {
      throw new Error('expected canonical bootstrap definitions');
    }
    await store.roles.update(superAdminRole.id, {
      name: 'drifted role',
      status: 'inactive',
    });
    await store.permissions.update(wildcardPermission.id, { status: 'inactive' });
    await store.rolePermissions.update(deniedBinding.id, { effect: 'deny' });
    await store.rolePermissions.update(inactiveBinding.id, { status: 'inactive' });
    await store.tagDefinitions.update(captainDefinition.id, {
      status: 'inactive',
      requiredScopeType: 'club',
    });
    await store.tagPermissions.update(inactiveTagBinding.id, { status: 'inactive' });
    await store.tagPermissions.update(deniedTagBinding.id, { effect: 'deny' });
    await store.modules.update(adminModule.id, {
      enabled: false,
      status: 'disabled',
    });
    const target = await store.subjects.create({
      uid: 'u_recovered_profile',
      displayName: 'Main-site display name',
      avatarUrl: 'https://example.test/avatar.png',
      status: 'inactive',
      ownerUid: 'main-site',
      scope: publicScope,
    });
    const extraBinding = await store.rolePermissions.create({
      roleKey: 'platform.super_admin',
      action: 'custom.export',
      resource: 'custom_resource',
      effect: 'allow',
      status: 'active',
      ownerUid: 'u_first',
      scope: publicScope,
    });

    const result = await runBootstrap(store, bootstrapInput('u_recovered_profile', true));

    expect(result.subjectId).toBe(target.id);
    expect(await store.subjects.get(target.id)).toMatchObject({
      status: 'active',
      displayName: 'Main-site display name',
      avatarUrl: 'https://example.test/avatar.png',
    });
    expect(await store.roles.get(superAdminRole.id)).toMatchObject({
      name: BUILT_IN_ROLES[0]?.name,
      status: 'active',
    });
    expect(await store.permissions.get(wildcardPermission.id)).toMatchObject({ status: 'active' });
    expect(await store.rolePermissions.get(deniedBinding.id)).toMatchObject({
      effect: 'allow',
      status: 'active',
    });
    expect(await store.rolePermissions.get(inactiveBinding.id)).toMatchObject({
      effect: 'allow',
      status: 'active',
    });
    expect(await store.tagDefinitions.get(captainDefinition.id)).toMatchObject({
      status: 'active',
      requiredScopeType: 'sports_team',
    });
    expect(await store.tagPermissions.get(inactiveTagBinding.id)).toMatchObject({
      effect: 'allow',
      status: 'active',
    });
    expect(await store.tagPermissions.get(deniedTagBinding.id)).toMatchObject({
      effect: 'allow',
      status: 'active',
    });
    expect(await store.modules.get(adminModule.id)).toMatchObject({
      enabled: true,
      status: 'enabled',
    });
    expect(await store.rolePermissions.get(extraBinding.id)).toEqual(extraBinding);
    const recoveryAudit = (await store.auditLogs.list({ query: 'u_recovered_profile' })).find(
      ({ action }) => action === 'platform.bootstrap.recovery',
    );
    expect(recoveryAudit?.details).toMatchObject({
      reconciliation: {
        roles: ['platform.super_admin'],
        permissions: ['*:*'],
        rolePermissions: expect.arrayContaining([
          'platform.super_admin:*:*:public:*',
          'domain.liaison_lead:clubs.*:*:public:*',
        ]),
        tagDefinitions: ['sports.team_captain'],
        tagPermissions: expect.arrayContaining([
          'sports.team_captain:sports.checkin.read:sports_checkin:sports_team:*',
          'sports.team_captain:sports.checkin.create:sports_checkin:sports_team:*',
        ]),
        modules: ['admin'],
        subjects: ['u_recovered_profile'],
      },
    });
    expect(
      (recoveryAudit?.details.reconciliation as { rolePermissions: string[] }).rolePermissions,
    ).toHaveLength(2);
    expect(
      (recoveryAudit?.details.reconciliation as { tagPermissions: string[] }).tagPermissions,
    ).toHaveLength(2);
  });

  it('locks the canonical super-admin role before assignment reads and writes', async () => {
    const events: string[] = [];
    const store = storeObservingBootstrapOrder(createMemoryStore({ seed: false }), events);

    await bootstrapPlatform(store, bootstrapInput('u_ordered'));

    expect(events).toEqual(['role-lock', 'assignment-list', 'assignment-create']);
  });

  it('serializes concurrent two-argument bootstrap calls through storage', async () => {
    const store = createMemoryStore({ seed: false });

    const outcomes = await Promise.allSettled([
      bootstrapPlatform(store, bootstrapInput('u_concurrent_a')),
      bootstrapPlatform(store, bootstrapInput('u_concurrent_b')),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: { code: 'super_admin_already_exists' },
    });
    expect(await store.roleAssignments.list()).toHaveLength(1);
  });
  it('does not mistake prefix-collision bindings for canonical recovery rows', async () => {
    const store = createMemoryStore({ seed: false });
    await runBootstrap(store, bootstrapInput('u_first'));
    const canonicalRoleBinding = (await store.rolePermissions.list()).find(
      ({ roleKey, action, resource, scope }) =>
        roleKey === 'platform.super_admin' &&
        action === '*' &&
        resource === '*' &&
        scope.type === 'public' &&
        scope.id === '*',
    );
    const canonicalTagBinding = (await store.tagPermissions.list()).find(
      ({ tagKey, action, scope }) =>
        tagKey === 'sports.team_captain' &&
        action === 'sports.checkin.read' &&
        scope.type === 'sports_team' &&
        scope.id === '*',
    );
    if (!canonicalRoleBinding || !canonicalTagBinding) {
      throw new Error('expected canonical bindings');
    }
    await store.rolePermissions.delete(canonicalRoleBinding.id);
    await store.tagPermissions.delete(canonicalTagBinding.id);
    const rolePrefix = await store.rolePermissions.create({
      roleKey: canonicalRoleBinding.roleKey,
      action: canonicalRoleBinding.action,
      resource: canonicalRoleBinding.resource,
      effect: 'allow',
      status: 'active',
      ownerUid: 'u_first',
      scope: { type: 'public', id: '*extra' },
    });
    const tagPrefix = await store.tagPermissions.create({
      tagKey: canonicalTagBinding.tagKey,
      action: canonicalTagBinding.action,
      resource: canonicalTagBinding.resource,
      effect: 'allow',
      status: 'active',
      ownerUid: 'u_first',
      scope: { type: 'sports_team', id: '*extra' },
    });

    await runBootstrap(store, bootstrapInput('u_recovered', true));

    expect(
      (await store.rolePermissions.list()).filter(
        ({ roleKey, action, resource, scope }) =>
          roleKey === 'platform.super_admin' &&
          action === '*' &&
          resource === '*' &&
          scope.type === 'public' &&
          scope.id === '*',
      ),
    ).toHaveLength(1);
    expect(
      (await store.tagPermissions.list()).filter(
        ({ tagKey, action, scope }) =>
          tagKey === 'sports.team_captain' &&
          action === 'sports.checkin.read' &&
          scope.type === 'sports_team' &&
          scope.id === '*',
      ),
    ).toHaveLength(1);
    expect(await store.rolePermissions.get(rolePrefix.id)).toEqual(rolePrefix);
    expect(await store.tagPermissions.get(tagPrefix.id)).toEqual(tagPrefix);
  });
});
