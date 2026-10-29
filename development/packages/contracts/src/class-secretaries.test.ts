import { describe, expect, it } from 'vitest';
import {
  canGrantClassSecretaries,
  CLASS_SECRETARY_TAG,
  secretaryClassIds,
} from './class-secretaries.js';
import { validateTagScope } from './permissions.js';

describe('class secretary appointment', () => {
  it('accepts only concrete safe class tags and excludes expired grants', () => {
    const at = new Date('2026-10-28T00:00:00Z');
    expect(
      secretaryClassIds(
        {
          tags: [
            { key: CLASS_SECRETARY_TAG, scope: { type: 'class', id: 'wu55' } },
            { key: CLASS_SECRETARY_TAG, scope: { type: 'class', id: 'wu55' } },
            { key: CLASS_SECRETARY_TAG, scope: { type: 'class', id: '*' } },
            { key: CLASS_SECRETARY_TAG, scope: { type: 'public', id: 'wu54' } },
            { key: CLASS_SECRETARY_TAG, scope: { type: 'class', id: '__proto__' } },
            {
              key: CLASS_SECRETARY_TAG,
              scope: { type: 'class', id: 'expired' },
              expiresAt: '2026-10-27T00:00:00Z',
            },
            {
              key: CLASS_SECRETARY_TAG,
              scope: { type: 'class', id: 'invalid' },
              expiresAt: 'invalid',
            },
            { key: 'other', scope: { type: 'class', id: 'wu54' } },
          ],
        },
        at,
      ),
    ).toEqual(['wu55']);
    expect(validateTagScope(CLASS_SECRETARY_TAG, { type: 'class', id: 'wu55' })).toBe(true);
    for (const id of ['', '*', '__proto__', 'constructor', 'prototype'])
      expect(validateTagScope(CLASS_SECRETARY_TAG, { type: 'class', id })).toBe(false);
  });
  it('allows development business admins and all valid organization posts only', () => {
    const user = { uid: 'actor', roles: [] };
    expect(
      canGrantClassSecretaries({ ...user, roles: ['platform.admin'], businessAdmin: true }),
    ).toBe(true);
    expect(
      canGrantClassSecretaries({
        ...user,
        roles: ['platform.learning_admin'],
      }),
    ).toBe(false);
    expect(canGrantClassSecretaries({ ...user, roles: ['counselor.practice'] })).toBe(false);
    expect(canGrantClassSecretaries({ ...user, roles: ['platform.super_admin'] })).toBe(false);
    expect(canGrantClassSecretaries({ ...user, roles: ['youth_league.organization.member'] })).toBe(
      true,
    );
    expect(
      canGrantClassSecretaries({
        ...user,
        roles: ['youth_league.organization.member'],
        previewing: true,
      }),
    ).toBe(false);
    const scoped = { ...user, roles: ['youth_league.organization.member'] as const };
    const appointment = {
      subjectUid: 'actor',
      roleKey: 'youth_league.organization.member' as const,
      scope: { type: 'department', id: 'youth_league.organization' },
      expiresAt: null,
    };
    expect(
      canGrantClassSecretaries({ ...scoped, roles: [...scoped.roles], roleScopes: [appointment] }),
    ).toBe(true);
    expect(
      canGrantClassSecretaries({
        ...scoped,
        roles: [...scoped.roles],
        roleScopes: [
          { ...appointment, scope: { type: 'department', id: 'youth_league.practice' } },
        ],
      }),
    ).toBe(false);
    expect(canGrantClassSecretaries({ ...scoped, roles: [...scoped.roles], roleScopes: [] })).toBe(
      false,
    );
  });
});
