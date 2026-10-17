import { afterEach, describe, expect, it } from 'vitest';
import type { RoleKey, SocialOrganizationId, UserContext } from '@freebbs-development/contracts';
import {
  scopedEditFixture,
  scopedMemberUid,
} from '../../core/authorization/scoped-edit-test-fixture.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { EventsService } from './service.js';
import { ActivityDetailService } from './detail-service.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture(role: RoleKey) {
  const value = await scopedEditFixture();
  cleanups.push(value.cleanup);
  await value.assign(role);
  const actor = await loadAuthorizationContext(
    value.store,
    {
      uid: scopedMemberUid,
      displayName: 'Maintainer',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    } satisfies UserContext,
    new Date(),
  );
  return {
    ...value,
    actor,
    service: new EventsService(value.store),
    detail: new ActivityDetailService(value.store),
  };
}
const input = (organizationId: SocialOrganizationId) => ({
  title: 'Organization activity',
  description: 'Private activity notes',
  clubId: null,
  startsAt: null,
  endsAt: null,
  location: 'Campus',
  organizationId,
  standingActivity: false,
  status: 'draft' as const,
  scope: { type: 'public', id: '*' },
});

describe('activity organization identity boundaries', () => {
  it('keeps unrelated leaders out of private technical-support requests while preserving SAST support', async () => {
    const { store, actor, service, detail } = await fixture('domain.arts_lead');
    const activity = await store.activities.create({
      ...input('sports_center'),
      scope: { type: 'social_organization', id: 'sports_center' },
      ownerUid: 'other',
      technicalSupportStatus: 'requested',
      technicalSupportNote: null,
    });
    expect((await service.list(actor, {})).some((row) => row.id === activity.id)).toBe(false);
    await expect(detail.get(actor, activity.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.updateTechnicalSupport(actor, activity.id, 'confirmed'),
    ).rejects.toMatchObject({ status: 404 });
    for (const row of await store.roleAssignments.list({ query: actor.uid }))
      if (row.subjectUid === actor.uid)
        await store.roleAssignments.update(row.id, { status: 'inactive' });
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'science_association.software.member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const support = await loadAuthorizationContext(store, actor, new Date());
    await expect(detail.get(support, activity.id)).resolves.toMatchObject({ id: activity.id });
    await expect(
      service.updateTechnicalSupport(support, activity.id, 'confirmed'),
    ).resolves.toMatchObject({ technicalSupportStatus: 'confirmed' });
  });
  it('rechecks revoked maintenance after acquiring the activity lock', async () => {
    const { store, actor, service, detail } = await fixture('domain.arts_lead');
    const activity = await service.create(actor, input('arts_center'));
    for (const row of await store.roleAssignments.list({ query: actor.uid }))
      if (row.subjectUid === actor.uid)
        await store.roleAssignments.update(row.id, { status: 'inactive' });
    await expect(
      service.update(actor, activity.id, { title: 'Revoked edit' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.transition(actor, activity.id, 'pending')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      detail.createMilestone(actor, activity.id, {
        title: 'Revoked',
        description: 'No',
        type: 'other',
        occursAt: '2026-11-01T00:00:00.000Z',
        completed: false,
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('allows the innovation counselor to maintain SAST but no foreign activities', async () => {
    const { actor, service } = await fixture('counselor.innovation');
    const activity = await service.create(actor, input('sast'));
    await expect(
      service.update(actor, activity.id, { title: 'SAST supervision' }),
    ).resolves.toMatchObject({ title: 'SAST supervision' });
    await expect(service.create(actor, input('tuanwei'))).rejects.toMatchObject({ status: 403 });
  });
});
