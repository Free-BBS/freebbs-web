import { describe, expect, it, vi } from 'vitest';

import { loadEnvironment } from '../../config/env.js';
import { authorize } from '../authorization/authorize.js';
import { bootstrapPlatform } from '../bootstrap/bootstrap-service.js';
import { createMemoryStore } from '../database/memory-store.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { DemoAuthClient } from './demo-auth-client.js';
import { MainSiteAuthClient } from './main-site-auth-client.js';

import type { UserContext } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../authorization/policy.js';
import type { AuthClient } from './auth-client.js';

const publicScope = { type: 'public', id: '*' };
const ownerUid = 'demo-admin';
const governanceNow = new Date('2026-07-22T00:00:00.000Z');

async function governedDemoStore(uid: string) {
  const store = createMemoryStore({ seed: false });
  await bootstrapPlatform(store, {
    uid: ownerUid,
    recovery: false,
    version: 'task-15-review',
    now: governanceNow,
  });
  await store.subjects.create({
    uid,
    displayName: uid,
    avatarUrl: null,
    status: 'active',
    ownerUid,
    scope: publicScope,
  });
  return store;
}

describe('review regressions: main-site identity contract', () => {
  it('prefers fullName and avatarPath from the real main-site user envelope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          user: {
            uid: 'main-uid-real',
            username: 'fallback-username',
            fullName: '正式姓名',
            avatarPath: '/uploads/avatar-real.png',
            role: 'admin',
            id: 314,
            passwordHash: 'must-never-cross-the-boundary',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new MainSiteAuthClient({
      apiBaseUrl: 'https://www.free-bbs.cn',
      fetch: fetchMock,
    });

    const user = await client.introspect('opaque');

    expect(user).toEqual({
      uid: 'main-uid-real',
      username: 'fallback-username',
      studentId: null,
      displayName: '正式姓名',
      avatarUrl: '/uploads/avatar-real.png',
      baseRole: 'student',
      roles: [],
      tags: [],
      mainSiteAdmin: false,
    });
    expect(
      authorize(user as AuthorizationContext, {
        action: 'sports.team.manage',
        resource: 'sports_team',
        scope: publicScope,
      }).allowed,
    ).toBe(false);
  });

  it('rejects unknown non-empty NODE_ENV values before demo mode can default or enable', () => {
    expect(() => loadEnvironment({ NODE_ENV: 'prod' })).toThrow(/NODE_ENV/i);
    expect(() => loadEnvironment({ NODE_ENV: 'prod', AUTH_MODE: 'demo' })).toThrow(/NODE_ENV/i);
  });
});

describe('review regressions: role assignment scopes', () => {
  it('keeps a public wildcard assignment as a global role grant', async () => {
    const store = await governedDemoStore('demo-sports-lead');
    await store.roleAssignments.create({
      subjectUid: 'demo-sports-lead',
      roleKey: 'domain.sports_lead',
      expiresAt: null,
      status: 'active',
      ownerUid,
      scope: publicScope,
    });
    const authenticate = createAuthMiddleware({
      authClient: new DemoAuthClient(['demo-sports-lead']),
      mode: 'demo',
      store,
    });
    const authenticated = await authenticate({ 'x-demo-user': 'demo-sports-lead' });
    if (authenticated.status !== 200) throw new Error('expected authenticated user');

    expect(authenticated.user.roles).toEqual(['domain.sports_lead']);
    expect(
      authorize(authenticated.user as AuthorizationContext, {
        action: 'sports.team.manage',
        resource: 'sports_team',
        scope: { type: 'sports_team', id: 'team-any' },
      }).allowed,
    ).toBe(true);
  });

  it('exposes scoped role metadata while keeping its compiled policies scoped', async () => {
    const store = await governedDemoStore('demo-student');
    await store.roleAssignments.create({
      subjectUid: 'demo-student',
      roleKey: 'department.sports_director',
      expiresAt: '2027-01-01T00:00:00.000Z',
      status: 'active',
      ownerUid,
      scope: { type: 'sports_team', id: 'team-a' },
    });
    const authenticate = createAuthMiddleware({
      authClient: new DemoAuthClient(['demo-student']),
      mode: 'demo',
      store,
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });
    const authenticated = await authenticate({ 'x-demo-user': 'demo-student' });
    if (authenticated.status !== 200) throw new Error('expected authenticated user');

    const context = authenticated.user as AuthorizationContext;
    expect(context.roles).toContain('department.sports_director');
    expect(
      authorize(context, {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-a' },
      }).allowed,
    ).toBe(true);
    expect(
      authorize(context, {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-b' },
      }).allowed,
    ).toBe(false);
  });
});

describe('review regressions: tag validation and deterministic deduplication', () => {
  it('merges existing and stored tags by key and scope using null then later expiry', async () => {
    const store = createMemoryStore({ seed: false });
    const client: AuthClient = {
      async introspect(): Promise<UserContext> {
        return {
          uid: 'demo-captain',
          displayName: '队长',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [
            {
              key: 'sports.team_captain',
              scope: { type: 'sports_team', id: 'team-a' },
              expiresAt: '2027-01-01T00:00:00.000Z',
            },
            { key: 'sports.team_captain' },
            {
              key: 'extension.custom',
              scope: publicScope,
              expiresAt: '2027-01-01T00:00:00.000Z',
            },
          ],
        };
      },
    };
    await store.tagAssignments.create({
      subjectUid: 'demo-captain',
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid,
      scope: { type: 'sports_team', id: 'team-a' },
    });
    await store.tagAssignments.create({
      subjectUid: 'demo-captain',
      tagKey: 'extension.custom',
      expiresAt: '2029-01-01T00:00:00.000Z',
      status: 'active',
      ownerUid,
      scope: publicScope,
    });
    await store.tagAssignments.create({
      subjectUid: 'demo-captain-near-match',
      tagKey: 'extension.near-match',
      expiresAt: null,
      status: 'active',
      ownerUid,
      scope: publicScope,
    });
    await store.tagAssignments.create({
      subjectUid: 'demo-captain',
      tagKey: 'sports.team_captain',
      expiresAt: null,
      status: 'active',
      ownerUid,
      scope: publicScope,
    });
    await store.tagAssignments.create({
      subjectUid: 'demo-captain',
      tagKey: 'sports.team_captain',
      expiresAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
      ownerUid,
      scope: { type: 'sports_team', id: 'team-b' },
    });
    const authenticate = createAuthMiddleware({
      authClient: client,
      mode: 'demo',
      store,
      now: () => new Date('2026-07-22T00:00:00.000Z'),
    });
    const authenticated = await authenticate({ 'x-demo-user': 'demo-captain' });
    if (authenticated.status !== 200) throw new Error('expected authenticated user');

    expect(authenticated.user.tags).toEqual([]);
    expect(authenticated.user.policies).toEqual([]);
  });
});
