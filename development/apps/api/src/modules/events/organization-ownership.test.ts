import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { setOrganizationMembership } from '../admin/organization-membership-service.js';

describe('organization-owned activities', () => {
  it('keeps maintenance within the actor organization and draft ownership', async () => {
    const store = createMemoryStore();
    for (const uid of ['sports-director', 'arts-director', 'sports-member']) {
      await store.subjects.create({
        uid,
        displayName: uid,
        avatarUrl: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'public', id: '*' },
      });
    }
    await setOrganizationMembership(
      store,
      { subjectUid: 'sports-director', organizationId: 'sports_center', level: 'director' },
      { actorUid: 'demo-admin' },
    );
    await setOrganizationMembership(
      store,
      { subjectUid: 'arts-director', organizationId: 'arts_center', level: 'director' },
      { actorUid: 'demo-admin' },
    );
    await setOrganizationMembership(
      store,
      { subjectUid: 'sports-member', organizationId: 'sports_center', level: 'member' },
      { actorUid: 'demo-admin' },
    );
    const users = new Set(['sports-director', 'arts-director', 'sports-member']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: {
        introspect: async (uid): Promise<UserContext | null> =>
          users.has(uid)
            ? {
                uid,
                displayName: uid,
                avatarUrl: null,
                baseRole: 'student',
                roles: [],
                tags: [],
              }
            : null,
      },
    });

    const created = await request(app)
      .post('/api/development/v1/events/activities')
      .set('X-Demo-User', 'sports-member')
      .send({
        title: '体育中心训练日',
        description: '面向全院的公开训练活动。',
        organizationId: 'sports_center',
        location: '综体',
      })
      .expect(201);
    expect(created.body.data.organizationId).toBe('sports_center');

    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', 'sports-member')
      .send({ id: created.body.data.id, description: '部员完善草稿介绍。' })
      .expect(200);
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', 'sports-director')
      .send({ id: created.body.data.id, location: '东操' })
      .expect(200);
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', 'arts-director')
      .send({ id: created.body.data.id, location: '越权地点' })
      .expect(404);
    await request(app)
      .post(`/api/development/v1/events/activities/${created.body.data.id}/transitions`)
      .set('X-Demo-User', 'sports-member')
      .send({ to: 'pending' })
      .expect(200);
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', 'sports-member')
      .send({ id: created.body.data.id, location: '审核中越权修改' })
      .expect(404);
  });
});
