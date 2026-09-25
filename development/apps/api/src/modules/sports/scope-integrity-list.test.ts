import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('sports team list scope integrity', () => {
  it('filters an active team whose stored scope does not match its record identity', async () => {
    const store = createMemoryStore();
    const corrupted = await store.sportsTeams.create({
      name: 'Corrupted team',
      description: 'This row must fail closed.',
      status: 'active',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'different-team' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });

    const response = await request(app)
      .get('/api/development/v1/sports/teams')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(response.body.data.map((team: { id: string }) => team.id)).not.toContain(corrupted.id);
  });
});
