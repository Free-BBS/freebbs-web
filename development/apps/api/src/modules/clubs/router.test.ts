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

describe('clubs API', () => {
  it('joins, prevents duplicates, leaves, and permits a later rejoin', async () => {
    const { app, store } = fixture();

    await request(app)
      .post('/api/development/v1/clubs/club-running/memberships')
      .set(student)
      .send({ memberUid: 'spoofed' })
      .expect(400);

    const joined = await request(app)
      .post('/api/development/v1/clubs/club-running/memberships')
      .set(student)
      .send({})
      .expect(201);
    expect(joined.body.data).toMatchObject({
      clubId: 'club-running',
      memberUid: 'demo-student',
      ownerUid: 'demo-student',
      status: 'pending',
      scope: { type: 'club', id: 'club-running' },
    });

    const duplicate = await request(app)
      .post('/api/development/v1/clubs/club-running/memberships')
      .set(student)
      .send({})
      .expect(409);
    expect(JSON.stringify(duplicate.body)).not.toContain('ER_DUP_ENTRY');

    await request(app)
      .delete('/api/development/v1/clubs/club-running/memberships')
      .set(student)
      .expect(204);
    const historical = (await store.clubMemberships.list({ query: 'club-running' })).find(
      (record) => record.memberUid === 'demo-student',
    );
    expect(historical).toMatchObject({ status: 'left' });

    const rejoined = await request(app)
      .post('/api/development/v1/clubs/club-running/memberships')
      .set(student)
      .send({})
      .expect(201);
    expect(rejoined.body.data).toMatchObject({ id: historical?.id, status: 'pending' });
  });

  it('uses authenticated ownership and lets an arts domain manager update with an audit', async () => {
    const { app, store } = fixture();
    const created = await request(app)
      .post('/api/development/v1/clubs')
      .set(admin)
      .send({
        name: 'Robotics Club',
        description: 'Build and learn.',
        status: 'draft',
        scope: { type: 'organization', id: 'arts' },
      })
      .expect(201);
    expect(created.body.data.ownerUid).toBe('demo-admin');

    await request(app)
      .post(`/api/development/v1/clubs/${created.body.data.id}/transitions`)
      .set(admin)
      .send({ to: 'active' })
      .expect(200);
    expect(await store.auditLogs.list({ query: created.body.data.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'clubs.club.status_changed',
          resourceId: created.body.data.id,
        }),
      ]),
    );
  });

  it('hides protected existence and fails closed when the module row is missing', async () => {
    const { app } = fixture();
    const known = await request(app)
      .patch('/api/development/v1/clubs')
      .set(student)
      .send({ id: 'club-running', name: 'No' })
      .expect(404);
    const unknown = await request(app)
      .patch('/api/development/v1/clubs')
      .set(student)
      .send({ id: 'missing-club', name: 'No' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);

    const empty = createMemoryStore({ seed: false });
    const closed = createApp({
      store: empty,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });
    await request(closed).get('/api/development/v1/clubs').set(student).expect(503);
  });
});
