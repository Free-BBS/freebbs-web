import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const captain = { 'X-Demo-User': 'demo-captain' };

function fixture() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-captain']),
  });
  return { app, store };
}

describe('sports scope integrity regressions', () => {
  it('fails closed when the parent team scope does not match its route identity', async () => {
    const { app, store } = fixture();
    await store.sportsTeams.update('team-basketball', {
      scope: { type: 'sports_team', id: 'team-badminton' },
    });

    const read = await request(app)
      .get('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .expect(404);
    const write = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-25' })
      .expect(404);
    expect(read.body.data.error.code).toBe('sports_team_not_found');
    expect(write.body.data.error.code).toBe('sports_team_not_found');
  });

  it('does not return a matching idempotency tuple with a corrupted scope', async () => {
    const { app, store } = fixture();
    await store.sportsCheckins.create({
      teamId: 'team-basketball',
      memberUid: 'demo-student',
      checkinDate: '2026-07-26',
      status: 'present',
      ownerUid: 'demo-captain',
      scope: { type: 'sports_team', id: 'team-badminton' },
    });

    const response = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-26' })
      .expect(404);
    expect(response.body.data.error.code).toBe('sports_team_not_found');
  });
});
