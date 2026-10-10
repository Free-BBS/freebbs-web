import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { GrowthSummary, SocialOrganizationId } from '@freebbs-development/contracts';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

function archive() {
  const store = createMemoryStore({ seed: false });
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-student', 'demo-captain']),
  });
  async function add(
    organizationId: SocialOrganizationId | null = 'arts_center',
    endsAt: string | null = '2020-01-01T00:00:00Z',
    status = 'finished',
    participantUid = 'demo-student',
    registrationStatus = 'registered',
  ) {
    const activity = await store.activities.create({
      title: '校园探索',
      description: '',
      endsAt,
      organizationId,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status,
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.activityRegistrations.create({
      activityId: activity.id,
      participantUid,
      status: registrationStatus,
      ownerUid: participantUid,
      scope: { type: 'activity', id: activity.id },
    });
    return activity;
  }
  async function summary(uid = 'demo-student'): Promise<GrowthSummary> {
    const response = await request(app)
      .get('/api/development/v1/growth/summary')
      .set('X-Demo-User', uid)
      .expect(200);
    return response.body.data;
  }
  return { store, app, add, summary };
}

describe('personal growth archive API', () => {
  it('returns all 18 locked badges for an empty archive with stable series and preserved IDs', async () => {
    const data = await archive().summary();
    expect(data.achievements).toHaveLength(18);
    expect(data.achievements.every((badge) => !badge.unlocked && badge.progress === 0)).toBe(true);
    expect(data.achievements.filter((badge) => badge.series === 'milestone')).toHaveLength(5);
    expect(data.achievements.filter((badge) => badge.series === 'specialty')).toHaveLength(7);
    expect(data.achievements.filter((badge) => badge.series === 'diversity')).toHaveLength(3);
    expect(data.achievements.filter((badge) => badge.series === 'rhythm')).toHaveLength(3);
    expect(data.achievements.map((badge) => badge.id)).toEqual(
      expect.arrayContaining(['first-step', 'steady-explorer', 'multi-domain']),
    );
  });

  it.each([1, 3, 5, 10, 20])(
    'unlocks total milestones at %i unique ended registrations',
    async (total) => {
      const fixture = archive();
      for (let index = 0; index < total; index++) await fixture.add();
      const data = await fixture.summary();
      const milestones = data.achievements.filter((badge) => badge.series === 'milestone');
      expect(milestones.map((badge) => badge.target)).toEqual([1, 3, 5, 10, 20]);
      expect(milestones.map((badge) => badge.unlocked)).toEqual(
        [1, 3, 5, 10, 20].map((target) => total >= target),
      );
      expect(milestones.every((badge) => badge.progress === total)).toBe(true);
    },
  );

  it('specializes in seven known domains and excludes other from diversity', async () => {
    const fixture = archive();
    const organizations = [
      'arts_center',
      'sports_center',
      'liaison_center',
      'rights_development_center',
      'tuanwei',
      'sast',
      'tms',
    ] as const;
    for (const organization of organizations) {
      for (let index = 0; index < 3; index++) await fixture.add(organization);
    }
    await fixture.add(null);
    const data = await fixture.summary();
    expect(data.achievements.filter((badge) => badge.series === 'specialty')).toEqual(
      organizations.map(() => expect.objectContaining({ progress: 3, target: 3, unlocked: true })),
    );
    expect(
      data.achievements
        .filter((badge) => badge.series === 'diversity')
        .map((badge) => badge.progress),
    ).toEqual([7, 7, 7]);
    const unknown = archive();
    await unknown.add(null);
    await unknown.add('arts_center');
    const unknownData = await unknown.summary();
    expect(unknownData.achievements.find((badge) => badge.id === 'multi-domain')?.progress).toBe(1);
  });

  it('counts distinct Shanghai calendar months, never missing or invalid legacy dates', async () => {
    const fixture = archive();
    await fixture.add('arts_center', '2020-01-31T15:59:59Z');
    await fixture.add('arts_center', '2020-01-31T16:00:00Z');
    await fixture.add('arts_center', '2020-02-01T02:00:00Z');
    await fixture.add('arts_center', null, 'archived');
    const invalid = await fixture.add();
    const normalizedInvalid = await fixture.add();
    const get = fixture.store.activities.get.bind(fixture.store.activities);
    vi.spyOn(fixture.store.activities, 'get').mockImplementation(async (id) => {
      const item = await get(id);
      return item && (id === invalid.id || id === normalizedInvalid.id)
        ? { ...item, endsAt: id === invalid.id ? 'invalid' : '2020-02-30T00:00:00Z' }
        : item;
    });
    let data = await fixture.summary();
    expect(data.total).toBe(6);
    expect(
      data.achievements
        .filter((badge) => badge.series === 'rhythm')
        .map((badge) => [badge.progress, badge.target, badge.unlocked]),
    ).toEqual([
      [2, 2, true],
      [2, 3, false],
      [2, 6, false],
    ]);
    for (const month of ['03', '04', '05', '06'])
      await fixture.add('arts_center', `2020-${month}-01T00:00:00Z`);
    data = await fixture.summary();
    expect(
      data.achievements
        .filter((badge) => badge.series === 'rhythm')
        .every((badge) => badge.unlocked && badge.progress === 6),
    ).toBe(true);
  });

  it('deduplicates repository registrations and rejects future, cancelled and foreign records', async () => {
    const fixture = archive();
    await fixture.add();
    const registrations = await fixture.store.activityRegistrations.list();
    await fixture.add('sports_center', '2999-01-01T00:00:00Z', 'published');
    await fixture.add('sports_center', '2020-01-01T00:00:00Z', 'cancelled');
    await fixture.add('sports_center', '2020-01-01T00:00:00Z', 'finished', 'demo-captain');
    await fixture.add(
      'sports_center',
      '2020-01-01T00:00:00Z',
      'finished',
      'demo-student',
      'cancelled',
    );
    const all = await fixture.store.activityRegistrations.list();
    vi.spyOn(fixture.store.activityRegistrations, 'list').mockResolvedValue([
      ...all,
      ...registrations,
    ]);
    const data = await fixture.summary();
    expect(data.total).toBe(1);
    expect(data.activities).toHaveLength(1);
    expect(data.achievements.find((badge) => badge.id === 'steady-explorer')?.progress).toBe(1);
    await request(fixture.app)
      .get('/api/development/v1/growth/summary?uid=demo-student')
      .expect(401);
    expect((await fixture.summary('demo-captain')).total).toBe(1);
  });
  it('counts only the current user’s completed, non-cancelled registrations', async () => {
    const store = createMemoryStore({ seed: false });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-captain']),
    });
    async function activity(title: string, organizationId: 'arts_center' | 'sports_center') {
      return store.activities.create({
        title,
        description: title,
        registrationDeadline: null,
        capacity: null,
        contact: '',
        clubId: null,
        startsAt: '2000-01-01T00:00:00.000Z',
        endsAt: '2000-01-02T00:00:00.000Z',
        location: '',
        organizationId,
        standingActivity: false,
        technicalSupportStatus: 'not_requested',
        technicalSupportNote: null,
        status: 'finished',
        ownerUid: 'demo-admin',
        scope: { type: 'public', id: '*' },
      });
    }
    async function register(activityId: string, participantUid: string, status = 'registered') {
      await store.activityRegistrations.create({
        activityId,
        participantUid,
        status,
        ownerUid: participantUid,
        scope: { type: 'activity', id: activityId },
      });
    }
    const arts = await activity('学生节演出', 'arts_center');
    const sports = await activity('校园运动会', 'sports_center');
    const cancelled = await activity('取消报名的活动', 'arts_center');
    const other = await activity('其他同学的活动', 'sports_center');
    const future = await activity('尚未举办的活动', 'sports_center');
    const rejected = await activity('未发布的活动', 'arts_center');
    await store.activities.update(rejected.id, { status: 'rejected' });
    await store.activities.update(future.id, {
      startsAt: '2999-01-01T00:00:00.000Z',
      endsAt: '2999-01-02T00:00:00.000Z',
      status: 'published',
    });
    await register(arts.id, 'demo-student');
    await register(sports.id, 'demo-student');
    await register(cancelled.id, 'demo-student', 'cancelled');
    await register(other.id, 'demo-captain');
    await register(future.id, 'demo-student');
    await register(rejected.id, 'demo-student');

    const response = await request(app)
      .get('/api/development/v1/growth/summary')
      .set('X-Demo-User', 'demo-student')
      .expect(200);

    expect(response.body.data.total).toBe(2);
    expect(response.body.data.byDomain).toEqual(
      expect.arrayContaining([
        { key: 'arts', label: '文艺', count: 1 },
        { key: 'sports', label: '体育', count: 1 },
      ]),
    );
    expect(response.body.data.achievements).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'first-step', unlocked: true })]),
    );
    expect(response.body.data.activities.map((item: { title: string }) => item.title)).toEqual(
      expect.arrayContaining(['学生节演出', '校园运动会']),
    );
    expect(JSON.stringify(response.body.data)).not.toContain('其他同学的活动');
    expect(JSON.stringify(response.body.data)).not.toContain('尚未举办的活动');
    expect(JSON.stringify(response.body.data)).not.toContain('未发布的活动');

    const otherResponse = await request(app)
      .get('/api/development/v1/growth/summary')
      .set('X-Demo-User', 'demo-captain')
      .expect(200);
    expect(otherResponse.body.data.total).toBe(1);
    expect(JSON.stringify(otherResponse.body.data)).not.toContain('学生节演出');
    await request(app).get('/api/development/v1/growth/summary').expect(401);
  });
});
