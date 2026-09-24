import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { SportsService } from './service.js';

const captain = { 'X-Demo-User': 'demo-captain' };
const sportsLead = { 'X-Demo-User': 'demo-sports-lead' };

describe('sports team captain management', () => {
  it('delegates exact captain grants and revokes access before member removal', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-captain', 'demo-sports-lead']),
    });

    const teamReadPermission = (await store.permissions.list()).find(
      (permission) => permission.action === 'sports.team.read',
    );
    expect(teamReadPermission).toBeDefined();
    await store.permissions.update(teamReadPermission!.id, { status: 'inactive' });

    const teams = await request(app)
      .get('/api/development/v1/sports/teams')
      .set(captain)
      .expect(200);
    expect(teams.body.data.map((team: { id: string }) => team.id)).toEqual(['team-basketball']);

    await request(app)
      .delete('/api/development/v1/sports/teams/team-basketball/members/demo-captain')
      .set(sportsLead)
      .expect(409);
    await request(app)
      .delete('/api/development/v1/sports/teams/team-basketball/captains/demo-captain')
      .set(sportsLead)
      .expect(200);
    await request(app)
      .delete('/api/development/v1/sports/teams/team-basketball/members/demo-captain')
      .set(sportsLead)
      .expect(204);

    await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-28' })
      .expect(404);
    expect((await store.tagAssignments.get('tag-captain-a'))?.status).toBe('inactive');
  });
  it('treats expired captain tags as ineffective and restores them through assignment service', async () => {
    const store = createMemoryStore();
    await store.tagAssignments.update('tag-captain-a', {
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    await request(app)
      .delete('/api/development/v1/sports/teams/team-basketball/members/demo-captain')
      .set(sportsLead)
      .expect(204);
    await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/members')
      .set(sportsLead)
      .send({ memberUid: 'demo-captain' })
      .expect(201);
    await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/captains')
      .set(sportsLead)
      .send({ memberUid: 'demo-captain' })
      .expect(201);

    expect(await store.tagAssignments.get('tag-captain-a')).toMatchObject({
      status: 'active',
      expiresAt: null,
    });
  });
  it('grants only an exact-scope current member through governance assignments', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    const granted = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/captains')
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(201);
    expect(granted.body.data).toMatchObject({
      subjectUid: 'demo-student',
      tagKey: 'sports.team_captain',
      status: 'active',
      scope: { type: 'sports_team', id: 'team-basketball' },
    });

    await request(app)
      .post('/api/development/v1/sports/teams/team-badminton/captains')
      .set(sportsLead)
      .send({ memberUid: 'demo-captain' })
      .expect(404);
    await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/captains')
      .set(sportsLead)
      .send({
        memberUid: 'demo-student',
        scope: { type: 'sports_team', id: '*' },
      })
      .expect(400);
    expect(await store.auditLogs.list({ query: granted.body.data.id })).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'admin.tag_assignment.grant' })]),
    );
  });
  it('recompiles a stale captain actor after assignment revocation', async () => {
    const store = createMemoryStore();
    const staleActor = await loadAuthorizationContext(
      store,
      {
        uid: 'demo-captain',
        displayName: 'Captain',
        avatarUrl: null,
        baseRole: 'student',
        roles: [],
        tags: [],
      },
      new Date('2026-07-28T00:00:00.000Z'),
    );
    expect(staleActor.policies?.some((policy) => policy.action === 'sports.checkin.create')).toBe(
      true,
    );
    await store.tagAssignments.update('tag-captain-a', { status: 'inactive' });

    await expect(
      new SportsService(store).createCheckin(staleActor, 'team-basketball', {
        memberUid: 'demo-student',
        checkinDate: '2026-07-30',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'sports_team_not_found' });
  });
});
