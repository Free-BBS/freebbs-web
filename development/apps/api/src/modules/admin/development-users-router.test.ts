import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

async function batchFixture(allowedUids: string[] = []) {
  const store = createMemoryStore();
  const users = ['lead', 'ordinary', 'admin', 'first', 'second', 'alias', 'allowed'].map(
    (name, index) => ({
      uid: `batch_${name}`,
      username: `Batch${name}`,
      displayName: name,
      studentId: `batch_student_${index}`,
      avatarUrl: null,
    }),
  );
  for (const name of ['lead', 'ordinary', 'admin']) {
    const user = users.find((candidate) => candidate.displayName === name)!;
    await store.developmentAccess.create({
      subjectUid: user.uid,
      studentId: user.studentId,
      username: user.username,
      accessLevel: name === 'lead' ? 'lead' : 'member',
      status: 'active',
      ownerUid: 'batch_lead',
      scope: { type: 'public', id: '*' },
    });
  }
  await store.subjects.create({
    uid: 'batch_admin',
    displayName: 'admin',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'batch_lead',
    scope: { type: 'public', id: '*' },
  });
  await store.roleAssignments.create({
    subjectUid: 'batch_admin',
    roleKey: 'platform.admin',
    expiresAt: null,
    status: 'active',
    ownerUid: 'batch_lead',
    scope: { type: 'public', id: '*' },
  });
  const app = createApp({
    store,
    authMode: 'main',
    previewAllowedUids: allowedUids,
    authClient: {
      introspect: async (token) => {
        const user = users.find((candidate) => candidate.displayName === token);
        return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
      },
    },
    userDirectory: {
      list: async () => users,
      get: async (uid) =>
        uid === 'wrong_uid'
          ? users[3]!
          : (users.find((candidate) => candidate.uid === uid) ?? null),
    },
  });
  await request(app).get('/api/development/v1/me').set('Authorization', 'Bearer lead').expect(200);
  return { store, users, app };
}

describe('batch development admission', () => {
  const endpoint = '/api/development/v1/admin/development-users/batch-allow';
  it('allows selected users atomically without business roles and is idempotent', async () => {
    const { app, store } = await batchFixture();
    const rolesBefore = await store.roleAssignments.list();
    const result = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first', 'batch_second'] })
      .expect(200);
    expect(result.body.data).toMatchObject({
      changedCount: 2,
      unchangedCount: 0,
      items: [
        { uid: 'batch_first', accessLevel: 'member' },
        { uid: 'batch_second', accessLevel: 'member' },
      ],
    });
    expect(await store.roleAssignments.list()).toEqual(rolesBefore);
    expect(
      await store.tagAssignments.list({ subjectUids: ['batch_first', 'batch_second'] }),
    ).toEqual([]);
    const access = await store.developmentAccess.list();
    const audit = await store.auditLogs.list();
    expect(audit.filter((row) => row.action === 'admin.development_access.update')).toHaveLength(2);
    expect(
      audit.filter((row) => row.action === 'admin.development_access.batch_allow'),
    ).toHaveLength(1);
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first', 'batch_second'] })
      .expect(200);
    expect(await store.developmentAccess.list()).toEqual(access);
    expect(await store.auditLogs.list()).toEqual(audit);
  });
  it.each(['ordinary', 'admin'])('denies %s users', async (token) => {
    const { app, store } = await batchFixture();
    const before = await store.developmentAccess.list();
    await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${token}`)
      .send({ uids: ['batch_first'] })
      .expect(403);
    expect(await store.developmentAccess.list()).toEqual(before);
  });
  it('preserves every matching lead alias and configured UID admission without changing grants', async () => {
    const { app, store, users } = await batchFixture(['batch_allowed']);
    const alias = users.find((user) => user.uid === 'batch_alias')!;
    for (const record of [
      {
        subjectUid: alias.uid,
        studentId: alias.studentId,
        username: alias.username,
        accessLevel: 'member' as const,
      },
      {
        subjectUid: null,
        studentId: null,
        username: alias.username.toUpperCase(),
        accessLevel: 'lead' as const,
      },
    ])
      await store.developmentAccess.create({
        ...record,
        status: 'active',
        ownerUid: 'batch_lead',
        scope: { type: 'public', id: '*' },
      });
    const before = await store.developmentAccess.list();
    const roles = await store.roleAssignments.list();
    const result = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_lead', 'batch_alias', 'batch_allowed'] })
      .expect(200);
    expect(result.body.data).toMatchObject({
      changedCount: 0,
      unchangedCount: 3,
      items: [
        { uid: 'batch_lead', accessLevel: 'lead' },
        { uid: 'batch_alias', accessLevel: 'lead' },
        { uid: 'batch_allowed', accessLevel: 'member' },
      ],
    });
    expect(await store.developmentAccess.list()).toEqual(before);
    expect(await store.roleAssignments.list()).toEqual(roles);
  });
  it.each(
    [
      [],
      ['batch_first', 'batch_first'],
      Array.from({ length: 101 }, (_, i) => `u_${i}`),
      [' '],
    ].map((uids) => ({ uids })),
  )('rejects invalid selection $uids', async ({ uids }) => {
    const { app, store } = await batchFixture();
    const before = await store.developmentAccess.list();
    const audit = await store.auditLogs.list();
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids })
      .expect(400);
    expect(await store.developmentAccess.list()).toEqual(before);
    expect(await store.auditLogs.list()).toEqual(audit);
  });
  it('validates all targets before mutations and rolls back identity conflicts', async () => {
    const { app, store, users } = await batchFixture();
    const second = users.find((user) => user.uid === 'batch_second')!;
    await store.developmentAccess.create({
      subjectUid: 'another_uid',
      studentId: second.studentId,
      username: second.username,
      accessLevel: 'member',
      status: 'active',
      ownerUid: 'batch_lead',
      scope: { type: 'public', id: '*' },
    });
    const before = await store.developmentAccess.list();
    const subjects = await store.subjects.list();
    const audit = await store.auditLogs.list();
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first', 'missing'] })
      .expect(404);
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first', 'wrong_uid'] })
      .expect(404);
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first', 'batch_second'] })
      .expect(409);
    expect(await store.developmentAccess.list()).toEqual(before);
    expect(await store.subjects.list()).toEqual(subjects);
    expect(await store.auditLogs.list()).toEqual(audit);
  });
  it('rejects extra fields that could request lead or business administrator grants', async () => {
    const { app, store } = await batchFixture();
    const before = await store.developmentAccess.list();
    const audit = await store.auditLogs.list();
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .send({ uids: ['batch_first'], accessLevel: 'lead', roles: ['platform.admin'] })
      .expect(400);
    expect(await store.developmentAccess.list()).toEqual(before);
    expect(await store.auditLogs.list()).toEqual(audit);
  });
  it('rejects batch writes during identity preview', async () => {
    const { app, store } = await batchFixture();
    const before = await store.developmentAccess.list();
    await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer lead')
      .set('x-development-preview-uid', 'batch_ordinary')
      .send({ uids: ['batch_first'] })
      .expect(403);
    expect(await store.developmentAccess.list()).toEqual(before);
  });
});

describe('development access administration', () => {
  it('lets a main-site administrator configure the first development lead and then closes fallback access', async () => {
    const store = createMemoryStore({ seed: false });
    const users = [
      {
        uid: 'u_main_admin',
        username: 'MainAdmin',
        displayName: 'Main administrator',
        studentId: '2023000001',
        avatarUrl: null,
      },
      {
        uid: 'u_development_lead',
        username: 'DevelopmentLead',
        displayName: 'Development lead',
        studentId: '2023000002',
        avatarUrl: null,
      },
    ];
    const app = createApp({
      store,
      authMode: 'main',
      authClient: {
        introspect: async (token) => {
          const user = users.find((candidate) =>
            token === 'main-admin'
              ? candidate.uid === 'u_main_admin'
              : token === 'development-lead'
                ? candidate.uid === 'u_development_lead'
                : false,
          );
          return user
            ? {
                ...user,
                baseRole: 'student',
                roles: [],
                tags: [],
                mainSiteAdmin: user.uid === 'u_main_admin',
              }
            : null;
        },
      },
      userDirectory: {
        list: async () => users,
        get: async (uid) => users.find((candidate) => candidate.uid === uid) ?? null,
      },
    });

    await request(app)
      .put('/api/development/v1/admin/development-users/u_development_lead')
      .set('Authorization', 'Bearer main-admin')
      .send({ accessLevel: 'lead' })
      .expect(200);

    await request(app)
      .get('/api/development/v1/me')
      .set('Authorization', 'Bearer main-admin')
      .expect(403);
    const lead = await request(app)
      .get('/api/development/v1/me')
      .set('Authorization', 'Bearer development-lead')
      .expect(200);
    expect(lead.body.data).toMatchObject({
      uid: 'u_development_lead',
      roles: ['platform.super_admin'],
      developmentAccess: 'lead',
    });
  });

  it('lists main-site users and assigns access without granting business identities', async () => {
    const store = createMemoryStore();
    await store.developmentAccess.create({
      subjectUid: 'u_lead',
      studentId: '2023010567',
      username: 'Yuchong',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'system',
      scope: { type: 'public', id: '*' },
    });
    const users = [
      {
        uid: 'u_lead',
        username: 'Yuchong',
        displayName: 'Yuchong',
        studentId: '2023010567',
        avatarUrl: null,
      },
      {
        uid: 'u_target',
        username: 'Target',
        displayName: 'Target',
        studentId: '2023000002',
        avatarUrl: null,
      },
    ];
    const app = createApp({
      store,
      authMode: 'main',
      authClient: {
        introspect: async (token) => {
          const user = users.find(
            (candidate) => candidate.uid === (token === 'lead' ? 'u_lead' : ''),
          );
          return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
        },
      },
      userDirectory: {
        list: async () => users,
        get: async (uid) => users.find((candidate) => candidate.uid === uid) ?? null,
      },
    });

    const directory = await request(app)
      .get('/api/development/v1/admin/development-users')
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(directory.body.data).toHaveLength(2);
    const paged = await request(app)
      .get('/api/development/v1/admin/development-users?page=1&pageSize=1&admission=lead')
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(paged.body.data).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      items: [expect.objectContaining({ uid: 'u_lead', accessLevel: 'lead' })],
    });
    const unadmitted = await request(app)
      .get('/api/development/v1/admin/development-users?page=1&pageSize=1&admission=not_admitted')
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(unadmitted.body.data).toMatchObject({
      total: 1,
      items: [expect.objectContaining({ uid: 'u_target' })],
    });

    await request(app)
      .put('/api/development/v1/admin/development-users/u_target')
      .set('Authorization', 'Bearer lead')
      .send({
        accessLevel: 'member',
      })
      .expect(200);

    expect(await store.developmentAccess.list({ query: 'u_target' })).toEqual([
      expect.objectContaining({ subjectUid: 'u_target', accessLevel: 'member', status: 'active' }),
    ]);
    expect(await store.roleAssignments.list({ query: 'u_target' })).toEqual([]);
    expect(await store.tagAssignments.list({ query: 'u_target' })).toEqual([]);

    await request(app)
      .put('/api/development/v1/admin/development-users/u_target')
      .set('Authorization', 'Bearer lead')
      .send({
        accessLevel: 'member',
        roles: ['domain.arts_lead', 'department.arts_member'],
        captainTeamIds: [],
      })
      .expect(400);

    await request(app)
      .put('/api/development/v1/admin/development-users/u_target')
      .set('Authorization', 'Bearer lead')
      .send({
        accessLevel: 'member',
        roles: ['department.sports_member'],
        captainTeamIds: ['team-does-not-exist'],
      })
      .expect(400);
  });

  it('does not let a platform administrator open the administrator module', async () => {
    const store = createMemoryStore();
    const user = {
      uid: 'u_platform_admin',
      username: 'PlatformAdmin',
      displayName: 'Platform administrator',
      studentId: '2023000003',
      avatarUrl: null,
    };
    await store.developmentAccess.create({
      subjectUid: user.uid,
      studentId: user.studentId,
      username: user.username,
      accessLevel: 'member',
      status: 'active',
      ownerUid: 'u_lead',
      scope: { type: 'public', id: '*' },
    });
    await store.subjects.create({
      uid: user.uid,
      displayName: user.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'u_lead',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: user.uid,
      roleKey: 'platform.admin',
      expiresAt: null,
      status: 'active',
      ownerUid: 'u_lead',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'main',
      authClient: {
        introspect: async () => ({ ...user, baseRole: 'student', roles: [], tags: [] }),
      },
      userDirectory: { list: async () => [user], get: async () => user },
    });

    await request(app)
      .get('/api/development/v1/admin/development-users')
      .set('Authorization', 'Bearer platform-admin')
      .expect(403);
  });

  it('will not remove the last active development lead', async () => {
    const store = createMemoryStore();
    await store.developmentAccess.create({
      subjectUid: 'u_lead',
      studentId: '2023010567',
      username: 'Yuchong',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'system',
      scope: { type: 'public', id: '*' },
    });
    const user = {
      uid: 'u_lead',
      username: 'Yuchong',
      displayName: 'Yuchong',
      studentId: '2023010567',
      avatarUrl: null,
    };
    const app = createApp({
      store,
      authMode: 'main',
      authClient: {
        introspect: async () => ({ ...user, baseRole: 'student', roles: [], tags: [] }),
      },
      userDirectory: { list: async () => [user], get: async () => user },
    });

    await request(app)
      .put('/api/development/v1/admin/development-users/u_lead')
      .set('Authorization', 'Bearer lead')
      .send({ accessLevel: null })
      .expect(409);
    expect(await store.developmentAccess.list({ query: 'u_lead' })).toEqual([
      expect.objectContaining({ accessLevel: 'lead', status: 'active' }),
    ]);
  });
});
