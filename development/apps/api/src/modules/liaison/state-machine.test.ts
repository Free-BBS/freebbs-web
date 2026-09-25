import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { canTransition } from '../../core/workflow/state-machine.js';
import { PROBLEM_TRANSITIONS } from './problem-service.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

describe('liaison resource lifecycle', () => {
  it('archives and restores resources through transitions while keeping status out of PATCH', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin', 'demo-student']),
    });
    const resource = await store.liaisonResources.create({
      name: 'Public contact',
      description: 'A stable public contact.',
      category: 'contact',
      visibility: 'public',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });

    await request(app)
      .post(`/api/development/v1/liaison/resources/${resource.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'archived' })
      .expect(200);

    const rejected = await request(app)
      .post(`/api/development/v1/liaison/resources/${resource.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'archived' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.liaisonResources.get(resource.id)).toMatchObject({ status: 'archived' });
    expect(await store.auditLogs.list({ query: resource.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'liaison.resource.status_changed',
          details: expect.objectContaining({ outcome: 'rejected' }),
        }),
      ]),
    );

    const publicList = await request(app).get('/api/development/v1/liaison/resources').expect(200);
    expect(publicList.body.data.map((item: { id: string }) => item.id)).not.toContain(resource.id);
    const studentList = await request(app)
      .get('/api/development/v1/liaison/resources')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(studentList.body.data.map((item: { id: string }) => item.id)).not.toContain(resource.id);

    await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set(adminHeaders)
      .send({ id: resource.id, status: 'active' })
      .expect(400);

    await request(app)
      .post(`/api/development/v1/liaison/resources/${resource.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'active' })
      .expect(200);

    expect(await store.liaisonResources.get(resource.id)).toMatchObject({ status: 'active' });
  });
});

describe('liaison problem lifecycle', () => {
  it('uses the approved transition graph', () => {
    expect(PROBLEM_TRANSITIONS).toEqual({
      draft: ['pending_review'],
      pending_review: ['open', 'rejected'],
      rejected: ['draft'],
      open: ['paused', 'closed'],
      paused: ['open', 'closed'],
      closed: ['archived'],
      archived: [],
    });
    expect(canTransition(PROBLEM_TRANSITIONS, 'open', 'paused')).toBe(true);
    expect(canTransition(PROBLEM_TRANSITIONS, 'open', 'archived')).toBe(false);
  });
});
