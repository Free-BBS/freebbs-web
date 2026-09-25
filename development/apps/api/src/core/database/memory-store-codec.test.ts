import { describe, expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

const scope = { type: 'public', id: '*' };

describe('memory store value codecs', () => {
  it('applies the same temporal and safe-integer contract as MySQL', async () => {
    const store = createMemoryStore({ seed: false });
    const assignment = await store.roleAssignments.create({
      subjectUid: 'uid-a',
      roleKey: 'platform.super_admin',
      expiresAt: '2027-01-02T11:04:05.006+08:00',
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    });
    expect(assignment.expiresAt).toBe('2027-01-02T03:04:05.006Z');

    await expect(
      store.sportsCheckins.create({
        teamId: 'team-a',
        memberUid: 'uid-a',
        checkinDate: '2026-7-2',
        status: 'present',
        ownerUid: 'uid-a',
        scope: { type: 'sports_team', id: 'team-a' },
      }),
    ).rejects.toThrow('calendar date');
    await expect(
      store.financeRecords.create({
        title: 'unsafe',
        kind: 'budget',
        amountCents: Number.MAX_SAFE_INTEGER + 1,
        activityId: null,
        status: 'draft',
        ownerUid: 'demo-admin',
        scope,
      }),
    ).rejects.toThrow('safe integer');
  });
});
