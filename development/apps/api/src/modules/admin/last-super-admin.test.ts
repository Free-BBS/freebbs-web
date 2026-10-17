import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { archiveRoleAssignment } from './assignment-service.js';

import type {
  DevelopmentStore,
  RecordRepository,
  StoredRecord,
} from '../../core/database/types.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const publicScope = { type: 'public', id: '*' } as const;

function appWithStore(store: DevelopmentStore) {
  return createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
  });
}

async function grantSecondSuperAdmin(store: DevelopmentStore, subjectUid: string) {
  await store.subjects.create({
    uid: subjectUid,
    displayName: subjectUid,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
  return store.roleAssignments.create({
    subjectUid,
    roleKey: 'platform.super_admin',
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: publicScope,
  });
}

function instrumentCurrentReads<T extends StoredRecord>(
  repository: RecordRepository<T>,
  label: string,
  readOrder: string[],
): RecordRepository<T> {
  return new Proxy(repository, {
    get(target, property) {
      if (property === 'listForUpdate') {
        return async (filters?: Parameters<RecordRepository<T>['list']>[0]) => {
          readOrder.push(label);
          return (await target.list(filters)).sort((left, right) =>
            left.id.localeCompare(right.id),
          );
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('last platform super administrator protection', () => {
  it('protects the reserved lead on HTTP and keeps internal last-lead recovery protection', async () => {
    const store = createMemoryStore();
    const app = appWithStore(store);

    const response = await request(app)
      .delete('/api/development/v1/admin/role-assignments/assignment-admin')
      .set(adminHeaders)
      .expect(409);

    expect(response.body).toEqual({
      data: {
        error: {
          code: 'protected_development_lead',
          message: '发展端负责人须通过准入管理修改',
        },
      },
      requestId: expect.any(String),
    });
    await expect(
      archiveRoleAssignment(store, 'assignment-admin', { actorUid: 'recovery-admin' }),
    ).rejects.toMatchObject({ status: 409, code: 'last_super_admin' });
    expect(await store.roleAssignments.get('assignment-admin')).toMatchObject({ status: 'active' });
    expect(await store.auditLogs.list({ query: 'admin.role_assignment.revoke' })).toEqual([]);
  });

  it('locks and protects reserved HTTP assignments while preserving internal recovery lock order', async () => {
    const baseStore = createMemoryStore();
    await grantSecondSuperAdmin(baseStore, 'main-second-admin');
    const readOrder: string[] = [];
    const store: DevelopmentStore = {
      ...baseStore,
      transaction: (operation) =>
        baseStore.transaction((transactionStore) =>
          operation({
            ...transactionStore,
            roles: instrumentCurrentReads(transactionStore.roles, 'roles', readOrder),
            roleAssignments: instrumentCurrentReads(
              transactionStore.roleAssignments,
              'assignments',
              readOrder,
            ),
            subjects: instrumentCurrentReads(transactionStore.subjects, 'subjects', readOrder),
          }),
        ),
    };
    const app = appWithStore(store);

    await request(app)
      .delete('/api/development/v1/admin/role-assignments/assignment-admin')
      .set(adminHeaders)
      .expect(409);

    expect(readOrder).toEqual(['roles', 'roles', 'assignments']);
    expect(await baseStore.roleAssignments.get('assignment-admin')).toMatchObject({
      status: 'active',
    });
    readOrder.length = 0;
    await archiveRoleAssignment(store, 'assignment-admin', { actorUid: 'recovery-admin' });

    expect(readOrder).toEqual(['roles', 'roles', 'assignments', 'subjects']);
    expect(await baseStore.roleAssignments.get('assignment-admin')).toMatchObject({
      status: 'inactive',
    });
  });
  it('uses current locking reads in canonical role, assignment, subject order', async () => {
    const baseStore = createMemoryStore();
    await grantSecondSuperAdmin(baseStore, 'main-current-read-admin');
    const readOrder: string[] = [];
    const store: DevelopmentStore = {
      ...baseStore,
      transaction: (operation) =>
        baseStore.transaction((transactionStore) =>
          operation({
            ...transactionStore,
            roles: instrumentCurrentReads(transactionStore.roles, 'roles', readOrder),
            roleAssignments: instrumentCurrentReads(
              transactionStore.roleAssignments,
              'assignments',
              readOrder,
            ),
            subjects: instrumentCurrentReads(transactionStore.subjects, 'subjects', readOrder),
          }),
        ),
    };

    await archiveRoleAssignment(store, 'assignment-admin', { actorUid: 'demo-admin' });

    expect(readOrder).toEqual(['roles', 'roles', 'assignments', 'subjects']);
  });
  it('serializes concurrent revocations of different assignments and leaves one effective admin', async () => {
    const store = createMemoryStore();
    const second = await grantSecondSuperAdmin(store, 'main-concurrent-admin');
    const results = await Promise.allSettled([
      archiveRoleAssignment(store, 'assignment-admin', { actorUid: 'demo-admin' }),
      archiveRoleAssignment(store, second.id, { actorUid: 'demo-admin' }),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toMatchObject({ status: 409, code: 'last_super_admin' });
    const assignments = await store.roleAssignments.list({ query: 'platform.super_admin' });
    expect(assignments.filter(({ status }) => status === 'active')).toHaveLength(1);
    expect(assignments.filter(({ status }) => status === 'inactive')).toHaveLength(1);
  });

  it('allows archiving a super-admin assignment when the canonical role is inactive', async () => {
    const store = createMemoryStore();
    const role = (await store.roles.list({ query: 'platform.super_admin' })).find(
      ({ key }) => key === 'platform.super_admin',
    );
    if (role === undefined) throw new Error('super admin role is missing');
    await store.roles.update(role.id, { status: 'inactive' });

    const archived = await archiveRoleAssignment(store, 'assignment-admin', {
      actorUid: 'recovery-admin',
    });

    expect(archived.status).toBe('inactive');
  });
  it('does not count inactive subjects or expired assignments as effective admins', async () => {
    const store = createMemoryStore();
    const expired = await grantSecondSuperAdmin(store, 'main-expired-admin');
    await store.roleAssignments.update(expired.id, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const app = appWithStore(store);

    await request(app)
      .delete('/api/development/v1/admin/role-assignments/assignment-admin')
      .set(adminHeaders)
      .expect(409);
    await expect(
      archiveRoleAssignment(store, 'assignment-admin', { actorUid: 'recovery-admin' }),
    ).rejects.toMatchObject({ status: 409, code: 'last_super_admin' });

    const subject = (await store.subjects.list({ query: 'main-expired-admin' })).find(
      ({ uid }) => uid === 'main-expired-admin',
    );
    if (subject === undefined) throw new Error('second admin subject is missing');
    await store.subjects.update(subject.id, { status: 'inactive' });

    await request(app)
      .delete(`/api/development/v1/admin/role-assignments/${expired.id}`)
      .set(adminHeaders)
      .expect(409);
    expect(
      (await archiveRoleAssignment(store, expired.id, { actorUid: 'recovery-admin' })).status,
    ).toBe('inactive');
  });
});
