import type { Pool, PoolConnection } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';

function fakeMySql() {
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

const publicRecord = {
  status: 'open',
  owner_uid: 'owner',
  scope_type: 'public',
  scope_id: '*',
  created_at: '2026-07-22 00:00:00.000',
  updated_at: '2026-07-22 00:00:00.000',
};

describe('Task 6 store contracts', () => {
  it('counts active liaison teams only for the bounded problem page on both adapters', async () => {
    const memory = createMemoryStore({ seed: false });
    await memory.subjects.create({
      uid: 'owner',
      displayName: 'Owner',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'owner',
      scope: { type: 'self', id: 'owner' },
    });
    const problem = await memory.liaisonProblems.create({
      title: 'Bounded aggregate',
      summary: 'Count teams for one page.',
      background: 'Contract fixture',
      sourceType: 'campus',
      sourceName: 'Campus',
      tags: [],
      expectedOutcome: 'A stable aggregate',
      constraints: '',
      startsAt: null,
      deadline: null,
      publicContact: '',
      internalContactNote: '',
      recorderUid: 'owner',
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: null,
      status: 'open',
      ownerUid: 'owner',
      scope: { type: 'public', id: '*' },
    });
    for (const [name, status] of [
      ['Active team', 'active'],
      ['Inactive team', 'inactive'],
    ] as const) {
      await memory.liaisonTeams.create({
        problemId: problem.id,
        name,
        proposal: 'Test proposal',
        maintainerUid: 'owner',
        status,
        ownerUid: 'owner',
        scope: { type: 'liaison_problem', id: problem.id },
      });
    }
    await expect(
      memory.liaisonTeams.countActiveByProblemIds([problem.id, 'missing']),
    ).resolves.toEqual({ [problem.id]: 1 });

    const fake = fakeMySql();
    fake.pool.execute.mockResolvedValueOnce([[{ problem_id: 'problem-a', total: 2 }], []]);
    const mysql = createMySqlStore({ pool: fake.typedPool });
    await expect(
      mysql.store.liaisonTeams.countActiveByProblemIds(['problem-a', 'problem-b']),
    ).resolves.toEqual({ 'problem-a': 2 });
    expect(fake.pool.execute.mock.calls[0]).toEqual([
      expect.stringMatching(/liaison_teams.*problem_id IN \(\?, \?\).*GROUP BY problem_id/),
      ['active', 'problem-a', 'problem-b'],
    ]);
  });

  it('enforces active membership and registration uniqueness in memory and permits recreate after delete', async () => {
    const store = createMemoryStore({ seed: false });
    const membershipInput = {
      clubId: 'club-a',
      memberUid: 'uid-a',
      status: 'active',
      ownerUid: 'uid-a',
      scope: { type: 'club', id: 'club-a' },
    } as const;
    const registrationInput = {
      activityId: 'activity-a',
      participantUid: 'uid-a',
      status: 'registered',
      ownerUid: 'uid-a',
      scope: { type: 'activity', id: 'activity-a' },
    } as const;

    const membership = await store.clubMemberships.create(membershipInput);
    await expect(store.clubMemberships.create(membershipInput)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
    expect(await store.clubMemberships.delete(membership.id)).toBe(true);
    await expect(store.clubMemberships.create(membershipInput)).resolves.toMatchObject(
      membershipInput,
    );

    const registration = await store.activityRegistrations.create(registrationInput);
    await expect(store.activityRegistrations.create(registrationInput)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
    expect(await store.activityRegistrations.delete(registration.id)).toBe(true);
    await expect(store.activityRegistrations.create(registrationInput)).resolves.toMatchObject(
      registrationInput,
    );
  });

  it('allows row locking only on a transaction connection and emits SELECT FOR UPDATE', async () => {
    const memory = createMemoryStore({ seed: false });
    await expect(memory.activities.getForUpdate('activity-a')).rejects.toThrow('transaction');
    await expect(memory.activities.listForUpdate()).rejects.toThrow('transaction');

    const outside = fakeMySql();
    const outsideHandle = createMySqlStore({ pool: outside.typedPool });
    await expect(outsideHandle.store.activities.getForUpdate('activity-a')).rejects.toThrow(
      'transaction',
    );
    await expect(outsideHandle.store.activities.listForUpdate()).rejects.toThrow('transaction');
    expect(outside.pool.execute).not.toHaveBeenCalled();

    const inside = fakeMySql();
    inside.connection.execute.mockResolvedValueOnce([
      [
        {
          id: 'activity-a',
          ...publicRecord,
          title: 'Locked activity',
          description: 'Concurrent registration guard',
          club_id: null,
          starts_at: null,
        },
      ],
      [],
    ]);
    const insideHandle = createMySqlStore({ pool: inside.typedPool });
    const activity = await insideHandle.store.transaction((store) =>
      store.activities.getForUpdate('activity-a'),
    );

    expect(activity?.id).toBe('activity-a');
    expect(inside.connection.execute.mock.calls[0]?.[0]).toMatch(/SELECT .* FOR UPDATE$/);
    expect(inside.pool.execute).not.toHaveBeenCalled();

    const registrationLock = fakeMySql();
    registrationLock.connection.execute.mockResolvedValueOnce([[], []]);
    const registrationHandle = createMySqlStore({ pool: registrationLock.typedPool });
    await registrationHandle.store.transaction((store) =>
      store.activityRegistrations.listForUpdate({ query: 'activity-a' }),
    );
    expect(registrationLock.connection.execute.mock.calls[0]?.[0]).toMatch(
      /activity_registrations.*LIKE \?.*FOR UPDATE$/,
    );
  });

  it('maps MySQL membership and registration duplicate errors to stable conflicts', async () => {
    for (const repositoryName of ['clubMemberships', 'activityRegistrations'] as const) {
      const fake = fakeMySql();
      fake.pool.execute.mockRejectedValueOnce(
        Object.assign(new Error('Duplicate entry secret-key for key uq_secret'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      );
      const handle = createMySqlStore({ pool: fake.typedPool });
      const input =
        repositoryName === 'clubMemberships'
          ? {
              clubId: 'club-a',
              memberUid: 'uid-a',
              status: 'active',
              ownerUid: 'uid-a',
              scope: { type: 'club', id: 'club-a' },
            }
          : {
              activityId: 'activity-a',
              participantUid: 'uid-a',
              status: 'registered',
              ownerUid: 'uid-a',
              scope: { type: 'activity', id: 'activity-a' },
            };

      const failure = handle.store[repositoryName].create(input as never);
      await expect(failure).rejects.toBeInstanceOf(RecordConflictError);
      await expect(failure).rejects.not.toThrow(/ER_DUP_ENTRY|secret-key/);
    }
  });
});
