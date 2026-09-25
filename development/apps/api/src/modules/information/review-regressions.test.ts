import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';

function actor(scopes: string[]): AuthorizationContext {
  return {
    uid: 'scoped-maintainer',
    displayName: 'Scoped maintainer',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: scopes.map((id) => ({
      id: `announcement-${id}`,
      action: 'information.announcement.create',
      resource: 'announcement',
      effect: 'allow' as const,
      scope: { type: 'organization', id },
    })),
  };
}

describe('information review regressions', () => {
  it('fails closed when its module row is missing', async () => {
    const app = createApp({ store: createMemoryStore({ seed: false }) });
    await request(app).get('/api/development/v1/information/announcements').expect(503);
  });

  it('rechecks the transaction-time scope before moving an announcement', async () => {
    const base = createMemoryStore();
    const announcement = await base.announcements.create({
      title: 'Scoped',
      body: 'Scoped body',
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
          await base.announcements.update(announcement.id, {
            scope: { type: 'organization', id: 'org-c' },
          });
        }
        return base.transaction(operation);
      },
    };
    const scopedActor = actor(['org-a', 'org-b']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedActor },
    });
    await request(app)
      .patch('/api/development/v1/information/announcements')
      .set('X-Demo-User', scopedActor.uid)
      .send({ id: announcement.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await base.announcements.get(announcement.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-c' },
    });
  });

  it('does not reveal whether an unauthorized consultation id exists', async () => {
    const store = createMemoryStore();
    const consultation = await store.consultations.create({
      title: 'Private',
      body: 'Private body',
      requesterUid: 'another-user',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'another-user',
      scope: { type: 'user', id: 'another-user' },
    });
    const ordinary: AuthorizationContext = {
      uid: 'ordinary',
      displayName: 'Ordinary',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => ordinary },
    });
    const known = await request(app)
      .post(`/api/development/v1/information/consultations/${consultation.id}/transitions`)
      .set('X-Demo-User', ordinary.uid)
      .send({ to: 'in_progress' })
      .expect(404);
    const unknown = await request(app)
      .post('/api/development/v1/information/consultations/missing-consultation/transitions')
      .set('X-Demo-User', ordinary.uid)
      .send({ to: 'in_progress' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);
  });
});
