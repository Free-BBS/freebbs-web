import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { setOrganizationMembership } from '../admin/organization-membership-service.js';

const identity = (uid: string): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});

async function proposalApp() {
  const store = createMemoryStore();
  for (const uid of ['proposal-student', 'rights-member']) {
    await store.subjects.create({
      uid,
      displayName: uid,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
  }
  await setOrganizationMembership(
    store,
    {
      subjectUid: 'rights-member',
      organizationId: 'rights_development_center',
      level: 'member',
    },
    { actorUid: 'demo-admin' },
  );
  const allowed = new Set(['proposal-student', 'rights-member']);
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      introspect: async (uid) => (allowed.has(uid) ? identity(uid) : null),
    },
  });
  return { app, store };
}

const proposalInput = {
  title: '增加夜间自习空间',
  problemDescription: '考试周座位不足',
  proposedSolution: '延长公共教室开放时间',
  category: 'campus_service',
};

describe('transparent proposal pool', () => {
  it('lets students submit and browse public details without leaking internal notes', async () => {
    const { app, store } = await proposalApp();

    const submitted = await request(app)
      .post('/api/development/v1/information/proposals')
      .set('X-Demo-User', 'proposal-student')
      .send(proposalInput)
      .expect(201);

    expect(submitted.body.data).toMatchObject({
      ...proposalInput,
      status: 'submitted',
      submitterUid: 'proposal-student',
      assigneeUid: null,
      publicProgress: '已提交',
    });
    expect(submitted.body.data).not.toHaveProperty('internalNote');

    await store.proposals.update(submitted.body.data.id, { internalNote: '仅后台可见' });

    const list = await request(app)
      .get('/api/development/v1/information/proposals')
      .set('X-Demo-User', 'proposal-student')
      .expect(200);
    const detail = await request(app)
      .get(`/api/development/v1/information/proposals/${submitted.body.data.id}`)
      .set('X-Demo-User', 'proposal-student')
      .expect(200);

    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: submitted.body.data.id, title: proposalInput.title }),
      ]),
    );
    expect(JSON.stringify(list.body.data)).not.toContain('internalNote');
    expect(detail.body.data).not.toHaveProperty('internalNote');
    expect(JSON.stringify(detail.body.data)).not.toContain('仅后台可见');
  });

  it('lets Rights Development maintain proposals and audits the write', async () => {
    const { app, store } = await proposalApp();
    const created = await store.proposals.create({
      ...proposalInput,
      submitterUid: 'proposal-student',
      assigneeUid: null,
      publicProgress: '已提交',
      internalNote: '',
      status: 'submitted',
      ownerUid: 'proposal-student',
      scope: { type: 'public', id: '*' },
    });

    await request(app)
      .patch(`/api/development/v1/information/proposals/${created.id}`)
      .set('X-Demo-User', 'proposal-student')
      .send({ status: 'reviewing' })
      .expect(403);

    const maintained = await request(app)
      .patch(`/api/development/v1/information/proposals/${created.id}`)
      .set('X-Demo-User', 'rights-member')
      .send({
        status: 'reviewing',
        publicProgress: '已进入调研',
        internalNote: '联系物业',
      })
      .expect(200);

    expect(maintained.body.data).toMatchObject({
      status: 'reviewing',
      publicProgress: '已进入调研',
      internalNote: '联系物业',
    });
    expect(await store.auditLogs.list({ query: created.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUid: 'rights-member',
          action: 'information.proposal.maintained',
          resourceId: created.id,
        }),
      ]),
    );
  });
});
