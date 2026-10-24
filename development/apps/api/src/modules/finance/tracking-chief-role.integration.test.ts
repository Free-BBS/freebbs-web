import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { RoleKey, SystemSettingsUser } from '@freebbs-development/contracts';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const roots: string[] = [];
const base = '/api/development/v1';
const finance = `${base}/finance/tracking`;
const scope = { type: 'public', id: '*' } as const;
const rootUid = 'u_48370eb1aba453c7';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'finance-chief-main-'));
  roots.push(root);
  const store = createMemoryStore();
  const users = ['settings-admin', 'chief-a', 'chief-b', 'local-chief', rootUid].map((uid) => ({
    uid,
    username: uid,
    displayName: uid,
    studentId: null,
    avatarUrl: null,
  }));
  for (const user of users)
    await store.subjects.create({
      uid: user.uid,
      displayName: user.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'settings-admin',
      scope,
    });
  await store.roleAssignments.create({
    subjectUid: 'settings-admin',
    roleKey: 'platform.admin',
    expiresAt: null,
    status: 'active',
    ownerUid: 'bootstrap',
    scope,
  });
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'main' },
    store,
    financeDirectory: join(root, 'private-finance'),
    systemSettingsDirectory: join(root, 'settings'),
    authClient: {
      introspect: async (token) => {
        const user = users.find(({ uid }) => uid === token);
        return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
      },
    },
    userDirectory: {
      list: async (query) => users.filter(({ uid }) => !query || uid.includes(query)),
      get: async (uid) => users.find((user) => user.uid === uid) ?? null,
    },
  });

  async function identity(uid: string): Promise<SystemSettingsUser> {
    const response = await request(app)
      .get(`${base}/system-settings/users`)
      .query({ query: uid })
      .set('Authorization', `Bearer ${rootUid}`)
      .expect(200);
    const user = (response.body.data as SystemSettingsUser[]).find((user) => user.uid === uid);
    expect(user).toBeDefined();
    return user!;
  }
  async function setRoles(uid: string, roles: RoleKey[]) {
    const user = await identity(uid);
    return request(app)
      .put(`${base}/system-settings/users/${uid}`)
      .set('Authorization', `Bearer ${rootUid}`)
      .send({ revision: user.revision, roles, captainTeamIds: [] })
      .expect(200);
  }
  return { app, store, identity, setRoles };
}

it('uses two globally appointed final reviewers through system settings and applies both through real main-site auth', async () => {
  const { app, store, identity, setRoles } = await fixture();
  const admin = await request(app)
    .get(`${base}/me`)
    .set('Authorization', 'Bearer settings-admin')
    .expect(200);
  expect(admin.body.data.businessAdmin).toBe(true);
  const ordinaryAdmin = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer settings-admin')
    .expect(200);
  expect(ordinaryAdmin.body.data).toEqual({
    configured: true,
    canAccess: false,
    canManageBudget: false,
  });
  const unassigned = await identity('chief-a');
  await request(app)
    .put(`${base}/system-settings/users/chief-a`)
    .set('Authorization', 'Bearer settings-admin')
    .send({ revision: unassigned.revision, roles: ['counselor.youth_league'], captainTeamIds: [] })
    .expect(403);
  expect(await store.roleAssignments.list({ subjectUid: 'chief-a' })).toEqual([]);

  for (const uid of ['chief-a', 'chief-b']) {
    const assigned = await setRoles(uid, ['counselor.youth_league']);
    expect(assigned.body.data.roles).toContain('counselor.youth_league');
    const identity = await request(app)
      .get(`${base}/me`)
      .set('Authorization', `Bearer ${uid}`)
      .expect(200);
    expect(identity.body.data.roles).toContain('counselor.youth_league');
    const access = await request(app)
      .get(`${finance}/access`)
      .set('Authorization', `Bearer ${uid}`)
      .expect(200);
    expect(access.body.data).toEqual({
      configured: true,
      canAccess: true,
      canManageBudget: true,
    });
  }

  const input = {
    year: '2026-2027',
    departmentId: 'youth_league.practice',
    code: '2-1-1',
    name: '实践活动',
    reimbursementCents: 10000,
    directPaymentCents: 5000,
    notes: '',
  };
  const created = await request(app)
    .post(`${finance}/projects`)
    .set('Authorization', 'Bearer chief-a')
    .send({ requestId: 'shared-project', ...input })
    .expect(201);
  const project = created.body.data.projects[0];
  const updated = await request(app)
    .put(`${finance}/projects/${project.id}`)
    .set('Authorization', 'Bearer chief-b')
    .send({ revision: project.revision, ...input, reimbursementCents: 20000 })
    .expect(200);
  expect(updated.body.data.projects[0].reimbursement.allocatedCents).toBe(20000);
  await request(app)
    .put(`${finance}/projects/${project.id}`)
    .set('Authorization', 'Bearer settings-admin')
    .send({ revision: 2, ...input })
    .expect(403);
  const hidden = await request(app)
    .get(finance)
    .set('Authorization', 'Bearer settings-admin')
    .expect(200);
  expect(hidden.body.data.projects).toEqual([]);
  expect(hidden.body.data.settings).toBeNull();

  await setRoles('chief-a', []);
  const revoked = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer chief-a')
    .expect(200);
  expect(revoked.body.data.canManageBudget).toBe(false);
  const retained = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer chief-b')
    .expect(200);
  expect(retained.body.data.canManageBudget).toBe(true);
  const audits = await store.auditLogs.list({ query: 'system_settings.user.update' });
  expect(audits).toHaveLength(3);
  expect(audits.map(({ actorUid }) => actorUid)).toEqual(Array(3).fill(rootUid));
});

it('rejects expired counselor appointments while honoring the authenticated root fallback', async () => {
  const { app, store } = await fixture();
  await store.roleAssignments.create({
    subjectUid: 'local-chief',
    roleKey: 'counselor.youth_league',
    expiresAt: '2020-01-01T00:00:00Z',
    status: 'active',
    ownerUid: 'bootstrap',
    scope,
  });
  const expired = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer local-chief')
    .expect(200);
  expect(expired.body.data.canManageBudget).toBe(false);
  const root = await request(app)
    .get(`${base}/me`)
    .set('Authorization', `Bearer ${rootUid}`)
    .expect(200);
  expect(root.body.data.rootAdmin).toBe(true);
  const allowed = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', `Bearer ${rootUid}`)
    .expect(200);
  expect(allowed.body.data).toEqual({ configured: true, canAccess: true, canManageBudget: true });
});

it('does not treat a local counselor appointment as global and permits explicit global assignment', async () => {
  const { app, store, identity, setRoles } = await fixture();
  await store.roleAssignments.create({
    subjectUid: 'local-chief',
    roleKey: 'counselor.youth_league',
    expiresAt: null,
    status: 'active',
    ownerUid: 'historical-import',
    scope: { type: 'department', id: 'youth_league.practice' },
  });
  const local = await request(app)
    .get(`${base}/me`)
    .set('Authorization', 'Bearer local-chief')
    .expect(200);
  expect(local.body.data.businessAdmin).toBe(false);
  const access = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer local-chief')
    .expect(200);
  expect(access.body.data.canManageBudget).toBe(false);
  expect((await identity('local-chief')).uid).toBe('local-chief');
  await setRoles('local-chief', ['counselor.youth_league']);
  const assigned = await request(app)
    .get(`${finance}/access`)
    .set('Authorization', 'Bearer local-chief')
    .expect(200);
  expect(assigned.body.data.canManageBudget).toBe(true);
  const grants = await store.roleAssignments.list({ subjectUid: 'local-chief' });
  expect(grants).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ roleKey: 'counselor.youth_league', status: 'active', scope }),
    ]),
  );
});
