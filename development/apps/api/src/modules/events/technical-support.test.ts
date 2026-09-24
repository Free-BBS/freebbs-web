import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

function actor(uid: string): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
  };
}

describe('activity technical support', () => {
  it('separates support requesting, confirmation, and approval permissions', async () => {
    const store = createMemoryStore();
    const activity = await store.activities.create({
      title: 'Scoped support',
      description: 'Needs technical support.',
      clubId: null,
      startsAt: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'pending',
      ownerUid: 'creator',
      scope: { type: 'organization', id: 'org-a' },
    });
    const actors = { updater: actor('updater'), support: actor('support') };
    for (const current of Object.values(actors)) {
      await store.subjects.create({
        uid: current.uid,
        displayName: current.displayName,
        avatarUrl: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'public', id: '*' },
      });
    }
    await store.roleAssignments.create({
      subjectUid: actors.updater.uid,
      roleKey: 'department.sports_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'org-a' },
    });
    await store.roleAssignments.create({
      subjectUid: actors.support.uid,
      roleKey: 'affiliation.sast_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'org-a' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: {
        introspect: async (token: string) =>
          token === 'updater' ? actors.updater : actors.support,
      },
    });
    const path = `/api/development/v1/events/activities/${activity.id}`;

    const invalid = await request(app)
      .patch(`${path}/technical-support`)
      .set('X-Demo-User', 'support')
      .send({ to: 'confirmed' })
      .expect(409);
    expect(invalid.body.data.error.code).toBe('invalid_state_transition');

    await request(app)
      .patch(`${path}/technical-support`)
      .set('X-Demo-User', 'updater')
      .send({ to: 'requested', note: 'Projector needed.' })
      .expect(200);
    await request(app)
      .patch(`${path}/technical-support`)
      .set('X-Demo-User', 'support')
      .send({ to: 'confirmed', note: 'Projector reserved.' })
      .expect(200);

    await request(app)
      .post(`${path}/transitions`)
      .set('X-Demo-User', 'support')
      .send({ to: 'approved' })
      .expect(404);
    expect(await store.activities.get(activity.id)).toMatchObject({
      status: 'pending',
      technicalSupportStatus: 'confirmed',
      technicalSupportNote: 'Projector reserved.',
    });
    expect(await store.auditLogs.list({ query: activity.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'events.technical_support.status_changed',
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
