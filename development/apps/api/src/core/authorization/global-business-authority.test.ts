import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { RoleKey, ScopeRef } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../database/memory-store.js';
import { loadAuthorizationContext } from './load-authorization-context.js';
import { authorize } from './authorize.js';
import {
  createRoleAssignment,
  archiveRoleAssignment,
} from '../../modules/admin/assignment-service.js';

const base = '/api/development/v1';
const publicScope = { type: 'public', id: '*' } as const;
const localScope = { type: 'social_organization', id: 'arts_center' } as const;
async function fixture(global = true, allowedUids: readonly string[] = []) {
  const store = createMemoryStore();
  const users = ['lead', 'global', 'local', 'target', 'counselor', 'other'].map((uid, i) => ({
    uid,
    username: uid,
    displayName: uid,
    studentId: `202300001${i}`,
    avatarUrl: null,
  }));
  for (const user of users) {
    await store.subjects.create({
      uid: user.uid,
      displayName: user.uid,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'lead',
      scope: publicScope,
    });
    await store.developmentAccess.create({
      subjectUid: user.uid,
      studentId: user.studentId,
      username: user.username,
      accessLevel: user.uid === 'lead' ? 'lead' : 'member',
      status: 'active',
      ownerUid: 'lead',
      scope: publicScope,
    });
  }
  async function assign(uid: string, roleKey: RoleKey, scope: ScopeRef = publicScope) {
    return store.roleAssignments.create({
      subjectUid: uid,
      roleKey,
      scope,
      status: 'active',
      expiresAt: null,
      ownerUid: 'lead',
    });
  }
  await assign('local', 'platform.admin', localScope);
  if (global) await assign('global', 'platform.admin');
  const app = createApp({
    store,
    authMode: 'main',
    previewAllowedUids: allowedUids,
    authClient: {
      introspect: async (token) => {
        const user = users.find(({ uid }) => uid === token);
        return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
      },
    },
    userDirectory: {
      list: async () => users,
      get: async (uid) => users.find((user) => user.uid === uid) ?? null,
    },
  });
  return { store, app, assign, users };
}
const bearer = (uid: string) => ({ Authorization: `Bearer ${uid}` });

describe('scope-aware global business authority', () => {
  it('reserves identity preview to original leads while global business administrators retain only settings access', async () => {
    const { app, assign, store } = await fixture();
    const leadPreview = await request(app)
      .get(`${base}/me`)
      .set(bearer('lead'))
      .set('X-Development-Preview-Uid', 'global')
      .expect(200);
    expect(leadPreview.body.data).toMatchObject({
      uid: 'global',
      roles: ['platform.admin'],
      businessAdmin: true,
      previewing: true,
      developmentAccess: 'lead',
      viewer: { uid: 'lead', canManageDevelopment: true, canPreviewDevelopment: true },
    });
    const globalIdentity = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(globalIdentity.body.data).toMatchObject({
      businessAdmin: true,
      developmentAccess: 'member',
      viewer: { canManageDevelopment: false, canPreviewDevelopment: false },
    });
    await request(app).get(`${base}/system-settings`).set(bearer('global')).expect(200);
    await request(app).get(`${base}/admin/development-users`).set(bearer('global')).expect(403);
    await assign('target', 'platform.super_admin');
    await assign('target', 'platform.admin');
    await assign('local', 'platform.super_admin', localScope);
    for (const uid of ['global', 'local', 'target']) {
      const denied = await request(app)
        .get(`${base}/me`)
        .set(bearer(uid))
        .set('X-Development-Preview-Uid', 'lead')
        .expect(403);
      expect(denied.body.data.error.code).toBe('preview_identity_denied');
    }
    const subject = (await store.subjects.list()).find(({ uid }) => uid === 'lead')!;
    await store.subjects.update(subject.id, { status: 'inactive' });
    const inactiveLead = await request(app).get(`${base}/me`).set(bearer('lead')).expect(200);
    expect(inactiveLead.body.data.viewer.canPreviewDevelopment).toBe(false);
    await request(app)
      .get(`${base}/me`)
      .set(bearer('lead'))
      .set('X-Development-Preview-Uid', 'global')
      .expect(403);
  });

  it('never treats allowlist fallback or retained global lead roles as original lead access', async () => {
    const { app, store, assign } = await fixture(true, ['global']);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'global',
    )!;
    await store.developmentAccess.delete(access.id);
    await assign('global', 'platform.super_admin');
    const identity = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(identity.body.data).toMatchObject({
      roles: expect.arrayContaining(['platform.super_admin', 'platform.admin']),
      businessAdmin: true,
      developmentAccess: 'member',
      viewer: { canManageDevelopment: false, canPreviewDevelopment: false },
    });
    await request(app).get(`${base}/system-settings`).set(bearer('global')).expect(200);
    await request(app)
      .get(`${base}/me`)
      .set(bearer('global'))
      .set('X-Development-Preview-Uid', 'lead')
      .expect(403);
  });

  it('keeps local admin policies local and denies global settings and identity preview over HTTP', async () => {
    const { store, app, users } = await fixture();
    const identity = {
      ...users.find(({ uid }) => uid === 'local')!,
      baseRole: 'student' as const,
      roles: ['platform.admin' as const],
      tags: [],
      businessAdmin: true,
    };
    const context = await loadAuthorizationContext(store, identity, new Date());
    expect(context.businessAdmin).toBe(false);
    expect(
      authorize(context, {
        action: 'knowledge.publish',
        resource: 'knowledge_entry',
        scope: localScope,
      }).allowed,
    ).toBe(true);
    expect(
      authorize(context, {
        action: 'knowledge.publish',
        resource: 'knowledge_entry',
        scope: { type: 'social_organization', id: 'sast' },
      }).allowed,
    ).toBe(false);
    await request(app).get(`${base}/system-settings/users`).set(bearer('local')).expect(403);
    await request(app)
      .get(`${base}/me`)
      .set(bearer('local'))
      .set('X-Development-Preview-Uid', 'target')
      .expect(403);
  });

  it('cannot grant new scoped platform-admin assignments', async () => {
    const { store } = await fixture();
    await expect(
      createRoleAssignment(
        store,
        { subjectUid: 'target', roleKey: 'platform.admin', scope: localScope },
        { actorUid: 'lead' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_platform_admin_scope' });
  });

  it('does not count a local admin as a replacement for the last accessible global admin', async () => {
    const { store, users } = await fixture();
    const directory = {
      list: async () => users,
      get: async (uid: string) => users.find((user) => user.uid === uid) ?? null,
    };
    const global = (await store.roleAssignments.list()).find((row) => row.subjectUid === 'global')!;
    await expect(
      archiveRoleAssignment(store, global.id, { actorUid: 'lead', directory }),
    ).rejects.toMatchObject({ code: 'last_platform_admin' });
    const local = (await store.roleAssignments.list()).find((row) => row.subjectUid === 'local')!;
    await expect(
      archiveRoleAssignment(store, local.id, { actorUid: 'lead', directory }),
    ).resolves.toMatchObject({ status: 'inactive' });
  });

  it('protects the last global business role while removing an obsolete admission record keeps access', async () => {
    const { app, store } = await fixture();
    const users = await request(app)
      .get(`${base}/system-settings/users`)
      .set(bearer('global'))
      .expect(200);
    const global = users.body.data.find((user: { uid: string }) => user.uid === 'global');
    await request(app)
      .put(`${base}/system-settings/users/global`)
      .set(bearer('global'))
      .send({ revision: global.revision, roles: [], captainTeamIds: [] })
      .expect(409);
    await request(app)
      .put(`${base}/admin/development-users/global`)
      .set(bearer('lead'))
      .send({ accessLevel: null })
      .expect(200);
    const retained = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(retained.body.data).toMatchObject({ businessAdmin: true, developmentAccess: 'member' });
    const local = users.body.data.find((user: { uid: string }) => user.uid === 'local');
    expect(local.roles).not.toContain('platform.admin');
    await request(app)
      .put(`${base}/system-settings/users/local`)
      .set(bearer('global'))
      .send({
        revision: local.revision,
        roles: [...local.roles, 'counselor.practice'],
        captainTeamIds: [],
      })
      .expect(200);
    expect(
      (await store.roleAssignments.list()).filter(
        (row) => row.subjectUid === 'local' && row.roleKey === 'platform.admin',
      ),
    ).toEqual([expect.objectContaining({ scope: localScope })]);
    await request(app).get(`${base}/system-settings/users`).set(bearer('local')).expect(403);
  });

  it('filters local admin finance reads and refuses cross-organization changes and budget review', async () => {
    const { store, app } = await fixture();
    const record = async (id: string, organizationId: 'arts_center' | 'sast') =>
      store.financeRecords.create({
        title: id,
        kind: 'budget',
        amountCents: 100,
        activityId: null,
        organizationId,
        status: 'draft',
        ownerUid: 'global',
        scope: { type: 'social_organization', id: organizationId },
      });
    const own = await record('own', 'arts_center');
    const other = await record('private', 'sast');
    const result = await request(app)
      .get(`${base}/finance/records`)
      .set(bearer('local'))
      .expect(200);
    expect(result.body.data.map((row: { id: string }) => row.id)).toContain(own.id);
    expect(result.body.data.map((row: { id: string }) => row.id)).not.toContain(other.id);
    await request(app)
      .patch(`${base}/finance/records`)
      .set(bearer('local'))
      .send({ id: other.id, title: 'illegal' })
      .expect(404);
    await store.financeRecords.update(other.id, { status: 'submitted' });
    await request(app)
      .post(`${base}/finance/records/${other.id}/reviews`)
      .set(bearer('local'))
      .send({ decision: 'approved' })
      .expect(403);
  });
});

describe('first global business administrator appointment', () => {
  it.each([false, true])(
    'recovers after the sole business administrator loses their main-site account (configured fallback: %s)',
    async (fallback) => {
      const { app, store, users } = await fixture(true, fallback ? ['global'] : []);
      if (fallback) {
        const grant = (await store.developmentAccess.list()).find(
          ({ subjectUid }) => subjectUid === 'global',
        )!;
        await store.developmentAccess.delete(grant.id);
      }
      const before = await request(app)
        .get(`${base}/admin/business-admin-bootstrap`)
        .set(bearer('lead'))
        .expect(200);
      expect(before.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
      users.splice(
        users.findIndex(({ uid }) => uid === 'global'),
        1,
      );
      await request(app).get(`${base}/me`).set(bearer('global')).expect(401);
      const status = await request(app)
        .get(`${base}/admin/business-admin-bootstrap`)
        .set(bearer('lead'))
        .expect(200);
      expect(status.body.data).toEqual({ canInitialize: true, globalAdminCount: 0 });
      await request(app)
        .post(`${base}/admin/business-admin-bootstrap`)
        .set(bearer('local'))
        .send({ uid: 'target' })
        .expect(403);
      await request(app)
        .post(`${base}/admin/business-admin-bootstrap`)
        .set(bearer('lead'))
        .send({ uid: 'target', reason: 'Replace deleted administrator' })
        .expect(201);
      await request(app).get(`${base}/system-settings/users`).set(bearer('target')).expect(200);
      await request(app).get(`${base}/system-settings/users`).set(bearer('lead')).expect(403);
      await request(app).get(`${base}/admin/development-users`).set(bearer('target')).expect(403);
      const closed = await request(app)
        .get(`${base}/admin/business-admin-bootstrap`)
        .set(bearer('lead'))
        .expect(200);
      expect(closed.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
      expect(
        (await store.auditLogs.list()).find(
          ({ action }) => action === 'admin.business_admin.initialize',
        ),
      ).toMatchObject({
        actorUid: 'lead',
        details: { previousGlobalAdminCount: 0, subjectUid: 'target' },
      });
    },
  );

  it.each(['settings', 'assignment'] as const)(
    'does not use a deleted account as a survivor when removing the last real admin through %s',
    async (route) => {
      const { app, users, assign } = await fixture();
      const assignment = await assign('lead', 'platform.admin');
      users.splice(
        users.findIndex(({ uid }) => uid === 'global'),
        1,
      );
      let result;
      if (route === 'settings') {
        const settings = await request(app)
          .get(`${base}/system-settings/users`)
          .set(bearer('lead'))
          .expect(200);
        const lead = settings.body.data.find((user: { uid: string }) => user.uid === 'lead');
        result = await request(app)
          .put(`${base}/system-settings/users/lead`)
          .set(bearer('lead'))
          .send({ revision: lead.revision, roles: [], captainTeamIds: [] });
      } else {
        result = await request(app)
          .delete(`${base}/admin/role-assignments/${assignment.id}`)
          .set(bearer('lead'));
      }
      expect(result.status).toBe(409);
      expect(result.body.data.error.code).toBe('last_platform_admin');
    },
  );

  it('keeps the business administrator role active while a real business admin remains', async () => {
    const { app, users, assign } = await fixture();
    await assign('lead', 'platform.admin');
    users.splice(
      users.findIndex(({ uid }) => uid === 'global'),
      1,
    );
    const result = await request(app)
      .patch(`${base}/admin/roles/platform.admin`)
      .set(bearer('lead'))
      .send({ status: 'inactive' })
      .expect(409);
    expect(result.body.data.error.code).toBe('last_platform_admin');
  });

  it('admits ordinary users without stored or configured access as notification recipients', async () => {
    const { app, store } = await fixture(true);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'global',
    )!;
    await store.developmentAccess.delete(access.id);
    await request(app)
      .post(`${base}/system-settings/notifications`)
      .set(bearer('global'))
      .send({
        requestId: 'fallback-notice',
        title: '配置准入',
        body: '可接收通知',
        recipientUids: ['global'],
      })
      .expect(201);
    const inbox = await request(app).get(`${base}/notifications`).set(bearer('global')).expect(200);
    expect(inbox.body.data).toHaveLength(1);
  });
  it('counts a verified global admin without stored or configured admission and protects its role', async () => {
    const { app, store, users } = await fixture(true);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'global',
    )!;
    await store.developmentAccess.delete(access.id);
    const me = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(me.body.data).toMatchObject({ businessAdmin: true, developmentAccess: 'member' });
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(409);
    const settings = await request(app)
      .get(`${base}/system-settings/users`)
      .set(bearer('global'))
      .expect(200);
    const target = settings.body.data.find((user: { uid: string }) => user.uid === 'global');
    expect(target.canReceiveNotifications).toBe(true);
    await request(app)
      .put(`${base}/system-settings/users/global`)
      .set(bearer('global'))
      .send({ revision: target.revision, roles: [], captainTeamIds: [] })
      .expect(409);
    const assignment = (await store.roleAssignments.list()).find(
      (row) => row.subjectUid === 'global',
    )!;
    await expect(
      archiveRoleAssignment(store, assignment.id, {
        actorUid: 'lead',
        allowedUids: ['global'],
        directory: {
          list: async () => users,
          get: async (uid) => users.find((user) => user.uid === uid) ?? null,
        },
      }),
    ).rejects.toMatchObject({ code: 'last_platform_admin' });
  });

  it('accepts an ordinary target without admission only as an active member and keeps scoped admins local', async () => {
    const { app, store } = await fixture(false);
    for (const uid of ['local', 'target']) {
      const access = (await store.developmentAccess.list()).find(
        ({ subjectUid }) => subjectUid === uid,
      )!;
      await store.developmentAccess.delete(access.id);
    }
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: true, globalAdminCount: 0 });
    await request(app).get(`${base}/system-settings/users`).set(bearer('local')).expect(403);
    const subject = (await store.subjects.list()).find(({ uid }) => uid === 'target')!;
    await store.subjects.update(subject.id, { status: 'inactive' });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(409);
    await store.subjects.update(subject.id, { status: 'active' });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(201);
    await request(app).get(`${base}/system-settings/users`).set(bearer('target')).expect(200);
    const closed = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(closed.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
  });

  it('keeps configured fallback access effective when its stored grant is removed', async () => {
    const { app } = await fixture(true, ['global']);
    await request(app)
      .put(`${base}/admin/development-users/global`)
      .set(bearer('lead'))
      .send({ accessLevel: null })
      .expect(200);
    const me = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(me.body.data).toMatchObject({ businessAdmin: true, developmentAccess: 'member' });
    const users = await request(app)
      .get(`${base}/admin/development-users`)
      .set(bearer('lead'))
      .expect(200);
    expect(users.body.data.find((user: { uid: string }) => user.uid === 'global').accessLevel).toBe(
      'member',
    );
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
  });

  it('includes a username-only legacy member in first-appointment candidates and initializes it', async () => {
    const { app, store } = await fixture(false);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'target',
    )!;
    await store.developmentAccess.update(access.id, {
      subjectUid: null,
      studentId: null,
      username: 'TaRgEt',
    });
    const users = await request(app)
      .get(`${base}/admin/development-users`)
      .set(bearer('lead'))
      .expect(200);
    expect(users.body.data.find((user: { uid: string }) => user.uid === 'target').accessLevel).toBe(
      'member',
    );
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(201);
    expect((await store.developmentAccess.get(access.id))?.subjectUid).toBe('target');
  });

  it('keeps a configured fallback global admin as a survivor when revoking another lead admin role', async () => {
    const { app, store, assign } = await fixture(true, ['global']);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'global',
    )!;
    await store.developmentAccess.delete(access.id);
    const leadAdmin = await assign('lead', 'platform.admin');
    await request(app)
      .delete(`${base}/admin/role-assignments/${leadAdmin.id}`)
      .set(bearer('lead'))
      .expect(200);
    expect((await store.roleAssignments.get(leadAdmin.id))?.status).toBe('inactive');
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
  });
  it('counts usable global admins whose legacy access has not yet bound a UID', async () => {
    const { app, store } = await fixture();
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'global',
    )!;
    await store.developmentAccess.update(access.id, { subjectUid: null });
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(409);
    await request(app)
      .put(`${base}/admin/development-users/global`)
      .set(bearer('lead'))
      .send({ accessLevel: null })
      .expect(200);
    const retained = await request(app).get(`${base}/me`).set(bearer('global')).expect(200);
    expect(retained.body.data).toMatchObject({ businessAdmin: true, developmentAccess: 'member' });
  });
  it('refuses appointments and status requests while previewing even when the original viewer is a qualified lead and global admin', async () => {
    const { app, assign, store } = await fixture(false);
    await assign('lead', 'platform.admin');
    const headers = { ...bearer('lead'), 'X-Development-Preview-Uid': 'target' };
    await request(app).get(`${base}/admin/business-admin-bootstrap`).set(headers).expect(403);
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(headers)
      .send({ uid: 'other' })
      .expect(403);
    expect(
      (await store.auditLogs.list()).filter(
        ({ action }) => action === 'admin.business_admin.initialize',
      ),
    ).toHaveLength(0);
  });
  it('lets only an original lead initialize once, audits the appointment, and preserves lead separation', async () => {
    const { app, store } = await fixture(false);
    await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('local'))
      .expect(403);
    const status = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(status.body.data).toEqual({ canInitialize: true, globalAdminCount: 0 });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target', reason: '首次任命' })
      .expect(201);
    const assignment = (await store.roleAssignments.list()).find(
      (row) => row.subjectUid === 'target' && row.roleKey === 'platform.admin',
    );
    expect(assignment).toMatchObject({ scope: publicScope, status: 'active', expiresAt: null });
    const audit = (await store.auditLogs.list()).find(
      (row) => row.action === 'admin.business_admin.initialize',
    );
    expect(audit).toMatchObject({
      actorUid: 'lead',
      details: { subjectUid: 'target', reason: '首次任命' },
    });
    await request(app).get(`${base}/system-settings/users`).set(bearer('target')).expect(200);
    await request(app).get(`${base}/admin/development-users`).set(bearer('target')).expect(403);
    await request(app).get(`${base}/system-settings/users`).set(bearer('lead')).expect(403);
    const closed = await request(app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .expect(200);
    expect(closed.body.data).toEqual({ canInitialize: false, globalAdminCount: 1 });
  });

  it('rejects inactive subjects and serializes first appointments without requiring admission records', async () => {
    const { app, store } = await fixture(false);
    const subject = (await store.subjects.list()).find(({ uid }) => uid === 'target')!;
    await store.subjects.update(subject.id, { status: 'inactive' });
    await request(app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(bearer('lead'))
      .send({ uid: 'target' })
      .expect(409);
    const access = (await store.developmentAccess.list()).find(
      ({ subjectUid }) => subjectUid === 'other',
    )!;
    await store.developmentAccess.update(access.id, { status: 'inactive' });
    await store.subjects.update(subject.id, { status: 'active' });
    const attempts = await Promise.all(
      ['target', 'other'].map((uid) =>
        request(app)
          .post(`${base}/admin/business-admin-bootstrap`)
          .set(bearer('lead'))
          .send({ uid }),
      ),
    );
    expect(attempts.map(({ status }) => status).sort()).toEqual([201, 409]);
  });
});

describe('Youth League counselor finance governance', () => {
  it.each(['counselor.youth_league_secretary', 'counselor.youth_league'] as const)(
    'gives %s global reads, edits and budget review with audit, while expiry revokes access',
    async (roleKey) => {
      const { app, store, assign } = await fixture();
      const assignment = await assign('counselor', roleKey);
      const created = await request(app)
        .post(`${base}/finance/records`)
        .set(bearer('counselor'))
        .send({
          title: 'Science finances',
          kind: 'budget',
          amountCents: 500,
          organizationId: 'sast',
          scope: { type: 'social_organization', id: 'sast' },
        })
        .expect(201);
      await request(app).get(`${base}/finance/records`).set(bearer('counselor')).expect(200);
      await request(app)
        .patch(`${base}/finance/records`)
        .set(bearer('counselor'))
        .send({ id: created.body.data.id, amountCents: 600 })
        .expect(200);
      await request(app)
        .post(`${base}/finance/records/${created.body.data.id}/transitions`)
        .set(bearer('counselor'))
        .send({ to: 'submitted' })
        .expect(200);
      await request(app)
        .post(`${base}/finance/records/${created.body.data.id}/reviews`)
        .set(bearer('counselor'))
        .send({ decision: 'approved' })
        .expect(200);
      expect(
        (await store.auditLogs.list({ query: created.body.data.id })).map(({ action }) => action),
      ).toContain('finance.record.reviewed');
      await store.roleAssignments.update(assignment.id, { expiresAt: '2000-01-01T00:00:00.000Z' });
      await request(app).get(`${base}/finance/records`).set(bearer('counselor')).expect(403);
    },
  );

  it('does not expand other counselors or grant global finance from scoped Youth League appointments', async () => {
    const { app, assign } = await fixture();
    await assign('counselor', 'counselor.youth_league', localScope);
    await assign('other', 'counselor.practice');
    await request(app).get(`${base}/finance/records`).set(bearer('other')).expect(403);
    await request(app)
      .post(`${base}/finance/records`)
      .set(bearer('counselor'))
      .send({
        title: 'Cross-scope budget',
        kind: 'budget',
        amountCents: 100,
        organizationId: 'sast',
        scope: { type: 'social_organization', id: 'sast' },
      })
      .expect(403);
  });
  it('uses counselor defaults on existing stores but honors explicitly inactive governed finance bindings', async () => {
    const { app, store, assign } = await fixture();
    await assign('counselor', 'counselor.youth_league');
    const bindings = (await store.rolePermissions.list()).filter(
      ({ roleKey, action }) =>
        roleKey === 'counselor.youth_league' && action.startsWith('finance.'),
    );
    for (const binding of bindings) await store.rolePermissions.delete(binding.id);
    await request(app).get(`${base}/finance/records`).set(bearer('counselor')).expect(200);
    await store.rolePermissions.create({
      roleKey: 'counselor.youth_league',
      action: 'finance.*',
      resource: '*',
      effect: 'allow',
      scope: publicScope,
      status: 'inactive',
      ownerUid: 'lead',
    });
    await request(app).get(`${base}/finance/records`).set(bearer('counselor')).expect(403);
  });
});
