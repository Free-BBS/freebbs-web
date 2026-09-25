import type { Pool } from 'mysql2/promise';
import { expect, it, vi } from 'vitest';

import { createMySqlStore } from './mysql-store.js';

it('round-trips activity startsAt as an absolute UTC DATETIME', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ affectedRows: 1 }, []])
    .mockResolvedValueOnce([
      [
        {
          id: 'activity-a',
          title: 'UTC activity',
          description: 'timezone-safe',
          club_id: null,
          starts_at: '2026-07-22 03:04:05.006',
          status: 'open',
          owner_uid: 'demo-admin',
          scope_type: 'public',
          scope_id: '*',
          created_at: '2026-07-20 00:00:00.000',
          updated_at: '2026-07-20 00:00:00.000',
        },
      ],
      [],
    ]);
  const pool = {
    execute,
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pool;
  const handle = createMySqlStore({ pool });

  const activity = await handle.store.activities.create({
    title: 'UTC activity',
    description: 'timezone-safe',
    clubId: null,
    startsAt: '2026-07-22T11:04:05.006+08:00',
    technicalSupportStatus: 'not_requested',
    technicalSupportNote: null,
    status: 'open',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });

  expect(execute.mock.calls[0]?.[1]).toContainEqual(new Date('2026-07-22T03:04:05.006Z'));
  expect(activity.startsAt).toBe('2026-07-22T03:04:05.006Z');
});
