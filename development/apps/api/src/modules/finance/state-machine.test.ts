import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

describe('finance lifecycle', () => {
  it('uses only legal transitions and preserves rejected attempts', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });

    await request(app)
      .post('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({
        title: 'Invalid initial status',
        kind: 'budget',
        amountCents: 10_000,
        status: 'submitted',
        scope: { type: 'public', id: '*' },
      })
      .expect(400);

    const draft = await request(app)
      .post('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({
        title: 'Lifecycle budget',
        kind: 'budget',
        amountCents: 10_000,
        scope: { type: 'public', id: '*' },
      })
      .expect(201);
    expect(draft.body.data.status).toBe('draft');

    await request(app)
      .patch('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({ id: draft.body.data.id, status: 'submitted' })
      .expect(400);

    for (const to of ['submitted', 'rejected', 'draft', 'submitted', 'approved', 'archived']) {
      const changed = await request(app)
        .post(`/api/development/v1/finance/records/${draft.body.data.id}/transitions`)
        .set(adminHeaders)
        .send({ to })
        .expect(200);
      expect(changed.body.data.status).toBe(to);
    }

    const rejected = await request(app)
      .post(`/api/development/v1/finance/records/${draft.body.data.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'submitted' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.financeRecords.get(draft.body.data.id)).toMatchObject({
      status: 'archived',
    });
    expect(await store.auditLogs.list({ query: draft.body.data.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finance.record.status_changed',
          details: expect.objectContaining({
            from: 'archived',
            to: 'submitted',
            outcome: 'rejected',
          }),
        }),
      ]),
    );
  });
});
