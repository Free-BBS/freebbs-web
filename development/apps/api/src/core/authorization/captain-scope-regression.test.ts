import { describe, expect, it } from 'vitest';

import { authorize } from './authorize.js';

import type { UserContext } from '@freebbs-development/contracts';

const teamRequest = {
  action: 'sports.checkin.create',
  resource: 'sports_checkin',
  scope: { type: 'sports_team', id: 'team-a' },
};

function captainWith(scope?: { type: string; id: string }): UserContext {
  return {
    uid: 'captain',
    displayName: '队长',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [{ key: 'sports.team_captain', scope }],
  };
}

describe('captain tag scope validation', () => {
  it('does not treat an unscoped captain tag as a global grant', () => {
    expect(authorize(captainWith(), teamRequest)).toEqual({
      allowed: false,
      reason: 'no-matching-grant',
      matchedBy: null,
    });
  });

  it('does not accept a captain tag bound to a non-team scope type', () => {
    expect(authorize(captainWith({ type: 'department', id: 'sports' }), teamRequest).allowed).toBe(
      false,
    );
  });
});
