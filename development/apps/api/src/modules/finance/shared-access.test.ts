import { describe, expect, it } from 'vitest';
import type { FinanceDepartment, RoleKey, ScopeRef } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { financeDepartmentAccess, isFinanceFinalReviewer } from './shared-access.js';

const arts: FinanceDepartment = {
  id: 'student_union.arts_center',
  name: '文艺中心',
  portId: 'student_union',
};
const sports: FinanceDepartment = {
  id: 'student_union.sports_center',
  name: '体育中心',
  portId: 'sports',
};
const software: FinanceDepartment = {
  id: 'science_association.software',
  name: '软件部',
  portId: 'science_association',
};
const team: FinanceDepartment = {
  id: 'sports_team.basketball',
  name: '篮球',
  portId: 'sports',
  teamId: 'basketball',
};
function actor(
  role?: RoleKey,
  scope: ScopeRef = { type: 'public', id: '*' },
): AuthorizationContext {
  return {
    uid: 'person',
    displayName: '同学',
    avatarUrl: null,
    baseRole: 'student',
    roles: role ? [role] : [],
    tags: [],
    roleScopes: role ? [{ subjectUid: 'person', roleKey: role, scope, expiresAt: null }] : [],
  };
}

describe('finance access from shared appointments', () => {
  it('uses trusted root and global final counselor appointments, not generic admin or role names', () => {
    expect(isFinanceFinalReviewer({ ...actor(), rootAdmin: true })).toBe(true);
    for (const role of ['counselor.youth_league_secretary', 'counselor.youth_league'] as const) {
      expect(isFinanceFinalReviewer(actor(role))).toBe(true);
      expect(isFinanceFinalReviewer(actor(role, { type: 'department', id: arts.id }))).toBe(false);
      expect(isFinanceFinalReviewer({ ...actor(role), roleScopes: [] })).toBe(false);
    }
    for (const role of [
      'platform.admin',
      'platform.learning_admin',
      'platform.super_admin',
      'counselor.student_development',
    ] as const)
      expect(isFinanceFinalReviewer(actor(role))).toBe(false);
  });
  it('limits department heads and excludes members, expired, mismatched and preview assignments', () => {
    const director = actor('department.arts_director');
    expect(financeDepartmentAccess(director, arts)).toEqual({
      read: true,
      submit: true,
      officer: false,
    });
    expect(financeDepartmentAccess(director, sports).read).toBe(false);
    expect(financeDepartmentAccess(actor('department.arts_member'), arts).read).toBe(false);
    expect(
      financeDepartmentAccess(
        actor('department.arts_director', { type: 'activity', id: 'meeting' }),
        arts,
      ).read,
    ).toBe(false);
    for (const override of [
      { expiresAt: '2000-01-01T00:00:00Z' },
      { expiresAt: 'invalid' },
      { subjectUid: 'another' },
    ]) {
      const user = actor('department.arts_director');
      user.roleScopes = user.roleScopes!.map((assignment) => ({ ...assignment, ...override }));
      expect(financeDepartmentAccess(user, arts).read).toBe(false);
    }
    expect(financeDepartmentAccess({ ...director, previewing: true }, arts).read).toBe(false);
  });
  it('derives org visibility and science finance from the existing office vice chair', () => {
    const union = actor('student_union.finance');
    expect(financeDepartmentAccess(union, arts)).toEqual({
      read: true,
      submit: false,
      officer: true,
    });
    expect(financeDepartmentAccess(union, sports).read).toBe(true);
    expect(financeDepartmentAccess(union, team).read).toBe(false);
    expect(
      financeDepartmentAccess(actor('science_association.office.vice_chair'), software),
    ).toEqual({ read: true, submit: false, officer: true });
    expect(financeDepartmentAccess(union, software).read).toBe(false);
  });
  it('gives sports heads all-team visibility while binding captains by team ID only', () => {
    const director = actor('department.sports_director');
    expect(financeDepartmentAccess(director, sports).submit).toBe(true);
    expect(financeDepartmentAccess(director, team)).toEqual({
      read: true,
      submit: false,
      officer: false,
    });
    const captain = actor();
    captain.tags = [
      { key: 'sports.team_captain', scope: { type: 'sports_team', id: 'basketball' } },
    ];
    expect(financeDepartmentAccess(captain, team)).toEqual({
      read: true,
      submit: true,
      officer: false,
    });
    expect(
      financeDepartmentAccess(captain, { ...team, teamId: 'football', name: '篮球' }).read,
    ).toBe(false);
    expect(financeDepartmentAccess(captain, { ...team, teamId: undefined }).read).toBe(false);
    captain.tags[0]!.expiresAt = 'invalid';
    expect(financeDepartmentAccess(captain, team).read).toBe(false);
  });
});
