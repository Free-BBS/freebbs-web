import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memberHeaders,
  publicScope,
  scopedEditFixture,
} from '../../core/authorization/scoped-edit-test-fixture.js';

const home = '/api/development/v1/organizations/student_union/sports_center/home';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture() {
  const value = await scopedEditFixture();
  cleanups.push(value.cleanup);
  return value;
}
function upload(app: Parameters<typeof request>[0], path = home) {
  return request(app)
    .put(path)
    .set(memberHeaders)
    .field('revision', '0')
    .attach('file', Buffer.from('<h1>Department</h1>'), 'home.html');
}

describe('department edit scope through production main authentication', () => {
  it.each([
    { type: 'sports_team', id: 'team-a' },
    { type: 'activity', id: 'activity-a' },
    { type: 'department', id: 'student_union.arts_center' },
  ])('rejects a sports director scoped to $type/$id in both the flag and upload', async (scope) => {
    const { app, assign } = await fixture();
    await assign('department.sports_director', scope);
    expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
      false,
    );
    await upload(app).expect(403);
  });

  it.each([
    publicScope,
    { type: 'department', id: 'student_union.sports_center' },
    { type: 'social_organization', id: 'sports_center' },
  ])(
    'allows a rightful ordinary member at $type/$id without migrating definitions',
    async (scope) => {
      const { app, assign } = await fixture();
      await assign('department.sports_member', scope);
      expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
        true,
      );
      await upload(app).expect(200);
    },
  );

  it('keeps media membership working without an unrelated events.create permission', async () => {
    const { app, assign } = await fixture();
    await assign('media_center.creative.member');
    await upload(app, '/api/development/v1/organizations/media_center/creative/home').expect(200);
  });

  it('denies expired assignments immediately', async () => {
    const { app, store, assign } = await fixture();
    const assignment = await assign('department.sports_member');
    await store.roleAssignments.update(assignment.id, { expiresAt: '2000-01-01T00:00:00Z' });
    expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
      false,
    );
    await upload(app).expect(403);
  });

  it.each(['permission', 'binding', 'module', 'role'] as const)(
    'honors disabled %s governance',
    async (disabled) => {
      const { app, store, assign } = await fixture();
      await assign('department.sports_member');
      if (disabled === 'permission')
        await store.permissions.create({
          action: 'events.department_home.update',
          resource: 'department_home',
          status: 'inactive',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      if (disabled === 'binding')
        await store.rolePermissions.create({
          roleKey: 'department.sports_member',
          action: 'events.department_home.update',
          resource: 'department_home',
          effect: 'allow',
          status: 'inactive',
          ownerUid: 'demo-admin',
          scope: publicScope,
        });
      if (disabled === 'module') {
        const module = (await store.modules.list()).find(({ moduleId }) => moduleId === 'events')!;
        await store.modules.update(module.id, { enabled: false });
      }
      if (disabled === 'role') {
        const role = (await store.roles.list()).find(
          ({ key }) => key === 'department.sports_member',
        )!;
        await store.roles.update(role.id, { status: 'inactive' });
      }
      expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
        false,
      );
      await upload(app).expect(403);
    },
  );

  it('honors a department-scoped explicit deny over membership', async () => {
    const { app, store, assign } = await fixture();
    await assign('department.sports_member');
    await store.permissions.create({
      action: 'events.department_home.update',
      resource: 'department_home',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: publicScope,
    });
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'events.department_home.update',
      resource: 'department_home',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'department', id: 'student_union.sports_center' },
    });
    expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
      false,
    );
    await upload(app).expect(403);
  });

  it('fails closed when assignment and stored binding scopes are incompatible', async () => {
    const { app, store, assign } = await fixture();
    await assign('department.sports_member', {
      type: 'department',
      id: 'student_union.sports_center',
    });
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'events.department_home.update',
      resource: 'department_home',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-a' },
    });
    await upload(app).expect(403);
  });

  it('does not turn a corrupt wildcard assignment into a concrete department grant', async () => {
    const { app, store, assign } = await fixture();
    const assignment = await assign('department.sports_member');
    await store.roleAssignments.update(assignment.id, { scope: { type: 'department', id: '*' } });
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'events.department_home.update',
      resource: 'department_home',
      effect: 'allow',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'department', id: 'student_union.sports_center' },
    });
    await upload(app).expect(403);
  });

  it('does not derive an edit grant from a disabled persisted wildcard permission', async () => {
    const { app, store, assign } = await fixture();
    await assign('domain.sports_lead');
    const definition = (await store.permissions.list()).find(
      ({ action, resource }) => action === 'events.*' && resource === '*',
    )!;
    await store.permissions.update(definition.id, { status: 'inactive' });
    expect((await request(app).get(home).set(memberHeaders).expect(200)).body.data.canEdit).toBe(
      false,
    );
    await upload(app).expect(403);
  });
});
