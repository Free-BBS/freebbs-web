import { describe, expect, it } from 'vitest';
import { canReviewFestival } from './festival.js';
import type { RoleKey } from './modules.js';

describe('spring festival default reviewers', () => {
  it.each<RoleKey>([
    'counselor.youth_league_secretary',
    'counselor.youth_league',
    'counselor.practice',
    'counselor.innovation',
    'counselor.student_development',
    'student_union.executive_president',
    'student_union.presidium',
    'department.arts_member',
    'department.arts_director',
    'domain.arts_lead',
  ])('allows the authorized reviewer %s', (role) => {
    expect(canReviewFestival({ roles: [role] })).toBe(true);
  });
  it.each<RoleKey>([
    'department.sports_member',
    'youth_league.organization.member',
    'platform.super_admin',
    'science_association.chair',
  ])('does not infer festival review from unrelated role %s', (role) => {
    expect(canReviewFestival({ roles: [role] })).toBe(false);
  });
  it('retains trusted platform administration and rejects role-only spoofing', () => {
    expect(canReviewFestival({ roles: ['platform.admin'], businessAdmin: true })).toBe(true);
    expect(canReviewFestival({ roles: ['platform.admin'], businessAdmin: false })).toBe(false);
    expect(canReviewFestival({ roles: [] })).toBe(false);
  });
});
