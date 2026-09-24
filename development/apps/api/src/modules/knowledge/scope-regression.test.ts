import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('knowledge scope mutation authorization', () => {
  it('requires write permission on both the current and target scopes', async () => {
    const store = createMemoryStore();
    const current = await store.knowledge.create({
      type: 'faq',
      title: '组织 A 经验',
      body: '不能由只有组织 B 权限的人搬移。',
      status: 'draft',
      ownerUid: 'org-a-owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const scopedUser: AuthorizationContext = {
      uid: 'scoped-maintainer',
      displayName: '组织 B 维护者',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [
        {
          id: 'knowledge-create-org-b',
          action: 'knowledge.create',
          resource: 'knowledge_entry',
          effect: 'allow',
          scope: { type: 'organization', id: 'org-b' },
        },
      ],
    };
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedUser },
    });

    const response = await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'scoped-maintainer')
      .send({ id: current.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);

    expect(response.body.data.error.code).toBe('knowledge_entry_not_found');
    expect(await store.knowledge.get(current.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-a' },
    });
  });
});
