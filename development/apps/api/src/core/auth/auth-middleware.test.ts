import { describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from '../../config/env.js';
import { authorize } from '../authorization/authorize.js';
import { bootstrapPlatform } from '../bootstrap/bootstrap-service.js';
import { createMemoryStore } from '../database/memory-store.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { DemoAuthClient } from './demo-auth-client.js';
import { IdentityProviderUnavailableError } from './auth-client.js';
import { MainSiteAuthClient } from './main-site-auth-client.js';

import type { AuthClient } from './auth-client.js';

describe('authentication middleware', () => {
  it('uses the development-owned allowlist and permits only leads to preview a real user', async () => {
    const store = createMemoryStore();
    await store.developmentAccess.create({
      subjectUid: 'u_lead',
      studentId: '2023010567',
      username: 'Yuchong',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'system',
      scope: { type: 'public', id: '*' },
    });
    await store.developmentAccess.create({
      subjectUid: 'u_member',
      studentId: '2023000002',
      username: 'Member',
      accessLevel: 'member',
      status: 'active',
      ownerUid: 'u_lead',
      scope: { type: 'public', id: '*' },
    });
    const identities = new Map([
      [
        'lead',
        { uid: 'u_lead', username: 'Yuchong', studentId: '2023010567', displayName: 'Yuchong' },
      ],
      [
        'member',
        { uid: 'u_member', username: 'Member', studentId: '2023000002', displayName: 'Member' },
      ],
    ]);
    const context = (token: string) => {
      const identity = identities.get(token);
      return identity
        ? { ...identity, avatarUrl: null, baseRole: 'student' as const, roles: [], tags: [] }
        : null;
    };
    const directory = {
      list: async () => [],
      get: async (uid: string) => {
        const identity = [...identities.values()].find((candidate) => candidate.uid === uid);
        return identity ? { ...identity, avatarUrl: null } : null;
      },
    };
    const authenticate = createAuthMiddleware({
      authClient: { introspect: async (token) => context(token) },
      mode: 'main',
      store,
      userDirectory: directory,
    });

    await expect(
      authenticate({ authorization: 'Bearer lead', 'x-development-preview-uid': 'u_member' }),
    ).resolves.toMatchObject({
      status: 200,
      user: {
        uid: 'u_member',
        previewing: true,
        viewer: { uid: 'u_lead', canManageDevelopment: true },
      },
    });
    await expect(
      authenticate({ authorization: 'Bearer member', 'x-development-preview-uid': 'u_lead' }),
    ).resolves.toMatchObject({ status: 403, code: 'preview_identity_denied' });
    await expect(authenticate({ authorization: 'Bearer unknown' })).resolves.toMatchObject({
      status: 401,
      code: 'invalid_identity',
    });
  });
  it('denies a main-site identity outside the preview list before creating a subject', async () => {
    const store = createMemoryStore({ seed: false });
    const authenticate = createAuthMiddleware({
      authClient: {
        introspect: async (token) => ({
          uid: token === 'allowed' ? 'u_allowed' : 'u_other',
          displayName: 'Main user',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [],
        }),
      },
      mode: 'main',
      store,
      allowedUids: ['u_allowed'],
    });

    await expect(authenticate({ authorization: 'Bearer denied' })).resolves.toMatchObject({
      status: 403,
      code: 'preview_access_denied',
    });
    expect(await store.subjects.list({ query: 'u_other' })).toEqual([]);
    await expect(authenticate({ authorization: 'Bearer allowed' })).resolves.toMatchObject({
      status: 200,
      user: { uid: 'u_allowed' },
    });
  });
  it('returns 401 for a missing bearer token without calling the provider', async () => {
    const introspect = vi.fn<AuthClient['introspect']>();
    const authenticate = createAuthMiddleware({ authClient: { introspect }, mode: 'main' });

    await expect(authenticate({})).resolves.toMatchObject({
      status: 401,
      code: 'missing_identity',
    });
    expect(introspect).not.toHaveBeenCalled();
  });

  it('returns 401 when the identity provider rejects a bearer token', async () => {
    const introspect = vi.fn<AuthClient['introspect']>().mockResolvedValue(null);
    const authenticate = createAuthMiddleware({ authClient: { introspect }, mode: 'main' });

    await expect(authenticate({ authorization: 'Bearer invalid' })).resolves.toMatchObject({
      status: 401,
      code: 'invalid_identity',
    });
  });

  it('returns 503 when the main identity provider is unavailable', async () => {
    const introspect = vi
      .fn<AuthClient['introspect']>()
      .mockRejectedValue(new IdentityProviderUnavailableError('timeout'));
    const authenticate = createAuthMiddleware({ authClient: { introspect }, mode: 'main' });

    await expect(authenticate({ authorization: 'Bearer secret' })).resolves.toMatchObject({
      status: 503,
      code: 'identity_provider_unavailable',
    });
  });

  it('loads demo authorization and exposes server-backed role and tag grants', async () => {
    const client = new DemoAuthClient(['demo-admin', 'demo-captain']);
    const store = createMemoryStore({ seed: false });
    const now = new Date('2026-07-27T10:00:00.000Z');
    await bootstrapPlatform(store, {
      uid: 'demo-admin',
      recovery: false,
      version: 'task-15-test',
      now,
    });
    await store.subjects.create({
      uid: 'demo-captain',
      displayName: 'Captain',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.tagAssignments.create({
      subjectUid: 'demo-captain',
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'sports_team', id: 'team-basketball' },
    });
    const authenticate = createAuthMiddleware({
      authClient: client,
      mode: 'demo',
      store,
      now: () => now,
    });

    const admin = await authenticate({ 'x-demo-user': 'demo-admin' });
    const captain = await authenticate({ 'x-demo-user': 'demo-captain' });

    expect(admin).toMatchObject({
      status: 200,
      user: {
        uid: 'demo-admin',
        roles: ['platform.super_admin'],
        tags: [],
        policies: expect.any(Array),
      },
    });
    expect(captain).toMatchObject({
      status: 200,
      user: {
        uid: 'demo-captain',
        roles: [],
        tags: [
          {
            key: 'sports.team_captain',
            scope: { type: 'sports_team', id: 'team-basketball' },
          },
        ],
        policies: expect.any(Array),
      },
    });
    if (admin.status !== 200 || captain.status !== 200) throw new Error('expected authentication');
    expect(
      authorize(admin.user, { action: 'knowledge.publish', resource: 'knowledge_entry' }, now)
        .allowed,
    ).toBe(true);
    expect(
      authorize(
        captain.user,
        {
          action: 'sports.checkin.create',
          resource: 'sports_checkin',
          scope: { type: 'sports_team', id: 'team-basketball' },
        },
        now,
      ).allowed,
    ).toBe(true);
  });
});

describe('main-site identity adapter', () => {
  it('forwards the bearer token and maps only the stable main-site identity fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          uid: 'main-uid-42',
          displayName: '同学甲',
          avatarUrl: 'https://cdn.example/avatar.png',
          role: 'admin',
          id: 999,
          studentId: '2023000042',
          username: 'main-user',
          passwordHash: 'must-not-leak',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new MainSiteAuthClient({
      apiBaseUrl: 'https://www.free-bbs.cn/',
      fetch: fetchMock,
      timeoutMs: 100,
    });

    await expect(client.introspect('opaque-token')).resolves.toEqual({
      uid: 'main-uid-42',
      username: 'main-user',
      studentId: '2023000042',
      displayName: '同学甲',
      avatarUrl: 'https://cdn.example/avatar.png',
      baseRole: 'student',
      roles: [],
      tags: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.free-bbs.cn/api/auth/me',
      expect.objectContaining({ headers: { authorization: 'Bearer opaque-token' } }),
    );
  });

  it('returns null for invalid tokens and classifies upstream failures as unavailable', async () => {
    const invalidClient = new MainSiteAuthClient({
      apiBaseUrl: 'https://www.free-bbs.cn',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    });
    const failingClient = new MainSiteAuthClient({
      apiBaseUrl: 'https://www.free-bbs.cn',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 502 })),
    });

    await expect(invalidClient.introspect('bad')).resolves.toBeNull();
    await expect(failingClient.introspect('token')).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it('aborts slow upstream requests and reports a provider timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    const client = new MainSiteAuthClient({
      apiBaseUrl: 'https://www.free-bbs.cn',
      fetch: fetchMock,
      timeoutMs: 25,
    });
    const result = client.introspect('token');
    const assertion = expect(result).rejects.toMatchObject({
      name: 'IdentityProviderUnavailableError',
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    vi.useRealTimers();
  });
});

describe('demo identity and environment safety', () => {
  it('accepts only allowlisted deterministic demo identities', async () => {
    const client = new DemoAuthClient(['demo-student', 'demo-admin']);

    await expect(client.introspect('demo-student')).resolves.toMatchObject({
      uid: 'demo-student',
      displayName: '普通同学',
    });
    await expect(client.introspect('demo-captain')).resolves.toBeNull();
    await expect(client.introspect('not-deterministic')).resolves.toBeNull();
  });

  it('makes demo authentication impossible in production', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        AUTH_MODE: 'demo',
        DEMO_USER_IDS: 'demo-admin',
      }),
    ).toThrow(/demo authentication is disabled in production/i);
  });
  it('rejects direct demo client construction in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new DemoAuthClient(['demo-admin'])).toThrow(/disabled in production/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
