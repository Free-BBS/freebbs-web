import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';

const scope = { type: 'public', id: '*' };

async function addAuditLogs(count: number) {
  const store = createMemoryStore({ seed: false });
  for (let index = 1; index <= count; index += 1) {
    await store.auditLogs.create({
      actorUid: 'actor',
      action: `action-${index}`,
      resourceType: 'record',
      resourceId: String(index),
      details: {},
      status: index % 2 === 0 ? 'archived' : 'active',
      ownerUid: 'actor',
      scope,
    });
  }
  return store;
}

describe('RecordRepository page contract', () => {
  it('pages memory records with the same stable order as list', async () => {
    const store = await addAuditLogs(5);
    const listed = await store.auditLogs.list();

    expect(await store.auditLogs.page(undefined, { page: 2, pageSize: 2 })).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 5,
      items: listed.slice(2, 4),
    });
  });

  it('applies filters before paging and returns an empty out-of-range page', async () => {
    const store = await addAuditLogs(5);

    await expect(
      store.auditLogs.page({ status: 'active' }, { page: 3, pageSize: 2 }),
    ).resolves.toEqual({
      page: 3,
      pageSize: 2,
      total: 3,
      items: [],
    });
  });

  it.each([
    [{ page: 0, pageSize: 10 }, 'page'],
    [{ page: 1.5, pageSize: 10 }, 'page'],
    [{ page: 1, pageSize: 0 }, 'pageSize'],
    [{ page: 1, pageSize: 101 }, 'pageSize'],
    [{ page: 1, pageSize: 1.5 }, 'pageSize'],
  ] as const)('rejects invalid page request %j', async (request, field) => {
    const store = createMemoryStore({ seed: false });

    await expect(store.auditLogs.page(undefined, request)).rejects.toThrow(field);
  });

  it('uses parameterized MySQL count, limit and offset with deterministic ordering', async () => {
    const timestamp = '2026-07-22 00:00:00.000';
    const row = {
      id: 'audit-c',
      actor_uid: 'actor',
      action: 'updated',
      resource_type: 'record',
      resource_id: 'c',
      details: '{}',
      status: 'active',
      owner_uid: 'actor',
      scope_type: 'public',
      scope_id: '*',
      created_at: timestamp,
      updated_at: timestamp,
    };
    const pool = {
      execute: vi.fn().mockResolvedValueOnce([[{ total: 5 }], []]),
      query: vi.fn().mockResolvedValueOnce([[row], []]),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pool;
    const handle = createMySqlStore({ pool });

    const result = await handle.store.auditLogs.page(
      { status: 'active' },
      { page: 2, pageSize: 2 },
    );

    const execute = pool.execute as ReturnType<typeof vi.fn>;
    const query = pool.query as ReturnType<typeof vi.fn>;
    expect(execute.mock.calls[0]).toEqual([
      'SELECT COUNT(*) AS total FROM audit_logs WHERE status = ?',
      ['active'],
    ]);
    expect(query.mock.calls[0]?.[0]).toContain(
      'ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    );
    expect(query.mock.calls[0]?.[1]).toEqual(['active', 2, 2]);
    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 5, items: [{ id: 'audit-c' }] });
  });
});
