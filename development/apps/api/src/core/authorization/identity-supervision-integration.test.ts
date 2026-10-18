import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { RoleKey, UserContext } from '@freebbs-development/contracts';
import { scopedEditFixture, scopedMemberUid, memberHeaders } from './scoped-edit-test-fixture.js';
import { loadAuthorizationContext } from './load-authorization-context.js';
import { canEditDepartmentHome } from './scoped-department-edit.js';
import { canMaintainSportsCard } from '../../modules/sports/card-authorization.js';
import { canManageCollection } from '../../modules/collections/access.js';
import { canUpdateOrganization } from '../../modules/events/organization-access.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});
async function fixture(role: RoleKey) {
  const f = await scopedEditFixture();
  cleanup.push(f.cleanup);
  await f.assign(role);
  const actor = await loadAuthorizationContext(
    f.store,
    {
      uid: scopedMemberUid,
      displayName: 'supervisor',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    } satisfies UserContext,
    new Date(),
  );
  return { ...f, actor };
}
describe('organization supervisors without platform identity escalation', () => {
  it.each<RoleKey>(['counselor.youth_league_secretary', 'counselor.youth_league'])(
    'lets %s supervise business while keeping platform modules closed',
    async (role) => {
      const { store, actor, app } = await fixture(role);
      expect(await canEditDepartmentHome(store, actor, 'media_center.creative')).toBe(true);
      expect(await canMaintainSportsCard(store, actor, 'team-basketball')).toBe(true);
      expect(
        canManageCollection(
          actor,
          { ownerUid: 'other', organizationId: 'sports_center' },
          { publisherDepartmentId: 'student_union.sports_center' },
        ),
      ).toBe(true);
      expect(canUpdateOrganization(actor, { organizationId: 'sast' })).toBe(true);
      await request(app).get('/api/development/v1/system-settings').set(memberHeaders).expect(403);
      await request(app)
        .get('/api/development/v1/admin/development-users')
        .set(memberHeaders)
        .expect(403);
    },
  );
  it.each<RoleKey>(['student_union.executive_president', 'student_union.presidium'])(
    'bounds %s to all four student union centers',
    async (role) => {
      const { store, actor } = await fixture(role);
      for (const department of [
        'student_union.arts_center',
        'student_union.sports_center',
        'student_union.liaison_center',
        'student_union.rights_development_center',
      ])
        expect(await canEditDepartmentHome(store, actor, department)).toBe(true);
      expect(await canEditDepartmentHome(store, actor, 'media_center.creative')).toBe(false);
      expect(await canMaintainSportsCard(store, actor, 'team-basketball')).toBe(true);
      expect(
        canManageCollection(
          actor,
          { ownerUid: 'other', organizationId: 'sports_center' },
          { publisherDepartmentId: 'student_union.sports_center' },
        ),
      ).toBe(true);
      expect(
        canManageCollection(
          actor,
          { ownerUid: 'other', organizationId: 'tms' },
          { publisherDepartmentId: 'tms.position' },
        ),
      ).toBe(false);
      expect(canUpdateOrganization(actor, { organizationId: 'sast' })).toBe(false);
    },
  );
  it('keeps department counselors inside their supervised departments', async () => {
    const { store, actor } = await fixture('counselor.practice');
    expect(await canEditDepartmentHome(store, actor, 'youth_league.practice')).toBe(true);
    expect(await canEditDepartmentHome(store, actor, 'youth_league.organization')).toBe(false);
    expect(await canMaintainSportsCard(store, actor, 'team-basketball')).toBe(false);
    expect(canManageCollection(actor, { ownerUid: 'other', organizationId: 'tuanwei' }, {})).toBe(
      false,
    );
    expect(
      canManageCollection(
        actor,
        { ownerUid: 'other', organizationId: 'tuanwei' },
        { publisherDepartmentId: 'youth_league.organization' },
      ),
    ).toBe(false);
    expect(
      canManageCollection(
        actor,
        { ownerUid: 'other', organizationId: 'tuanwei' },
        { publisherDepartmentId: 'youth_league.practice' },
      ),
    ).toBe(true);
  });
});
