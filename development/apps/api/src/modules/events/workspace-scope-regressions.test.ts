import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memberHeaders,
  publicScope,
  scopedEditFixture,
  scopedMemberUid,
} from '../../core/authorization/scoped-edit-test-fixture.js';

const root = '/api/development/v1/events/workspaces';
const block = { id: 'intro', kind: 'paragraph', text: 'Update', assetId: null, caption: '' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture() {
  const value = await scopedEditFixture();
  cleanups.push(value.cleanup);
  await value.store.activities.update('activity-night-run', {
    organizationId: 'sports_center',
    status: 'finished',
  });
  return value;
}
function edit(app: Parameters<typeof request>[0], path: string) {
  return request(app)
    .put(`${path}/intro`)
    .set(memberHeaders)
    .send({ revision: 0, blocks: [block] });
}
const activityPath = `${root}/development_activity/activity-night-run`;
const nativePath = `${root}/native_collection/collection-autumn-workshop`;

describe('workspace edit scope through production main authentication', () => {
  it.each([
    publicScope,
    { type: 'department', id: 'student_union.sports_center' },
    { type: 'social_organization', id: 'sports_center' },
  ])(
    'allows ordinary department collaborators at $type/$id while ordinary event updates remain forbidden',
    async (scope) => {
      const { app, store, assign } = await fixture();
      await assign('department.sports_member', scope);
      expect(
        (await request(app).get(activityPath).set(memberHeaders).expect(200)).body.data.canEdit,
      ).toBe(true);
      await edit(app, activityPath).expect(200);
      await request(app)
        .patch('/api/development/v1/events/activities')
        .set(memberHeaders)
        .send({ id: 'activity-night-run', title: 'Cannot modify the activity itself' })
        .expect(404);
      expect((await store.activities.get('activity-night-run'))?.title).not.toBe(
        'Cannot modify the activity itself',
      );
    },
  );

  it.each(['activity', 'sports_team'] as const)(
    'rejects a director scoped to another %s even when they own the activity',
    async (type) => {
      const { app, store, assign } = await fixture();
      await assign('department.sports_director', { type, id: 'another-resource' });
      await store.activities.update('activity-night-run', { ownerUid: scopedMemberUid });
      expect(
        (await request(app).get(activityPath).set(memberHeaders).expect(200)).body.data.canEdit,
      ).toBe(false);
      await edit(app, activityPath).expect(403);
    },
  );

  it('allows the assigned activity and rejects another activity in the same department', async () => {
    const { app, store, assign } = await fixture();
    await assign('department.sports_director', { type: 'activity', id: 'activity-night-run' });
    await edit(app, activityPath).expect(200);
    const original = (await store.activities.get('activity-night-run'))!;
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = original;
    void _id;
    void _createdAt;
    void _updatedAt;
    const other = await store.activities.create({
      ...copy,
      ownerUid: scopedMemberUid,
      title: 'Other activity',
    });
    await edit(app, `${root}/development_activity/${other.id}`).expect(403);
  });

  it('allows a native form scoped to its own concrete id', async () => {
    const { app, store, assign } = await fixture();
    await store.collectionForms.update('collection-autumn-workshop', {
      organizationId: 'sports_center',
    });
    await assign('department.sports_member', {
      type: 'collection_form',
      id: 'collection-autumn-workshop',
    });
    await edit(app, nativePath).expect(200);
  });

  it('rejects another native form scope even when the director owns it', async () => {
    const { app, store, assign } = await fixture();
    await store.collectionForms.update('collection-autumn-workshop', {
      organizationId: 'sports_center',
      ownerUid: scopedMemberUid,
    });
    await assign('department.sports_director', { type: 'collection_form', id: 'another-form' });
    expect(
      (await request(app).get(nativePath).set(memberHeaders).expect(200)).body.data.canEdit,
    ).toBe(false);
    await edit(app, nativePath).expect(403);
  });

  it.each(['events.update', 'events.workspace.update'] as const)(
    'honors %s deny over an ordinary member collaboration grant',
    async (action) => {
      const { app, store, assign } = await fixture();
      await assign('department.sports_member');
      if (action === 'events.workspace.update')
        await store.permissions.create({
          action,
          resource: 'activity',
          status: 'active',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      await store.rolePermissions.create({
        roleKey: 'department.sports_member',
        action,
        resource: 'activity',
        effect: 'deny',
        status: 'active',
        ownerUid: 'demo-admin',
        scope: publicScope,
      });
      expect(
        (await request(app).get(activityPath).set(memberHeaders).expect(200)).body.data.canEdit,
      ).toBe(false);
      await edit(app, activityPath).expect(403);
    },
  );

  it('rejects cross-department ordinary members', async () => {
    const { app, assign } = await fixture();
    await assign('department.arts_member');
    await edit(app, activityPath).expect(403);
  });

  it('rejects expired assignments on native forms', async () => {
    const { app, store, assign } = await fixture();
    await store.collectionForms.update('collection-autumn-workshop', {
      organizationId: 'sports_center',
    });
    const assignment = await assign('department.sports_director');
    await store.roleAssignments.update(assignment.id, { expiresAt: '2000-01-01T00:00:00Z' });
    await edit(app, nativePath).expect(403);
  });

  it.each(['permission', 'binding', 'module'] as const)(
    'honors disabled workspace %s governance',
    async (disabled) => {
      const { app, store, assign } = await fixture();
      await assign('department.sports_member');
      if (disabled === 'permission')
        await store.permissions.create({
          action: 'events.workspace.update',
          resource: 'activity',
          status: 'inactive',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      if (disabled === 'binding')
        await store.rolePermissions.create({
          roleKey: 'department.sports_member',
          action: 'events.workspace.update',
          resource: 'activity',
          effect: 'allow',
          status: 'inactive',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      if (disabled === 'module') {
        const module = (await store.modules.list()).find(({ moduleId }) => moduleId === 'events')!;
        await store.modules.update(module.id, { enabled: false });
      }
      await edit(app, activityPath).expect(disabled === 'module' ? 404 : 403);
    },
  );

  it('requires exact native publishing department membership within a shared organization', async () => {
    const { app, store, assign } = await fixture();
    const form = (await store.collectionForms.get('collection-autumn-workshop'))!;
    const version = (await store.collectionVersions.get(form.publishedVersionId!))!;
    await store.collectionVersions.update(version.id, {
      schema: { ...version.schema, publisherDepartmentId: 'youth_league.organization' },
    });
    await assign('youth_league.freshman.member');
    await edit(app, nativePath).expect(403);
  });

  it('allows ordinary media collaborators on native forms with a null organization', async () => {
    const { app, store, assign } = await fixture();
    const form = (await store.collectionForms.get('collection-autumn-workshop'))!;
    const version = (await store.collectionVersions.get(form.publishedVersionId!))!;
    await store.collectionVersions.update(version.id, {
      schema: { ...version.schema, publisherDepartmentId: 'media_center.creative' },
    });
    await assign('media_center.creative.member');
    await edit(app, nativePath).expect(200);
  });

  it('honors a scoped legacy update deny on native forms over a collaboration grant', async () => {
    const { app, store, assign } = await fixture();
    await store.collectionForms.update('collection-autumn-workshop', {
      organizationId: 'sports_center',
    });
    await assign('department.sports_member');
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'events.update',
      resource: 'activity',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'collection_form', id: 'collection-autumn-workshop' },
    });
    await edit(app, nativePath).expect(403);
  });

  it('does not let a different role grant bypass an explicit activity-scoped workspace deny', async () => {
    const { app, store, assign } = await fixture();
    await assign('department.sports_member');
    await assign('department.sports_director');
    await store.rolePermissions.create({
      roleKey: 'department.sports_director',
      action: 'events.workspace.update',
      resource: 'activity',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'activity', id: 'activity-night-run' },
    });
    await edit(app, activityPath).expect(403);
  });
});
