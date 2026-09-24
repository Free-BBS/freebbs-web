import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const publicScope = { type: 'public', id: '*' } as const;

function adminApp() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin', 'demo-sports-lead']),
  });
  return { app, store };
}

function bindingIdentity(binding: {
  action: string;
  resource: string;
  effect: string;
  scope: { type: string; id: string };
}) {
  return {
    action: binding.action,
    resource: binding.resource,
    effect: binding.effect,
    scope: binding.scope,
  };
}

describe('role permission governance', () => {
  it('lists governed role, permission and role-binding records', async () => {
    const { app } = adminApp();

    const [roles, permissions, bindings] = await Promise.all([
      request(app).get('/api/development/v1/admin/roles').set(adminHeaders).expect(200),
      request(app).get('/api/development/v1/admin/permissions').set(adminHeaders).expect(200),
      request(app).get('/api/development/v1/admin/role-permissions').set(adminHeaders).expect(200),
    ]);

    expect(roles.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'platform.super_admin', status: 'active' }),
        expect.objectContaining({ key: 'domain.arts_lead', status: 'active' }),
      ]),
    );
    expect(permissions.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'knowledge.publish',
          resource: 'knowledge_entry',
          status: 'active',
        }),
      ]),
    );
    expect(bindings.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleKey: 'domain.arts_lead',
          action: 'knowledge.*',
          resource: '*',
          effect: 'allow',
          scope: publicScope,
        }),
      ]),
    );
  });

  it('atomically replaces active bindings, restores a desired tuple and audits identities', async () => {
    const { app, store } = adminApp();
    const previousBindings = (
      await store.rolePermissions.list({ query: 'domain.arts_lead' })
    ).filter(({ roleKey }) => roleKey === 'domain.arts_lead');
    const desired = previousBindings.find(
      ({ action, resource }) => action === 'knowledge.*' && resource === '*',
    );
    if (desired === undefined) throw new Error('expected the built-in arts knowledge binding');
    await store.rolePermissions.update(desired.id, { status: 'inactive' });

    const response = await request(app)
      .put('/api/development/v1/admin/roles/domain.arts_lead/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'knowledge.*',
            resource: '*',
            effect: 'allow',
            scope: publicScope,
          },
        ],
      })
      .expect(200);

    expect(response.body.data.bindings).toEqual([
      expect.objectContaining({
        id: desired.id,
        roleKey: 'domain.arts_lead',
        action: 'knowledge.*',
        resource: '*',
        effect: 'allow',
        status: 'active',
        scope: publicScope,
      }),
    ]);
    const stored = (await store.rolePermissions.list({ query: 'domain.arts_lead' })).filter(
      ({ roleKey }) => roleKey === 'domain.arts_lead',
    );
    expect(stored.filter(({ status }) => status === 'active')).toEqual([
      expect.objectContaining({ id: desired.id }),
    ]);
    expect(
      stored.filter(({ id }) => id !== desired.id).every(({ status }) => status === 'inactive'),
    ).toBe(true);

    const audit = (await store.auditLogs.list({ query: 'admin.role_permissions.replace' })).at(0);
    expect(audit).toMatchObject({
      actorUid: 'demo-admin',
      action: 'admin.role_permissions.replace',
      resourceType: 'role',
      resourceId: 'domain.arts_lead',
      details: {
        oldBindings: expect.arrayContaining(
          previousBindings.filter(({ id }) => id !== desired.id).map(bindingIdentity),
        ),
        newBindings: [
          {
            action: 'knowledge.*',
            resource: '*',
            effect: 'allow',
            scope: publicScope,
          },
        ],
      },
    });
  });

  it.each([
    {
      label: 'unknown action',
      invalid: {
        action: 'unknown.export',
        resource: 'knowledge_entry',
        effect: 'allow',
        scope: publicScope,
      },
    },
    {
      label: 'mismatched action and resource',
      invalid: {
        action: 'knowledge.publish',
        resource: 'activity',
        effect: 'allow',
        scope: publicScope,
      },
    },
    {
      label: 'invalid public scope semantics',
      invalid: {
        action: 'knowledge.publish',
        resource: 'knowledge_entry',
        effect: 'allow',
        scope: { type: 'public', id: 'not-wildcard' },
      },
    },
  ])('rejects a mixed replace-set with $label without any write or audit', async ({ invalid }) => {
    const { app, store } = adminApp();
    const before = await store.rolePermissions.list({ query: 'domain.arts_lead' });

    const response = await request(app)
      .put('/api/development/v1/admin/roles/domain.arts_lead/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'knowledge.publish',
            resource: 'knowledge_entry',
            effect: 'allow',
            scope: publicScope,
          },
          invalid,
        ],
      })
      .expect(400);

    expect(response.body.data.error.code).toMatch(/invalid|permission/);
    expect(await store.rolePermissions.list({ query: 'domain.arts_lead' })).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.role_permissions.replace' })).toEqual([]);
  });

  it('rejects an inactive registered permission definition without replacing bindings', async () => {
    const { app, store } = adminApp();
    const definition = (await store.permissions.list({ query: 'knowledge.publish' })).find(
      ({ action, resource }) => action === 'knowledge.publish' && resource === 'knowledge_entry',
    );
    if (definition === undefined) throw new Error('expected knowledge publish definition');
    await store.permissions.update(definition.id, { status: 'inactive' });
    const before = await store.rolePermissions.list({ query: 'domain.arts_lead' });

    const response = await request(app)
      .put('/api/development/v1/admin/roles/domain.arts_lead/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'knowledge.publish',
            resource: 'knowledge_entry',
            effect: 'allow',
            scope: publicScope,
          },
        ],
      })
      .expect(409);

    expect(response.body.data.error.code).toBe('permission_definition_inactive');
    expect(await store.rolePermissions.list({ query: 'domain.arts_lead' })).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.role_permissions.replace' })).toEqual([]);
  });

  it('toggles an ordinary built-in role with audit and immediate authorization effect', async () => {
    const { app, store } = adminApp();
    const sportsHeaders = { 'X-Demo-User': 'demo-sports-lead' };

    await request(app)
      .post('/api/development/v1/sports/teams')
      .set(sportsHeaders)
      .send({ name: 'Before toggle', description: 'Authorized before role deactivation.' })
      .expect(201);

    const inactive = await request(app)
      .patch('/api/development/v1/admin/roles/domain.sports_lead')
      .set(adminHeaders)
      .send({ status: 'inactive' })
      .expect(200);
    expect(inactive.body.data).toMatchObject({
      key: 'domain.sports_lead',
      status: 'inactive',
    });
    await request(app)
      .post('/api/development/v1/sports/teams')
      .set(sportsHeaders)
      .send({ name: 'While inactive', description: 'Must be denied while role is inactive.' })
      .expect(403);

    const active = await request(app)
      .patch('/api/development/v1/admin/roles/domain.sports_lead')
      .set(adminHeaders)
      .send({ status: 'active' })
      .expect(200);
    expect(active.body.data).toMatchObject({ key: 'domain.sports_lead', status: 'active' });
    await request(app)
      .post('/api/development/v1/sports/teams')
      .set(sportsHeaders)
      .send({ name: 'After toggle', description: 'Authorized after role reactivation.' })
      .expect(201);

    expect(await store.auditLogs.list({ query: 'admin.role.update' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: 'domain.sports_lead',
          details: { oldStatus: 'active', newStatus: 'inactive' },
        }),
        expect.objectContaining({
          resourceId: 'domain.sports_lead',
          details: { oldStatus: 'inactive', newStatus: 'active' },
        }),
      ]),
    );
  });

  it('keeps built-in role keys immutable and exposes no deletion route', async () => {
    const { app, store } = adminApp();
    const before = (await store.roles.list()).find(({ key }) => key === 'domain.arts_lead');

    await request(app)
      .patch('/api/development/v1/admin/roles/domain.arts_lead')
      .set(adminHeaders)
      .send({ status: 'inactive', key: 'domain.renamed' })
      .expect(400);
    await request(app)
      .delete('/api/development/v1/admin/roles/domain.arts_lead')
      .set(adminHeaders)
      .expect(404);

    expect((await store.roles.list()).find(({ id }) => id === before?.id)).toEqual(before);
  });

  it.each([
    ['an empty set', []],
    [
      'a non-administrative set',
      [
        {
          action: 'knowledge.publish',
          resource: 'knowledge_entry',
          effect: 'allow',
          scope: publicScope,
        },
      ],
    ],
    [
      'an explicit administrative deny',
      [
        { action: '*', resource: '*', effect: 'allow', scope: publicScope },
        {
          action: 'admin.manage',
          resource: 'admin',
          effect: 'deny',
          scope: publicScope,
        },
      ],
    ],
  ])('atomically rejects replacing super-admin bindings with %s', async (_label, bindings) => {
    const { app, store } = adminApp();
    const before = await store.rolePermissions.list({ query: 'platform.super_admin' });

    const response = await request(app)
      .put('/api/development/v1/admin/roles/platform.super_admin/permissions')
      .set(adminHeaders)
      .send({ bindings })
      .expect(409);

    expect(response.body.data.error.code).toBe('last_super_admin_access');
    expect(await store.rolePermissions.list({ query: 'platform.super_admin' })).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.role_permissions.replace' })).toEqual([]);
  });

  it('accepts a global admin.manage allow and preserves access to the admin router', async () => {
    const { app } = adminApp();

    await request(app)
      .put('/api/development/v1/admin/roles/platform.super_admin/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'admin.manage',
            resource: 'admin',
            effect: 'allow',
            scope: publicScope,
          },
        ],
      })
      .expect(200);

    await request(app).get('/api/development/v1/admin/roles').set(adminHeaders).expect(200);
  });

  it('refuses deactivating platform.super_admin without mutation or audit', async () => {
    const { app, store } = adminApp();
    const before = (await store.roles.list()).find(({ key }) => key === 'platform.super_admin');

    const response = await request(app)
      .patch('/api/development/v1/admin/roles/platform.super_admin')
      .set(adminHeaders)
      .send({ status: 'inactive' })
      .expect(409);

    expect(response.body.data.error.code).toBe('last_super_admin_access');
    expect((await store.roles.list()).find(({ id }) => id === before?.id)).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.role.update' })).toEqual([]);
  });
});
