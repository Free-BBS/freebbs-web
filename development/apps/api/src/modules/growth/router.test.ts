import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('personal growth archive API', () => {
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
