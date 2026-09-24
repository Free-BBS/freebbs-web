import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };

function adminApp() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
  });
  return { app, store };
}

async function createClubCoordinator(app: ReturnType<typeof adminApp>['app']) {
  return request(app)
    .post('/api/development/v1/admin/tag-definitions')
    .set(adminHeaders)
    .send({
      key: 'clubs.coordinator',
      name: 'Club coordinator',
      description: 'Coordinates one registered club.',
      requiredScopeType: 'club',
      metadata: { resourceTypes: ['club'], maintainedBy: 'community-team' },
    })
    .expect(201);
}

describe('tag definition and permission governance', () => {
  it('lists definitions and tag permission bindings', async () => {
    const { app } = adminApp();

    const [definitions, bindings] = await Promise.all([
      request(app).get('/api/development/v1/admin/tag-definitions').set(adminHeaders).expect(200),
      request(app).get('/api/development/v1/admin/tag-permissions').set(adminHeaders).expect(200),
    ]);

    expect(definitions.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'sports.team_captain',
          requiredScopeType: 'sports_team',
          status: 'active',
        }),
      ]),
    );
    expect(bindings.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagKey: 'sports.team_captain',
          action: 'sports.checkin.read',
          resource: 'sports_checkin',
          effect: 'allow',
          scope: { type: 'sports_team', id: '*' },
        }),
      ]),
    );
  });

  it('creates and updates an extension Tag while keeping its key immutable', async () => {
    const { app, store } = adminApp();

    const created = await createClubCoordinator(app);
    expect(created.body.data).toMatchObject({
      key: 'clubs.coordinator',
      name: 'Club coordinator',
      requiredScopeType: 'club',
      status: 'active',
      ownerUid: 'demo-admin',
    });
    expect(await store.auditLogs.list({ query: 'admin.tag_definition.create' })).toEqual([
      expect.objectContaining({
        actorUid: 'demo-admin',
        resourceId: 'clubs.coordinator',
      }),
    ]);

    const updated = await request(app)
      .patch('/api/development/v1/admin/tag-definitions/clubs.coordinator')
      .set(adminHeaders)
      .send({
        key: 'clubs.coordinator',
        name: 'Club programme coordinator',
        description: 'Coordinates programme delivery for one club.',
        requiredScopeType: 'club',
        metadata: { resourceTypes: ['club'], maintainedBy: 'programme-team' },
        status: 'inactive',
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      key: 'clubs.coordinator',
      name: 'Club programme coordinator',
      requiredScopeType: 'club',
      status: 'inactive',
    });

    const beforeRename = await store.tagDefinitions.get(created.body.data.id);
    const renamed = await request(app)
      .patch('/api/development/v1/admin/tag-definitions/clubs.coordinator')
      .set(adminHeaders)
      .send({ key: 'clubs.renamed' })
      .expect(409);
    expect(renamed.body.data.error.code).toBe('tag_key_immutable');
    expect(await store.tagDefinitions.get(created.body.data.id)).toEqual(beforeRename);
  });

  it.each([
    {
      label: 'a malformed required scope type',
      body: {
        key: 'clubs.bad_scope',
        name: 'Bad scope',
        description: 'Invalid required scope syntax.',
        requiredScopeType: 'Sports Team',
        metadata: {},
      },
    },
    {
      label: 'the non-concrete public required scope type',
      body: {
        key: 'extension.public_required',
        name: 'Impossible public scope',
        description: 'Public scope cannot require a concrete identifier.',
        requiredScopeType: 'public',
        metadata: {},
      },
    },
    {
      label: 'a duplicate built-in key',
      body: {
        key: 'sports.team_captain',
        name: 'Replacement captain',
        description: 'Must not replace a built-in definition.',
        requiredScopeType: 'sports_team',
        metadata: {},
      },
    },
  ])('rejects creating an extension Tag with $label', async ({ body }) => {
    const { app, store } = adminApp();
    const before = await store.tagDefinitions.list();

    await request(app)
      .post('/api/development/v1/admin/tag-definitions')
      .set(adminHeaders)
      .send(body)
      .expect(body.key === 'sports.team_captain' ? 409 : 400);

    expect(await store.tagDefinitions.list()).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.tag_definition.create' })).toEqual([]);
  });

  it('keeps a built-in Tag key and required scope immutable', async () => {
    const { app, store } = adminApp();
    const before = (await store.tagDefinitions.list()).find(
      ({ key }) => key === 'sports.team_captain',
    );

    for (const patch of [{ key: 'sports.captain' }, { requiredScopeType: 'club' }]) {
      const response = await request(app)
        .patch('/api/development/v1/admin/tag-definitions/sports.team_captain')
        .set(adminHeaders)
        .send(patch)
        .expect(409);
      expect(response.body.data.error.code).toMatch(/immutable|built_in/);
    }

    expect((await store.tagDefinitions.list()).find(({ id }) => id === before?.id)).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.tag_definition.update' })).toEqual([]);
  });

  it('toggles a built-in Tag enabled state with an audit event', async () => {
    const { app, store } = adminApp();

    const inactive = await request(app)
      .patch('/api/development/v1/admin/tag-definitions/sports.team_captain')
      .set(adminHeaders)
      .send({ status: 'inactive' })
      .expect(200);
    expect(inactive.body.data).toMatchObject({
      key: 'sports.team_captain',
      status: 'inactive',
      requiredScopeType: 'sports_team',
    });

    const active = await request(app)
      .patch('/api/development/v1/admin/tag-definitions/sports.team_captain')
      .set(adminHeaders)
      .send({ status: 'active' })
      .expect(200);
    expect(active.body.data).toMatchObject({
      key: 'sports.team_captain',
      status: 'active',
      requiredScopeType: 'sports_team',
    });
    expect(await store.auditLogs.list({ query: 'admin.tag_definition.update' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: 'sports.team_captain',
          details: expect.objectContaining({
            oldDefinition: expect.objectContaining({ status: 'active' }),
            newDefinition: expect.objectContaining({ status: 'inactive' }),
          }),
        }),
        expect.objectContaining({
          resourceId: 'sports.team_captain',
          details: expect.objectContaining({
            oldDefinition: expect.objectContaining({ status: 'inactive' }),
            newDefinition: expect.objectContaining({ status: 'active' }),
          }),
        }),
      ]),
    );
  });
  it('replaces a built-in Tag binding only with exact registered permissions and scope semantics', async () => {
    const { app, store } = adminApp();

    const response = await request(app)
      .put('/api/development/v1/admin/tag-definitions/sports.team_captain/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'sports.checkin.read',
            resource: 'sports_checkin',
            effect: 'allow',
            scope: { type: 'sports_team', id: '*' },
          },
        ],
      })
      .expect(200);

    expect(response.body.data.bindings).toEqual([
      expect.objectContaining({
        tagKey: 'sports.team_captain',
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        status: 'active',
        scope: { type: 'sports_team', id: '*' },
      }),
    ]);
    const stored = (await store.tagPermissions.list({ query: 'sports.team_captain' })).filter(
      ({ tagKey }) => tagKey === 'sports.team_captain',
    );
    expect(stored.filter(({ status }) => status === 'active')).toHaveLength(1);
    expect(
      stored
        .filter(({ action }) => action === 'sports.checkin.create')
        .every(({ status }) => status === 'inactive'),
    ).toBe(true);
    expect(await store.auditLogs.list({ query: 'admin.tag_permissions.replace' })).toEqual([
      expect.objectContaining({
        resourceType: 'tag_definition',
        resourceId: 'sports.team_captain',
        details: expect.objectContaining({
          oldBindings: expect.any(Array),
          newBindings: [
            {
              action: 'sports.checkin.read',
              resource: 'sports_checkin',
              effect: 'allow',
              scope: { type: 'sports_team', id: '*' },
            },
          ],
        }),
      }),
    ]);
  });

  it('allows an extension Tag only registered permissions and atomically rejects a mixed set', async () => {
    const { app, store } = adminApp();
    await createClubCoordinator(app);
    await request(app)
      .put('/api/development/v1/admin/tag-definitions/clubs.coordinator/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'clubs.read',
            resource: 'club',
            effect: 'allow',
            scope: { type: 'club', id: '*' },
          },
        ],
      })
      .expect(200);
    const before = await store.tagPermissions.list({ query: 'clubs.coordinator' });
    const auditsBefore = await store.auditLogs.list({ query: 'admin.tag_permissions.replace' });

    const response = await request(app)
      .put('/api/development/v1/admin/tag-definitions/clubs.coordinator/permissions')
      .set(adminHeaders)
      .send({
        bindings: [
          {
            action: 'clubs.read',
            resource: 'club',
            effect: 'allow',
            scope: { type: 'club', id: '*' },
          },
          {
            action: 'extension.unregistered',
            resource: 'extension_resource',
            effect: 'allow',
            scope: { type: 'club', id: '*' },
          },
        ],
      })
      .expect(400);

    expect(response.body.data.error.code).toBe('permission_definition_not_found');
    expect(await store.tagPermissions.list({ query: 'clubs.coordinator' })).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.tag_permissions.replace' })).toEqual(
      auditsBefore,
    );
  });

  it.each([
    {
      label: 'mismatched scope type',
      binding: {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        effect: 'allow',
        scope: { type: 'club', id: '*' },
      },
    },
    {
      label: 'concrete permission template scope',
      binding: {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        effect: 'allow',
        scope: { type: 'sports_team', id: 'team-a' },
      },
    },
  ])('rejects $label without partially replacing Tag bindings', async ({ binding }) => {
    const { app, store } = adminApp();
    const before = await store.tagPermissions.list({ query: 'sports.team_captain' });

    await request(app)
      .put('/api/development/v1/admin/tag-definitions/sports.team_captain/permissions')
      .set(adminHeaders)
      .send({ bindings: [binding] })
      .expect(400);

    expect(await store.tagPermissions.list({ query: 'sports.team_captain' })).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.tag_permissions.replace' })).toEqual([]);
  });
});
