import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('sports team update scope integrity', () => {
  it('hides and preserves a team whose stored scope does not match its identity', async () => {
    const store = createMemoryStore();
    const before = await store.sportsTeams.get('team-basketball');
    await store.sportsTeams.update('team-basketball', {
      scope: { type: 'sports_team', id: 'team-badminton' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    const known = await request(app)
      .patch('/api/development/v1/sports/teams')
      .set('X-Demo-User', 'demo-sports-lead')
      .send({ id: 'team-basketball', name: 'Must not be changed' })
      .expect(404);
    const unknown = await request(app)
      .patch('/api/development/v1/sports/teams')
      .set('X-Demo-User', 'demo-sports-lead')
      .send({ id: 'missing-team', name: 'Must not be changed' })
      .expect(404);
    expect(known.body.data.error.code).toBe('sports_team_not_found');
    expect(unknown.body.data.error.code).toBe(known.body.data.error.code);
    expect(await store.sportsTeams.get('team-basketball')).toMatchObject({
      name: before?.name,
      scope: { type: 'sports_team', id: 'team-badminton' },
    });
  });
});
