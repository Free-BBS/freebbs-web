import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const transitionsPath = (entryId: string) =>
  `/api/development/v1/knowledge/entries/${entryId}/transitions`;

function knowledgeApp() {
  const store = createMemoryStore();
  return {
    app: createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    }),
    store,
  };
}

describe('knowledge lifecycle', () => {
  it('supports publish, withdraw, republish and archive, then treats archived as terminal', async () => {
    const { app, store } = knowledgeApp();
    const draft = await store.knowledge.create({
      type: 'workflow',
      title: '部门交接流程',
      body: '由维护者持续更新。',
      status: 'draft',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });

    for (const to of ['published', 'draft', 'published', 'archived'] as const) {
      const response = await request(app)
        .post(transitionsPath(draft.id))
        .set(adminHeaders)
        .send({ to })
        .expect(200);
      expect(response.body.data).toMatchObject({ id: draft.id, status: to });
    }

    const rejected = await request(app)
      .post(transitionsPath(draft.id))
      .set(adminHeaders)
      .send({ to: 'published' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.knowledge.get(draft.id)).toMatchObject({ status: 'archived' });
  });

  it('rejects draft-to-archived without changing the record and audits the rejected attempt', async () => {
    const { app, store } = knowledgeApp();
    const draft = await store.knowledge.create({
      type: 'faq',
      title: '待发布问答',
      body: '非法迁移不应改变内容。',
      status: 'draft',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });

    await request(app)
      .post(transitionsPath(draft.id))
      .set(adminHeaders)
      .send({ to: 'archived' })
      .expect(409);

    expect(await store.knowledge.get(draft.id)).toEqual(draft);
    expect(await store.auditLogs.list({ query: draft.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUid: 'demo-admin',
          action: 'knowledge.entry.publish',
          resourceId: draft.id,
          details: expect.objectContaining({
            from: 'draft',
            to: 'archived',
            outcome: 'rejected',
          }),
        }),
      ]),
    );
  });

  it('keeps status out of the generic PATCH contract', async () => {
    const { app, store } = knowledgeApp();
    const draft = await store.knowledge.create({
      type: 'notice',
      title: '编辑边界',
      body: 'PATCH 只修改内容。',
      status: 'draft',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });

    const updated = await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set(adminHeaders)
      .send({ id: draft.id, title: '只编辑内容' })
      .expect(200);
    expect(updated.body.data).toMatchObject({ status: 'draft', title: '只编辑内容' });
    expect(await store.auditLogs.list({ query: draft.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'knowledge.entry.update', resourceId: draft.id }),
      ]),
    );

    await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set(adminHeaders)
      .send({ id: draft.id, status: 'published' })
      .expect(400);
    expect(await store.knowledge.get(draft.id)).toMatchObject({ status: 'draft' });
  });
});
