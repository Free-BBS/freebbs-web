import { describe, expect, it } from 'vitest';

import { authorize } from './authorize.js';

import type { RoleKey } from '@freebbs-development/contracts';
import type { AuthorizationContext, AuthorizationPolicy } from './policy.js';

function user(policies: AuthorizationPolicy[] = [], roles: RoleKey[] = []): AuthorizationContext {
  return {
    uid: 'review-user',
    displayName: 'Review user',
    avatarUrl: null,
    baseRole: 'student',
    roles,
    tags: [],
    policies,
  };
}

describe('review regressions: compiled policy coverage', () => {
  it('allows a database-compiled public liaison baseline only at public scope', () => {
    const context = user([
      {
        id: 'baseline-liaison',
        action: 'liaison.resource.read',
        resource: 'liaison_resource',
        effect: 'allow',
        scope: { type: 'public', id: '*' },
      },
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
        action: 'liaison.resource.read',
        resource: 'liaison_resource',
        scope: { type: 'restricted', id: 'leadership' },
      }).allowed,
    ).toBe(false);
  });

  it.each(['read', 'create', 'update', 'approve'] as const)(
    'allows a compiled Tuanwei policy to %s finance records',
    (operation) => {
      const context = user([
        {
          id: `tuanwei-${operation}`,
          action: `finance.record.${operation}`,
          resource: 'finance_record',
          effect: 'allow',
        },
      ]);
      expect(
        authorize(context, {
          action: `finance.record.${operation}`,
          resource: 'finance_record',
        }).allowed,
      ).toBe(true);
    },
  );

  it('does not grant finance access without a compiled policy', () => {
    expect(
      authorize(user(), { action: 'finance.record.read', resource: 'finance_record' }).allowed,
    ).toBe(false);
    for (const operation of ['delete', 'export']) {
      expect(
        authorize(user([], ['affiliation.tuanwei_member']), {
          action: `finance.record.${operation}`,
          resource: 'finance_record',
        }).allowed,
      ).toBe(false);
    }
  });
});

describe('review regressions: fail closed', () => {
  it('denies an unknown runtime role and action without throwing', () => {
    const corruptContext = user([], ['future.unknown_role' as RoleKey]);
    expect(() =>
      authorize(corruptContext, { action: 'admin.role.assign', resource: 'role_assignment' }),
    ).not.toThrow();
    expect(
      authorize(corruptContext, { action: 'admin.role.assign', resource: 'role_assignment' }),
    ).toEqual({ allowed: false, reason: 'unknown-permission', matchedBy: null });
  });
});
