import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

import type { DevelopmentStore } from '../../core/database/types.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const studentHeaders = { 'X-Demo-User': 'demo-student' };
const liaisonHeaders = { 'X-Demo-User': 'demo-liaison-member' };
const reviewerHeaders = { 'X-Demo-User': 'demo-tuanwei-lead' };

function liaisonApp(store = createMemoryStore()) {
  return {
    app: createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient([
        'demo-admin',
        'demo-student',
        'demo-liaison-member',
        'demo-tuanwei-lead',
        'demo-captain',
      ]),
    }),
    store,
  };
}

async function addResource(
  store: DevelopmentStore,
  overrides: Partial<Parameters<DevelopmentStore['liaisonResources']['create']>[0]> = {},
) {
  return store.liaisonResources.create({
    name: '测试资源',
    description: '只用于路由边界测试。',
    category: 'contact',
    visibility: 'public',
    status: 'active',
    ownerUid: 'seed-owner',
    scope: { type: 'public', id: '*' },
    ...overrides,
  });
}

describe('liaison API', () => {
  it('rejects an inverted problem schedule at the request schema boundary', async () => {
    const { app } = liaisonApp();
    const response = await request(app)
      .post('/api/development/v1/liaison/problems')
      .set(liaisonHeaders)
      .send({
        title: 'Invalid schedule',
        summary: 'The deadline is before the start.',
        background: 'A research group supplied an anonymized sample.',
        sourceType: 'lab',
        sourceName: 'Campus data lab',
        tags: ['data'],
        expectedOutcome: 'A working public prototype',
        constraints: '',
        startsAt: '2026-10-02T08:00:00.000Z',
        deadline: '2026-10-01T08:00:00.000Z',
        publicContact: 'Public liaison desk',
        internalContactNote: '',
      })
      .expect(400);

    expect(response.body.data.error).toMatchObject({
      code: 'invalid_request',
      message: '开始时间不得晚于截止时间',
    });
  });

  it('rejects calendar-invalid liaison times at the MySQL-compatible boundary', async () => {
    const { app } = liaisonApp();
    await request(app)
      .post('/api/development/v1/liaison/problems')
      .set(liaisonHeaders)
      .send({
        title: 'Invalid calendar date',
        summary: 'The timestamp shape is valid but the date is not.',
        background: 'Calendar validation must match the persistence codec.',
        sourceType: 'lab',
        sourceName: 'Campus data lab',
        tags: ['data'],
        expectedOutcome: 'A stable validation error',
        constraints: '',
        startsAt: '2026-02-31T08:00:00.000Z',
        deadline: null,
        publicContact: 'Public liaison desk',
        internalContactNote: '',
      })
      .expect(400);
  });

  it('rejects liaison times outside the MySQL DATETIME range at the request boundary', async () => {
    const { app } = liaisonApp();
    await request(app)
      .post('/api/development/v1/liaison/problems')
      .set(liaisonHeaders)
      .send({
        title: 'Out-of-range schedule',
        summary: 'The timestamp is valid ISO but cannot be stored by MySQL.',
        background: 'HTTP validation must reject it before service normalization.',
        sourceType: 'lab',
        sourceName: 'Campus data lab',
        tags: ['data'],
        expectedOutcome: 'A stable validation error',
        constraints: '',
        startsAt: '0999-01-01T00:00:00.000Z',
        deadline: null,
        publicContact: 'Public liaison desk',
        internalContactNote: '',
      })
      .expect(400);
  });

  it('lets anonymous callers read only public resources', async () => {
    const { app, store } = liaisonApp();
    await addResource(store, {
      name: '组织联络资源',
      visibility: 'organization',
      scope: { type: 'organization', id: 'freebbs' },
    });
    await addResource(store, {
      name: '绝密联络资源',
      description: 'secret-contact@example.test',
      visibility: 'restricted',
      scope: { type: 'organization', id: 'secret-org' },
    });

    const response = await request(app).get('/api/development/v1/liaison/resources').expect(200);

    expect(response.body.data.length).toBeGreaterThan(0);
    expect(
      response.body.data.every(
        (resource: { visibility: string; scope: { type: string; id: string } }) =>
          resource.visibility === 'public' &&
          resource.scope.type === 'public' &&
          resource.scope.id === '*',
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('secret-contact@example.test');
  });

  it('denies an ordinary student restricted access without leaking sensitive values', async () => {
    const { app, store } = liaisonApp();
    await addResource(store, {
      name: '受限联系人',
      description: 'restricted-person@example.test',
      visibility: 'restricted',
      scope: { type: 'organization', id: 'secret-org' },
    });

    const response = await request(app)
      .get(
        '/api/development/v1/liaison/resources?visibility=restricted&scopeType=organization&scopeId=secret-org',
      )
      .set(studentHeaders)
      .expect(403);

    expect(response.body).toMatchObject({
      data: { error: { code: 'forbidden' } },
      requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(/受限联系人|restricted-person/i);
    const deniedAudits = (await store.auditLogs.list()).filter(
      (entry) => entry.action === 'liaison.resource.read_denied',
    );
    expect(deniedAudits).toHaveLength(1);
    expect(JSON.stringify(deniedAudits)).not.toMatch(/受限联系人|restricted-person/i);
  });

  it('applies restricted scope filters before returning data and audits each successful read', async () => {
    const { app, store } = liaisonApp();
    const allowed = await addResource(store, {
      name: '组织 A 受限资源',
      visibility: 'restricted',
      scope: { type: 'organization', id: 'org-a' },
    });
    await addResource(store, {
      name: '组织 B 受限资源',
      visibility: 'restricted',
      scope: { type: 'organization', id: 'org-b' },
    });

    const response = await request(app)
      .get(
        '/api/development/v1/liaison/resources?visibility=restricted&scopeType=organization&scopeId=org-a',
      )
      .set(adminHeaders)
      .expect(200);

    expect(response.body.data.map((resource: { id: string }) => resource.id)).toEqual([allowed.id]);
    expect(JSON.stringify(response.body)).not.toContain('组织 B 受限资源');
    expect(await store.auditLogs.list({ query: allowed.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUid: 'demo-admin',
          action: 'liaison.resource.read_restricted',
          resourceId: allowed.id,
        }),
      ]),
    );
  });

  it('uses authenticated ownership for writes and audits status changes', async () => {
    const { app, store } = liaisonApp();
    await request(app)
      .post('/api/development/v1/liaison/resources')
      .set(adminHeaders)
      .send({
        name: '伪造归属资源',
        description: '客户端不能指定 ownerUid。',
        category: 'contact',
        visibility: 'restricted',
        scope: { type: 'organization', id: 'org-a' },
        ownerUid: 'spoofed-user',
      })
      .expect(400);

    const created = await request(app)
      .post('/api/development/v1/liaison/resources')
      .set(adminHeaders)
      .send({
        name: '校友联络说明',
        description: '仅供组织内维护者使用。',
        category: 'alumni',
        visibility: 'restricted',
        scope: { type: 'organization', id: 'org-a' },
      })
      .expect(201);
    expect(created.body.data).toMatchObject({ ownerUid: 'demo-admin', status: 'active' });

    await request(app)
      .post(`/api/development/v1/liaison/resources/${created.body.data.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'archived' })
      .expect(200);
    expect(await store.auditLogs.list({ query: created.body.data.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'liaison.resource.status_changed',
          resourceId: created.body.data.id,
        }),
      ]),
    );
  });

  it('fails closed when the liaison module is disabled', async () => {
    const { app, store } = liaisonApp();
    const moduleRecord = (await store.modules.list({ query: 'liaison' })).find(
      (record) => record.moduleId === 'liaison',
    );
    expect(moduleRecord).toBeDefined();
    await store.modules.update(moduleRecord!.id, { enabled: false, status: 'disabled' });

    await request(app).get('/api/development/v1/liaison/resources').expect(503);
  });

  it('exposes the complete problem review and participation routes', async () => {
    const { app, store } = liaisonApp();
    const created = await request(app)
      .post('/api/development/v1/liaison/problems')
      .set(liaisonHeaders)
      .send({
        title: 'Open campus data question',
        summary: 'Build a readable visualization.',
        background: 'A research group supplied an anonymized sample.',
        sourceType: 'lab',
        sourceName: 'Campus data lab',
        tags: ['data', 'frontend'],
        expectedOutcome: 'A working public prototype',
        constraints: 'Do not upload private datasets.',
        startsAt: '2026-09-15T08:00:00.000Z',
        deadline: null,
        publicContact: 'Public liaison desk',
        internalContactNote: 'Private contact details',
      })
      .expect(201);
    const problemId = created.body.data.id as string;

    const hidden = await request(app)
      .get('/api/development/v1/liaison/problems')
      .set(studentHeaders)
      .expect(200);
    expect(hidden.body.data.items.map(({ id }: { id: string }) => id)).not.toContain(problemId);

    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/transitions`)
      .set(liaisonHeaders)
      .send({ to: 'pending_review' })
      .expect(200);
    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/review`)
      .set(reviewerHeaders)
      .send({ decision: 'approve', note: 'Public fields are safe.' })
      .expect(200);

    const publicDetail = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}`)
      .set(studentHeaders)
      .expect(200);
    expect(publicDetail.body.data).not.toHaveProperty('internalContactNote');
    expect(publicDetail.body.data).not.toHaveProperty('reviewNote');
    for (const internalField of ['recorderUid', 'reviewerUid', 'reviewedAt', 'ownerUid', 'scope']) {
      expect(publicDetail.body.data).not.toHaveProperty(internalField);
    }

    const team = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams`)
      .set(studentHeaders)
      .send({ name: 'Visualization team', proposal: 'Start with a public metric card.' })
      .expect(201);
    const teamId = team.body.data.id as string;
    const confirmed = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members`)
      .set('X-Demo-User', 'demo-captain')
      .send({ action: 'request' })
      .expect(201);
    await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members`)
      .set(studentHeaders)
      .send({ action: 'confirm', memberUid: 'demo-captain' })
      .expect(200);

    const post = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/posts`)
      .set(studentHeaders)
      .send({ kind: 'progress', teamId, body: 'The first public prototype is ready.' })
      .expect(201);
    await request(app)
      .patch(`/api/development/v1/liaison/problems/${problemId}/posts/${post.body.data.id}`)
      .set('X-Demo-User', 'demo-captain')
      .send({ body: 'Another member cannot rewrite the author post.' })
      .expect(404);
    await request(app)
      .post(
        `/api/development/v1/liaison/problems/${problemId}/posts/${post.body.data.id}/transitions`,
      )
      .set(studentHeaders)
      .send({ to: 'hidden' })
      .expect(404);
    await request(app)
      .delete(
        `/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members/demo-captain`,
      )
      .set(liaisonHeaders)
      .expect(404);
    await request(app)
      .patch(`/api/development/v1/liaison/problems/${problemId}/posts/${post.body.data.id}`)
      .set(studentHeaders)
      .send({ body: 'The author corrected the public prototype update.' })
      .expect(200);
    await request(app)
      .post(
        `/api/development/v1/liaison/problems/${problemId}/posts/${post.body.data.id}/transitions`,
      )
      .set(liaisonHeaders)
      .send({ to: 'hidden' })
      .expect(200);
    const posts = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/posts`)
      .set(studentHeaders)
      .expect(200);
    expect(posts.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: post.body.data.id })]),
    );

    await request(app)
      .delete(
        `/api/development/v1/liaison/problems/${problemId}/teams/${teamId}/members/demo-captain`,
      )
      .set(studentHeaders)
      .expect(204);
    expect(await store.liaisonTeamMembers.get(confirmed.body.data.id)).toMatchObject({
      status: 'inactive',
    });
    expect(await store.auditLogs.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'liaison.problem.post_updated' }),
        expect.objectContaining({ action: 'liaison.problem.post_hidden' }),
        expect.objectContaining({ action: 'liaison.problem.team_member_removed' }),
      ]),
    );

    const outcome = await request(app)
      .post(`/api/development/v1/liaison/problems/${problemId}/outcomes`)
      .set(studentHeaders)
      .send({
        teamId,
        title: 'Public prototype',
        description: 'The first complete version.',
        linkUrl: 'https://example.test/prototype',
        attachmentRef: null,
      })
      .expect(201);
    await request(app)
      .patch(`/api/development/v1/liaison/problems/${problemId}/outcomes/${outcome.body.data.id}`)
      .set(liaisonHeaders)
      .send({ status: 'adopted' })
      .expect(200);
    const outcomes = await request(app)
      .get(`/api/development/v1/liaison/problems/${problemId}/outcomes`)
      .set(studentHeaders)
      .expect(200);
    expect(outcomes.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'adopted' })]),
    );

    const board = await request(app)
      .get('/api/development/v1/liaison/problems?page=1&pageSize=20')
      .set(studentHeaders)
      .expect(200);
    expect(board.body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: problemId, teamCount: 1 })]),
    );
  });
});
