import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('development access administration', () => {
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
        roles: ['department.sports_member'],
        captainTeamIds: ['team-basketball'],
      })
      .expect(200);

    expect(await store.developmentAccess.list({ query: 'u_target' })).toEqual([
      expect.objectContaining({ subjectUid: 'u_target', accessLevel: 'member', status: 'active' }),
    ]);
    expect(await store.roleAssignments.list({ query: 'u_target' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleKey: 'department.sports_member', status: 'active' }),
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
