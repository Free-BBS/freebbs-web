import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

async function setup() {
  const store = createMemoryStore();
  await store.subjects.create({
    uid: 'organization-user',
    displayName: '组织成员',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  return {
    store,
    app: createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    }),
  };
}

describe('organization membership administration', () => {
  it('sets and revokes one organization membership through the admin API', async () => {
    const { app, store } = await setup();

    const created = await request(app)
      .post('/api/development/v1/admin/organization-memberships')
      .set(adminHeaders)
      .send({
        subjectUid: 'organization-user',
        organizationId: 'rights_development_center',
        level: 'director',
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      subjectUid: 'organization-user',
      organizationId: 'rights_development_center',
      level: 'director',
      role: { roleKey: 'department.rights_development_director', status: 'active' },
      tag: { tagKey: 'social_org.rights_development_center', status: 'active' },
    });

    await request(app)
      .delete(
        '/api/development/v1/admin/organization-memberships/organization-user/rights_development_center',
      )
      .set(adminHeaders)
      .expect(204);

    expect(
      (await store.roleAssignments.list({ query: 'organization-user' })).filter(
        ({ status }) => status === 'active',
      ),
    ).toHaveLength(0);
    expect(
      (await store.tagAssignments.list({ query: 'organization-user' })).filter(
        ({ status }) => status === 'active',
      ),
    ).toHaveLength(0);
  });

  it('rejects unknown organization identifiers', async () => {
    const { app } = await setup();
    await request(app)
      .post('/api/development/v1/admin/organization-memberships')
      .set(adminHeaders)
      .send({
        subjectUid: 'organization-user',
        organizationId: 'unknown',
        level: 'member',
      })
      .expect(400);
  });
});
