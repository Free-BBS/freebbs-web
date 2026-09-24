import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';

const scope = { type: 'department', id: 'sports' };

function duplicateEntryError() {
  return Object.assign(new Error('Duplicate entry contains database details'), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });
}

describe('assignment repository conflicts', () => {
  it('enforces role and tag assignment uniqueness in memory', async () => {
    const store = createMemoryStore({ seed: false });
    const role = {
      subjectUid: 'uid-a',
      roleKey: 'department.sports_director' as const,
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    };
    const tag = {
      subjectUid: 'uid-a',
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-a' },
    };

    await store.roleAssignments.create(role);
    await expect(store.roleAssignments.create(role)).rejects.toMatchObject({
      name: 'RecordConflictError',
    });
    await store.tagAssignments.create(tag);
    await expect(store.tagAssignments.create(tag)).rejects.toMatchObject({
      name: 'RecordConflictError',
    });
  });

  it.each([
    ['role', 'roleAssignments', 'department.sports_director', scope],
    ['tag', 'tagAssignments', 'sports.team_captain', { type: 'sports_team', id: 'team-a' }],
  ] as const)(
    'maps MySQL duplicate %s writes to a database-neutral conflict',
    async (_kind, key, value, assignmentScope) => {
      const pool = {
        execute: vi.fn().mockRejectedValueOnce(duplicateEntryError()),
        end: vi.fn().mockResolvedValue(undefined),
      } as unknown as Pool;
      const handle = createMySqlStore({ pool });
      const repository = handle.store[key];
      const input =
        key === 'roleAssignments'
          ? {
              subjectUid: 'uid-a',
              roleKey: value,
              expiresAt: null,
              status: 'active',
              ownerUid: 'demo-admin',
              scope: assignmentScope,
            }
          : {
              subjectUid: 'uid-a',
              tagKey: value,
              expiresAt: null,
              status: 'active',
              ownerUid: 'demo-admin',
              scope: assignmentScope,
            };

      await expect(repository.create(input as never)).rejects.toMatchObject({
        name: 'RecordConflictError',
        message: 'Assignment already exists',
      });
    },
  );
});
