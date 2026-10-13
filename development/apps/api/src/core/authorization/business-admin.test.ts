import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../database/memory-store.js';
import { businessAdminIdentities, effectiveGlobalBusinessAdmins } from './business-admin.js';
import type { UserDirectory } from '../auth/user-directory.js';

const publicScope = { type: 'public', id: '*' } as const;

async function fixture() {
  const store = createMemoryStore();
  await store.subjects.create({
    uid: 'admin',
    displayName: 'Admin',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'lead',
    scope: publicScope,
  });
  await store.roleAssignments.create({
    subjectUid: 'admin',
    roleKey: 'platform.admin',
    status: 'active',
    expiresAt: null,
    ownerUid: 'lead',
    scope: publicScope,
  });
  await store.developmentAccess.create({
    subjectUid: 'admin',
    studentId: null,
    username: 'admin',
    accessLevel: 'member',
    status: 'active',
    ownerUid: 'lead',
    scope: publicScope,
  });
  return {
    assignments: await store.roleAssignments.list(),
    roles: await store.roles.list(),
    subjects: await store.subjects.list(),
    access: await store.developmentAccess.list(),
  };
}

describe('effective global business administrator identities', () => {
  it.each(['bound', 'fallback'] as const)(
    'requires an existing main-site identity for %s admission when a directory snapshot is provided',
    async (admission) => {
      const { assignments, roles, subjects, access } = await fixture();
      expect(
        effectiveGlobalBusinessAdmins(
          assignments,
          roles,
          subjects,
          admission === 'bound' ? access : [],
          new Date(),
          [],
          admission === 'fallback' ? ['admin'] : [],
        ),
      ).toEqual(new Set());
    },
  );

  it('preserves bound admission when no authoritative directory is available', async () => {
    const { assignments, roles, subjects, access } = await fixture();
    const identities = await businessAdminIdentities(assignments);
    expect(
      effectiveGlobalBusinessAdmins(assignments, roles, subjects, access, new Date(), identities),
    ).toEqual(new Set(['admin']));
  });

  it('distinguishes absent directories from authoritative empty results', async () => {
    const { assignments } = await fixture();
    expect(await businessAdminIdentities(assignments)).toBeUndefined();
    expect(
      await businessAdminIdentities(assignments, {
        list: async () => [],
        get: async () => null,
      }),
    ).toEqual([]);
  });

  it('propagates directory failures instead of opening recovery', async () => {
    const { assignments } = await fixture();
    const failure = new Error('Directory unavailable');
    const directory: UserDirectory = {
      list: async () => [],
      get: async () => {
        throw failure;
      },
    };
    await expect(businessAdminIdentities(assignments, directory)).rejects.toBe(failure);
  });
});
