import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { canMaintainSportsCard } from './card-authorization.js';
import { SportsService } from './service.js';
import type { RoleKey } from '@freebbs-development/contracts';

const publicScope = { type: 'public', id: '*' };
const team = 'team-basketball';
const action = 'sports.showcase.update' as const;
const resource = 'sports_showcase';

async function fixture(admin = false) {
  const store = createMemoryStore();
  const identity = {
    uid: 'live-card-member',
    displayName: 'Live member',
    avatarUrl: null,
    baseRole: 'student' as const,
    roles: [],
    tags: [],
  };
  await store.subjects.create({
    uid: identity.uid,
    displayName: identity.displayName,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey: admin ? 'platform.admin' : 'department.sports_member',
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  await store.rolePermissions.create({
    roleKey: 'department.sports_member',
    action,
    resource,
    effect: 'allow',
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  const actor = await loadAuthorizationContext(store, identity, new Date());
  expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
  return { store, identity, actor };
}

describe('current sports card binding denies with cached identities', () => {
  it.each([false, true])(
    'rejects disabled wildcard source definitions for role and captain fallback: captain=%s',
    async (captain) => {
      const { store, identity } = await fixture();
      for (const row of await store.roleAssignments.list({ subjectUid: identity.uid }))
        await store.roleAssignments.update(row.id, { status: 'archived' });
      if (captain) {
        await store.tagAssignments.create({
          subjectUid: identity.uid,
          tagKey: 'sports.team_captain',
          expiresAt: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: { type: 'sports_team', id: team },
        });
        for (const row of await store.tagPermissions.list({ tagKey: 'sports.team_captain' }))
          await store.tagPermissions.update(row.id, { status: 'archived' });
        await store.tagPermissions.create({
          tagKey: 'sports.team_captain',
          action: 'sports.*',
          resource: '*',
          effect: 'allow',
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      } else {
        await store.roleAssignments.create({
          subjectUid: identity.uid,
          roleKey: 'domain.sports_lead',
          expiresAt: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
        for (const row of await store.rolePermissions.list({ roleKey: 'domain.sports_lead' }))
          if (row.action !== 'sports.*')
            await store.rolePermissions.update(row.id, { status: 'archived' });
      }
      const actor = await loadAuthorizationContext(store, identity, new Date());
      expect(await canMaintainSportsCard(store, actor, team)).toBe(true);
      const source = (await store.permissions.list()).find(
        (row) => row.action === 'sports.*' && row.resource === '*',
      )!;
      await store.permissions.update(source.id, { status: 'archived' });
      const current = await loadAuthorizationContext(store, identity, new Date());
      expect(await canMaintainSportsCard(store, current, team)).toBe(false);
      await expect(
        new SportsService(store).updateTeam(current, team, { description: 'Must not be saved' }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await store.sportsTeams.get(team))?.description).not.toBe('Must not be saved');
      await store.permissions.update(source.id, { status: 'active' });
      expect(await canMaintainSportsCard(store, actor, team)).toBe(true);
      await expect(
        new SportsService(store).updateTeam(actor, team, {
          description: 'Active definition control',
        }),
      ).resolves.toMatchObject({ description: 'Active definition control' });
    },
  );
  async function supervisorFixture(roleKey: RoleKey, scope = publicScope) {
    const { store, identity } = await fixture();
    for (const assignment of await store.roleAssignments.list({ subjectUid: identity.uid }))
      await store.roleAssignments.update(assignment.id, { status: 'archived' });
    const assignment = await store.roleAssignments.create({
      subjectUid: identity.uid,
      roleKey,
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    });
    const actor = await loadAuthorizationContext(store, identity, new Date());
    return { store, identity, actor, assignment };
  }
  it.each([
    'counselor.youth_league_secretary',
    'counselor.youth_league',
    'student_union.executive_president',
    'student_union.presidium',
  ] as const)(
    'allows current public supervisor %s to maintain cards and showcases',
    async (role) => {
      const { store, actor } = await supervisorFixture(role);
      expect(await canMaintainSportsCard(store, actor)).toBe(true);
      expect(await canMaintainSportsCard(store, actor, team)).toBe(true);
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    },
  );
  it.each([
    'counselor.practice',
    'counselor.innovation',
    'counselor.student_development',
    'science_association.chair',
  ] as const)('does not turn %s into a sports supervisor', async (role) => {
    const { store, actor } = await supervisorFixture(role);
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
  });
  it('does not widen a scoped supervisory role into global card authority', async () => {
    const { store, actor } = await supervisorFixture('student_union.presidium', {
      type: 'social_organization',
      id: 'arts_center',
    });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
  });
  it.each([
    'assignment',
    'expiry',
    'role',
    'subject',
    'module',
    'definition',
    'binding',
    'deny',
  ] as const)('rechecks %s before using cached supervisor allows', async (guard) => {
    const { store, actor, assignment } = await supervisorFixture('student_union.presidium');
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    if (guard === 'assignment')
      await store.roleAssignments.update(assignment.id, { status: 'archived' });
    if (guard === 'expiry')
      await store.roleAssignments.update(assignment.id, { expiresAt: '2000-01-01T00:00:00.000Z' });
    if (guard === 'role')
      await store.roles.update(
        (await store.roles.list()).find(({ key }) => key === assignment.roleKey)!.id,
        { status: 'archived' },
      );
    if (guard === 'subject')
      await store.subjects.update(
        (await store.subjects.list()).find(({ uid }) => uid === actor.uid)!.id,
        { status: 'archived' },
      );
    if (guard === 'module')
      await store.modules.update(
        (await store.modules.list()).find(({ moduleId }) => moduleId === 'sports')!.id,
        { enabled: false },
      );
    if (guard === 'definition') {
      const definition = (await store.permissions.list()).find(
        (row) => row.action === action && row.resource === resource,
      );
      if (definition) await store.permissions.update(definition.id, { status: 'archived' });
      else
        await store.permissions.create({
          action,
          resource,
          status: 'archived',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
    }
    if (guard === 'binding')
      for (const binding of await store.rolePermissions.list({ roleKey: assignment.roleKey })) {
        if (
          binding.action.startsWith('sports.') &&
          ['public', 'department', 'social_organization'].includes(binding.scope.type) &&
          ['*', 'sports_center', 'student_union.sports_center'].includes(binding.scope.id)
        )
          await store.rolePermissions.update(binding.id, { status: 'archived' });
      }
    if (guard === 'deny')
      await store.rolePermissions.create({
        roleKey: assignment.roleKey,
        action: 'sports.*',
        resource: '*',
        effect: 'deny',
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'social_organization', id: 'sports_center' },
      });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
  });
  it('honors a newly added scoped role deny despite an existing cached explicit allow', async () => {
    const { store, actor, identity } = await fixture();
    const deny = await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action,
      resource,
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: team },
    });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
    expect(await canMaintainSportsCard(store, actor, 'team-badminton', action)).toBe(true);
    const refreshed = await loadAuthorizationContext(store, identity, new Date());
    expect(await canMaintainSportsCard(store, refreshed, team, action)).toBe(false);
    await store.rolePermissions.update(deny.id, { status: 'archived' });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
  });

  it.each([false, true])(
    'checks fresh denies from other current roles before a sports/admin allow: admin=%s',
    async (admin) => {
      const { store, actor } = await fixture(admin);
      const assignment = await store.roleAssignments.create({
        subjectUid: actor.uid,
        roleKey: 'department.arts_member',
        expiresAt: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'department', id: 'student_union.sports_center' },
      });
      await store.rolePermissions.create({
        roleKey: 'department.arts_member',
        action,
        resource,
        effect: 'deny',
        status: 'active',
        ownerUid: 'demo-admin',
        scope: publicScope,
      });
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
      await store.roleAssignments.update(assignment.id, { expiresAt: '2020-01-01T00:00:00.000Z' });
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    },
  );

  it.each([false, true])(
    'checks newly assigned tag denies before sports/admin allows and ignores expired tags: admin=%s',
    async (admin) => {
      const { store, actor } = await fixture(admin);
      const assignment = await store.tagAssignments.create({
        subjectUid: actor.uid,
        tagKey: 'sports.team_captain',
        expiresAt: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'sports_team', id: team },
      });
      const deny = await store.tagPermissions.create({
        tagKey: 'sports.team_captain',
        action,
        resource,
        effect: 'deny',
        status: 'active',
        ownerUid: 'demo-admin',
        scope: publicScope,
      });
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
      expect(await canMaintainSportsCard(store, actor, 'team-badminton', action)).toBe(true);
      await store.tagAssignments.update(assignment.id, { expiresAt: '2020-01-01T00:00:00.000Z' });
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
      await store.tagAssignments.update(assignment.id, { expiresAt: null });
      await store.tagPermissions.update(deny.id, { status: 'archived' });
      expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    },
  );

  it('keeps wildcard deny definitions and current role governance authoritative', async () => {
    const { store, actor } = await fixture();
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'department.arts_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    });
    const deny = await store.rolePermissions.create({
      roleKey: 'department.arts_member',
      action: 'sports.*',
      resource: '*',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(false);
    const definition = (await store.permissions.list()).find(
      (permission) => permission.action === 'sports.*' && permission.resource === '*',
    )!;
    await store.permissions.update(definition.id, { status: 'archived' });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    await store.permissions.update(definition.id, { status: 'active' });
    await store.rolePermissions.update(deny.id, { status: 'archived' });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
    await store.rolePermissions.update(deny.id, { status: 'active' });
    const role = (await store.roles.list()).find(({ key }) => key === 'department.arts_member')!;
    await store.roles.update(role.id, { status: 'archived' });
    expect(await canMaintainSportsCard(store, actor, team, action)).toBe(true);
  });
});
