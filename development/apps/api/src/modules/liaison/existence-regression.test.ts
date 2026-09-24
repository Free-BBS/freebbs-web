import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('liaison protected existence', () => {
  it('authorizes the current scope before validating a target mutation', async () => {
    const store = createMemoryStore();
    const existing = await store.liaisonResources.create({
      name: 'Restricted',
      description: 'Sensitive',
      category: 'contact',
      visibility: 'restricted',
      status: 'active',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const actor: AuthorizationContext = {
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
      authClient: { introspect: async () => actor },
    });

    const known = await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set('X-Demo-User', actor.uid)
      .send({ id: existing.id, visibility: 'public' })
      .expect(404);
    const unknown = await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set('X-Demo-User', actor.uid)
      .send({ id: 'missing-resource', visibility: 'public' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);
  });
});
