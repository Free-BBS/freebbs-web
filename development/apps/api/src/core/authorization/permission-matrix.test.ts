import { describe, expect, it } from 'vitest';

import { authorize } from './authorize.js';

import type { AuthorizationContext, AuthorizationPolicy } from './policy.js';

const baseUser = (policies: AuthorizationPolicy[] = []): AuthorizationContext => ({
  uid: 'user-1',
  displayName: 'Test student',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  policies,
});

describe('compiled authorization policy matrix', () => {
  it.each([
    [{ type: '', id: '' }, 'empty fields'],
    [{ type: 'sports_team', id: '' }, 'empty id'],
    [{ type: 'sports_team', id: 'team\u0000a' }, 'control character'],
    [{ type: 'sports_team', id: 'x'.repeat(129) }, 'oversized id'],
    [{ type: 'x'.repeat(129), id: 'team-a' }, 'oversized type'],
    [{ type: 'sports_team', id: '*' }, 'non-public wildcard'],
  ])('rejects a malformed request scope before matching policies: %s (%s)', (scope) => {
    const context = baseUser([
      {
        id: 'global-sports',
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        effect: 'allow',
      },
    ]);

    expect(
      authorize(context, {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        scope,
      }),
    ).toEqual({ allowed: false, reason: 'invalid-scope', matchedBy: null });
  });

  it('validates scope before action matching', () => {
    expect(
      authorize(baseUser(), {
        action: 'unknown.execute',
        resource: 'unknown',
        scope: { type: '', id: '' },
      }),
    ).toEqual({ allowed: false, reason: 'invalid-scope', matchedBy: null });
  });

  it('accepts public wildcard and concrete scopes while preserving explicit unscoped requests', () => {
    const scoped: AuthorizationPolicy = {
      id: 'team-a',
      action: 'sports.checkin.create',
      resource: 'sports_checkin',
      effect: 'allow',
      scope: { type: 'sports_team', id: 'team-a' },
    };
    const context = baseUser([
      {
        id: 'global-sports',
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        effect: 'allow',
      },
      {
        id: 'public-liaison',
        action: 'liaison.resource.read',
        resource: 'liaison_resource',
        effect: 'allow',
        scope: { type: 'public', id: '*' },
      },
      scoped,
    ]);

    expect(
      authorize(context, {
        action: 'liaison.resource.read',
        resource: 'liaison_resource',
        scope: { type: 'public', id: '*' },
      }).allowed,
    ).toBe(true);
    expect(
      authorize(context, {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-a' },
      }).allowed,
    ).toBe(true);
    expect(
      authorize(context, {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
      }).allowed,
    ).toBe(true);
    expect(
      authorize(baseUser([scoped]), {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
      }),
    ).toEqual({ allowed: false, reason: 'scope-mismatch', matchedBy: 'policy:team-a' });
  });
  it('does not grant through coarse roles or tags', () => {
    const untrusted: AuthorizationContext = {
      ...baseUser(),
      roles: ['platform.super_admin'],
      tags: [
        {
          key: 'sports.team_captain',
          scope: { type: 'sports_team', id: 'team-a' },
        },
      ],
    };

    expect(authorize(untrusted, { action: 'admin.manage', resource: 'admin' }).allowed).toBe(false);
    expect(
      authorize(untrusted, {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-a' },
      }).allowed,
    ).toBe(false);
  });

  it('makes a current explicit deny override an allow through the same policy path', () => {
    const context = baseUser([
      {
        id: 'global-allow',
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        effect: 'allow',
      },
      {
        id: 'team-deny',
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        effect: 'deny',
        scope: { type: 'sports_team', id: 'team-a' },
      },
    ]);

    expect(
      authorize(context, {
        action: 'sports.checkin.create',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-a' },
      }),
    ).toEqual({
      allowed: false,
      reason: 'explicit-deny',
      matchedBy: 'policy:team-deny',
    });
  });

  it('chooses the most-specific current allow and reports scope mismatches', () => {
    const scoped: AuthorizationPolicy = {
      id: 'team-a',
      action: 'sports.checkin.read',
      resource: 'sports_checkin',
      effect: 'allow',
      scope: { type: 'sports_team', id: 'team-a' },
    };
    const context = baseUser([
      {
        id: 'global',
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        effect: 'allow',
      },
      scoped,
    ]);

    expect(
      authorize(context, {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-a' },
      }),
    ).toEqual({
      allowed: true,
      reason: 'policy-grant',
      matchedBy: 'policy:team-a',
    });
    expect(
      authorize(baseUser([scoped]), {
        action: 'sports.checkin.read',
        resource: 'sports_checkin',
        scope: { type: 'sports_team', id: 'team-b' },
      }),
    ).toEqual({
      allowed: false,
      reason: 'scope-mismatch',
      matchedBy: 'policy:team-a',
    });
  });

  it('ignores expired grants and denies unknown permissions', () => {
    const expired = baseUser([
      {
        id: 'expired',
        action: 'events.create',
        resource: 'activity',
        effect: 'allow',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(
      authorize(
        expired,
        { action: 'events.create', resource: 'activity' },
        new Date('2026-07-27T00:00:00.000Z'),
      ),
    ).toEqual({
      allowed: false,
      reason: 'expired-assignment',
      matchedBy: 'policy:expired',
    });
    expect(authorize(baseUser(), { action: 'unknown.execute', resource: 'unknown' })).toEqual({
      allowed: false,
      reason: 'unknown-permission',
      matchedBy: null,
    });
  });
});
