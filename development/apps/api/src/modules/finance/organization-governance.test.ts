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
  await store.subjects.create({
    uid: 'finance-counselor',
    displayName: 'Finance counselor',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  await store.roleAssignments.create({
    subjectUid: 'finance-counselor',
    roleKey: 'counselor.youth_league',
    status: 'active',
    expiresAt: null,
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  const users = [...memberships.map(({ uid }) => uid), 'demo-student', 'finance-counselor'];
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
  it('pages authorized records and keeps whole-organization totals independent of the visible page', async () => {
    const { app, store } = await fixture();
    for (const row of await store.financeRecords.list()) await store.financeRecords.delete(row.id);
    for (let i = 0; i < 25; i++)
      await store.financeRecords.create({
        title: `Arts ${i}`,
        kind: 'budget',
        amountCents: 100,
        activityId: null,
        organizationId: 'arts_center',
        status: i === 0 ? 'archived' : 'approved',
        reviewDecision: 'approved',
        reviewerUid: 'tuanwei-lead',
        reviewedAt: new Date().toISOString(),
        ownerUid: 'arts-lead',
        scope: { type: 'social_organization', id: 'arts_center' },
      });
    await store.financeRecords.create({
      title: 'Hidden sports',
      kind: 'budget',
      amountCents: 9000,
      activityId: null,
      organizationId: 'sports_center',
      status: 'approved',
      ownerUid: 'sports-lead',
      scope: { type: 'public', id: '*' },
    });
    await store.financeRecords.create({
      title: 'Legacy',
      kind: 'budget',
      amountCents: 500,
      activityId: null,
      organizationId: null,
      status: 'approved',
      ownerUid: 'tuanwei-lead',
      scope: { type: 'public', id: '*' },
    });
    await store.rolePermissions.create({
      roleKey: 'counselor.youth_league',
      action: 'finance.record.read',
      resource: 'finance_record',
      effect: 'deny',
      status: 'active',
      ownerUid: 'system',
      scope: { type: 'social_organization', id: 'sports_center' },
    });
    const page = await asUser(app, 'finance-counselor')
      .get('/api/development/v1/finance/records?page=2&pageSize=20')
      .expect(200);
    expect(page.body.data).toMatchObject({ page: 2, pageSize: 20, total: 26 });
    expect(page.body.data.items).toHaveLength(6);
    expect(page.body.data.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: 'arts_center',
          approvedBudget: 2500,
          remaining: 2500,
        }),
        expect.objectContaining({ organizationId: null, approvedBudget: 500 }),
      ]),
    );
    expect(
      page.body.data.summaries.some(
        (row: { organizationId: string }) => row.organizationId === 'sports_center',
      ),
    ).toBe(false);
    const arts = await asUser(app, 'arts-lead')
      .get('/api/development/v1/finance/records?page=1&pageSize=20&status=archived')
      .expect(200);
    expect(arts.body.data).toMatchObject({
      total: 1,
      summaries: [expect.objectContaining({ approvedBudget: 2500 })],
    });
  });

  it('shows leads and ordinary directors only their own organization records', async () => {
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
    const director = await asUser(app, 'arts-director')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(director.body.data).toEqual([
      expect.objectContaining({ organizationId: 'arts_center' }),
    ]);
    await asUser(app, 'demo-student').get('/api/development/v1/finance/records').expect(403);

    const oversight = await asUser(app, 'tuanwei-lead')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(oversight.body.data).toEqual([]);
  });

  it('allows leaders to create and review only their own organization', async () => {
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
    await asUser(app, 'tuanwei-lead')
      .post(`/api/development/v1/finance/records/${submitted.id}/reviews`)
      .send({ decision: 'approved' })
      .expect(403);
    const reviewed = await asUser(app, 'arts-lead')
      .post(`/api/development/v1/finance/records/${submitted.id}/reviews`)
      .send({ decision: 'approved' })
      .expect(200);
    expect(reviewed.body.data).toMatchObject({
      status: 'approved',
      reviewerUid: 'arts-lead',
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
