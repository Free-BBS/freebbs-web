import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { FinanceService } from './service.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const activityScope = { type: 'activity', id: 'activity-orientation' } as const;

async function activityScopedLeadFixture() {
  const store = createMemoryStore();
  const identity: AuthorizationContext = {
    uid: 'activity-finance-lead',
    displayName: 'Activity finance lead',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
  };
  await store.subjects.create({
    uid: identity.uid,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  const assignment = await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey: 'domain.rights_development_lead',
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: activityScope,
  });
  const actor = await loadAuthorizationContext(store, identity, new Date());
  return { store, identity, assignment, actor };
}

function revokeAtActivityLock(store: DevelopmentStore, assignmentId: string): DevelopmentStore {
  return {
    ...store,
    async transaction<T>(operation: (transactionStore: DevelopmentStore) => Promise<T>) {
      return store.transaction(async (transactionStore) => {
        let revoked = false;
        const activities = {
          ...transactionStore.activities,
          async getForUpdate(id: string) {
            const activity = await transactionStore.activities.getForUpdate(id);
            if (!revoked) {
              revoked = true;
              await transactionStore.roleAssignments.update(assignmentId, { status: 'inactive' });
            }
            return activity;
          },
        };
        return operation({ ...transactionStore, activities });
      });
    },
  };
}

describe('finance security regressions', () => {
  it('rechecks exact create permission after the linked activity lock', async () => {
    const { store, assignment, actor } = await activityScopedLeadFixture();
    const service = new FinanceService(revokeAtActivityLock(store, assignment.id));

    await expect(
      service.create(actor, {
        title: 'Stale activity create',
        kind: 'budget',
        amountCents: 1000,
        activityId: 'activity-orientation',
        status: 'draft',
        scope: activityScope,
      }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(await store.financeRecords.list({ query: 'Stale activity create' })).toEqual([]);
  });

  it('rechecks update permission after the linked activity lock', async () => {
    const { store, assignment, actor } = await activityScopedLeadFixture();
    const draft = await store.financeRecords.create({
      title: 'Activity draft before revocation',
      kind: 'budget',
      amountCents: 2000,
      activityId: 'activity-orientation',
      status: 'draft',
      ownerUid: 'another-owner',
      scope: activityScope,
    });
    const service = new FinanceService(revokeAtActivityLock(store, assignment.id));

    await expect(service.update(actor, draft.id, { amountCents: 3000 })).rejects.toMatchObject({
      status: 404,
      code: 'finance_record_not_found',
    });
    expect(await store.financeRecords.get(draft.id)).toMatchObject({ amountCents: 2000 });
  });
  it('recompiles scoped permissions after locking transitions and updates', async () => {
    const store = createMemoryStore();
    const scope = { type: 'organization', id: 'revoked-finance-scope' } as const;
    const identity: AuthorizationContext = {
      uid: 'revoked-finance-lead',
      displayName: 'Revoked finance lead',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    await store.subjects.create({
      uid: identity.uid,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const assignment = await store.roleAssignments.create({
      subjectUid: identity.uid,
      roleKey: 'domain.rights_development_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    });
    const submitted = await store.financeRecords.create({
      title: 'Submitted before revocation',
      kind: 'budget',
      amountCents: 1000,
      activityId: null,
      status: 'submitted',
      ownerUid: identity.uid,
      scope,
    });
    const draft = await store.financeRecords.create({
      title: 'Draft before revocation',
      kind: 'budget',
      amountCents: 2000,
      activityId: null,
      status: 'draft',
      ownerUid: 'another-owner',
      scope,
    });
    const staleActor = await loadAuthorizationContext(store, identity, new Date());
    await store.roleAssignments.update(assignment.id, { status: 'inactive' });

    const service = new FinanceService(store);
    await expect(service.transition(staleActor, submitted.id, 'approved')).rejects.toMatchObject({
      status: 404,
      code: 'finance_record_not_found',
    });
    await expect(
      service.update(staleActor, draft.id, { title: 'Stale update' }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'finance_record_not_found',
    });
    expect(await store.financeRecords.get(submitted.id)).toMatchObject({ status: 'submitted' });
    expect(await store.financeRecords.get(draft.id)).toMatchObject({
      title: 'Draft before revocation',
    });
  });

  it('does not let an update-only finance director approve a record', async () => {
    const store = createMemoryStore();
    const actor: AuthorizationContext = {
      uid: 'finance-director',
      displayName: 'Finance director',
      avatarUrl: null,
      baseRole: 'student',
      roles: ['department.rights_development_director'],
      tags: [],
    };
    await store.subjects.create({
      uid: actor.uid,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'department.rights_development_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const record = await store.financeRecords.create({
      title: 'Submitted budget',
      kind: 'budget',
      amountCents: 1000,
      activityId: null,
      status: 'submitted',
      ownerUid: actor.uid,
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });

    const known = await request(app)
      .post(`/api/development/v1/finance/records/${record.id}/transitions`)
      .set('X-Demo-User', actor.uid)
      .send({ to: 'approved' })
      .expect(404);
    const unknown = await request(app)
      .post('/api/development/v1/finance/records/missing-record/transitions')
      .set('X-Demo-User', actor.uid)
      .send({ to: 'approved' })
      .expect(404);
    expect(known.body.data.error.code).toBe(unknown.body.data.error.code);
    expect(await store.financeRecords.get(record.id)).toMatchObject({ status: 'submitted' });
  });

  it('requires rejected records to return to draft before editing', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });
    const created = await request(app)
      .post('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({
        title: 'Editable after rejection',
        kind: 'budget',
        amountCents: 1000,
        scope: { type: 'public', id: '*' },
      })
      .expect(201);
    for (const to of ['submitted', 'rejected']) {
      await request(app)
        .post(`/api/development/v1/finance/records/${created.body.data.id}/transitions`)
        .set(adminHeaders)
        .send({ to })
        .expect(200);
    }
    await request(app)
      .patch('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({ id: created.body.data.id, title: 'Too early' })
      .expect(404);
    await request(app)
      .post(`/api/development/v1/finance/records/${created.body.data.id}/transitions`)
      .set(adminHeaders)
      .send({ to: 'draft' })
      .expect(200);
    const edited = await request(app)
      .patch('/api/development/v1/finance/records')
      .set(adminHeaders)
      .send({ id: created.body.data.id, title: 'Revised draft' })
      .expect(200);
    expect(edited.body.data.title).toBe('Revised draft');
  });

  it('rejects numeric strings and omits titles and amounts from transactional audit details', async () => {
    const store = createMemoryStore();
    const actor: AuthorizationContext = {
      uid: 'finance-lead',
      displayName: 'Finance lead',
      avatarUrl: null,
      baseRole: 'student',
      roles: ['domain.rights_development_lead'],
      tags: [],
    };
    await store.subjects.create({
      uid: actor.uid,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'domain.rights_development_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });

    await request(app)
      .post('/api/development/v1/finance/records')
      .set('X-Demo-User', actor.uid)
      .send({
        title: 'String amount',
        kind: 'budget',
        amountCents: '100',
        organizationId: 'rights_development_center',
        scope: { type: 'social_organization', id: 'rights_development_center' },
      })
      .expect(400);

    const created = await request(app)
      .post('/api/development/v1/finance/records')
      .set('X-Demo-User', actor.uid)
      .send({
        title: 'Sensitive vendor alpha',
        kind: 'settlement',
        amountCents: 712345,
        organizationId: 'rights_development_center',
        scope: { type: 'social_organization', id: 'rights_development_center' },
      })
      .expect(201);
    const audits = await store.auditLogs.list({ query: created.body.data.id });
    expect(JSON.stringify(audits)).not.toMatch(/Sensitive vendor alpha|712345/);
  });
});
