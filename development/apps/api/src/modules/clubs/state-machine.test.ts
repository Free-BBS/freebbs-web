import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const admin = { 'X-Demo-User': 'demo-admin' };

describe('club lifecycle', () => {
  it('archives and restores through transitions while rejecting status in generic PATCH', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });

    await request(app)
      .patch('/api/development/v1/clubs')
      .set(admin)
      .send({ id: 'club-running', status: 'archived' })
      .expect(400);

    const path = '/api/development/v1/clubs/club-running/transitions';
    await request(app).post(path).set(admin).send({ to: 'archived' }).expect(200);
    await request(app).post(path).set(admin).send({ to: 'active' }).expect(200);
    const rejected = await request(app).post(path).set(admin).send({ to: 'active' }).expect(409);

    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.clubs.get('club-running')).toMatchObject({ status: 'active' });
    expect(await store.auditLogs.list({ query: 'club-running' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'clubs.club.status_changed',
          details: expect.objectContaining({ from: 'active', to: 'active', outcome: 'rejected' }),
        }),
      ]),
    );
  });
});
