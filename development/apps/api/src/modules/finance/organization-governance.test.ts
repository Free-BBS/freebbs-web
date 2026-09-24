import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type {
  OrganizationLevel,
  SocialOrganizationId,
  UserContext,
} from '@freebbs-development/contracts';
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

async function fixture() {
  const store = createMemoryStore();
  const memberships: Array<{
    uid: string;
    organizationId: SocialOrganizationId;
    level: OrganizationLevel;
  }> = [
    { uid: 'arts-lead', organizationId: 'arts_center', level: 'lead' },
    { uid: 'arts-director', organizationId: 'arts_center', level: 'director' },
    { uid: 'sports-lead', organizationId: 'sports_center', level: 'lead' },
    { uid: 'tuanwei-lead', organizationId: 'tuanwei', level: 'lead' },
  ];
  for (const membership of memberships) {
    await store.subjects.create({
      uid: membership.uid,
      displayName: membership.uid,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await setOrganizationMembership(
      store,
      {
        subjectUid: membership.uid,
        organizationId: membership.organizationId,
        level: membership.level,
      },
      { actorUid: 'demo-admin' },
    );
  }
  const users = [...memberships.map(({ uid }) => uid), 'demo-student'];
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      introspect: async (uid) => (users.includes(uid) ? identity(uid) : null),
    },
  });
  return { app, store };
}

function asUser(app: ReturnType<typeof createApp>, uid: string) {
  return {
    get: (path: string) => request(app).get(path).set('X-Demo-User', uid),
    post: (path: string) => request(app).post(path).set('X-Demo-User', uid),
  };
}

describe('organization-scoped finance governance', () => {
  it('shows each organization lead only their records and rejects lower levels', async () => {
    const { app, store } = await fixture();
    await store.financeRecords.create({
      title: 'Arts annual budget',
      kind: 'budget',
      amountCents: 1000,
      activityId: null,
      organizationId: 'arts_center',
      status: 'draft',
      ownerUid: 'arts-lead',
      scope: { type: 'social_organization', id: 'arts_center' },
    });
    await store.financeRecords.create({
      title: 'Sports annual budget',
      kind: 'budget',
      amountCents: 2000,
      activityId: null,
      organizationId: 'sports_center',
      status: 'draft',
      ownerUid: 'sports-lead',
      scope: { type: 'social_organization', id: 'sports_center' },
    });
    await store.financeRecords.create({
      title: 'Legacy unassigned budget',
      kind: 'budget',
      amountCents: 3000,
      activityId: null,
      organizationId: null,
      status: 'draft',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });

    const arts = await asUser(app, 'arts-lead')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(arts.body.data).toEqual([expect.objectContaining({ organizationId: 'arts_center' })]);
    await asUser(app, 'arts-director').get('/api/development/v1/finance/records').expect(403);
    await asUser(app, 'demo-student').get('/api/development/v1/finance/records').expect(403);

    const oversight = await asUser(app, 'tuanwei-lead')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(oversight.body.data.map((record: { title: string }) => record.title)).toEqual(
      expect.arrayContaining([
        'Arts annual budget',
        'Sports annual budget',
        'Legacy unassigned budget',
      ]),
    );
  });

  it('creates only for a lead organization and reserves reviews for Tuanwei oversight', async () => {
    const { app, store } = await fixture();
    const created = await asUser(app, 'arts-lead')
      .post('/api/development/v1/finance/records')
      .send({
        title: 'Arts event budget',
        kind: 'budget',
        amountCents: 8800,
        activityId: null,
        organizationId: 'arts_center',
        scope: { type: 'social_organization', id: 'arts_center' },
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      organizationId: 'arts_center',
      ownerUid: 'arts-lead',
    });
    await asUser(app, 'arts-lead')
      .post('/api/development/v1/finance/records')
      .send({
        title: 'Mismatched organization scope',
        kind: 'budget',
        amountCents: 100,
        organizationId: 'arts_center',
        scope: { type: 'public', id: '*' },
      })
      .expect(400);

    await asUser(app, 'arts-lead')
      .post('/api/development/v1/finance/records')
      .send({
        title: 'Cross-organization budget',
        kind: 'budget',
        amountCents: 100,
        organizationId: 'sports_center',
        scope: { type: 'social_organization', id: 'sports_center' },
      })
      .expect(403);

    const submitted = await store.financeRecords.update(created.body.data.id, {
      status: 'submitted',
    });
    if (submitted === null) throw new Error('Expected submitted finance record');
    await asUser(app, 'arts-lead')
      .post(`/api/development/v1/finance/records/${submitted.id}/reviews`)
      .send({ decision: 'approved' })
      .expect(403);
    const reviewed = await asUser(app, 'tuanwei-lead')
      .post(`/api/development/v1/finance/records/${submitted.id}/reviews`)
      .send({ decision: 'approved' })
      .expect(200);
    expect(reviewed.body.data).toMatchObject({
      status: 'approved',
      reviewerUid: 'tuanwei-lead',
      reviewDecision: 'approved',
      reviewedAt: expect.any(String),
    });
    expect(await store.auditLogs.list({ query: submitted.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finance.record.reviewed',
          details: expect.objectContaining({
            from: 'submitted',
            to: 'approved',
            previousDecision: null,
            nextDecision: 'approved',
          }),
        }),
      ]),
    );
  });
});
