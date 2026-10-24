import { describe, expect, it } from 'vitest';
import {
  type RoleKey,
  type ScopeRef,
  type UserContext,
  isDevelopmentBusinessAdmin,
} from '@freebbs-development/contracts';
import { createMemoryStore } from '../database/memory-store.js';
import { bootstrapPlatform } from '../bootstrap/bootstrap-service.js';
import { resolvePlatformAuthority } from './platform-authority.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { authorize } from '../authorization/authorize.js';
import { upsertDevelopmentAccess } from './development-access.js';

const now = new Date('2026-10-24T10:00:00Z');
const scope = { type: 'public', id: '*' } as const;
const identity = (uid = 'account'): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});
async function fixture(
  role?: RoleKey,
  roleScope: ScopeRef = scope,
  expiresAt: string | null = null,
) {
  const store = createMemoryStore({ seed: false });
  await bootstrapPlatform(store, {
    uid: 'bootstrap',
    recovery: false,
    version: 'authority-test',
    now,
  });
  await store.subjects.create({
    uid: 'account',
    displayName: 'Account',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'bootstrap',
    scope,
  });
  if (role)
    await store.roleAssignments.create({
      subjectUid: 'account',
      roleKey: role,
      status: 'active',
      expiresAt,
      ownerUid: 'bootstrap',
      scope: roleScope,
    });
  const authenticate = createAuthMiddleware({
    authClient: { introspect: async () => identity() },
    mode: 'main',
    store,
    now: () => now,
  });
  return { store, authenticate };
}
describe('shared platform authority', () => {
  it.each([
    ['platform.admin', false, true, false],
    ['platform.learning_admin', true, false, false],
    ['counselor.youth_league_secretary', true, true, true],
    ['counselor.youth_league', true, true, true],
    ['counselor.student_development', true, true, false],
  ] as const)(
    'projects %s independently for both platforms',
    async (role, learningAdmin, developmentAdmin, developmentLead) => {
      const { store, authenticate } = await fixture(role);
      expect(await resolvePlatformAuthority(store, 'account', now)).toEqual({
        rootAdmin: false,
        learningAdmin,
        developmentAdmin,
        developmentLead,
      });
      const result = await authenticate({ authorization: 'Bearer identity' });
      expect(result).toMatchObject({
        status: 200,
        user: {
          learningAdmin,
          businessAdmin: developmentAdmin,
          developmentAccess: developmentLead ? 'lead' : 'member',
        },
      });
      if (result.status !== 200) throw new Error('authentication failed');
      expect(isDevelopmentBusinessAdmin(result.user)).toBe(developmentAdmin);
      expect(
        authorize(result.user, { action: 'admin.manage', resource: 'admin' }, now).allowed,
      ).toBe(developmentLead);
    },
  );
  it.each([
    'platform.admin',
    'platform.learning_admin',
    'counselor.youth_league_secretary',
    'counselor.youth_league',
    'counselor.student_development',
  ] as const)('requires current global %s appointments', async (role) => {
    for (const [roleScope, expiresAt] of [
      [{ type: 'department', id: 'youth_league.organization' }, null],
      [scope, now.toISOString()],
    ] as Array<[ScopeRef, string | null]>) {
      const { store, authenticate } = await fixture(role, roleScope, expiresAt);
      expect(await resolvePlatformAuthority(store, 'account', now)).toEqual({
        rootAdmin: false,
        learningAdmin: false,
        developmentAdmin: false,
        developmentLead: false,
      });
      const result = await authenticate({ authorization: 'Bearer token' });
      expect(result).toMatchObject({
        status: 200,
        user: { businessAdmin: false, learningAdmin: false, developmentAccess: 'member' },
      });
    }
  });
  it('does not count disabled subjects or role definitions', async () => {
    const { store } = await fixture('platform.learning_admin');
    const role = (await store.roles.list()).find((row) => row.key === 'platform.learning_admin')!;
    await store.roles.update(role.id, { status: 'inactive' });
    expect((await resolvePlatformAuthority(store, 'account', now)).learningAdmin).toBe(false);
    await store.roles.update(role.id, { status: 'active' });
    const subject = (await store.subjects.list({ query: 'account' }))[0]!;
    await store.subjects.update(subject.id, { status: 'inactive' });
    expect((await resolvePlatformAuthority(store, 'account', now)).learningAdmin).toBe(false);
  });
  it('recognizes the explicitly appointed root before any login or role assignment', async () => {
    const { store } = await fixture();
    const uid = 'u_48370eb1aba453c7';
    expect(await resolvePlatformAuthority(store, uid, now)).toEqual({
      rootAdmin: true,
      learningAdmin: true,
      developmentAdmin: true,
      developmentLead: true,
    });
    const authenticate = createAuthMiddleware({
      store,
      mode: 'main',
      now: () => now,
      authClient: { introspect: async () => identity(uid) },
    });
    const result = await authenticate({ authorization: 'Bearer root' });
    expect(result).toMatchObject({
      status: 200,
      user: {
        rootAdmin: true,
        businessAdmin: true,
        learningAdmin: true,
        developmentAccess: 'lead',
      },
    });
    if (result.status !== 200) throw new Error('authentication failed');
    expect(authorize(result.user, { action: 'admin.manage', resource: 'admin' }, now).allowed).toBe(
      true,
    );
    expect(
      authorize(result.user, { action: 'knowledge.publish', resource: 'knowledge_entry' }, now)
        .allowed,
    ).toBe(true);
  });
  it('ignores provider root/admin flags for all other UIDs', async () => {
    const { store } = await fixture();
    const authenticate = createAuthMiddleware({
      store,
      mode: 'main',
      authClient: {
        introspect: async () => ({
          ...identity(),
          rootAdmin: true,
          businessAdmin: true,
          learningAdmin: true,
          roles: ['platform.super_admin', 'platform.admin', 'platform.learning_admin'],
        }),
      },
    });
    await expect(authenticate({ authorization: 'Bearer forged' })).resolves.toMatchObject({
      status: 200,
      user: { rootAdmin: false, businessAdmin: false, learningAdmin: false, roles: [] },
    });
  });
  it('prevents ordinary appointment edits from revoking the configured root', async () => {
    const { store } = await fixture();
    await expect(
      upsertDevelopmentAccess(store, {
        user: { uid: 'u_48370eb1aba453c7', username: 'root', studentId: null },
        accessLevel: 'member',
        actorUid: 'ordinary-admin',
      }),
    ).rejects.toMatchObject({ code: 'platform_root_immutable' });
  });
});
