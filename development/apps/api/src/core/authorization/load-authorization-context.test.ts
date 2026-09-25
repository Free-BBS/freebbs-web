import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { bootstrapPlatform } from '../bootstrap/bootstrap-service.js';
import { createMemoryStore } from '../database/memory-store.js';
import type { DevelopmentStore } from '../database/types.js';
import { authorize } from './authorize.js';
import { loadAuthorizationContext } from './load-authorization-context.js';

const now = new Date('2026-07-27T10:00:00.000Z');
const publicScope = { type: 'public', id: '*' } as const;
const identity: UserContext = {
  uid: 'u_authorized',
  displayName: 'Authorized student',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['platform.super_admin'],
  tags: [{ key: 'sports.team_captain' }],
};

async function governanceStore(): Promise<DevelopmentStore> {
  const store = createMemoryStore({ seed: false });
  await bootstrapPlatform(store, {
    uid: 'u_bootstrap',
    recovery: false,
    version: 'task-15-test',
    now,
  });
  await store.subjects.create({
    uid: identity.uid,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    status: 'active',
    ownerUid: identity.uid,
    scope: publicScope,
  });
  return store;
}

async function assignRole(
  store: DevelopmentStore,
  roleKey: 'department.arts_director',
  expiresAt: string | null = null,
) {
  return store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey,
    expiresAt,
    status: 'active',
    ownerUid: 'u_bootstrap',
    scope: publicScope,
  });
}

function publishRequest() {
  return { action: 'knowledge.publish', resource: 'knowledge_entry' };
}

describe('database-backed authorization context', () => {
  it('grants from active governance rows and revokes immediately with the binding', async () => {
    const store = await governanceStore();
    await assignRole(store, 'department.arts_director');
    const binding = (await store.rolePermissions.list()).find(
      ({ roleKey, action }) =>
        roleKey === 'department.arts_director' && action === 'knowledge.publish',
    );
    if (binding === undefined) throw new Error('expected knowledge publish binding');

    const context = await loadAuthorizationContext(store, identity, now);
    expect(authorize(context, publishRequest(), now).allowed).toBe(true);
    expect(context.roles).toEqual(['department.arts_director']);
    expect(context.tags).toEqual([]);

    await store.rolePermissions.update(binding.id, { status: 'inactive' });
    const revoked = await loadAuthorizationContext(store, identity, now);
    expect(authorize(revoked, publishRequest(), now).allowed).toBe(false);
  });

  it('requires active definitions, a current assignment, and an enabled module', async () => {
    const cases = [
      {
        name: 'inactive role definition',
        mutate: async (store: DevelopmentStore, assignmentId: string) => {
          void assignmentId;
          const role = (await store.roles.list()).find(
            ({ key }) => key === 'department.arts_director',
          );
          if (role === undefined) throw new Error('expected role');
          await store.roles.update(role.id, { status: 'inactive' });
        },
      },
      {
        name: 'expired assignment',
        mutate: async (store: DevelopmentStore, assignmentId: string) => {
          await store.roleAssignments.update(assignmentId, {
            expiresAt: '2026-07-27T09:59:59.999Z',
          });
        },
      },

      {
        name: 'disabled module',
        mutate: async (store: DevelopmentStore, assignmentId: string) => {
          void assignmentId;
          const module = (await store.modules.list()).find(
            ({ moduleId }) => moduleId === 'knowledge',
          );
          if (module === undefined) throw new Error('expected knowledge module');
          await store.modules.update(module.id, { enabled: false, status: 'disabled' });
        },
      },
    ];

    for (const testCase of cases) {
      const store = await governanceStore();
      const assignment = await assignRole(store, 'department.arts_director');
      await testCase.mutate(store, assignment.id);

      const context = await loadAuthorizationContext(store, identity, now);
      expect(authorize(context, publishRequest(), now), `${testCase.name} must deny`).toMatchObject(
        { allowed: false },
      );
    }
  });

  it('does not let an unknown database permission expand the code catalog', async () => {
    const store = await governanceStore();
    await assignRole(store, 'department.arts_director');
    await store.permissions.create({
      action: 'secret.export',
      resource: 'knowledge_secret',
      status: 'active',
      ownerUid: 'u_bootstrap',
      scope: publicScope,
    });
    await store.rolePermissions.create({
      roleKey: 'department.arts_director',
      action: 'secret.export',
      resource: 'knowledge_secret',
      effect: 'allow',
      status: 'active',
      ownerUid: 'u_bootstrap',
      scope: publicScope,
    });

    const context = await loadAuthorizationContext(store, identity, now);

    expect(
      authorize(context, { action: 'secret.export', resource: 'knowledge_secret' }, now),
    ).toEqual({ allowed: false, reason: 'unknown-permission', matchedBy: null });
  });

  it('combines captain binding and assignment scopes into one concrete policy', async () => {
    const store = await governanceStore();
    const assignment = await store.tagAssignments.create({
      subjectUid: identity.uid,
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid: 'u_bootstrap',
      scope: { type: 'sports_team', id: 'team-a' },
    });
    const request = {
      action: 'sports.checkin.create',
      resource: 'sports_checkin',
      scope: { type: 'sports_team', id: 'team-a' },
    };

    const context = await loadAuthorizationContext(store, identity, now);
    expect(authorize(context, request, now)).toMatchObject({
      allowed: true,
      reason: 'policy-grant',
    });
    expect(context.policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: { type: 'sports_team', id: 'team-a' } }),
      ]),
    );

    await store.tagAssignments.update(assignment.id, {
      scope: { type: 'sports_team', id: '*' },
    });
    const wildcardAssignment = await loadAuthorizationContext(store, identity, now);
    expect(authorize(wildcardAssignment, request, now).allowed).toBe(false);
  });

  it('denies inactive tag definitions and incompatible concrete scopes', async () => {
    const store = await governanceStore();
    await store.tagAssignments.create({
      subjectUid: identity.uid,
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid: 'u_bootstrap',
      scope: { type: 'sports_team', id: 'team-a' },
    });
    const definition = (await store.tagDefinitions.list()).find(
      ({ key }) => key === 'sports.team_captain',
    );
    const binding = (await store.tagPermissions.list()).find(
      ({ tagKey, action }) => tagKey === 'sports.team_captain' && action === 'sports.checkin.read',
    );
    if (definition === undefined || binding === undefined) {
      throw new Error('expected captain governance rows');
    }
    await store.tagPermissions.update(binding.id, {
      scope: { type: 'sports_team', id: 'team-b' },
    });
    let context = await loadAuthorizationContext(store, identity, now);
    expect(
      authorize(
        context,
        {
          action: 'sports.checkin.read',
          resource: 'sports_checkin',
          scope: { type: 'sports_team', id: 'team-a' },
        },
        now,
      ).allowed,
    ).toBe(false);

    await store.tagPermissions.update(binding.id, {
      scope: { type: 'sports_team', id: '*' },
    });
    await store.tagDefinitions.update(definition.id, { status: 'inactive' });
    context = await loadAuthorizationContext(store, identity, now);
    expect(
      authorize(
        context,
        {
          action: 'sports.checkin.read',
          resource: 'sports_checkin',
          scope: { type: 'sports_team', id: 'team-a' },
        },
        now,
      ).allowed,
    ).toBe(false);
  });

  it('compiles the student baseline only from active database definitions', async () => {
    const store = await governanceStore();
    const permission = (await store.permissions.list()).find(
      ({ action, resource }) =>
        action === 'information.consultation.create' && resource === 'consultation',
    );
    if (permission === undefined) throw new Error('expected baseline permission');

    let context = await loadAuthorizationContext(store, identity, now);
    expect(
      authorize(
        context,
        { action: 'information.consultation.create', resource: 'consultation' },
        now,
      ).allowed,
    ).toBe(true);

    await store.permissions.update(permission.id, { status: 'inactive' });
    context = await loadAuthorizationContext(store, identity, now);
    expect(
      authorize(
        context,
        { action: 'information.consultation.create', resource: 'consultation' },
        now,
      ).allowed,
    ).toBe(false);
  });
});
