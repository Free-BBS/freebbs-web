import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from '../../core/database/memory-store.js';
import { createMySqlStore } from '../../core/database/mysql-store.js';
import { RecordConflictError } from '../../core/database/record-conflict-error.js';

const checkin = {
  teamId: 'team-a',
  memberUid: 'member-a',
  checkinDate: '2026-07-22',
  status: 'present',
  ownerUid: 'captain-a',
  scope: { type: 'sports_team', id: 'team-a' },
} as const;
const membership = {
  teamId: 'team-a',
  memberUid: 'member-a',
  status: 'active',
  ownerUid: 'sports-lead-a',
  scope: { type: 'sports_team', id: 'team-a' },
} as const;

describe('sports check-in store contract', () => {
  it('enforces the team, member, and date idempotency key in memory', async () => {
    const store = createMemoryStore({ seed: false });
    await store.sportsCheckins.create(checkin);
    await expect(store.sportsCheckins.create(checkin)).rejects.toBeInstanceOf(RecordConflictError);
  });

  it('maps MySQL duplicate details to a stable conflict', async () => {
    const pool = {
      execute: vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('Duplicate entry secret for uq_sports_checkin'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      ),
      getConnection: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const store = createMySqlStore({ pool: pool as unknown as Pool }).store;

    const failure = store.sportsCheckins.create(checkin);
    await expect(failure).rejects.toBeInstanceOf(RecordConflictError);
    await expect(failure).rejects.not.toThrow(/ER_DUP_ENTRY|uq_sports_checkin|secret/);
  });
});

describe('sports team member store contract', () => {
  it('enforces the team and member uniqueness key in memory', async () => {
    const store = createMemoryStore({ seed: false });
    await store.sportsTeamMembers.create(membership);
    await expect(store.sportsTeamMembers.create(membership)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
  });

  it('maps MySQL member duplicates to a stable conflict', async () => {
    const pool = {
      execute: vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('Duplicate member secret'), {
          code: 'ER_DUP_ENTRY',
          errno: 1062,
        }),
      ),
      getConnection: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    };
    const store = createMySqlStore({ pool: pool as unknown as Pool }).store;

    const failure = store.sportsTeamMembers.create(membership);
    await expect(failure).rejects.toBeInstanceOf(RecordConflictError);
    await expect(failure).rejects.not.toThrow(/ER_DUP_ENTRY|secret/);
  });
});
