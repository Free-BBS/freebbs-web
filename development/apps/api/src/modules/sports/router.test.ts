import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const captain = { 'X-Demo-User': 'demo-captain' };
const sportsLead = { 'X-Demo-User': 'demo-sports-lead' };

function fixture() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-student', 'demo-captain', 'demo-sports-lead']),
  });
  return { app, store };
}

describe('sports teams API', () => {
  it('shows ordinary students only active team summaries while a sports lead sees all states', async () => {
    const { app, store } = fixture();
    const draft = await store.sportsTeams.create({
      name: 'Draft volleyball team',
      description: 'Not public yet.',
      status: 'draft',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'draft-seed' },
    });
    await store.sportsTeams.update(draft.id, {
      scope: { type: 'sports_team', id: draft.id },
    });
    const archived = await store.sportsTeams.create({
      name: 'Archived football team',
      description: 'Past team.',
      status: 'archived',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'sports_team', id: 'archived-seed' },
    });
    await store.sportsTeams.update(archived.id, {
      scope: { type: 'sports_team', id: archived.id },
    });

    const publicResponse = await request(app)
      .get('/api/development/v1/sports/teams')
      .set(student)
      .expect(200);
    expect(publicResponse.body.data).toHaveLength(2);
    expect(
      publicResponse.body.data.every((team: { status: string }) => team.status === 'active'),
    ).toBe(true);
    expect(JSON.stringify(publicResponse.body.data)).not.toContain('checkinDate');

    const managedResponse = await request(app)
      .get('/api/development/v1/sports/teams')
      .set(sportsLead)
      .expect(200);
    expect(managedResponse.body.data.map((team: { status: string }) => team.status)).toEqual(
      expect.arrayContaining(['active', 'draft', 'archived']),
    );
  });

  it('lets a sports lead create and update canonical team records without client identity fields', async () => {
    const { app, store } = fixture();
    const created = await request(app)
      .post('/api/development/v1/sports/teams')
      .set(sportsLead)
      .send({ name: 'Swimming team', description: 'College swimming team.', status: 'draft' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: 'Swimming team',
      status: 'draft',
      ownerUid: 'demo-sports-lead',
    });
    expect(created.body.data.scope).toEqual({
      type: 'sports_team',
      id: created.body.data.id,
    });

    await request(app)
      .patch('/api/development/v1/sports/teams')
      .set(sportsLead)
      .send({ id: created.body.data.id, description: 'Updated swimming team.' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/sports/teams/${created.body.data.id}/transitions`)
      .set(sportsLead)
      .send({ to: 'active' })
      .expect(200);
    expect(await store.auditLogs.list({ query: created.body.data.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'sports.team.created' }),
        expect.objectContaining({ action: 'sports.team.updated' }),
        expect.objectContaining({ action: 'sports.team.status_changed' }),
      ]),
    );

    for (const spoofed of [
      { ownerUid: 'demo-admin' },
      { scope: { type: 'sports_team', id: 'team-basketball' } },
    ]) {
      await request(app)
        .post('/api/development/v1/sports/teams')
        .set(sportsLead)
        .send({ name: 'Spoofed team', description: 'Must fail.', ...spoofed })
        .expect(400);
    }
  });

  it('hides known and unknown team existence from an unauthorized updater', async () => {
    const { app } = fixture();
    const known = await request(app)
      .patch('/api/development/v1/sports/teams')
      .set(student)
      .send({ id: 'team-basketball', name: 'No' })
      .expect(404);
    const unknown = await request(app)
      .patch('/api/development/v1/sports/teams')
      .set(student)
      .send({ id: 'missing-team', name: 'No' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);
    expect(known.body.data.error.code).toBe('sports_team_not_found');
  });
});

describe('sports check-ins API', () => {
  it('lets a captain read only the check-ins of the bound team', async () => {
    const { app } = fixture();
    const own = await request(app)
      .get('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .expect(200);
    expect(own.body.data).toHaveLength(2);
    expect(
      own.body.data.every(
        (entry: { teamId: string; scope: { type: string; id: string } }) =>
          entry.teamId === 'team-basketball' &&
          entry.scope.type === 'sports_team' &&
          entry.scope.id === 'team-basketball',
      ),
    ).toBe(true);

    const other = await request(app)
      .get('/api/development/v1/sports/teams/team-badminton/checkins')
      .set(captain)
      .expect(404);
    const unknown = await request(app)
      .get('/api/development/v1/sports/teams/missing-team/checkins')
      .set(captain)
      .expect(404);
    expect(other.body.data.error.code).toBe(unknown.body.data.error.code);
  });

  it('creates a canonical check-in once and returns the same record on an idempotent retry', async () => {
    const { app, store } = fixture();
    const input = { memberUid: 'demo-student', checkinDate: '2026-07-22' };

    const first = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send(input)
      .expect(201);
    expect(first.body.data).toMatchObject({
      ...input,
      teamId: 'team-basketball',
      status: 'present',
      ownerUid: 'demo-captain',
      scope: { type: 'sports_team', id: 'team-basketball' },
    });
    const auditCount = (await store.auditLogs.list({ query: first.body.data.id })).length;

    const retry = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send(input)
      .expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await store.auditLogs.list({ query: first.body.data.id })).toHaveLength(auditCount);
  });

  it('takes the team and owner only from trusted route and identity inputs', async () => {
    const { app } = fixture();
    for (const spoofed of [
      { teamId: 'team-badminton' },
      { ownerUid: 'demo-sports-lead' },
      { scope: { type: 'sports_team', id: 'team-badminton' } },
    ]) {
      await request(app)
        .post('/api/development/v1/sports/teams/team-basketball/checkins')
        .set(captain)
        .send({ memberUid: 'demo-student', checkinDate: '2026-07-23', ...spoofed })
        .expect(400);
    }
  });

  it('rejects malformed and impossible calendar dates', async () => {
    const { app } = fixture();
    for (const checkinDate of ['2026-7-2', '2026-02-30', '2026-07-22T00:00:00Z']) {
      await request(app)
        .post('/api/development/v1/sports/teams/team-basketball/checkins')
        .set(captain)
        .send({ memberUid: 'demo-student', checkinDate })
        .expect(400);
    }
  });

  it('denies an expired captain assignment for its former team', async () => {
    const { app, store } = fixture();
    await store.tagAssignments.update('tag-captain-a', { expiresAt: '2020-01-01T00:00:00.000Z' });

    const expiredRead = await request(app)
      .get('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .expect(404);
    const expiredWrite = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(captain)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-24' })
      .expect(404);
    expect(expiredRead.body.data.error.code).toBe('sports_team_not_found');
    expect(expiredWrite.body.data.error.code).toBe('sports_team_not_found');
  });

  it('lets a sports lead manage check-ins across teams', async () => {
    const { app } = fixture();
    await request(app)
      .get('/api/development/v1/sports/teams/team-basketball/checkins')
      .set(sportsLead)
      .expect(200);
    await request(app)
      .post('/api/development/v1/sports/teams/team-badminton/members')
      .set(sportsLead)
      .send({ memberUid: 'demo-student' })
      .expect(201);
    await request(app)
      .post('/api/development/v1/sports/teams/team-badminton/checkins')
      .set(sportsLead)
      .send({ memberUid: 'demo-student', checkinDate: '2026-07-22' })
      .expect(201);
  });

  it('fails closed when the sports module is disabled or missing', async () => {
    const { app, store } = fixture();
    await store.modules.update('module-sports', { enabled: false, status: 'disabled' });
    await request(app).get('/api/development/v1/sports/teams').set(student).expect(503);

    const emptyStore = createMemoryStore({ seed: false });
    const closedApp = createApp({
      store: emptyStore,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });
    await request(closedApp).get('/api/development/v1/sports/teams').set(student).expect(503);
  });
});
