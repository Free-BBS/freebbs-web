import { describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createMemoryStore } from '../database/memory-store.js';
import { createAuthMiddleware, synchronizeSubject } from './auth-middleware.js';
import { DemoAuthClient } from './demo-auth-client.js';

const now = new Date('2026-07-27T10:00:00.000Z');
const identity: UserContext = {
  uid: 'main-user-42',
  displayName: 'Main User',
  avatarUrl: 'https://cdn.example/main-user.png',
  baseRole: 'student',
  roles: [],
  tags: [],
};

describe('main-site subject synchronization', () => {
  it('creates one production subject for the stable main-site uid', async () => {
    const store = createMemoryStore({ seed: false });

    const first = await synchronizeSubject(store, identity, now);
    const second = await synchronizeSubject(store, identity, now);

    expect(second.id).toBe(first.id);
    expect(await store.subjects.list()).toEqual([
      expect.objectContaining({
        uid: identity.uid,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        status: 'active',
        ownerUid: identity.uid,
        scope: { type: 'public', id: '*' },
      }),
    ]);
  });

  it('activates a pending roster subject when the matching main-site user signs in', async () => {
    const store = createMemoryStore({ seed: false });
    const existing = await store.subjects.create({
      uid: identity.uid,
      displayName: identity.displayName,
      avatarUrl: null,
      status: 'pending',
      ownerUid: 'sports-director',
      scope: { type: 'public', id: '*' },
    });

    const synchronized = await synchronizeSubject(store, identity, now);

    expect(synchronized).toMatchObject({
      id: existing.id,
      uid: identity.uid,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      status: 'active',
      ownerUid: 'sports-director',
      scope: { type: 'public', id: '*' },
    });
  });

  it('updates profile fields without reactivating or taking ownership of an existing subject', async () => {
    const store = createMemoryStore({ seed: false });
    const existing = await store.subjects.create({
      uid: identity.uid,
      displayName: 'Old Name',
      avatarUrl: null,
      status: 'inactive',
      ownerUid: 'governance-admin',
      scope: { type: 'department', id: 'arts' },
    });

    const synchronized = await synchronizeSubject(store, identity, now);

    expect(synchronized).toMatchObject({
      id: existing.id,
      uid: identity.uid,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      status: 'inactive',
      ownerUid: 'governance-admin',
      scope: { type: 'department', id: 'arts' },
    });
  });

  it('runs subject synchronization for main auth only', async () => {
    const mainStore = createMemoryStore({ seed: false });
    const mainAuthenticate = createAuthMiddleware({
      authClient: { introspect: vi.fn().mockResolvedValue(identity) },
      mode: 'main',
      store: mainStore,
      allowedUids: [identity.uid],
      now: () => now,
    });
    const demoStore = createMemoryStore({ seed: false });
    const demoAuthenticate = createAuthMiddleware({
      authClient: new DemoAuthClient(['demo-student']),
      mode: 'demo',
      store: demoStore,
      now: () => now,
    });

    await expect(mainAuthenticate({ authorization: 'Bearer main-token' })).resolves.toMatchObject({
      status: 200,
      user: { uid: identity.uid },
    });
    await expect(demoAuthenticate({ 'x-demo-user': 'demo-student' })).resolves.toMatchObject({
      status: 200,
      user: { uid: 'demo-student' },
    });

    expect(await mainStore.subjects.list()).toHaveLength(1);
    expect(await demoStore.subjects.list()).toEqual([]);
  });
});
