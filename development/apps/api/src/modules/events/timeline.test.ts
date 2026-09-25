import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const admin = { 'X-Demo-User': 'demo-admin' };
const activityId = 'activity-night-run';

describe('activity detail timeline and competition preview', () => {
  it('aggregates public detail and computes progress from maintained milestones', async () => {
    const store = createMemoryStore();
    await store.activities.update(activityId, {
      endsAt: '2026-09-12T21:00:00.000Z',
      location: '东大操场',
      organizationId: 'sports_center',
      standingActivity: true,
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-admin']),
    });

    for (const milestone of [
      {
        occursAt: '2026-08-20T10:00:00.000Z',
        title: '主持人推送',
        type: 'promotion',
        description: '发布主持人招募推送。',
        completed: true,
        displayOrder: 1,
      },
      {
        occursAt: '2026-09-01T10:00:00.000Z',
        title: '报名推送',
        type: 'registration',
        description: '开放报名。',
        completed: false,
        displayOrder: 2,
      },
    ]) {
      await request(app)
        .post(`/api/development/v1/events/activities/${activityId}/milestones`)
        .set(admin)
        .send(milestone)
        .expect(201);
    }
    await request(app)
      .post(`/api/development/v1/events/activities/${activityId}/fixtures`)
      .set(admin)
      .send({
        round: '小组赛',
        participantA: '电子系',
        participantB: '自动化系',
        scheduledAt: '2026-09-12T11:00:00.000Z',
        location: '东大操场',
        score: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/development/v1/events/activities/${activityId}/milestones`)
      .set(student)
      .send({
        occursAt: '2026-09-12T12:00:00.000Z',
        title: '越权修改',
        type: 'invalid',
        description: '普通同学不能维护时间线。',
        completed: false,
        displayOrder: 3,
      })
      .expect(404);

    const detail = await request(app)
      .get(`/api/development/v1/events/activities/${activityId}`)
      .set(student)
      .expect(200);

    expect(detail.body.data).toMatchObject({
      id: activityId,
      location: '东大操场',
      organizationId: 'sports_center',
      standingActivity: true,
      progress: { completed: 1, total: 2, percentage: 50 },
    });
    expect(detail.body.data.milestones.map(({ title }: { title: string }) => title)).toEqual([
      '主持人推送',
      '报名推送',
    ]);
    expect(detail.body.data.fixtures[0]).toMatchObject({
      round: '小组赛',
      participantA: '电子系',
      participantB: '自动化系',
    });
  });
});
