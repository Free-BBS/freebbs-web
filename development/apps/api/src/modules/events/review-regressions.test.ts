import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';

function scopedActor(scopeIds: string[]): AuthorizationContext {
  return {
    uid: 'event-maintainer',
    displayName: 'Event maintainer',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: scopeIds.map((id) => ({
      id: `event-${id}`,
      action: 'events.update',
      resource: 'activity',
      effect: 'allow' as const,
      scope: { type: 'organization', id },
    })),
  };
}

describe('events security regressions', () => {
  it('lets a sports domain manager update an activity', async () => {
    const store = createMemoryStore();
    const actor: AuthorizationContext = {
      uid: 'sports-lead',
      displayName: 'Sports lead',
      avatarUrl: null,
      baseRole: 'student',
      roles: ['domain.sports_lead'],
      tags: [],
    };
    await store.subjects.create({
      uid: actor.uid,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'domain.sports_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', actor.uid)
      .send({ id: 'activity-night-run', description: 'Domain-maintained activity.' })
      .expect(200);
  });

  it('uses the transaction-time activity scope for update authorization', async () => {
    const base = createMemoryStore();
    const activity = await base.activities.create({
      title: 'Scoped activity',
      description: 'Original',
      clubId: null,
      startsAt: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'draft',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    let raced = false;
    const store: DevelopmentStore = {
      ...base,
      transaction: async (operation) => {
        if (!raced) {
          raced = true;
          await base.activities.update(activity.id, {
            scope: { type: 'organization', id: 'org-c' },
          });
        }
        return base.transaction(operation);
      },
    };
    const actor = scopedActor(['org-a', 'org-b']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });

    await request(app)
      .patch('/api/development/v1/events/activities')
      .set('X-Demo-User', actor.uid)
      .send({ id: activity.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await base.activities.get(activity.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-c' },
    });
  });

  it('lets a scoped create-only owner edit, revise, and resubmit', async () => {
    const store = createMemoryStore();
    const creator: AuthorizationContext = {
      uid: 'sports-member',
      displayName: 'Sports member',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    await store.subjects.create({
      uid: creator.uid,
      displayName: creator.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: creator.uid,
      roleKey: 'department.sports_member',
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
          token === creator.uid
            ? creator
            : {
                uid: 'demo-admin',
                displayName: 'Admin',
                avatarUrl: null,
                baseRole: 'student' as const,
                roles: [],
                tags: [],
              },
      },
    });
    const creatorHeader = { 'X-Demo-User': creator.uid };
    const created = await request(app)
      .post('/api/development/v1/events/activities')
      .set(creatorHeader)
      .send({
        title: 'Creator workflow',
        description: 'Draft',
        scope: { type: 'organization', id: 'org-a' },
      })
      .expect(201);
    const id = created.body.data.id as string;

    const visible = await request(app)
      .get('/api/development/v1/events/activities')
      .set(creatorHeader)
      .expect(200);
    expect(visible.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set(creatorHeader)
      .send({ id, description: 'Revised by creator' })
      .expect(200);
    await request(app)
      .patch(`/api/development/v1/events/activities/${id}/technical-support`)
      .set(creatorHeader)
      .send({ to: 'requested' })
      .expect(404);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set(creatorHeader)
      .send({ to: 'pending' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set('X-Demo-User', 'demo-admin')
      .send({ to: 'rejected' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set(creatorHeader)
      .send({ to: 'draft' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set(creatorHeader)
      .send({ to: 'pending' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set('X-Demo-User', 'demo-admin')
      .send({ to: 'approved' })
      .expect(200);
    await request(app)
      .patch('/api/development/v1/events/activities')
      .set(creatorHeader)
      .send({ id, description: 'Post-approval edit' })
      .expect(404);
    await request(app)
      .post(`/api/development/v1/events/activities/${id}/transitions`)
      .set(creatorHeader)
      .send({ to: 'published' })
      .expect(404);
  });

  it('allows a personal cancellation after the activity closes and rejects spoofed creation fields', async () => {
    const store = createMemoryStore();
    const actor: AuthorizationContext = {
      uid: 'demo-student',
      displayName: 'Student',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });
    await store.activities.update('activity-orientation', { status: 'finished' });
    await request(app)
      .delete('/api/development/v1/events/activities/activity-orientation/registrations')
      .set('X-Demo-User', actor.uid)
      .expect(204);

    await request(app)
      .post('/api/development/v1/events/activities')
      .set('X-Demo-User', actor.uid)
      .send({
        title: 'Spoofed activity',
        description: 'Client identity must be rejected.',
        ownerUid: actor.uid,
        scope: { type: 'public', id: '*' },
      })
      .expect(400);
  });
});
