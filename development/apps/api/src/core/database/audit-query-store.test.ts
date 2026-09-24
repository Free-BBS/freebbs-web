import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from './create-store.js';
import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';

const publicScope = { type: 'public', id: '*' } as const;
const from = '2026-07-27T10:00:00.000Z';
const to = '2026-07-27T10:00:00.000Z';

function newAudit(actorUid: string, resourceId = 'sports') {
  return {
    actorUid,
    action: 'admin.module.update',
    resourceType: 'module',
    resourceId,
    details: {},
    status: 'recorded',
    ownerUid: actorUid,
    scope: publicScope,
  };
}

function fakePool() {
  const pool = {
    execute: vi.fn(),
    query: vi.fn(),
    getConnection: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { pool, typedPool: pool as unknown as Pool };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bounded audit queries', () => {
  it('provides exact, inclusive, stable and bounded memory paging', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(from));
    const store = createMemoryStore({ seed: false });
    const first = await store.auditLogs.create(newAudit('actor-a'));
    const second = await store.auditLogs.create(newAudit('actor-a'));
    await store.auditLogs.create(newAudit('actor-b'));
    await store.auditLogs.create(newAudit('actor-a', 'finance'));
    const expectedIds = [first.id, second.id].sort((left, right) => right.localeCompare(left));

    const pageOne = await store.queryAuditLogs({
      actorUid: 'actor-a',
      action: 'admin.module.update',
      resourceType: 'module',
      resourceId: 'sports',
      from,
      to,
      page: 1,
      pageSize: 1,
    });
    const pageTwo = await store.queryAuditLogs({
      actorUid: 'actor-a',
      action: 'admin.module.update',
      resourceType: 'module',
      resourceId: 'sports',
      from,
      to,
      page: 2,
      pageSize: 1,
    });

    expect(pageOne).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(pageOne.items.map(({ id }) => id)).toEqual([expectedIds[0]]);
    expect(pageTwo.items.map(({ id }) => id)).toEqual([expectedIds[1]]);
  });

  it('uses exact parameterized MySQL predicates, count and stable bounded ordering', async () => {
    const { pool, typedPool } = fakePool();
    const timestamp = '2026-07-27 10:00:00.000';
    pool.execute.mockResolvedValueOnce([[{ total: 2 }], []]);
    pool.query.mockResolvedValueOnce([
      [
        {
          id: 'audit-b',
          actor_uid: 'actor-a',
          action: 'admin.module.update',
          resource_type: 'module',
          resource_id: 'sports',
          details: '{}',
          status: 'recorded',
          owner_uid: 'actor-a',
          scope_type: 'public',
          scope_id: '*',
          created_at: timestamp,
          updated_at: timestamp,
        },
      ],
      [],
    ]);
    const handle = createMySqlStore({ pool: typedPool });

    const result = await handle.store.queryAuditLogs({
      actorUid: 'actor-a',
      action: 'admin.module.update',
      resourceType: 'module',
      resourceId: 'sports',
      from,
      to,
      page: 2,
      pageSize: 1,
    });

    const [countSql, countValues] = pool.execute.mock.calls[0] ?? [];
    const [selectSql, selectValues] = pool.query.mock.calls[0] ?? [];
    expect(countSql).toBe(
      'SELECT COUNT(*) AS total FROM audit_logs WHERE actor_uid = ? AND action = ? AND resource_type = ? AND resource_id = ? AND created_at >= ? AND created_at <= ?',
    );
    expect(countValues).toEqual([
      'actor-a',
      'admin.module.update',
      'module',
      'sports',
      new Date(from),
      new Date(to),
    ]);
    expect(selectSql).toBe(
      'SELECT * FROM audit_logs WHERE actor_uid = ? AND action = ? AND resource_type = ? AND resource_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    );
    expect(selectValues).toEqual([...countValues, 1, 1]);
    expect(result).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 1,
      items: [{ id: 'audit-b', createdAt: from }],
    });
  });

  it('reports zero applied migrations for the memory store handle', async () => {
    const handle = createStore({ DATA_MODE: 'memory' });

    await expect(handle.getAppliedMigrationCount()).resolves.toBe(0);
    await handle.close();
  });

  it('reads the applied migration count with one parameter-free query', async () => {
    const { pool, typedPool } = fakePool();
    pool.execute.mockResolvedValueOnce([[{ total: 4 }], []]);
    const handle = createMySqlStore({ pool: typedPool });

    await expect(handle.getAppliedMigrationCount()).resolves.toBe(4);
    expect(pool.execute).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS total FROM development_schema_migrations',
    );
  });
});
