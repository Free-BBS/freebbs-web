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
    store,
    assignments: await store.roleAssignments.list(),
    roles: await store.roles.list(),
    subjects: await store.subjects.list(),
    access: await store.developmentAccess.list(),
  };
}

describe('effective global business administrator identities', () => {
  it('counts current global dual administrators and an existing configured root, excluding local and learning-only roles', async () => {
    const { store } = await fixture();
    for (const [uid, roleKey, scope, expiresAt] of [
      ['dual', 'counselor.student_development', publicScope, null],
      [
        'local',
        'counselor.youth_league',
        { type: 'department', id: 'youth_league.organization' },
        null,
      ],
      ['expired', 'counselor.youth_league_secretary', publicScope, '2000-01-01T00:00:00Z'],
      ['learning', 'platform.learning_admin', publicScope, null],
    ] as const) {
      await store.subjects.create({
        uid,
        displayName: uid,
        avatarUrl: null,
        status: 'active',
        ownerUid: 'test',
        scope: publicScope,
      });
      await store.roleAssignments.create({
        subjectUid: uid,
        roleKey,
        status: 'active',
        expiresAt,
        ownerUid: 'test',
        scope,
      });
    }
    const root = 'u_48370eb1aba453c7';
    const load = async () =>
      effectiveGlobalBusinessAdmins(
        await store.roleAssignments.list(),
        await store.roles.list(),
        await store.subjects.list(),
        [],
        new Date(),
      );
    expect(await load()).toEqual(new Set(['admin', 'demo-admin', 'dual']));
    await store.subjects.create({
      uid: root,
      displayName: 'Root',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'test',
      scope: publicScope,
    });
    expect(await load()).toEqual(new Set(['admin', 'demo-admin', 'dual', root]));
  });
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

  it('counts all active stored administrators when no authoritative directory is available', async () => {
    const { assignments, roles, subjects, access } = await fixture();
    const identities = await businessAdminIdentities(assignments);
    expect(
      effectiveGlobalBusinessAdmins(assignments, roles, subjects, access, new Date(), identities),
    ).toEqual(new Set(['admin', 'demo-admin']));
  });

  it.each(['missing', 'archived'] as const)(
    'counts an active verified global administrator with %s admission metadata',
    async (state) => {
      const { assignments, roles, subjects, access } = await fixture();
      const identities = [
        { uid: 'admin', username: 'admin', displayName: 'Admin', studentId: null, avatarUrl: null },
      ];
      expect(
        effectiveGlobalBusinessAdmins(
          assignments,
          roles,
          subjects,
          state === 'missing' ? [] : access.map((grant) => ({ ...grant, status: 'archived' })),
          new Date(),
          identities,
        ),
      ).toEqual(new Set(['admin']));
      expect(
        effectiveGlobalBusinessAdmins(
          assignments,
          roles,
          subjects.map((subject) => ({ ...subject, status: 'inactive' })),
          [],
          new Date(),
          identities,
        ),
      ).toEqual(new Set());
    },
  );

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
