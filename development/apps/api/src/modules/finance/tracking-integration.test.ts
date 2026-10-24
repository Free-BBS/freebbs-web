import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { isFinanceFinalReviewer } from './shared-access.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-app-'));
  roots.push(directory);
  const store = createMemoryStore();
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'demo' },
    store,
    financeDirectory: directory,
  });
  await store.roleAssignments.create({
    subjectUid: 'demo-admin',
    roleKey: 'counselor.youth_league',
    expiresAt: null,
    status: 'active',
    ownerUid: 'test-shared-identities',
    scope: { type: 'public', id: '*' },
  });
  return { app, store };
}
const base = '/api/development/v1/finance/tracking';
it('recognizes only current global final-reviewer appointments, with no identity-provider role shortcut', async () => {
  const { store } = await fixture();
  const identity = {
    uid: 'new-chief',
    displayName: '经费总负责人',
    avatarUrl: null,
    baseRole: 'student' as const,
    roles: ['counselor.youth_league' as const],
    tags: [],
  };
  await store.subjects.create({
    ...identity,
    status: 'active',
    ownerUid: identity.uid,
    scope: { type: 'public', id: '*' },
  });
  expect(isFinanceFinalReviewer(await loadAuthorizationContext(store, identity, new Date()))).toBe(
    false,
  );
  const local = await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey: 'counselor.youth_league',
    expiresAt: null,
    status: 'active',
    ownerUid: 'role-administrator',
    scope: { type: 'department', id: 'youth_league.practice' },
  });
  expect(isFinanceFinalReviewer(await loadAuthorizationContext(store, identity, new Date()))).toBe(
    false,
  );
  await store.roleAssignments.update(local.id, { scope: { type: 'public', id: '*' } });
  expect(isFinanceFinalReviewer(await loadAuthorizationContext(store, identity, new Date()))).toBe(
    true,
  );
  await store.roleAssignments.update(local.id, { expiresAt: '2020-01-01T00:00:00Z' });
  expect(isFinanceFinalReviewer(await loadAuthorizationContext(store, identity, new Date()))).toBe(
    false,
  );
});
it('mounts private finance separately, requires login, and does not grant ordinary users access', async () => {
  const { app } = await fixture();
  await request(app).get(base).expect(401);
  const access = await request(app)
    .get(`${base}/access`)
    .set('X-Demo-User', 'demo-admin')
    .expect(200);
  expect(access.body.data).toEqual({ configured: true, canAccess: true, canManageBudget: true });
  expect(access.headers['cache-control']).toBe('private, no-store');
  const student = await request(app).get(base).set('X-Demo-User', 'demo-student').expect(200);
  expect(student.body.data.projects).toEqual([]);
  expect(student.body.data.settings).toBeNull();
});
it('blocks a disabled subject even when its UID is the finance owner', async () => {
  const { app, store } = await fixture();
  await request(app).get(`${base}/access`).set('X-Demo-User', 'demo-admin').expect(200);
  const owner = (await store.subjects.list({ query: 'demo-admin' })).find(
    ({ uid }) => uid === 'demo-admin',
  )!;
  await store.subjects.update(owner.id, { status: 'disabled' });
  const response = await request(app)
    .get(`${base}/access`)
    .set('X-Demo-User', 'demo-admin')
    .expect(403);
  expect(response.body.data.error.code).toBe('finance_subject_inactive');
  await request(app)
    .put(`${base}/settings`)
    .set('X-Demo-User', 'demo-admin')
    .send({ revision: 1, departments: [], grants: [] })
    .expect(403);
});
it('respects the finance module switch independently from explicit grants', async () => {
  const { app, store } = await fixture();
  const module = (await store.modules.list({ query: 'finance' })).find(
    ({ moduleId }) => moduleId === 'finance',
  )!;
  await store.modules.update(module.id, { enabled: false });
  const response = await request(app)
    .get(`${base}/access`)
    .set('X-Demo-User', 'demo-admin')
    .expect(503);
  expect(response.body.data.error.code).toBe('module_disabled');
});
it('starts production with finance closed until a private directory is configured', async () => {
  const app = createApp({
    environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
    authClient: {
      introspect: async () => ({
        uid: 'real-admin',
        displayName: '负责人',
        avatarUrl: null,
        baseRole: 'student',
        roles: [],
        tags: [],
      }),
    },
  });
  const result = await request(app)
    .get(`${base}/access`)
    .set('Authorization', 'Bearer owner')
    .expect(200);
  expect(result.body.data).toEqual({ configured: false, canAccess: false, canManageBudget: false });
  await request(app)
    .put(`${base}/settings`)
    .set('Authorization', 'Bearer owner')
    .send({ revision: 1, departments: [], grants: [] })
    .expect(503);
});
