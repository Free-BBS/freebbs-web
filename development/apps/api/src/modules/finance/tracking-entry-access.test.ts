import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEPARTMENT_DIRECTORY,
  DEVELOPMENT_IDENTITY_BY_ROLE,
  financeWorkPortRoleScope,
  type RoleKey,
  type ScopeRef,
} from '@freebbs-development/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { DEFAULT_FINANCE_DEPARTMENTS } from './default-departments.js';
import { FinanceTrackingService } from './tracking-service.js';

const globalScope = { type: 'public', id: '*' } as const;
const directories: string[] = [];
let service: FinanceTrackingService;

beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-entry-matrix-'));
  directories.push(directory);
  service = new FinanceTrackingService({
    directory,
    defaultDepartments: DEFAULT_FINANCE_DEPARTMENTS,
  });
});
afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function actor(roleKey?: RoleKey, scope: ScopeRef = globalScope): AuthorizationContext {
  const uid = `entry-${roleKey ?? 'student'}`;
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: roleKey ? [roleKey] : [],
    tags: [],
    roleScopes: roleKey ? [{ subjectUid: uid, roleKey, scope, expiresAt: null }] : [],
  };
}

const departmentCases = DEPARTMENT_DIRECTORY.flatMap((department) => {
  const departmentId = department.id === 'tms.position' ? 'youth_league.tms' : department.id;
  return department.roleKeys.map((roleKey) => ({
    departmentId,
    roleKey,
    allowed: !['部员', '组员', '学员', '会员'].includes(
      DEVELOPMENT_IDENTITY_BY_ROLE.get(roleKey)!.label,
    ),
  }));
});

describe('finance navigation eligibility', () => {
  it.each(departmentCases)(
    '$departmentId $roleKey has finance entry = $allowed',
    async ({ departmentId, roleKey, allowed }) => {
      const user = actor(roleKey, { type: 'department', id: departmentId });
      expect((await service.access(user)).canAccess).toBe(allowed);
      const payload = await service.read(user);
      expect(payload.departments.some(({ id }) => id === departmentId)).toBe(allowed);
      expect(payload.canManageBudget).toBe(false);
      if (!allowed) {
        expect(payload.departments).toEqual([]);
        expect(payload.projects).toEqual([]);
        expect(payload.claims).toEqual([]);
        expect(payload.settings).toBeNull();
      }
    },
  );

  it.each([
    ['youth_league.finance', 'youth_league'],
    ['student_union.finance', 'student_union'],
    ['science_association.office.vice_chair', 'science_association'],
    ['media_center.finance', 'media_center'],
    ['sports.finance', 'sports'],
    ['bbs.finance', 'bbs'],
    ['student_union.executive_president', 'student_union'],
    ['student_union.presidium', 'student_union'],
    ['science_association.chair', 'science_association'],
    ['media_center.director', 'media_center'],
    ['bbs.lead', 'bbs'],
  ] as const)(
    'admits %s to its work port without making it a reviewer',
    async (roleKey, portId) => {
      const user = actor(roleKey, financeWorkPortRoleScope(roleKey) ?? globalScope);
      expect((await service.access(user)).canAccess).toBe(true);
      const payload = await service.read(user);
      expect(payload.departments.length).toBeGreaterThan(0);
      expect(payload.canManageBudget).toBe(false);
      expect(
        payload.departments.every((department) =>
          department.id === 'student_union.sports_center'
            ? portId === 'student_union' || portId === 'sports'
            : department.portId === portId,
        ),
      ).toBe(true);
    },
  );

  it.each([
    'counselor.youth_league_secretary',
    'counselor.youth_league',
    'counselor.practice',
    'counselor.innovation',
    'counselor.student_development',
  ] as const)('admits the responsible counselor %s', async (roleKey) => {
    expect((await service.access(actor(roleKey))).canAccess).toBe(true);
  });

  it('admits root but not ordinary students, platform-only admins, or untrusted role labels', async () => {
    expect((await service.access({ ...actor(), rootAdmin: true })).canAccess).toBe(true);
    for (const user of [
      actor(),
      { ...actor('platform.admin'), businessAdmin: true },
      actor('platform.learning_admin'),
      { ...actor('department.arts_director'), roleScopes: [] },
      actor('department.arts_director', { type: 'department', id: 'youth_league.research' }),
    ])
      expect((await service.access(user)).canAccess).toBe(false);
  });

  it('limits captains to a current concrete team and preserves the deployment pilot gate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-entry-team-'));
    directories.push(directory);
    const teamService = new FinanceTrackingService({
      directory,
      defaultDepartments: [
        { id: 'sports.team-a', name: '代表队甲', portId: 'sports', teamId: 'team-a' },
        { id: 'sports.team-b', name: '代表队乙', portId: 'sports', teamId: 'team-b' },
      ],
    });
    const captain: AuthorizationContext = {
      ...actor(),
      tags: [{ key: 'sports.team_captain', scope: { type: 'sports_team', id: 'team-a' } }],
    };
    expect((await teamService.access(captain)).canAccess).toBe(true);
    expect((await teamService.read(captain)).departments.map(({ id }) => id)).toEqual([
      'sports.team-a',
    ]);
    expect(
      (
        await teamService.access({
          ...captain,
          tags: [{ ...captain.tags[0]!, expiresAt: '2000-01-01T00:00:00Z' }],
        })
      ).canAccess,
    ).toBe(false);
    const pilot = new FinanceTrackingService({ directory, pilotUids: ['designated-pilot'] });
    expect((await pilot.access({ ...actor(), rootAdmin: true })).canAccess).toBe(false);
  });
});

it('re-evaluates granting, expiry and revocation against current shared appointments on each HTTP request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-entry-main-auth-'));
  directories.push(directory);
  const store = createMemoryStore();
  const identity = actor('department.arts_director');
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'main' },
    store,
    financeDirectory: directory,
    // Provider role labels are deliberately present; only the shared appointment should confer access.
    authClient: { introspect: async () => identity },
  });
  const base = '/api/development/v1/finance/tracking';
  const access = async (expected: boolean) => {
    const response = await request(app)
      .get(`${base}/access`)
      .set('Authorization', 'Bearer entry-test')
      .expect(200);
    expect(response.body.data.canAccess).toBe(expected);
    expect(response.headers['cache-control']).toBe('private, no-store');
    if (!expected) {
      const hidden = await request(app)
        .get(base)
        .set('Authorization', 'Bearer entry-test')
        .expect(200);
      expect(hidden.body.data).toMatchObject({
        departments: [],
        projects: [],
        claims: [],
        settings: null,
      });
    }
  };
  await access(false);
  const appointment = await store.roleAssignments.create({
    subjectUid: identity.uid,
    roleKey: 'department.arts_director',
    scope: { type: 'department', id: 'student_union.arts_center' },
    expiresAt: null,
    status: 'active',
    ownerUid: 'entry-administrator',
  });
  await access(true);
  await store.roleAssignments.update(appointment.id, { expiresAt: '2000-01-01T00:00:00Z' });
  await access(false);
  await store.roleAssignments.update(appointment.id, { expiresAt: null });
  await access(true);
  await store.roleAssignments.update(appointment.id, { status: 'inactive' });
  await access(false);
});
