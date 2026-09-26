import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

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
      .send({ accessLevel: 'lead', roles: [], captainTeamIds: [] })
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

  it('lists main-site users and atomically assigns access and development roles', async () => {
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

    await request(app)
      .put('/api/development/v1/admin/development-users/u_target')
      .set('Authorization', 'Bearer lead')
      .send({
        accessLevel: 'member',
        roles: ['domain.arts_lead', 'department.sports_member', 'platform.admin'],
        captainTeamIds: ['team-basketball'],
      })
      .expect(200);

    expect(await store.developmentAccess.list({ query: 'u_target' })).toEqual([
      expect.objectContaining({ subjectUid: 'u_target', accessLevel: 'member', status: 'active' }),
    ]);
    expect(await store.roleAssignments.list({ query: 'u_target' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleKey: 'domain.arts_lead', status: 'active' }),
        expect.objectContaining({ roleKey: 'department.sports_member', status: 'active' }),
        expect.objectContaining({ roleKey: 'platform.admin', status: 'active' }),
      ]),
    );
    expect(await store.tagAssignments.list({ query: 'u_target' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagKey: 'sports.team_captain',
          scope: { type: 'sports_team', id: 'team-basketball' },
        }),
      ]),
    );

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
      .send({ accessLevel: null, roles: [], captainTeamIds: [] })
      .expect(409);
    expect(await store.developmentAccess.list({ query: 'u_lead' })).toEqual([
      expect.objectContaining({ accessLevel: 'lead', status: 'active' }),
    ]);
  });
});
