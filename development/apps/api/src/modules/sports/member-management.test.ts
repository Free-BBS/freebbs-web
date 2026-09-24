import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const captain = { 'X-Demo-User': 'demo-captain' };
const sportsLead = { 'X-Demo-User': 'demo-sports-lead' };

describe('sports team member management', () => {
  it('adds each subject once and keeps membership in the exact team scope', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    await request(app)
      .post('/api/development/v1/sports/teams/team-badminton/members')
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(201);
    await request(app)
      .post('/api/development/v1/sports/teams/team-badminton/members')
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(409);

    const listed = await request(app)
      .get('/api/development/v1/sports/teams/team-badminton/members')
      .set(sportsLead)
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        teamId: 'team-badminton',
        memberUid: 'demo-student',
        scope: { type: 'sports_team', id: 'team-badminton' },
      }),
    ]);
  });
  it('immediately rejects check-ins for a removed member', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-captain', 'demo-sports-lead']),
    });

    await request(app)
      .delete('/api/development/v1/sports/teams/team-basketball/members/demo-student')
      .set(sportsLead)
      .expect(204);
    const denied = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-29' })
      .expect(404);
    expect(denied.body.data.error.code).toBe('sports_team_member_not_found');
  });
});
