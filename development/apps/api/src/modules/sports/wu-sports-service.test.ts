import { describe, expect, it } from 'vitest';
import type { RoleKey } from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { WuSportsService } from './wu-sports-service.js';

const publicScope = { type: 'public', id: '*' };
async function fixture(roleKey: RoleKey) {
  const store = createMemoryStore();
  const identity = {
    uid: 'match-supervisor',
    displayName: 'Supervisor',
    avatarUrl: null,
    baseRole: 'student' as const,
    roles: [],
    tags: [],
  };
  await store.subjects.create({
    ...identity,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  const assignment = await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey,
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  const match = await store.sportsMatches.create({
    title: '篮球赛',
    startsAt: '2026-10-01T01:00:00.000Z',
    endsAt: '2026-10-01T02:00:00.000Z',
    location: '体育馆',
    result: null,
    coverUrl: null,
    liveUrl: null,
    replayUrl: null,
    status: 'active',
    ownerUid: 'another',
    scope: publicScope,
  });
  const actor = await loadAuthorizationContext(store, identity, new Date());
  return { store, actor, assignment, match, service: new WuSportsService(store) };
}

describe('current sports match supervisors', () => {
  it.each([
    'counselor.youth_league_secretary',
    'counselor.youth_league',
    'counselor.student_development',
    'student_union.executive_president',
    'student_union.presidium',
  ] as const)('lets %s update and delete another user’s match', async (role) => {
    const { service, actor, match } = await fixture(role);
    expect(await service.updateMatch(actor, match.id, { result: '72–68' })).toMatchObject({
      result: '72–68',
    });
    await service.deleteMatch(actor, match.id);
  });
  it.each([
    'counselor.innovation',
    'counselor.practice',
    'science_association.chair',
    'department.sports_member',
  ] as const)('does not let %s update another user’s match', async (role) => {
    const { service, actor, match } = await fixture(role);
    await expect(service.updateMatch(actor, match.id, { result: 'wrong' })).rejects.toMatchObject({
      status: 403,
    });
  });
  it.each(['scoped', 'expired'] as const)(
    'does not give a %s student-development counselor global match authority',
    async (state) => {
      const { store, service, actor, assignment, match } = await fixture(
        'counselor.student_development',
      );
      await store.roleAssignments.update(
        assignment.id,
        state === 'scoped'
          ? { scope: { type: 'department', id: 'youth_league.freshman' } }
          : { expiresAt: '2000-01-01T00:00:00.000Z' },
      );
      const before = await store.sportsMatches.get(match.id);
      await expect(service.updateMatch(actor, match.id, { result: 'wrong' })).rejects.toMatchObject(
        {
          status: 403,
        },
      );
      expect(await store.sportsMatches.get(match.id)).toEqual(before);
    },
  );
  it.each([
    'assignment',
    'expiry',
    'role',
    'subject',
    'module',
    'definition',
    'binding',
    'deny',
  ] as const)('does not retain cached match authority after %s changes', async (guard) => {
    const { store, actor, assignment, service, match } = await fixture('student_union.presidium');
    expect(await service.updateMatch(actor, match.id, { result: '72–68' })).toMatchObject({
      result: '72–68',
    });
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
    if (guard === 'definition')
      await store.permissions.update(
        (await store.permissions.list()).find(
          ({ action, resource }) => action === 'sports.match.update' && resource === 'sports_match',
        )!.id,
        { status: 'archived' },
      );
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
        scope: publicScope,
      });
    const before = await store.sportsMatches.get(match.id);
    const audit = await store.auditLogs.list();
    await expect(service.updateMatch(actor, match.id, { result: 'wrong' })).rejects.toMatchObject({
      status: 403,
    });
    expect(await store.sportsMatches.get(match.id)).toEqual(before);
    expect(await store.auditLogs.list()).toEqual(audit);
  });
});
