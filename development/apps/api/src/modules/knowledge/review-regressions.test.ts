import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';

function scopedActor(scopes: string[]): AuthorizationContext {
  return {
    uid: 'scoped-maintainer',
    displayName: 'Scoped maintainer',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: scopes.map((id) => ({
      id: `knowledge-${id}`,
      action: 'knowledge.create',
      resource: 'knowledge_entry',
      effect: 'allow' as const,
      scope: { type: 'organization', id },
    })),
  };
}

describe('knowledge review regressions', () => {
  it('fails closed when its module row is missing', async () => {
    const app = createApp({ store: createMemoryStore({ seed: false }) });
    await request(app).get('/api/development/v1/knowledge/entries').expect(503);
  });

  it('rechecks the transaction-time scope before moving an entry', async () => {
    const base = createMemoryStore();
    const entry = await base.knowledge.create({
      type: 'faq',
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
          await base.knowledge.update(entry.id, { scope: { type: 'organization', id: 'org-c' } });
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
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', actor.uid)
      .send({ id: entry.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await base.knowledge.get(entry.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-c' },
    });
  });

  it('does not reveal whether an unauthorized entry id exists', async () => {
    const store = createMemoryStore();
    const entry = await store.knowledge.create({
      type: 'faq',
      title: 'Private',
      body: 'Private body',
      status: 'draft',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const actor = scopedActor(['org-b']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });
    const known = await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', actor.uid)
      .send({ id: entry.id, title: 'No' })
      .expect(404);
    const unknown = await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', actor.uid)
      .send({ id: 'missing-entry', title: 'No' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);
  });
});
