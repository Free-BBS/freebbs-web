import { expect, it } from 'vitest';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { departmentMember, initialState, manages, viewsAll, workspaceDto } from './domain.js';

function actor(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    uid: 'user',
    displayName: '同学',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    ...overrides,
  };
}

it('requires current matching organization appointments rather than names with unrelated or expired scopes', () => {
  const state = initialState();
  const roleKey = 'youth_league.organization.member' as const;
  const member = actor({
    roles: [roleKey],
    roleScopes: [
      {
        subjectUid: 'user',
        roleKey,
        scope: { type: 'department', id: 'youth_league.organization' },
        expiresAt: null,
      },
    ],
  });
  expect(departmentMember(member)).toBe(true);
  expect(viewsAll(state, member)).toBe(true);
  expect(manages(state, member)).toBe(false);
  expect(workspaceDto(state, member).canGrantSecretaries).toBe(true);
  for (const invalid of [
    { ...member, roleScopes: [] },
    {
      ...member,
      roleScopes: [{ ...member.roleScopes![0]!, scope: { type: 'department', id: 'another' } }],
    },
    {
      ...member,
      roleScopes: [{ ...member.roleScopes![0]!, expiresAt: '2000-01-01T00:00:00.000Z' }],
    },
    { ...member, roleScopes: [{ ...member.roleScopes![0]!, subjectUid: 'another' }] },
  ]) {
    expect(viewsAll(state, invalid)).toBe(false);
    expect(workspaceDto(state, invalid).canGrantSecretaries).toBe(false);
  }
});

it('grants current global counselor appointments global read without upgrading other counselors to managers', () => {
  const state = initialState();
  for (const roleKey of [
    'counselor.practice',
    'counselor.innovation',
    'counselor.youth_league',
  ] as const) {
    const counselor = actor({
      roles: [roleKey],
      roleScopes: [
        { subjectUid: 'user', roleKey, scope: { type: 'public', id: '*' }, expiresAt: null },
      ],
    });
    expect(viewsAll(state, counselor)).toBe(true);
    expect(manages(state, counselor)).toBe(roleKey === 'counselor.youth_league');
    for (const invalid of [
      {
        ...counselor,
        roleScopes: [{ ...counselor.roleScopes![0]!, scope: { type: 'class', id: 'a' } }],
      },
      {
        ...counselor,
        roleScopes: [{ ...counselor.roleScopes![0]!, expiresAt: '2000-01-01T00:00:00.000Z' }],
      },
    ]) {
      expect(viewsAll(state, invalid)).toBe(false);
      expect(manages(state, invalid)).toBe(false);
    }
  }
});

it('does not use expired or wildcard secretary tags and keeps preview mode read only', () => {
  const state = initialState();
  state.classes = [{ id: 'a', label: 'A班' }];
  const secretary = actor({
    tags: [{ key: 'class.youth_league_secretary', scope: { type: 'class', id: 'a' } }],
  });
  expect(workspaceDto(state, secretary).canSubmit).toBe(true);
  expect(workspaceDto(state, { ...secretary, previewing: true }).canSubmit).toBe(false);
  expect(
    workspaceDto(state, {
      ...secretary,
      tags: [{ ...secretary.tags[0]!, expiresAt: '2000-01-01T00:00:00.000Z' }],
    }).canSubmit,
  ).toBe(false);
  expect(
    workspaceDto(state, {
      ...secretary,
      tags: [{ key: 'class.youth_league_secretary', scope: { type: 'class', id: '*' } }],
    }).allowedSubmitClassIds,
  ).toEqual([]);
});
