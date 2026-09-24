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
describe('administration review regressions', () => {
  it('rejects unknown and disabled tag definitions without writing assignments or audits', async () => {
    const { app, store } = adminApp();
    await createActiveSubject(store, 'main-uid-42');

    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'extension.not_registered',
        scope: { type: 'public', id: '*' },
      })
      .expect(400);

    const extension = (await store.tagDefinitions.list({ query: 'extension.custom' })).find(
      ({ key }) => key === 'extension.custom',
    );
    if (extension === undefined) throw new Error('demo extension tag definition is missing');
    await store.tagDefinitions.update(extension.id, { status: 'disabled' });
    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'extension.custom',
        scope: { type: 'public', id: '*' },
      })
      .expect(409);

    expect(await store.tagAssignments.list({ query: 'main-uid-42' })).toEqual([]);
    expect(await store.auditLogs.list({ query: 'admin.tag_assignment.grant' })).toEqual([]);
  });

  it('validates extension tag scopes from their active registered definitions', async () => {
    const { app, store } = adminApp();
    await createActiveSubject(store, 'main-uid-42');
    await store.tagDefinitions.create({
      key: 'clubs.coordinator',
      name: 'Club coordinator',
      description: 'Applies only to the selected club.',
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'], maintainedBy: 'community-team' },
      status: 'active',
      ownerUid: 'community-team',
      scope: { type: 'public', id: '*' },
    });

    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'clubs.coordinator',
        scope: { type: 'sports_team', id: 'team-basketball' },
      })
      .expect(400);

    const granted = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'clubs.coordinator',
        scope: { type: 'club', id: 'club-music' },
      })
      .expect(201);
    expect(granted.body.data).toMatchObject({
      tagKey: 'clubs.coordinator',
      scope: { type: 'club', id: 'club-music' },
    });
  });
});
