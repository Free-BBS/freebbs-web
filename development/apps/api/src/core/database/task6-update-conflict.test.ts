import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';

describe('Task 6 update uniqueness', () => {
  it('rejects membership and registration key collisions in memory without changing the record', async () => {
    const store = createMemoryStore({ seed: false });
    const membershipA = await store.clubMemberships.create({
      clubId: 'club-a',
      memberUid: 'uid-a',
      status: 'active',
      ownerUid: 'uid-a',
      scope: { type: 'club', id: 'club-a' },
    });
    const membershipB = await store.clubMemberships.create({
      clubId: 'club-a',
      memberUid: 'uid-b',
      status: 'active',
      ownerUid: 'uid-b',
      scope: { type: 'club', id: 'club-a' },
    });
    await expect(
      store.clubMemberships.update(membershipB.id, { memberUid: membershipA.memberUid }),
    ).rejects.toBeInstanceOf(RecordConflictError);
    expect(await store.clubMemberships.get(membershipB.id)).toMatchObject({ memberUid: 'uid-b' });

    const registrationA = await store.activityRegistrations.create({
      activityId: 'activity-a',
      participantUid: 'uid-a',
      status: 'registered',
      ownerUid: 'uid-a',
      scope: { type: 'activity', id: 'activity-a' },
    });
    const registrationB = await store.activityRegistrations.create({
      activityId: 'activity-a',
      participantUid: 'uid-b',
      status: 'registered',
      ownerUid: 'uid-b',
      scope: { type: 'activity', id: 'activity-a' },
    });
    await expect(
      store.activityRegistrations.update(registrationB.id, {
        participantUid: registrationA.participantUid,
      }),
    ).rejects.toBeInstanceOf(RecordConflictError);
    expect(await store.activityRegistrations.get(registrationB.id)).toMatchObject({
      participantUid: 'uid-b',
    });
  });

  it('maps MySQL update duplicate errors to stable conflicts', async () => {
    for (const repositoryName of ['clubMemberships', 'activityRegistrations'] as const) {
      const pool = {
        execute: vi.fn().mockRejectedValueOnce(
          Object.assign(new Error('Duplicate entry secret-key for key uq_secret'), {
            code: 'ER_DUP_ENTRY',
            errno: 1062,
          }),
        ),
        getConnection: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
      };
      const handle = createMySqlStore({ pool: pool as unknown as Pool });
      const patch =
        repositoryName === 'clubMemberships' ? { memberUid: 'uid-a' } : { participantUid: 'uid-a' };

      const failure = handle.store[repositoryName].update('record-b', patch as never);
      await expect(failure).rejects.toBeInstanceOf(RecordConflictError);
      await expect(failure).rejects.not.toThrow(/ER_DUP_ENTRY|secret-key/);
    }
  });
});
