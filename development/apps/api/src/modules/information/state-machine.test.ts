import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const studentHeaders = { 'X-Demo-User': 'demo-student' };

function informationApp() {
  const store = createMemoryStore();
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

describe('information workflows', () => {
  it('runs the announcement lifecycle and audits a rejected terminal transition', async () => {
    const { app, store } = informationApp();
    const draft = await store.announcements.create({
      title: '发展平台公告',
      body: '由维护者发布。',
      status: 'draft',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const path = `/api/development/v1/information/announcements/${draft.id}/transitions`;
    for (const to of ['published', 'draft', 'published', 'archived'] as const) {
      const response = await request(app).post(path).set(adminHeaders).send({ to }).expect(200);
      expect(response.body.data.status).toBe(to);
    }
    const rejected = await request(app)
      .post(path)
      .set(adminHeaders)
      .send({ to: 'published' })
      .expect(409);
    expect(rejected.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.announcements.get(draft.id)).toMatchObject({ status: 'archived' });
    expect(await store.auditLogs.list({ query: draft.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'information.announcement.status_changed',
          details: expect.objectContaining({
            from: 'archived',
            to: 'published',
            outcome: 'rejected',
          }),
        }),
      ]),
    );
  });

  it('creates open consultations and enforces the exact manager lifecycle', async () => {
    const { app, store } = informationApp();
    const created = await request(app)
      .post('/api/development/v1/information/consultations')
      .set(studentHeaders)
      .send({ title: '场地咨询', body: '何时可以使用？' })
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('open');
    await request(app)
      .patch('/api/development/v1/information/consultations')
      .set(studentHeaders)
      .send({ id, title: '活动场地咨询' })
      .expect(200);
    await request(app)
      .patch(`/api/development/v1/information/consultations/${id}/handling`)
      .set(adminHeaders)
      .send({ assigneeUid: 'missing-subject' })
      .expect(400);
    expect(await store.consultations.get(id)).toMatchObject({ assigneeUid: null, reply: null });
    await request(app)
      .patch(`/api/development/v1/information/consultations/${id}/handling`)
      .set(adminHeaders)
      .send({ assigneeUid: 'demo-admin', reply: '正在协调场地。' })
      .expect(200);
    const path = `/api/development/v1/information/consultations/${id}/transitions`;
    for (const to of ['in_progress', 'resolved', 'in_progress', 'resolved', 'closed'] as const) {
      const response = await request(app).post(path).set(adminHeaders).send({ to }).expect(200);
      expect(response.body.data.status).toBe(to);
    }
    await request(app)
      .patch('/api/development/v1/information/consultations')
      .set(studentHeaders)
      .send({ id, title: '关闭后不可编辑' })
      .expect(404);
    expect(await store.consultations.get(id)).toMatchObject({
      title: '活动场地咨询',
      status: 'closed',
      assigneeUid: 'demo-admin',
      reply: '正在协调场地。',
    });
  });

  it('rejects open to resolved without mutation and audits outside the transaction', async () => {
    const { app, store } = informationApp();
    const consultation = await store.consultations.create({
      title: '待处理咨询',
      body: '不能跳过处理。',
      requesterUid: 'demo-student',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'demo-student',
      scope: { type: 'user', id: 'demo-student' },
    });
    const response = await request(app)
      .post(`/api/development/v1/information/consultations/${consultation.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'resolved' })
      .expect(409);
    expect(response.body.data.error.code).toBe('invalid_state_transition');
    expect(await store.consultations.get(consultation.id)).toEqual(consultation);
    expect(await store.auditLogs.list({ query: consultation.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'information.consultation.status_changed',
          details: expect.objectContaining({ from: 'open', to: 'resolved', outcome: 'rejected' }),
        }),
      ]),
    );
  });
});
