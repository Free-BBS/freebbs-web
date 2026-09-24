import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const admin = { 'X-Demo-User': 'demo-admin' };

function fixture() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-student', 'demo-admin']),
  });
  return { app, store };
}

describe('events API', () => {
  it('restores, cancels, and reuses the actor registration history', async () => {
    const { app, store } = fixture();
    await store.activities.update('activity-night-run', { registrationDeadline: null });
    await request(app)
      .post('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .send({ participantUid: 'spoofed' })
      .expect(400);

    const registered = await request(app)
      .post('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .send({})
      .expect(201);
    expect(registered.body.data).toMatchObject({
      activityId: 'activity-night-run',
      participantUid: 'demo-student',
      ownerUid: 'demo-student',
      status: 'registered',
      scope: { type: 'activity', id: 'activity-night-run' },
    });

    const duplicate = await request(app)
      .post('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .send({})
      .expect(409);
    expect(JSON.stringify(duplicate.body)).not.toContain('ER_DUP_ENTRY');

    const current = await request(app)
      .get('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .expect(200);
    expect(current.body.data).toMatchObject({
      id: registered.body.data.id,
      status: 'registered',
    });

    await request(app)
      .delete('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .expect(204);
    const historical = (
      await store.activityRegistrations.list({ query: 'activity-night-run' })
    ).find((record) => record.participantUid === 'demo-student');
    expect(historical).toMatchObject({ status: 'cancelled' });

    const registeredAgain = await request(app)
      .post('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .send({})
      .expect(201);
    expect(registeredAgain.body.data).toMatchObject({
      id: historical?.id,
      status: 'registered',
    });
  });

  it('accepts registration only while the transaction-locked activity is published', async () => {
    const { app, store } = fixture();
    await store.activities.update('activity-night-run', { status: 'approved' });
    const response = await request(app)
      .post('/api/development/v1/events/activities/activity-night-run/registrations')
      .set(student)
      .send({})
      .expect(409);
    expect(response.body.data.error.code).toBe('activity_not_published');
  });

  it('keeps status out of generic PATCH and updates content atomically with an audit', async () => {
    const { app, store } = fixture();
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set(admin)
      .send({ id: 'activity-night-run', status: 'finished' })
      .expect(400);
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set(admin)
      .send({ id: 'activity-night-run', description: 'Updated activity.' })
      .expect(200);
    expect(await store.auditLogs.list({ query: 'activity-night-run' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'events.activity.updated',
          resourceId: 'activity-night-run',
        }),
      ]),
    );
  });

  it('fails closed when the module row is disabled', async () => {
    const { app, store } = fixture();
    const module = (await store.modules.list({ query: 'events' })).find(
      (record) => record.moduleId === 'events',
    )!;
    await store.modules.update(module.id, { enabled: false, status: 'disabled' });
    await request(app).get('/api/development/v1/events/activities').set(student).expect(503);
  });
});
