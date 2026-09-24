import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('liaison scope mutation authorization', () => {
  it('requires update permission on both the current and target scopes', async () => {
    const store = createMemoryStore();
    const current = await store.liaisonResources.create({
      name: '组织 A 资源',
      description: '不能由只有组织 B 权限的人搬移。',
      category: 'contact',
      visibility: 'restricted',
      status: 'active',
      ownerUid: 'org-a-owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const scopedUser: AuthorizationContext = {
      uid: 'scoped-maintainer',
      displayName: '组织 A 维护者',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    await store.subjects.create({
      uid: scopedUser.uid,
      displayName: scopedUser.displayName,
      avatarUrl: scopedUser.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    for (const roleKey of ['department.liaison_member', 'department.liaison_director'] as const) {
      await store.roleAssignments.create({
        subjectUid: scopedUser.uid,
        roleKey,
        expiresAt: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'organization', id: 'org-a' },
      });
    }
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedUser },
    });

    await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set('X-Demo-User', 'scoped-maintainer')
      .send({ id: current.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await store.liaisonResources.get(current.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-a' },
    });
  });
  it('returns the union of actual scopes and exposes archived records only to scoped maintainers', async () => {
    const store = createMemoryStore();
    const active = await store.liaisonResources.create({
      name: 'Organization A active resource',
      description: 'Visible to the organization A reader.',
      category: 'contact',
      visibility: 'organization',
      status: 'active',
      ownerUid: 'org-a-owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const archived = await store.liaisonResources.create({
      name: 'Organization A archived resource',
      description: 'Visible only because the reader can maintain this exact scope.',
      category: 'contact',
      visibility: 'organization',
      status: 'archived',
      ownerUid: 'org-a-owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const otherScope = await store.liaisonResources.create({
      name: 'Organization B resource',
      description: 'Must remain outside the scoped union.',
      category: 'contact',
      visibility: 'organization',
      status: 'active',
      ownerUid: 'org-b-owner',
      scope: { type: 'organization', id: 'org-b' },
    });
    const scopedUser: AuthorizationContext = {
      uid: 'org-a-maintainer',
      displayName: 'Organization A maintainer',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    await store.subjects.create({
      uid: scopedUser.uid,
      displayName: scopedUser.displayName,
      avatarUrl: scopedUser.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    for (const roleKey of ['department.liaison_member', 'department.liaison_director'] as const) {
      await store.roleAssignments.create({
        subjectUid: scopedUser.uid,
        roleKey,
        expiresAt: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'organization', id: 'org-a' },
      });
    }
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedUser },
    });

    const response = await request(app)
      .get('/api/development/v1/liaison/resources?visibility=organization')
      .set('X-Demo-User', scopedUser.uid)
      .expect(200);
    const ids = response.body.data.map((record: { id: string }) => record.id);
    expect(ids).toEqual(expect.arrayContaining([active.id, archived.id]));
    expect(ids).not.toContain(otherScope.id);
  });
});
