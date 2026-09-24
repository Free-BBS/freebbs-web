import type { Pool, PoolConnection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { buildMySqlPoolOptions, createMySqlStore } from './mysql-store.js';

const timestamp = '2026-07-22 08:09:10.123';
const baseRow = {
  status: 'published',
  owner_uid: 'demo-admin',
  scope_type: 'public',
  scope_id: '*',
  created_at: timestamp,
  updated_at: timestamp,
};

function createFakes() {
  const connection = {
    execute: vi.fn(),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
  const pool = {
    execute: vi.fn(),
    getConnection: vi.fn().mockResolvedValue(connection),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return {
    connection,
    pool,
    typedPool: pool as unknown as Pool,
    typedConnection: connection as unknown as PoolConnection,
  };
}

describe('MySQL store transactions', () => {
  it('uses deterministic current reads for transaction list locks', async () => {
    const { connection, typedPool } = createFakes();
    connection.execute.mockResolvedValueOnce([[], []]);
    const handle = createMySqlStore({ pool: typedPool });

    await handle.store.transaction((store) =>
      store.roleAssignments.listForUpdate({ query: 'platform.super_admin' }),
    );

    expect(connection.execute.mock.calls[0]?.[0]).toMatch(
      /SELECT \* FROM role_assignments.*ORDER BY id FOR UPDATE$/,
    );
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('releases a connection when beginTransaction fails', async () => {
    const { connection, typedPool } = createFakes();
    connection.beginTransaction.mockRejectedValueOnce(new Error('begin failed'));
    const handle = createMySqlStore({ pool: typedPool });

    await expect(handle.store.transaction(async () => undefined)).rejects.toThrow('begin failed');
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('binds repositories to the transaction connection and commits', async () => {
    const { connection, pool, typedPool } = createFakes();
    connection.execute.mockResolvedValueOnce([
      [
        {
          id: 'knowledge-a',
          ...baseRow,
          entry_type: 'faq',
          title: '事务内读取',
          body: '使用同一连接。',
        },
      ],
      [],
    ]);
    const handle = createMySqlStore({ pool: typedPool });

    const result = await handle.store.transaction((store) => store.knowledge.get('knowledge-a'));

    expect(result?.title).toBe('事务内读取');
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(pool.execute).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases when the transaction operation fails', async () => {
    const { connection, typedPool } = createFakes();
    const handle = createMySqlStore({ pool: typedPool });

    await expect(
      handle.store.transaction(async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});

describe('MySQL store mappings and binding', () => {
  it('configures the driver to interpret DATETIME values as UTC', () => {
    expect(
      buildMySqlPoolOptions({
        host: '127.0.0.1',
        port: 3306,
        user: 'development',
        password: 'secret',
        database: 'free_bbs_development',
      }),
    ).toMatchObject({ timezone: 'Z', dateStrings: true });
  });

  it('binds CRUD values and never interpolates record data into SQL identifiers', async () => {
    const { pool, typedPool } = createFakes();
    const row = {
      id: 'knowledge-a',
      ...baseRow,
      entry_type: 'faq',
      title: "title'); DROP TABLE subjects; --",
      body: 'parameterized',
    };
    pool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ ...row, status: 'archived' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const handle = createMySqlStore({ pool: typedPool });

    const created = await handle.store.knowledge.create({
      type: 'faq',
      title: row.title,
      body: row.body,
      status: 'published',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await handle.store.knowledge.update(created.id, { status: 'archived' });
    await handle.store.knowledge.delete(created.id);

    const [insertSql, insertValues] = pool.execute.mock.calls[0] ?? [];
    expect(insertSql).toContain('INSERT INTO knowledge_entries');
    expect(insertSql).not.toContain(row.title);
    expect(insertValues).toContain(row.title);
    expect(pool.execute.mock.calls[2]?.[0]).toContain('UPDATE knowledge_entries');
    expect(pool.execute.mock.calls[4]?.[0]).toBe('DELETE FROM knowledge_entries WHERE id = ?');
  });

  it('escapes LIKE wildcard input with an explicit escape character', async () => {
    const { pool, typedPool } = createFakes();
    pool.execute.mockResolvedValueOnce([[], []]);
    const handle = createMySqlStore({ pool: typedPool });

    await handle.store.knowledge.list({ query: String.raw`50%_\done` });

    const [sql, values] = pool.execute.mock.calls[0] ?? [];
    expect(sql).toContain(String.raw`ESCAPE '\\'`);
    expect(values).toEqual([String.raw`%50\%\_\\done%`, String.raw`50%_\done`]);
  });

  it('rejects invalid page requests before querying MySQL', async () => {
    const { pool, typedPool } = createFakes();
    const handle = createMySqlStore({ pool: typedPool });

    await expect(
      handle.store.auditLogs.page(undefined, { page: 1, pageSize: 101 }),
    ).rejects.toThrow('pageSize');
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('round-trips UTC DATETIME and calendar DATE fields consistently', async () => {
    const { pool, typedPool } = createFakes();
    pool.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([
        [
          {
            id: 'assignment-a',
            ...baseRow,
            subject_uid: 'uid-a',
            role_key: 'platform.super_admin',
            expires_at: '2027-01-02 03:04:05.006',
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([
        [
          {
            id: 'checkin-a',
            ...baseRow,
            team_id: 'team-a',
            member_uid: 'uid-a',
            checkin_date: '2026-07-22',
          },
        ],
        [],
      ]);
    const handle = createMySqlStore({ pool: typedPool });

    const assignment = await handle.store.roleAssignments.create({
      subjectUid: 'uid-a',
      roleKey: 'platform.super_admin',
      expiresAt: '2027-01-02T03:04:05.006Z',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const checkin = await handle.store.sportsCheckins.create({
      teamId: 'team-a',
      memberUid: 'uid-a',
      checkinDate: '2026-07-22',
      status: 'present',
      ownerUid: 'uid-a',
      scope: { type: 'sports_team', id: 'team-a' },
    });

    expect(assignment.expiresAt).toBe('2027-01-02T03:04:05.006Z');
    expect(assignment.createdAt).toBe('2026-07-22T08:09:10.123Z');
    expect(pool.execute.mock.calls[0]?.[1]).toContainEqual(new Date('2027-01-02T03:04:05.006Z'));
    expect(checkin.checkinDate).toBe('2026-07-22');
    expect(pool.execute.mock.calls[2]?.[1]).toContain('2026-07-22');
  });

  it('rejects unsafe integer cents on write and read', async () => {
    const write = createFakes();
    const writeHandle = createMySqlStore({ pool: write.typedPool });
    await expect(
      writeHandle.store.financeRecords.create({
        title: 'unsafe',
        kind: 'budget',
        amountCents: Number.MAX_SAFE_INTEGER + 1,
        activityId: null,
        status: 'draft',
        ownerUid: 'demo-admin',
        scope: { type: 'public', id: '*' },
      }),
    ).rejects.toThrow('safe integer');
    expect(write.pool.execute).not.toHaveBeenCalled();

    const read = createFakes();
    read.pool.execute.mockResolvedValueOnce([
      [
        {
          id: 'finance-a',
          ...baseRow,
          title: 'unsafe stored value',
          record_kind: 'budget',
          amount_cents: '9007199254740992',
          activity_id: null,
        },
      ],
      [],
    ]);
    const readHandle = createMySqlStore({ pool: read.typedPool });
    await expect(readHandle.store.financeRecords.get('finance-a')).rejects.toThrow('safe integer');
  });
});
