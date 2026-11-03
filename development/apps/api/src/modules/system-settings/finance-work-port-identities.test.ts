import { describe, expect, it } from 'vitest';
import {
  FINANCE_WORK_PORT_ROLES,
  financeWorkPortRoleScope,
  organizationMembershipsForRole,
  type RoleKey,
  type ScopeRef,
  type UserContext,
} from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { ensurePlatformDefinitions } from '../../core/bootstrap/bootstrap-service.js';
import { ROLE_PERMISSION_CATALOG } from '../../core/authorization/permission-catalog.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { authorize } from '../../core/authorization/authorize.js';
import { createRoleAssignment } from '../admin/assignment-service.js';
import { identitySnapshot, updateSettingsUser } from './users.js';

const publicScope = { type: 'public', id: '*' } as const;
const target = {
  uid: 'work-port-target',
  username: 'work-port-target',
  displayName: 'Target',
  avatarUrl: null,
  studentId: null,
};
const directory = {
  list: async () => [target],
  get: async (uid: string) => (uid === target.uid ? target : null),
};
const user: UserContext = { ...target, baseRole: 'student', roles: [], tags: [] };
async function fixture() {
  const store = createMemoryStore();
  await store.subjects.create({
    uid: target.uid,
    displayName: target.displayName,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'admin',
    scope: publicScope,
  });
  return store;
}

describe('shared work-port identity appointments', () => {
  it('fills new built-in definitions without a data migration or granting appointments', async () => {
    const store = createMemoryStore({ seed: false });
    await ensurePlatformDefinitions(store, 'admin');
    const definitions = await store.roles.list();
    for (const roleKey of FINANCE_WORK_PORT_ROLES)
      expect(definitions).toContainEqual(
        expect.objectContaining({ key: roleKey, status: 'active' }),
      );
    expect(await store.roleAssignments.list()).toEqual([]);
  });

  it.each(FINANCE_WORK_PORT_ROLES)(
    'assigns %s through the ordinary identity editor using its exact organization scope',
    async (roleKey) => {
      const store = await fixture();
      const before = identitySnapshot(target, [], []);
      const saved = await updateSettingsUser(
        store,
        directory,
        target.uid,
        { revision: before.revision, roles: [roleKey], captainTeamIds: [] },
        'admin',
      );
      expect(saved.roles).toContain(roleKey);
      expect(await store.roleAssignments.list({ subjectUid: target.uid })).toEqual([
        expect.objectContaining({
          roleKey,
          scope: financeWorkPortRoleScope(roleKey),
          status: 'active',
        }),
      ]);
      const context = await loadAuthorizationContext(store, user, new Date());
      expect(context.roles).toContain(roleKey);
      expect(context.roleScopes).toContainEqual(
        expect.objectContaining({ roleKey, scope: financeWorkPortRoleScope(roleKey) }),
      );
      expect(context.businessAdmin).toBe(false);
      expect(context.learningAdmin).toBe(false);
      expect(organizationMembershipsForRole(roleKey)).toEqual([]);
      expect(ROLE_PERMISSION_CATALOG[roleKey]).toEqual([]);
      for (const [action, resource] of [
        ['finance.record.review', 'finance_record'],
        ['admin.manage', 'admin'],
        ['events.update', 'activity'],
        ['sports.team.manage', 'sports_team'],
      ] as const)
        expect(
          authorize(context, { action, resource, scope: { type: 'organization', id: 'bbs' } })
            .allowed,
        ).toBe(false);
      await updateSettingsUser(
        store,
        directory,
        target.uid,
        { revision: saved.revision, roles: [], captainTeamIds: [] },
        'admin',
      );
      expect((await loadAuthorizationContext(store, user, new Date())).roles).not.toContain(roleKey);
    },
  );

  it.each(FINANCE_WORK_PORT_ROLES)(
    'requires precise scope for %s even through the retained role-assignment API',
    async (roleKey) => {
      const store = await fixture();
      for (const scope of [
        publicScope,
        { type: 'organization', id: 'foreign' },
        { type: 'sports_team', id: 'team-one' },
      ] as ScopeRef[])
        await expect(
          createRoleAssignment(
            store,
            { subjectUid: target.uid, roleKey, scope },
            { actorUid: 'admin' },
          ),
        ).rejects.toMatchObject({ status: 400, code: 'invalid_finance_work_port_scope' });
      expect(await store.roleAssignments.list({ subjectUid: target.uid })).toEqual([]);
    },
  );

  it('honors appointment expiry and preserves an existing expiry when the identity editor saves unchanged selections', async () => {
    const store = await fixture();
    const roleKey: RoleKey = 'bbs.finance';
    const expiry = '2099-01-01T00:00:00.000Z';
    const appointment = await createRoleAssignment(
      store,
      {
        subjectUid: target.uid,
        roleKey,
        scope: financeWorkPortRoleScope(roleKey)!,
        expiresAt: expiry,
      },
      { actorUid: 'admin' },
    );
    const before = identitySnapshot(target, await store.roleAssignments.list(), []);
    await updateSettingsUser(
      store,
      directory,
      target.uid,
      { revision: before.revision, roles: [roleKey], captainTeamIds: [] },
      'admin',
    );
    expect((await store.roleAssignments.get(appointment.id))?.expiresAt).toBe(expiry);
    expect(
      (await loadAuthorizationContext(store, user, new Date('2098-12-31T00:00:00Z'))).roles,
    ).toContain(roleKey);
    expect(
      (await loadAuthorizationContext(store, user, new Date('2099-01-02T00:00:00Z'))).roles,
    ).not.toContain(roleKey);
  });
});
