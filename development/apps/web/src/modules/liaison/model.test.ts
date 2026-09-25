import { describe, expect, it } from 'vitest';

import { hasLiaisonPermission, type LiaisonUser } from './model.js';

const base: LiaisonUser = {
  uid: 'student',
  displayName: 'Student',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
};
const problem = { type: 'liaison_problem', id: 'problem-1' } as const;
const team = { type: 'liaison_team', id: 'team-1' } as const;
const outcome = { type: 'liaison_outcome', id: 'outcome-1' } as const;

describe('liaison presentation permissions', () => {
  it('fails closed without a compiled allow policy', () => {
    expect(hasLiaisonPermission(base, 'liaison.problem.join', 'liaison_problem', [problem])).toBe(
      false,
    );
  });

  it('requires permission at every ancestor and lets any ancestor deny win', () => {
    const globallyAllowed: LiaisonUser = {
      ...base,
      policies: [
        {
          action: 'liaison.problem.outcome.manage',
          resource: 'liaison_outcome',
          effect: 'allow',
        },
        {
          action: 'liaison.problem.outcome.manage',
          resource: 'liaison_outcome',
          effect: 'deny',
          scope: problem,
        },
      ],
    };
    expect(
      hasLiaisonPermission(globallyAllowed, 'liaison.problem.outcome.manage', 'liaison_outcome', [
        problem,
        team,
        outcome,
      ]),
    ).toBe(false);

    const problemOnly: LiaisonUser = {
      ...base,
      policies: [
        {
          action: 'liaison.problem.join',
          resource: 'liaison_problem',
          effect: 'allow',
          scope: problem,
        },
      ],
    };
    expect(
      hasLiaisonPermission(problemOnly, 'liaison.problem.join', 'liaison_problem', [problem, team]),
    ).toBe(false);
  });
});
