import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const publicScope = { type: 'public', id: '*' } as const;

function adminApp() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin', 'demo-student']),
  });
  return { app, store };
}

async function createSubject(
  store: ReturnType<typeof createMemoryStore>,
  uid: string,
  status = 'active',
) {
  return store.subjects.create({
    uid,
    displayName: `Subject ${uid}`,
    avatarUrl: null,
    status,
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
}

describe('administration subjects and assignments', () => {
  it('pages and filters subject mappings and resolves an exact uid', async () => {
    const { app, store } = adminApp();
    await createSubject(store, 'main-page-alpha');
    await createSubject(store, 'main-page-beta');

    const page = await request(app)
      .get('/api/development/v1/admin/subjects')
      .query({ query: 'main-page', status: 'active', page: 1, pageSize: 1 })
      .set(adminHeaders)
      .expect(200);

    expect(page.body.data).toMatchObject({
      items: [expect.objectContaining({ uid: expect.stringMatching(/^main-page-/) })],
      page: 1,
      pageSize: 1,
      total: 2,
    });

    const exact = await request(app)
      .get('/api/development/v1/admin/subjects/main-page-alpha')
      .set(adminHeaders)
      .expect(200);
    expect(exact.body.data).toMatchObject({
      uid: 'main-page-alpha',
      displayName: 'Subject main-page-alpha',
    });

    await request(app)
      .get('/api/development/v1/admin/subjects')
      .query({ page: 0, pageSize: 101 })
      .set(adminHeaders)
      .expect(400);
    await request(app)
      .get('/api/development/v1/admin/subjects/not-present')
      .set(adminHeaders)
      .expect(404);
  });

  it('rejects role grants for missing or inactive subjects and inactive definitions', async () => {
    const { app, store } = adminApp();
    const inactiveUid = 'main-inactive-role-subject';
    await createSubject(store, inactiveUid, 'inactive');

    for (const subjectUid of ['main-missing-role-subject', inactiveUid]) {
      const response = await request(app)
        .post('/api/development/v1/admin/role-assignments')
        .set(adminHeaders)
        .send({ subjectUid, roleKey: 'department.sports_director' })
        .expect(subjectUid.includes('missing') ? 400 : 409);
      expect(response.body.data.error.code).toBe(
        subjectUid.includes('missing') ? 'subject_not_found' : 'subject_inactive',
      );
    }

    const subjectUid = 'main-inactive-role-definition';
    await createSubject(store, subjectUid);
    const role = (await store.roles.list({ query: 'department.sports_director' })).find(
      ({ key }) => key === 'department.sports_director',
    );
    if (role === undefined) throw new Error('demo role definition is missing');
    await store.roles.update(role.id, { status: 'inactive' });

    const response = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send({ subjectUid, roleKey: role.key })
      .expect(409);
    expect(response.body.data.error.code).toBe('role_definition_inactive');
    expect(await store.roleAssignments.list({ query: subjectUid })).toEqual([]);
    expect(await store.auditLogs.list({ query: 'admin.role_assignment.grant' })).toEqual([]);
  });

  it('validates scope semantics and requires a valid future expiry', async () => {
    const { app, store } = adminApp();
    const subjectUid = 'main-invalid-assignment-input';
    await createSubject(store, subjectUid);

    const invalidInputs = [
      {
        subjectUid,
        roleKey: 'department.sports_director',
        scope: { type: 'public', id: 'not-wildcard' },
      },
      {
        subjectUid,
        roleKey: 'department.sports_director',
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
      {
        subjectUid,
        roleKey: 'department.sports_director',
        expiresAt: 'not-a-date',
      },
    ];

    for (const input of invalidInputs) {
      await request(app)
        .post('/api/development/v1/admin/role-assignments')
        .set(adminHeaders)
        .send(input)
        .expect(400);
    }

    const wildcard = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send({
        subjectUid,
        roleKey: 'department.sports_director',
        scope: { type: 'department', id: '*' },
      })
      .expect(201);
    expect(wildcard.body.data.scope).toEqual({ type: 'department', id: '*' });
  });

  it('creates, pages, archives and structurally audits scoped role assignments', async () => {
    const { app, store } = adminApp();
    const subjectUid = 'main-role-lifecycle';
    await createSubject(store, subjectUid);
    const input = {
      subjectUid,
      roleKey: 'department.sports_director',
      scope: { type: 'department', id: 'sports' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };

    const granted = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(201);
    await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(409);

    const page = await request(app)
      .get('/api/development/v1/admin/role-assignments')
      .query({
        query: subjectUid,
        status: 'active',
        scopeType: 'department',
        scopeId: 'sports',
        page: 1,
        pageSize: 10,
      })
      .set(adminHeaders)
      .expect(200);
    expect(page.body.data).toMatchObject({
      items: [expect.objectContaining({ id: granted.body.data.id })],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    const revoked = await request(app)
      .delete(`/api/development/v1/admin/role-assignments/${granted.body.data.id}`)
      .set(adminHeaders)
      .expect(200);
    expect(revoked.body.data).toMatchObject({
      id: granted.body.data.id,
      status: 'inactive',
      archived: true,
    });
    expect(await store.roleAssignments.get(granted.body.data.id)).toMatchObject({
      status: 'inactive',
    });

    const restored = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send({ ...input, expiresAt: '2098-01-01T00:00:00.000Z' })
      .expect(201);
    expect(restored.body.data).toMatchObject({
      id: granted.body.data.id,
      status: 'active',
      expiresAt: '2098-01-01T00:00:00.000Z',
    });

    const audits = await store.auditLogs.list({ query: 'admin.role_assignment' });
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin.role_assignment.grant',
          details: expect.objectContaining({
            subjectUid,
            roleKey: input.roleKey,
            scope: input.scope,
            expiresAt: input.expiresAt,
            status: 'active',
          }),
        }),
        expect.objectContaining({
          action: 'admin.role_assignment.revoke',
          details: expect.objectContaining({
            subjectUid,
            roleKey: input.roleKey,
            scope: input.scope,
            previousStatus: 'active',
            status: 'inactive',
          }),
        }),
        expect.objectContaining({
          action: 'admin.role_assignment.grant',
          details: expect.objectContaining({
            subjectUid,
            roleKey: input.roleKey,
            previousStatus: 'inactive',
            status: 'active',
            restored: true,
          }),
        }),
      ]),
    );
  });

  it('validates tag subjects and definitions, then pages and archives a scoped grant', async () => {
    const { app, store } = adminApp();
    const subjectUid = 'main-tag-lifecycle';
    await createSubject(store, subjectUid);

    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-missing-tag-subject',
        tagKey: 'sports.team_captain',
        scope: { type: 'sports_team', id: 'team-basketball' },
      })
      .expect(400);

    const input = {
      subjectUid,
      tagKey: 'sports.team_captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const granted = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send(input)
      .expect(201);

    const page = await request(app)
      .get('/api/development/v1/admin/tag-assignments')
      .query({ query: subjectUid, page: 1, pageSize: 10 })
      .set(adminHeaders)
      .expect(200);
    expect(page.body.data).toMatchObject({
      items: [expect.objectContaining({ id: granted.body.data.id })],
      total: 1,
    });

    await request(app)
      .delete(`/api/development/v1/admin/tag-assignments/${granted.body.data.id}`)
      .set(adminHeaders)
      .expect(200);

    const restored = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({ ...input, expiresAt: '2098-01-01T00:00:00.000Z' })
      .expect(201);
    expect(restored.body.data).toMatchObject({
      id: granted.body.data.id,
      status: 'active',
      expiresAt: '2098-01-01T00:00:00.000Z',
    });
    expect(await store.auditLogs.list({ query: 'admin.tag_assignment.grant' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: granted.body.data.id,
          details: expect.objectContaining({
            previousStatus: 'inactive',
            status: 'active',
            restored: true,
          }),
        }),
      ]),
    );
  });
});
