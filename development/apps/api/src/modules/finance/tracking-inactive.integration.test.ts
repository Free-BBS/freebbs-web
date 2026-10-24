import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { UserContext } from '@freebbs-development/contracts';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('revokes final-reviewer financial access when the development subject becomes inactive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-inactive-owner-'));
  directories.push(directory);
  const store = createMemoryStore();
  const owner: UserContext = {
    uid: 'financial-owner',
    displayName: '预算负责人',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
  };
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'main' },
    store,
    authClient: { introspect: async () => owner },
    financeDirectory: directory,
  });
  await store.roleAssignments.create({
    subjectUid: owner.uid,
    roleKey: 'counselor.youth_league',
    status: 'active',
    ownerUid: 'role-administrator',
    scope: { type: 'public', id: '*' },
    expiresAt: null,
  });
  const first = await request(app)
    .get('/api/development/v1/finance/tracking/access')
    .set('Authorization', 'Bearer owner-token')
    .expect(200);
  expect(first.body.data.canManageBudget).toBe(true);
  const subject = (await store.subjects.list({ query: owner.uid })).find(
    (item) => item.uid === owner.uid,
  );
  expect(subject).toBeDefined();
  await store.subjects.update(subject!.id, { status: 'inactive' });
  await request(app)
    .get('/api/development/v1/finance/tracking/access')
    .set('Authorization', 'Bearer owner-token')
    .expect(403);
  await request(app)
    .post('/api/development/v1/finance/tracking/projects')
    .set('Authorization', 'Bearer owner-token')
    .send({
      requestId: 'inactive-owner-create',
      year: '2026-2027',
      departmentId: 'youth_league.practice',
      code: '2-1-1',
      name: '实践项目',
      reimbursementCents: 10000,
      directPaymentCents: 0,
      notes: '',
    })
    .expect(403);
});
