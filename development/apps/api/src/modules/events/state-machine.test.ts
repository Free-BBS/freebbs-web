import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

describe('activity lifecycle', () => {
  it('creates drafts and follows the complete approval lifecycle', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });

    const created = await request(app)
      .post('/api/development/v1/events/activities')
      .set(adminHeaders)
      .send({
        title: 'Approval workflow',
        description: 'A complete activity lifecycle.',
        status: 'published',
        scope: { type: 'public', id: '*' },
      })
      .expect(400);

    expect(created.body.data.error.code).toBe('invalid_request');

    const draft = await request(app)
      .post('/api/development/v1/events/activities')
      .set(adminHeaders)
      .send({
        title: 'Approval workflow',
        description: 'A complete activity lifecycle.',
        scope: { type: 'public', id: '*' },
      })
      .expect(201);
    expect(draft.body.data.status).toBe('draft');

    for (const to of ['pending', 'approved', 'published', 'finished', 'archived'] as const) {
      const response = await request(app)
        .post(`/api/development/v1/events/activities/${draft.body.data.id}/transitions`)
        .set(adminHeaders)
        .send({ to })
        .expect(200);
      expect(response.body.data.status).toBe(to);
    }

    const rejected = await request(app)
      .post(`/api/development/v1/events/activities/${draft.body.data.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'published' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.activities.get(draft.body.data.id)).toMatchObject({ status: 'archived' });
    expect(await store.auditLogs.list({ query: draft.body.data.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'events.activity.status_changed',
          details: expect.objectContaining({
            from: 'archived',
            to: 'published',
            outcome: 'rejected',
          }),
        }),
      ]),
    );
  });
});
