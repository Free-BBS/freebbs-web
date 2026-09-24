import { describe, expect, it } from 'vitest';

import { createMemoryStore } from '../database/memory-store.js';
import { resolveDevelopmentAccess } from './development-access.js';

const publicScope = { type: 'public', id: '*' } as const;

function identity(input: { uid: string; studentId: string | null; username: string | null }) {
  return {
    ...input,
    displayName: input.username ?? input.uid,
    avatarUrl: null,
    baseRole: 'student' as const,
    roles: [],
    tags: [],
  };
}

describe('development access identity matching', () => {
  it('does not fall back to student ID or username when a grant is bound to another UID', async () => {
    const store = createMemoryStore({ seed: false });
    await store.developmentAccess.create({
      subjectUid: 'uid-original',
      studentId: '2023010567',
      username: 'Yuchong',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'system',
      scope: publicScope,
    });

    await expect(
      resolveDevelopmentAccess(
        store,
        identity({ uid: 'uid-impostor', studentId: '2023010567', username: 'Yuchong' }),
      ),
    ).resolves.toBeNull();
  });

  it('does not fall back to username when a grant has a different student ID', async () => {
    const store = createMemoryStore({ seed: false });
    await store.developmentAccess.create({
      subjectUid: null,
      studentId: '2023010567',
      username: 'Yuchong',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'system',
      scope: publicScope,
    });

    await expect(
      resolveDevelopmentAccess(
        store,
        identity({ uid: 'uid-impostor', studentId: '2023999999', username: 'Yuchong' }),
      ),
    ).resolves.toBeNull();
  });

  it('uses a username only for a legacy grant with no UID or student ID', async () => {
    const store = createMemoryStore({ seed: false });
    await store.developmentAccess.create({
      subjectUid: null,
      studentId: null,
      username: 'Yuchong',
      accessLevel: 'member',
      status: 'active',
      ownerUid: 'system',
      scope: publicScope,
    });

    await expect(
      resolveDevelopmentAccess(
        store,
        identity({ uid: 'uid-yuchong', studentId: null, username: 'yuchong' }),
      ),
    ).resolves.toMatchObject({ subjectUid: 'uid-yuchong', accessLevel: 'member' });
  });
});
