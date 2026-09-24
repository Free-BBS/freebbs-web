import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { setOrganizationMembership } from '../admin/organization-membership-service.js';

import type { DevelopmentStore } from '../../core/database/types.js';

const identity = (uid: string): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});

async function addSubject(store: DevelopmentStore, uid: string) {
  await store.subjects.create({
    uid,
    displayName: uid,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
}

async function audienceApp() {
  const store = createMemoryStore();
  const users = ['ordinary', 'arts-member', 'arts-director', 'arts-lead'] as const;
  for (const uid of users) await addSubject(store, uid);
  await setOrganizationMembership(
    store,
    { subjectUid: 'arts-member', organizationId: 'arts_center', level: 'member' },
    { actorUid: 'demo-admin' },
  );
  await setOrganizationMembership(
    store,
    { subjectUid: 'arts-director', organizationId: 'arts_center', level: 'director' },
    { actorUid: 'demo-admin' },
  );
  await setOrganizationMembership(
    store,
    { subjectUid: 'arts-lead', organizationId: 'arts_center', level: 'lead' },
    { actorUid: 'demo-admin' },
  );

  const artsDraft = await store.knowledge.create({
    type: 'workflow',
    title: '文艺中心交接草稿',
    body: '文艺中心内部流程。',
    audience: 'social_org',
    organizationId: 'arts_center',
    status: 'draft',
    ownerUid: 'arts-member',
    scope: { type: 'social_organization', id: 'arts_center' },
  });
  const sportsDraft = await store.knowledge.create({
    type: 'workflow',
    title: '体育中心交接草稿',
    body: '体育中心内部流程。',
    audience: 'social_org',
    organizationId: 'sports_center',
    status: 'draft',
    ownerUid: 'sports-member',
    scope: { type: 'social_organization', id: 'sports_center' },
  });

  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      introspect: async (uid) =>
        users.includes(uid as (typeof users)[number]) ? identity(uid) : null,
    },
  });
  return { app, store, artsDraft, sportsDraft };
}

describe('knowledge audience isolation', () => {
  it('conceals the social-organization audience from ordinary students', async () => {
    const { app } = await audienceApp();

    const response = await request(app)
      .get('/api/development/v1/knowledge/entries?audience=social_org')
      .set('X-Demo-User', 'ordinary')
      .expect(403);

    expect(response.body.data.error.code).toBe('forbidden');
  });

  it('requires and enforces the creator organization', async () => {
    const { app } = await audienceApp();

    const missingOrganization = await request(app)
      .post('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'arts-member')
      .send({
        type: 'faq',
        title: '交接问题',
        body: '社工组织内部内容。',
        audience: 'social_org',
      })
      .expect(400);
    expect(missingOrganization.body.data.error.code).toBe('organization_required');

    const created = await request(app)
      .post('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'arts-member')
      .send({
        type: 'faq',
        title: '交接问题',
        body: '社工组织内部内容。',
        audience: 'social_org',
        organizationId: 'arts_center',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      organizationId: 'arts_center',
      scope: { type: 'social_organization', id: 'arts_center' },
    });

    await request(app)
      .post('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'arts-member')
      .send({
        type: 'faq',
        title: '越权草稿',
        body: '不应写入其他组织。',
        audience: 'social_org',
        organizationId: 'sports_center',
      })
      .expect(404);
  });

  it('lists only the member organizations while leads can manage across organizations', async () => {
    const { app, sportsDraft } = await audienceApp();

    const member = await request(app)
      .get('/api/development/v1/knowledge/entries?audience=social_org')
      .set('X-Demo-User', 'arts-member')
      .expect(200);
    expect(
      member.body.data.map((entry: { organizationId: string }) => entry.organizationId),
    ).toEqual(['arts_center']);

    await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'arts-member')
      .send({ id: sportsDraft.id, title: '越权修改' })
      .expect(404);

    const leadUpdate = await request(app)
      .patch('/api/development/v1/knowledge/entries')
      .set('X-Demo-User', 'arts-lead')
      .send({ id: sportsDraft.id, title: '负责人协助维护' })
      .expect(200);
    expect(leadUpdate.body.data.title).toBe('负责人协助维护');
  });

  it('allows directors to publish their organization drafts but not another organization', async () => {
    const { app, artsDraft, sportsDraft } = await audienceApp();

    await request(app)
      .post(`/api/development/v1/knowledge/entries/${artsDraft.id}/transitions`)
      .set('X-Demo-User', 'arts-director')
      .send({ to: 'published' })
      .expect(200);

    await request(app)
      .post(`/api/development/v1/knowledge/entries/${sportsDraft.id}/transitions`)
      .set('X-Demo-User', 'arts-director')
      .send({ to: 'published' })
      .expect(404);
  });
});
