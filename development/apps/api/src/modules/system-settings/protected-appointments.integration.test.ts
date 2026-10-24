import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT_MANAGED_ROLE_KEYS, type RoleKey } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const rootUid = 'u_48370eb1aba453c7',
  base = '/api/development/v1',
  scope = { type: 'public', id: '*' } as const;
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'protected-appointments-'));
  roots.push(path);
  const store = createMemoryStore();
  const users = [rootUid, 'admin', 'lead-admin', 'target'].map((uid) => ({
    uid,
    username: uid,
    displayName: uid,
    studentId: null,
    avatarUrl: null,
  }));
  for (const user of users)
    await store.subjects.create({ ...user, status: 'active', ownerUid: rootUid, scope });
  for (const uid of ['admin', 'lead-admin'])
    await store.roleAssignments.create({
      subjectUid: uid,
      roleKey: 'platform.admin',
      status: 'active',
      expiresAt: null,
      ownerUid: rootUid,
      scope,
    });
  await store.developmentAccess.create({
    subjectUid: 'lead-admin',
    studentId: null,
    username: 'lead-admin',
    status: 'active',
    accessLevel: 'lead',
    ownerUid: rootUid,
    scope,
  });
  const app = createApp({
    store,
    authMode: 'main',
    collectionsUploadDirectory: path,
    authClient: {
      introspect: async (token) => {
        const user = users.find((row) => row.uid === token);
        return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
      },
    },
    userDirectory: {
      get: async (uid) => users.find((row) => row.uid === uid) ?? null,
      list: async (query) => users.filter((row) => !query || row.uid.includes(query)),
    },
  });
  const auth = (uid: string) => ({ Authorization: `Bearer ${uid}` });
  async function get(uid: string) {
    const result = await request(app)
      .get(`${base}/system-settings/users?query=${uid}`)
      .set(auth('admin'))
      .expect(200);
    return result.body.data.find((row: { uid: string }) => row.uid === uid);
  }
  async function set(actor: string, uid: string, roles: RoleKey[]) {
    const previous = await get(uid);
    return request(app)
      .put(`${base}/system-settings/users/${uid}`)
      .set(auth(actor))
      .send({ revision: previous.revision, roles, captainTeamIds: [] });
  }
  return { store, app, auth, get, set };
}
describe('root-only high privilege appointments', () => {
  it.each(ROOT_MANAGED_ROLE_KEYS)(
    'protects %s definition activation and deactivation from indirect changes',
    async (role) => {
      const f = await fixture(),
        url = `${base}/admin/roles/${role}`;
      await request(f.app)
        .patch(url)
        .set(f.auth('lead-admin'))
        .send({ status: 'inactive' })
        .expect(403);
      await request(f.app).patch(url).set(f.auth(rootUid)).send({ status: 'inactive' }).expect(200);
      await request(f.app)
        .patch(url)
        .set(f.auth('lead-admin'))
        .send({ status: 'active' })
        .expect(403);
      await request(f.app).patch(url).set(f.auth(rootUid)).send({ status: 'active' }).expect(200);
    },
  );
  it.each(ROOT_MANAGED_ROLE_KEYS)(
    'blocks ordinary administrators from changing %s and lets root grant and revoke',
    async (role) => {
      const f = await fixture();
      expect((await f.set('admin', 'target', [role])).status).toBe(403);
      if (role !== 'platform.admin')
        expect((await f.set('admin', 'admin', ['platform.admin', role])).status).toBe(403);
      expect((await f.set(rootUid, 'target', [role])).status).toBe(200);
      const before = (await f.store.roleAssignments.list({ subjectUid: 'target' })).find(
        (row) => row.roleKey === role,
      )!;
      expect((await f.set('admin', 'target', [role, 'department.arts_member'])).status).toBe(200);
      expect(await f.store.roleAssignments.get(before.id)).toMatchObject({
        status: 'active',
        expiresAt: before.expiresAt,
        ownerUid: rootUid,
      });
      expect((await f.set('admin', 'target', ['department.arts_member'])).status).toBe(403);
      expect((await f.set(rootUid, 'target', ['department.arts_member'])).status).toBe(200);
    },
  );
  it.each(ROOT_MANAGED_ROLE_KEYS)(
    'does not allow low-level global %s grant, restore or archive bypasses',
    async (role) => {
      const f = await fixture(),
        url = `${base}/admin/role-assignments`;
      await request(f.app)
        .post(url)
        .set(f.auth('lead-admin'))
        .send({ subjectUid: 'target', roleKey: role, scope })
        .expect(403);
      const granted = await request(f.app)
        .post(url)
        .set(f.auth(rootUid))
        .send({ subjectUid: 'target', roleKey: role, scope })
        .expect(201);
      await request(f.app)
        .delete(`${url}/${granted.body.data.id}`)
        .set(f.auth('lead-admin'))
        .expect(403);
      await request(f.app)
        .delete(`${url}/${granted.body.data.id}`)
        .set(f.auth(rootUid))
        .expect(200);
      await request(f.app)
        .post(url)
        .set(f.auth('lead-admin'))
        .send({ subjectUid: 'target', roleKey: role, scope })
        .expect(403);
      await request(f.app)
        .post(url)
        .set(f.auth(rootUid))
        .send({ subjectUid: 'target', roleKey: role, scope })
        .expect(201);
    },
  );
  it('preserves a local counselor appointment without letting it become a global administrator', async () => {
    const f = await fixture(),
      role = 'counselor.youth_league' as const;
    const local = await f.store.roleAssignments.create({
      subjectUid: 'target',
      roleKey: role,
      status: 'active',
      expiresAt: null,
      ownerUid: 'lead-admin',
      scope: { type: 'department', id: 'youth_league.organization' },
    });
    expect((await f.get('target')).roles).not.toContain(role);
    expect((await f.set('admin', 'target', [role])).status).toBe(403);
    await request(f.app)
      .post(`${base}/admin/role-assignments`)
      .set(f.auth('lead-admin'))
      .send({ subjectUid: 'target', roleKey: role, scope })
      .expect(403);
    expect((await f.set(rootUid, 'target', [role])).status).toBe(200);
    expect(await f.store.roleAssignments.get(local.id)).toMatchObject({
      status: 'active',
      scope: { type: 'department', id: 'youth_league.organization' },
    });
  });
  it('closes legacy first-administrator initialization when a real configured root already exists', async () => {
    const f = await fixture();
    for (const row of await f.store.roleAssignments.list())
      if (row.roleKey === 'platform.admin') await f.store.roleAssignments.delete(row.id);
    const status = await request(f.app)
      .get(`${base}/admin/business-admin-bootstrap`)
      .set(f.auth('lead-admin'))
      .expect(200);
    expect(status.body.data).toMatchObject({ canInitialize: false, globalAdminCount: 1 });
    await request(f.app)
      .post(`${base}/admin/business-admin-bootstrap`)
      .set(f.auth('lead-admin'))
      .send({ uid: 'target' })
      .expect(409);
  });
});
