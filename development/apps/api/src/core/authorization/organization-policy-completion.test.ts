import { describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  departmentsForRoles,
  organizationMembershipsForRole,
  isGlobalOrganizationBusinessSupervisor,
  type RoleKey,
  type ScopeRef,
  type UserContext,
} from '@freebbs-development/contracts';
import { createMemoryStore } from '../database/memory-store.js';
import { createRoleAssignment } from '../../modules/admin/assignment-service.js';
import { setOrganizationMembership } from '../../modules/admin/organization-membership-service.js';
import { loadAuthorizationContext } from './load-authorization-context.js';
import { authorize } from './authorize.js';
import { canEditActivityWorkspace, canEditDepartmentHome } from './scoped-department-edit.js';

const now = new Date('2026-10-15T09:00:00Z');
const publicScope = { type: 'public', id: '*' } as const;
const identity: UserContext = {
  uid: 'policy-member',
  displayName: 'Member',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};

async function fixture(roleKey: RoleKey, scope: ScopeRef = publicScope) {
  const store = createMemoryStore();
  await store.subjects.create({
    uid: identity.uid,
    displayName: identity.displayName,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'test',
    scope: publicScope,
  });
  const assignment = await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey,
    scope,
    status: 'active',
    expiresAt: null,
    ownerUid: 'test',
  });
  return { store, assignment, load: () => loadAuthorizationContext(store, identity, now) };
}
const request = {
  action: 'events.update',
  resource: 'activity',
  scope: { type: 'social_organization', id: 'arts_center' },
};

describe('organization policy compatibility on existing stores', () => {
  it('lets the innovation counselor supervise SAST business at organization scope while denying foreign organizations', async () => {
    const f = await fixture('counselor.innovation');
    const context = await f.load();
    for (const [action, resource] of [
      ['knowledge.create', 'knowledge_entry'],
      ['knowledge.publish', 'knowledge_entry'],
      ['events.update', 'activity'],
    ] as const) {
      expect(
        authorize(
          context,
          { action, resource, scope: { type: 'social_organization', id: 'sast' } },
          now,
        ).allowed,
      ).toBe(true);
      expect(
        authorize(
          context,
          { action, resource, scope: { type: 'social_organization', id: 'tuanwei' } },
          now,
        ).allowed,
      ).toBe(false);
    }
  });
  it.each(ROLE_KEYS)(
    'checks canonical business authority for %s across the complete 79-role matrix',
    async (roleKey) => {
      const f = await fixture(roleKey);
      const context = await f.load();
      expect(context.roles).toContain(roleKey);
      if (roleKey === 'platform.super_admin') {
        expect(authorize(context, request, now).allowed).toBe(false);
        return;
      }
      if (roleKey === 'platform.admin') {
        expect(context.businessAdmin).toBe(true);
        return;
      }
      expect(context.businessAdmin).toBe(false);
      expect(authorize(context, { action: 'admin.manage', resource: 'admin' }, now).allowed).toBe(
        false,
      );
      for (const { organizationId } of organizationMembershipsForRole(roleKey)) {
        expect(
          authorize(
            context,
            {
              action: 'finance.record.read',
              resource: 'finance_record',
              scope: { type: 'social_organization', id: organizationId },
            },
            now,
          ).allowed,
        ).toBe(true);
        if (
          ['youth_league.', 'science_association.', 'media_center.'].some((prefix) =>
            roleKey.startsWith(prefix),
          )
        ) {
          expect(
            authorize(
              context,
              {
                action: 'events.create',
                resource: 'activity',
                scope: { type: 'social_organization', id: 'arts_center' },
              },
              now,
            ).allowed,
          ).toBe(false);
        }
      }
      for (const { id } of departmentsForRoles([roleKey])) {
        expect(
          authorize(
            context,
            {
              action: 'events.department_home.update',
              resource: 'department_home',
              scope: { type: 'department', id },
            },
            now,
          ).allowed,
        ).toBe(true);
      }
      if (roleKey.startsWith('counselor.')) {
        expect(
          authorize(
            context,
            {
              action: 'knowledge.publish',
              resource: 'knowledge_entry',
              scope: { type: 'social_organization', id: 'arts_center' },
            },
            now,
          ).allowed,
        ).toBe(['counselor.youth_league_secretary', 'counselor.youth_league'].includes(roleKey));
      }
    },
  );
  it('adds absent rules and definitions before any administrator reconciliation', async () => {
    const f = await fixture('student_union.executive_president');
    for (const row of await f.store.rolePermissions.list())
      if (row.roleKey === 'student_union.executive_president')
        await f.store.rolePermissions.delete(row.id);
    for (const row of await f.store.permissions.list())
      if (row.action === 'events.department_home.update') await f.store.permissions.delete(row.id);
    const context = await f.load();
    expect(authorize(context, request, now).allowed).toBe(true);
    expect(
      authorize(context, { ...request, scope: { type: 'social_organization', id: 'tuanwei' } }, now)
        .allowed,
    ).toBe(false);
    expect(
      authorize(
        context,
        {
          action: 'events.department_home.update',
          resource: 'department_home',
          scope: { type: 'department', id: 'student_union.arts_center' },
        },
        now,
      ).allowed,
    ).toBe(true);
    expect(
      (await f.store.permissions.list()).some(
        ({ action }) => action === 'events.department_home.update',
      ),
    ).toBe(false);
  });
  it.each(['inactive', 'deny'] as const)(
    'honors governed %s wildcard bindings when adding defaults',
    async (kind) => {
      const f = await fixture('student_union.presidium');
      for (const row of await f.store.rolePermissions.list())
        if (row.roleKey === 'student_union.presidium') await f.store.rolePermissions.delete(row.id);
      await f.store.rolePermissions.create({
        roleKey: 'student_union.presidium',
        action: '*',
        resource: '*',
        status: kind === 'inactive' ? 'inactive' : 'active',
        effect: kind === 'deny' ? 'deny' : 'allow',
        scope: publicScope,
        ownerUid: 'test',
      });
      expect(authorize(await f.load(), request, now).allowed).toBe(false);
    },
  );
  it('preserves explicit definitions, role state, expiry, subject state and module state', async () => {
    for (const kind of ['definition', 'role', 'expiry', 'subject', 'module'] as const) {
      const f = await fixture('student_union.presidium');
      for (const row of await f.store.rolePermissions.list())
        if (row.roleKey === 'student_union.presidium') await f.store.rolePermissions.delete(row.id);
      if (kind === 'definition') {
        const definition = (await f.store.permissions.list()).find(
          ({ action }) => action === 'events.*',
        )!;
        await f.store.permissions.update(definition.id, { status: 'inactive' });
      }
      if (kind === 'role') {
        const role = (await f.store.roles.list()).find(
          ({ key }) => key === 'student_union.presidium',
        )!;
        await f.store.roles.update(role.id, { status: 'inactive' });
      }
      if (kind === 'expiry')
        await f.store.roleAssignments.update(f.assignment.id, {
          expiresAt: '2000-01-01T00:00:00Z',
        });
      if (kind === 'subject') {
        const subject = (await f.store.subjects.list()).find(({ uid }) => uid === identity.uid)!;
        await f.store.subjects.update(subject.id, { status: 'inactive' });
      }
      if (kind === 'module') {
        const module = (await f.store.modules.list()).find(
          ({ moduleId }) => moduleId === 'events',
        )!;
        await f.store.modules.update(module.id, { status: 'disabled', enabled: false });
      }
      expect(authorize(await f.load(), request, now).allowed, kind).toBe(false);
    }
  });
  it('keeps active exact governed rights when an umbrella definition is inactive', async () => {
    const f = await fixture('student_union.presidium');
    const definition = (await f.store.permissions.list()).find(
      ({ action }) => action === 'events.*',
    )!;
    await f.store.permissions.update(definition.id, { status: 'inactive' });
    expect(authorize(await f.load(), request, now).allowed).toBe(true);
  });
  it('does not revive an inactive concrete action through an active umbrella grant', async () => {
    const f = await fixture('counselor.youth_league');
    const definition = (await f.store.permissions.list()).find(
      ({ action }) => action === 'knowledge.publish',
    )!;
    await f.store.permissions.update(definition.id, { status: 'inactive' });
    expect(
      authorize(await f.load(), { action: 'knowledge.publish', resource: 'knowledge_entry' }, now),
    ).toMatchObject({ allowed: false, reason: 'explicit-deny' });
  });
  it('does not turn an inactive universal definition into a denial of the active student baseline', async () => {
    const f = await fixture('department.arts_member');
    const definition = (await f.store.permissions.list()).find(
      ({ action, resource }) => action === '*' && resource === '*',
    )!;
    await f.store.permissions.update(definition.id, { status: 'inactive' });
    expect(
      authorize(await f.load(), { action: 'dashboard.read', resource: 'dashboard' }, now).allowed,
    ).toBe(true);
  });
  it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
    'grants %s organization business while keeping platform identity separate',
    async (roleKey) => {
      const f = await fixture(roleKey);
      const context = await f.load();
      expect(isGlobalOrganizationBusinessSupervisor(context)).toBe(true);
      expect(context.businessAdmin).toBe(false);
      expect(context.roles).toEqual([roleKey]);
      expect(
        authorize(
          context,
          {
            action: 'knowledge.publish',
            resource: 'knowledge_entry',
            scope: { type: 'social_organization', id: 'media_center' },
          },
          now,
        ).allowed,
      ).toBe(true);
      expect(authorize(context, { action: 'admin.manage', resource: 'admin' }, now).allowed).toBe(
        false,
      );
      await f.store.roleAssignments.update(f.assignment.id, {
        scope: { type: 'social_organization', id: 'arts_center' },
      });
      expect(isGlobalOrganizationBusinessSupervisor(await f.load())).toBe(false);
    },
  );
  it.each([
    'student_union.executive_president',
    'student_union.presidium',
    'science_association.chair',
  ] as const)(
    'does not promote a scoped %s assignment into organization-wide role authority',
    async (roleKey) => {
      const f = await fixture(roleKey, {
        type: 'department',
        id: roleKey.startsWith('student_union.')
          ? 'student_union.arts_center'
          : 'science_association.office',
      });
      expect((await f.load()).roles).not.toContain(roleKey);
    },
  );
});

describe('collaboration scope intersections with persisted definitions', () => {
  it('combines a department position with an appointment to its parent organization', async () => {
    const f = await fixture('department.sports_member', {
      type: 'social_organization',
      id: 'sports_center',
    });
    const actor = await f.load();
    expect(await canEditDepartmentHome(f.store, actor, 'student_union.sports_center')).toBe(true);
    expect(await canEditDepartmentHome(f.store, actor, 'student_union.arts_center')).toBe(false);
  });
  it.each(['development_activity', 'native_collection'] as const)(
    'keeps a concrete %s appointment restricted to that resource',
    async (source) => {
      const f = await fixture('department.sports_member', {
        type: source === 'development_activity' ? 'activity' : 'collection_form',
        id: 'owned-id',
      });
      const actor = await f.load();
      const target = {
        source,
        id: 'owned-id',
        organizationId: 'sports_center' as const,
        departmentId: 'student_union.sports_center',
        scope: publicScope,
      };
      expect(await canEditActivityWorkspace(f.store, actor, target)).toBe(true);
      expect(await canEditActivityWorkspace(f.store, actor, { ...target, id: 'another-id' })).toBe(
        false,
      );
      expect(await canEditDepartmentHome(f.store, actor, 'student_union.sports_center')).toBe(
        false,
      );
    },
  );
  it('does not resurrect a default when a persisted binding has an incompatible scope', async () => {
    const f = await fixture('department.sports_member', {
      type: 'department',
      id: 'student_union.sports_center',
    });
    const binding = (await f.store.rolePermissions.list()).find(
      ({ roleKey, action }) =>
        roleKey === 'department.sports_member' && action === 'events.department_home.update',
    )!;
    await f.store.rolePermissions.update(binding.id, {
      scope: { type: 'sports_team', id: 'another-team' },
    });
    const actor = await f.load();
    expect(
      authorize(
        actor,
        {
          action: 'events.department_home.update',
          resource: 'department_home',
          scope: { type: 'department', id: 'student_union.sports_center' },
        },
        now,
      ).allowed,
    ).toBe(false);
    expect(await canEditDepartmentHome(f.store, actor, 'student_union.sports_center')).toBe(false);
  });
  it('rejects inconsistent department and organization metadata even for global business supervisors', async () => {
    const f = await fixture('counselor.youth_league');
    expect(
      await canEditActivityWorkspace(f.store, await f.load(), {
        source: 'development_activity',
        id: 'one',
        organizationId: 'arts_center',
        departmentId: 'student_union.sports_center',
        scope: publicScope,
      }),
    ).toBe(false);
  });
  it('rechecks current administrator assignments before using a loaded administrator policy', async () => {
    const f = await fixture('platform.admin');
    const actor = await f.load();
    await f.store.roleAssignments.update(f.assignment.id, { status: 'inactive' });
    expect(await canEditDepartmentHome(f.store, actor, 'student_union.sports_center')).toBe(false);
  });
});

describe('identity assignment write boundaries', () => {
  it('rejects a generic assignment across ordinary positions but preserves finance and cross-organization positions', async () => {
    const f = await fixture('department.arts_member');
    const grant = (roleKey: RoleKey) =>
      createRoleAssignment(
        f.store,
        { subjectUid: identity.uid, roleKey },
        { actorUid: 'test', now },
      );
    await expect(grant('department.sports_member')).rejects.toMatchObject({
      code: 'invalid_identity_selection',
    });
    await expect(grant('student_union.finance')).resolves.toMatchObject({
      roleKey: 'student_union.finance',
    });
    await expect(grant('youth_league.practice.member')).resolves.toMatchObject({
      roleKey: 'youth_league.practice.member',
    });
    await expect(grant('affiliation.tuanwei_member')).rejects.toMatchObject({
      code: 'invalid_identity_selection',
    });
  });
  it('rejects the legacy membership writer bypass atomically', async () => {
    const f = await fixture('student_union.presidium');
    await expect(
      setOrganizationMembership(
        f.store,
        { subjectUid: identity.uid, organizationId: 'sports_center', level: 'member' },
        { actorUid: 'test' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_identity_selection' });
    expect(
      (await f.store.roleAssignments.list({ subjectUid: identity.uid }))
        .filter(({ status }) => status === 'active')
        .map(({ roleKey }) => roleKey),
    ).toEqual(['student_union.presidium']);
  });
});
