import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const sportsLead = { 'X-Demo-User': 'demo-sports-lead' };

describe('sports team lifecycle', () => {
  it('archives and restores explicitly while generic PATCH rejects status', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    await request(app)
      .patch('/api/development/v1/sports/teams')
      .set(sportsLead)
      .send({ id: 'team-basketball', status: 'archived' })
      .expect(400);

    const path = '/api/development/v1/sports/teams/team-basketball/transitions';
    await request(app).post(path).set(sportsLead).send({ to: 'archived' }).expect(200);
    await request(app).post(path).set(sportsLead).send({ to: 'active' }).expect(200);
    const rejected = await request(app)
      .post(path)
      .set(sportsLead)
      .send({ to: 'active' })
      .expect(409);

    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.sportsTeams.get('team-basketball')).toMatchObject({ status: 'active' });
    expect(await store.auditLogs.list({ query: 'team-basketball' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'sports.team.status_changed',
          details: expect.objectContaining({ from: 'active', to: 'active', outcome: 'rejected' }),
        }),
      ]),
    );
  });
  it('allows draft roster preparation but rejects non-active and archived writes', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-sports-lead']),
    });

    const draft = await request(app)
      .post('/api/development/v1/sports/teams')
      .set(sportsLead)
      .send({ name: 'Draft team', description: 'Preparing roster.', status: 'draft' })
      .expect(201);
    const draftBase = `/api/development/v1/sports/teams/${draft.body.data.id}`;
    await request(app)
      .post(`${draftBase}/members`)
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(201);
    await request(app)
      .post(`${draftBase}/captains`)
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(201);
    const draftCheckin = await request(app)
      .post(`${draftBase}/checkins`)
      .set(sportsLead)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-30' })
      .expect(409);
    expect(draftCheckin.body.data.error.code).toBe('sports_team_not_active');

    const activeBase = '/api/development/v1/sports/teams/team-basketball';
    await request(app)
      .post(`${activeBase}/transitions`)
      .set(sportsLead)
      .send({ to: 'archived' })
      .expect(200);
    await request(app).get(`${activeBase}/checkins`).set(sportsLead).expect(200);

    const archivedRequests = [
      request(app)
        .post(`${activeBase}/members`)
        .set(sportsLead)
        .send({ memberUid: 'demo-sports-lead' }),
      request(app).delete(`${activeBase}/members/demo-student`).set(sportsLead),
      request(app)
        .post(`${activeBase}/captains`)
        .set(sportsLead)
        .send({ memberUid: 'demo-student' }),
      request(app).delete(`${activeBase}/captains/demo-captain`).set(sportsLead),
      request(app)
        .post(`${activeBase}/checkins`)
        .set(sportsLead)
        .send({ memberUid: 'demo-student', checkinDate: '2026-07-30' }),
    ];
    for (const archivedRequest of archivedRequests) {
      const response = await archivedRequest.expect(409);
      expect(response.body.data.error.code).toBe('sports_team_archived');
    }
  });
});
