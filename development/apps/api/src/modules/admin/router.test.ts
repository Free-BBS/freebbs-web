import express from 'express';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { createAdminRouter } from './router.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

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
function policyOnlyAdminApp() {
  const store = createMemoryStore();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/development/v1/admin',
    createAdminRouter({
      store,
      authenticate: async () => ({
        status: 200,
        user: {
          uid: 'policy-admin',
          displayName: 'Policy Admin',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [],
          policies: [
            {
              id: 'policy-admin-manage',
              action: 'admin.manage',
              resource: 'admin',
              effect: 'allow',
            },
          ],
        },
      }),
      version: 'test',
      dataMode: 'memory',
      getAppliedMigrationCount: async () => 0,
    }),
  );
  return app;
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

describe('administration API', () => {
  it('fails closed with 403 for an ordinary authenticated student', async () => {
    const { app } = adminApp();
    const response = await request(app)
      .get('/api/development/v1/admin/modules')
      .set('X-Demo-User', 'demo-student')
      .expect(403);

    expect(response.body).toMatchObject({
      data: { error: { code: 'forbidden' } },
      requestId: expect.any(String),
    });
  });

  it('rejects a policy-only admin.manage grant', async () => {
    const response = await request(policyOnlyAdminApp())
      .get('/api/development/v1/admin/modules')
      .expect(403);

    expect(response.body).toMatchObject({
      data: { error: { code: 'forbidden' } },
    });
  });

  it('lets a super admin disable a validated module and audits the transaction', async () => {
    const { app } = adminApp();
    const response = await request(app)
      .patch('/api/development/v1/admin/modules')
      .set(adminHeaders)
      .send({ moduleId: 'sports', enabled: false })
      .expect(200);

    expect(response.body.data).toMatchObject({ id: 'sports', status: 'disabled' });
    const modules = await request(app).get('/api/development/v1/modules').expect(200);
    expect(
      modules.body.data.find((module: { id: string }) => module.id === 'sports'),
    ).toMatchObject({
      status: 'disabled',
    });
    const audit = await request(app)
      .get('/api/development/v1/admin/audit-logs')
      .set(adminHeaders)
      .expect(200);
    expect(audit.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUid: 'demo-admin',
          action: 'admin.module.update',
          resourceId: 'sports',
        }),
      ]),
    );

    await request(app)
      .patch('/api/development/v1/admin/modules')
      .set(adminHeaders)
      .send({ moduleId: 'not-a-module', enabled: true })
      .expect(400);
  });

  it('grants and revokes only known roles and writes an audit record for each mutation', async () => {
    const { app, store } = adminApp();
    await createActiveSubject(store, 'main-uid-42');
    await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send({ subjectUid: 'main-uid-42', roleKey: 'totally.unknown' })
      .expect(400);

    const granted = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        roleKey: 'department.sports_director',
        expiresAt: null,
      })
      .expect(201);
    expect(granted.body.data).toMatchObject({
      subjectUid: 'main-uid-42',
      roleKey: 'department.sports_director',
      status: 'active',
    });
    const listed = await request(app)
      .get('/api/development/v1/admin/role-assignments')
      .set(adminHeaders)
      .expect(200);
    expect(listed.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: granted.body.data.id, subjectUid: 'main-uid-42' }),
      ]),
    );

    await request(app)
      .delete(`/api/development/v1/admin/role-assignments/${granted.body.data.id}`)
      .set(adminHeaders)
      .send({ assignmentId: 'must-not-override-the-route' })
      .expect(200);
    const audit = await request(app)
      .get('/api/development/v1/admin/audit-logs')
      .set(adminHeaders)
      .expect(200);
    expect(
      audit.body.data.items.filter(
        (entry: { resourceType: string }) => entry.resourceType === 'role_assignment',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'admin.role_assignment.grant' }),
        expect.objectContaining({ action: 'admin.role_assignment.revoke' }),
      ]),
    );
  });

  it('validates captain scope, supports scoped tag grants and audits grant and revoke', async () => {
    const { app, store } = adminApp();
    await createActiveSubject(store, 'main-uid-42');
    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({ subjectUid: 'main-uid-42', tagKey: 'sports.team_captain' })
      .expect(400);
    await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'sports.team_captain',
        scope: { type: 'club', id: 'team-basketball' },
      })
      .expect(400);

    const granted = await request(app)
      .post('/api/development/v1/admin/tag-assignments')
      .set(adminHeaders)
      .send({
        subjectUid: 'main-uid-42',
        tagKey: 'sports.team_captain',
        scope: { type: 'sports_team', id: 'team-basketball' },
        expiresAt: null,
      })
      .expect(201);
    expect(granted.body.data).toMatchObject({
      subjectUid: 'main-uid-42',
      tagKey: 'sports.team_captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    });
    await request(app)
      .delete(`/api/development/v1/admin/tag-assignments/${granted.body.data.id}`)
      .set(adminHeaders)
      .expect(200);

    const audit = await request(app)
      .get('/api/development/v1/admin/audit-logs')
      .set(adminHeaders)
      .expect(200);
    expect(
      audit.body.data.items.filter(
        (entry: { resourceType: string }) => entry.resourceType === 'tag_assignment',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'admin.tag_assignment.grant' }),
        expect.objectContaining({ action: 'admin.tag_assignment.revoke' }),
      ]),
    );
  });
});
