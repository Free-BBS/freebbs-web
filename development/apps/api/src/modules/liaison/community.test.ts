import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('liaison problem community', () => {
  it('shows a pending application only to its applicant and team maintainer until confirmation', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-captain', 'demo-liaison-member']),
    });
    const problemId = 'liaison-problem-lab-energy';
    const teamId = 'liaison-team-energy-story';

    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members`)
      .set('X-Demo-User', 'demo-captain')
      .send({ action: 'request' })
      .expect(201);

    const applicantView = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-captain')
      .expect(200);
    expect(
      applicantView.body.data
        .find(({ id }: { id: string }) => id === teamId)
        .members.find(({ memberUid }: { memberUid: string }) => memberUid === 'demo-captain'),
    ).toMatchObject({ status: 'pending' });

    const unrelatedView = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-liaison-member')
      .expect(200);
    expect(
      unrelatedView.body.data
        .find(({ id }: { id: string }) => id === teamId)
        .members.some(({ memberUid }: { memberUid: string }) => memberUid === 'demo-captain'),
    ).toBe(false);

    const maintainerView = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(
      maintainerView.body.data
        .find(({ id }: { id: string }) => id === teamId)
        .members.find(({ memberUid }: { memberUid: string }) => memberUid === 'demo-captain'),
    ).toMatchObject({ status: 'pending' });

    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members`)
      .set('X-Demo-User', 'demo-student')
      .send({ action: 'confirm', memberUid: 'demo-captain' })
      .expect(200);

    const confirmedView = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-captain')
      .expect(200);
    expect(
      confirmedView.body.data
        .find(({ id }: { id: string }) => id === teamId)
        .members.find(({ memberUid }: { memberUid: string }) => memberUid === 'demo-captain'),
    ).toMatchObject({ status: 'active' });
  });

  it('keeps multiple teams and adopted outcomes active without closing the problem', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-captain', 'demo-liaison-member']),
    });
    const problemId = 'liaison-problem-lab-energy';

    const thirdTeam = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-student')
      .send({ name: 'Third team', proposal: 'An independent approach.' })
      .expect(201);
    const teams = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(teams.body.data.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([
        'liaison-team-energy-story',
        'liaison-team-energy-map',
        thirdTeam.body.data.id,
      ]),
    );

    const submitted = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/outcomes`)
      .set('X-Demo-User', 'demo-student')
      .send({
        teamId: thirdTeam.body.data.id,
        title: 'Independent result',
        description: 'A second adoptable result.',
        linkUrl: null,
        attachmentRef: null,
      })
      .expect(201);
    await request(app)
      .patch(`/api/development/v1/liaison/problems/${problemId}/outcomes/${submitted.body.data.id}`)
      .set('X-Demo-User', 'demo-liaison-member')
      .send({ status: 'adopted' })
      .expect(200);

    expect(await store.liaisonProblems.get(problemId)).toMatchObject({ status: 'open' });
    expect(
      (await store.liaisonOutcomes.list({ query: problemId })).filter(
        ({ status }) => status === 'adopted',
      ),
    ).toHaveLength(2);
  });

  it('does not let an inactive team maintainer confirm a pending member', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-captain']),
    });
    const problemId = 'liaison-problem-lab-energy';
    const team = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set('X-Demo-User', 'demo-student')
      .send({ name: 'Subject-state team', proposal: 'Confirm only while authorized.' })
      .expect(201);
    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${team.body.data.id}/members`)
      .set('X-Demo-User', 'demo-captain')
      .send({ action: 'request' })
      .expect(201);
    const maintainerSubject = (await store.subjects.list({ query: 'demo-student' })).find(
      ({ uid }) => uid === 'demo-student',
    );
    expect(maintainerSubject).toBeDefined();
    await store.subjects.update(maintainerSubject!.id, { status: 'inactive' });

    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${team.body.data.id}/members`)
      .set('X-Demo-User', 'demo-student')
      .send({ action: 'confirm', memberUid: 'demo-captain' })
      .expect(404);
    const membership = (await store.liaisonTeamMembers.list({ query: problemId })).find(
      ({ teamId, memberUid }) => teamId === team.body.data.id && memberUid === 'demo-captain',
    );
    expect(membership).toMatchObject({ status: 'pending' });
  });
});
