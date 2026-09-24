import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';

function actor(scopes: string[]): AuthorizationContext {
  return {
    uid: 'scoped-maintainer',
    displayName: 'Scoped maintainer',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: scopes.map((id) => ({
      id: `liaison-${id}`,
      action: 'liaison.resource.update',
      resource: 'liaison_resource',
      effect: 'allow' as const,
      scope: { type: 'organization', id },
    })),
  };
}

describe('liaison review regressions', () => {
  it('fails closed when its module row is missing', async () => {
    const app = createApp({ store: createMemoryStore({ seed: false }) });
    await request(app).get('/api/development/v1/liaison/resources').expect(503);
  });

  it('rechecks the transaction-time scope before moving a resource', async () => {
    const base = createMemoryStore();
    const resource = await base.liaisonResources.create({
      name: 'Scoped',
      description: 'Scoped body',
      category: 'contact',
      visibility: 'restricted',
      status: 'active',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    let raced = false;
    const store: DevelopmentStore = {
      ...base,
      transaction: async (operation) => {
        if (!raced) {
          raced = true;
          await base.liaisonResources.update(resource.id, {
            scope: { type: 'organization', id: 'org-c' },
          });
        }
        return base.transaction(operation);
      },
    };
    const scopedActor = actor(['org-a', 'org-b']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedActor },
    });
    await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set('X-Demo-User', scopedActor.uid)
      .send({ id: resource.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await base.liaisonResources.get(resource.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-c' },
    });
  });

  it('audits restricted create and content updates without sensitive values', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });
    const created = await request(app)
      .post('/api/development/v1/liaison/resources')
      .set('X-Demo-User', 'demo-admin')
      .send({
        name: 'Sensitive contact',
        description: 'secret@example.test',
        category: 'contact',
        visibility: 'restricted',
        scope: { type: 'organization', id: 'org-a' },
      })
      .expect(201);
    await request(app)
      .patch('/api/development/v1/liaison/resources')
      .set('X-Demo-User', 'demo-admin')
      .send({ id: created.body.data.id, description: 'new-secret@example.test' })
      .expect(200);
    const audits = await store.auditLogs.list({ query: created.body.data.id });
    expect(audits.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'liaison.resource.create_restricted',
        'liaison.resource.update_restricted',
      ]),
    );
    expect(JSON.stringify(audits)).not.toMatch(/Sensitive contact|secret@example.test|new-secret/i);
  });

  it('lets either configured reviewer decide but does not treat admin.manage as review permission', async () => {
    const base = createMemoryStore();
    const makePending = (ownerUid: string) =>
      base.liaisonProblems.create({
        title: 'Review candidate',
        summary: 'A review candidate.',
        background: 'Background',
        sourceType: 'campus',
        sourceName: 'Campus unit',
        tags: [],
        expectedOutcome: 'A useful result',
        constraints: '',
        startsAt: null,
        deadline: null,
        publicContact: 'Public desk',
        internalContactNote: 'Private desk',
        recorderUid: ownerUid,
        reviewerUid: null,
        reviewedAt: null,
        reviewNote: null,
        status: 'pending_review',
        ownerUid,
        scope: { type: 'public', id: '*' },
      });
    const first = await makePending('demo-liaison-member');
    const second = await makePending('demo-liaison-member');
    const configuredApp = createApp({
      store: base,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin', 'demo-tuanwei-lead']),
    });

    await request(configuredApp)
      .post(`/api/development/v1/liaison/problems/${first.id}/review`)
      .set('X-Demo-User', 'demo-admin')
      .send({ decision: 'approve', note: 'Development lead approval' })
      .expect(200);
    await request(configuredApp)
      .post(`/api/development/v1/liaison/problems/${second.id}/review`)
      .set('X-Demo-User', 'demo-tuanwei-lead')
      .send({ decision: 'reject', note: 'Youth League rejection' })
      .expect(200);

    const superAdminAssignment = (await base.roleAssignments.list()).find(
      ({ subjectUid, roleKey }) =>
        subjectUid === 'demo-admin' && roleKey === 'platform.super_admin',
    );
    expect(superAdminAssignment).toBeDefined();
    await base.roleAssignments.update(superAdminAssignment!.id, { status: 'inactive' });
    await base.roleAssignments.create({
      subjectUid: 'demo-admin',
      roleKey: 'domain.arts_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const adminPermission = (await base.permissions.list()).find(
      ({ action, resource }) => action === 'admin.manage' && resource === 'admin',
    );
    expect(adminPermission).toBeDefined();
    await base.rolePermissions.create({
      roleKey: 'domain.arts_lead',
      action: 'admin.manage',
      resource: 'admin',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const third = await makePending('demo-liaison-member');
    const adminOnlyApp = createApp({
      store: base,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });
    await request(adminOnlyApp)
      .post(`/api/development/v1/liaison/problems/${third.id}/review`)
      .set('X-Demo-User', 'demo-admin')
      .send({ decision: 'approve', note: 'Must not work' })
      .expect(404);
  });
});
