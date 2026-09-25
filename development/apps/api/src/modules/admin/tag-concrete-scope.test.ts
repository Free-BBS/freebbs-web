import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

function adminApp() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
  });
  return { app, store };
}

async function createActiveSubject(
  store: ReturnType<typeof createMemoryStore>,
  uid: string,
): Promise<void> {
  await store.subjects.create({
    uid,
    displayName: uid,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
}
async function expectNoGrant(
  store: ReturnType<typeof createMemoryStore>,
  subjectUid: string,
): Promise<void> {
  expect(await store.tagAssignments.list({ query: subjectUid })).toEqual([]);
  expect(await store.auditLogs.list({ query: 'admin.tag_assignment.grant' })).toEqual([]);
}

describe('tag assignment concrete scopes', () => {
  it('rejects a wildcard sports team for the registered captain tag', async () => {
    const { app, store } = adminApp();
    const subjectUid = 'main-uid-wildcard-captain';
    await createActiveSubject(store, subjectUid);

    const response = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid,
        tagKey: 'sports.team_captain',
        scope: { type: 'sports_team', id: '*' },
      })
      .expect(400);

    expect(response.body.data.error).toEqual({
      code: 'invalid_tag_scope',
      message: 'Tag scope does not match its definition',
    });
    await expectNoGrant(store, subjectUid);
  });

  it('rejects a wildcard identifier for any tag with a required scope type', async () => {
    const { app, store } = adminApp();
    const subjectUid = 'main-uid-wildcard-club';
    await createActiveSubject(store, subjectUid);
    await store.tagDefinitions.create({
      key: 'clubs.coordinator',
      name: 'Club coordinator',
      description: 'Applies only to one selected club.',
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'] },
      status: 'active',
      ownerUid: 'community-team',
      scope: { type: 'public', id: '*' },
    });

    const response = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid,
        tagKey: 'clubs.coordinator',
        scope: { type: 'club', id: '*' },
      })
      .expect(400);

    expect(response.body.data.error).toEqual({
      code: 'invalid_tag_scope',
      message: 'Tag scope does not match its definition',
    });
    await expectNoGrant(store, subjectUid);
  });

  it('still permits public wildcard scope for a tag without a required scope type', async () => {
    const { app, store } = adminApp();
    await createActiveSubject(store, 'main-uid-global-extension');

    const response = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-global-extension',
        tagKey: 'extension.custom',
        scope: { type: 'public', id: '*' },
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      tagKey: 'extension.custom',
      scope: { type: 'public', id: '*' },
    });
  });
});
