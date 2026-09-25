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

function expectConflict(response: { body: unknown }) {
  expect(response.body).toEqual({
    data: { error: { code: 'conflict', message: 'Assignment already exists' } },
    requestId: expect.any(String),
  });
}

describe('administration assignment conflicts', () => {
  it('returns a stable 409 and a single audit entry for duplicate role grants', async () => {
    const { app, store } = adminApp();
    const input = {
      subjectUid: 'main-uid-duplicate-role',
      roleKey: 'department.sports_director',
      scope: { type: 'department', id: 'sports' },
    };

    await createActiveSubject(store, input.subjectUid);

    await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(201);
    const duplicate = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(409);

    expectConflict(duplicate);
    expect(await store.roleAssignments.list({ query: input.subjectUid })).toHaveLength(1);
    expect(
      (await store.auditLogs.list({ query: 'admin.role_assignment.grant' })).filter(
        ({ resourceType }) => resourceType === 'role_assignment',
      ),
    ).toHaveLength(1);
  });

  it('returns a stable 409 and a single audit entry for duplicate tag grants', async () => {
    const { app, store } = adminApp();
    const input = {
      subjectUid: 'main-uid-duplicate-tag',
      tagKey: 'sports.team_captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    };

    await createActiveSubject(store, input.subjectUid);

    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(201);
    const duplicate = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(409);

    expectConflict(duplicate);
    expect(await store.tagAssignments.list({ query: input.subjectUid })).toHaveLength(1);
    expect(
      (await store.auditLogs.list({ query: 'admin.tag_assignment.grant' })).filter(
        ({ resourceType }) => resourceType === 'tag_assignment',
      ),
    ).toHaveLength(1);
  });
});
