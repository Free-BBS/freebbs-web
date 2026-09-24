import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

import type { DevelopmentStore } from '../../core/database/types.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

function knowledgeApp(store = createMemoryStore()) {
  return {
    app: createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin', 'demo-student']),
    }),
    store,
  };
}

async function addEntry(
  store: DevelopmentStore,
  overrides: Partial<Parameters<DevelopmentStore['knowledge']['create']>[0]> = {},
) {
  return store.knowledge.create({
    type: 'faq',
    title: '测试经验',
    body: '只用于路由边界测试。',
    status: 'draft',
    ownerUid: 'seed-owner',
    scope: { type: 'public', id: '*' },
    ...overrides,
  });
}

describe('knowledge API', () => {
  it('lets anonymous callers read only public published entries', async () => {
    const { app, store } = knowledgeApp();
    await addEntry(store, { title: '公开草稿', status: 'draft' });
    await addEntry(store, {
      title: '组织内已发布经验',
      status: 'published',
      scope: { type: 'organization', id: 'org-secret' },
    });

    const response = await request(app).get('/api/development/v1/knowledge/entries').expect(200);

    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(
      response.body.data.every(
        (entry: { status: string; scope: { type: string; id: string } }) =>
          entry.status === 'published' && entry.scope.type === 'public' && entry.scope.id === '*',
      ),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('组织内已发布经验');
    expect(JSON.stringify(response.body)).not.toContain('公开草稿');
  });

  it('uses the authenticated uid for draft creation and rejects client-owned fields', async () => {
    const { app } = knowledgeApp();

    await request(app)
      .post('/api/development/v1/knowledge/entries')
      .set(adminHeaders)
      .send({
        type: 'workflow',
        title: '伪造归属',
        body: '客户端不能指定 ownerUid。',
        ownerUid: 'spoofed-user',
      })
      .expect(400);

    const created = await request(app)
      .post('/api/development/v1/knowledge/entries')
      .set(adminHeaders)
      .send({
        type: 'workflow',
        title: '交接流程草稿',
        body: '由维护者整理的交接流程。',
        scope: { type: 'public', id: '*' },
      })
      .expect(201);

    expect(created.body).toMatchObject({
      data: {
        type: 'workflow',
        title: '交接流程草稿',
        status: 'draft',
        ownerUid: 'demo-admin',
        audience: 'general',
        organizationId: null,
        scope: { type: 'public', id: '*' },
      },
      requestId: expect.any(String),
    });
  });

  it('publishes a draft atomically with an audit record and applies scope filters server-side', async () => {
    const { app, store } = knowledgeApp();
    const draft = await addEntry(store, {
      title: '待发布 FAQ',
      status: 'draft',
      scope: { type: 'organization', id: 'org-a' },
    });
    await addEntry(store, {
      title: '其他组织草稿',
      status: 'draft',
      scope: { type: 'organization', id: 'org-b' },
    });

    const filtered = await request(app)
      .get(
        '/api/development/v1/knowledge/entries?status=draft&type=faq&scopeType=organization&scopeId=org-a',
      )
      .set(adminHeaders)
      .expect(200);
    expect(filtered.body.data.map((entry: { id: string }) => entry.id)).toEqual([draft.id]);

    const published = await request(app)
      .post(`/api/development/v1/knowledge/entries/${draft.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'published' })
      .expect(200);
    expect(published.body.data).toMatchObject({ id: draft.id, status: 'published' });

    expect(await store.auditLogs.list({ query: draft.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUid: 'demo-admin',
          action: 'knowledge.entry.publish',
          resourceId: draft.id,
        }),
      ]),
    );
  });

  it('fails closed when the knowledge module is disabled', async () => {
    const { app, store } = knowledgeApp();
    const moduleRecord = (await store.modules.list({ query: 'knowledge' })).find(
      (record) => record.moduleId === 'knowledge',
    );
    expect(moduleRecord).toBeDefined();
    await store.modules.update(moduleRecord!.id, { enabled: false, status: 'disabled' });

    const response = await request(app).get('/api/development/v1/knowledge/entries').expect(503);
    expect(response.body).toMatchObject({
      data: { error: { code: 'module_disabled' } },
      requestId: expect.any(String),
    });
  });
});
