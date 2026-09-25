import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const support = { 'X-Demo-User': 'support-only' };

describe('club technical support', () => {
  it('grants only the support state machine and audits rejected attempts', async () => {
    const store = createMemoryStore();
    await store.subjects.create({
      uid: 'support-only',
      displayName: 'Support only',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: 'support-only',
      roleKey: 'affiliation.sast_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: {
        introspect: async () => ({
          uid: 'support-only',
          displayName: 'Support only',
          avatarUrl: null,
          baseRole: 'student' as const,
          roles: [],
          tags: [],
        }),
      },
    });
    const path = '/api/development/v1/clubs/club-running/technical-support';

    const rejected = await request(app)
      .patch(path)
      .set(support)
      .send({ status: 'confirmed' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    await request(app)
      .patch(path)
      .set(support)
      .send({ status: 'requested', note: '需要直播设备' })
      .expect(200);
    const confirmed = await request(app)
      .patch(path)
      .set(support)
      .send({ status: 'confirmed' })
      .expect(200);
    expect(confirmed.body.data).toMatchObject({
      technicalSupportStatus: 'confirmed',
      technicalSupportNote: '需要直播设备',
    });

    await request(app)
      .patch('/api/development/v1/clubs')
      .set(support)
      .send({ id: 'club-running', name: 'Forbidden' })
      .expect(404);
    await request(app)
      .patch('/api/development/v1/clubs/club-running/memberships/membership-running')
      .set(support)
      .send({ status: 'rejected' })
      .expect(404);
    expect(await store.auditLogs.list({ query: 'club-running' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'clubs.technical_support.status_changed',
          details: expect.objectContaining({
            from: 'not_requested',
            to: 'confirmed',
            outcome: 'rejected',
          }),
        }),
      ]),
    );
  });
});
