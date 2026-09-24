import { describe, expect, it } from 'vitest';

import { LIAISON_PROBLEM_PERMISSION_ACTIONS, validateTagScope } from './permissions.js';

describe('permission tag scopes', () => {
  it('requires a sports team scope for a sports team captain tag', () => {
    expect(validateTagScope('sports.team_captain', undefined)).toBe(false);
    expect(validateTagScope('sports.team_captain', { type: 'sports_team', id: '*' })).toBe(false);
    expect(validateTagScope('sports.team_captain', { type: 'sports_team', id: '' })).toBe(false);
    expect(validateTagScope('sports.team_captain', { type: 'sports_team', id: 'team-1' })).toBe(
      true,
    );
  });
});

describe('liaison problem permissions', () => {
  it('exports the stable problem-board permission actions', () => {
    expect(LIAISON_PROBLEM_PERMISSION_ACTIONS).toEqual([
      'liaison.problem.read',
      'liaison.problem.create',
      'liaison.problem.update',
      'liaison.problem.submit_review',
      'liaison.problem.review',
      'liaison.problem.join',
      'liaison.problem.post',
      'liaison.problem.outcome.submit',
      'liaison.problem.outcome.manage',
    ]);
  });
});
