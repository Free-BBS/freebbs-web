import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  FinanceBudgetInput,
  FinanceClaimInput,
  FinanceDepartment,
  RoleKey,
} from '@freebbs-development/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { FinanceTrackingService } from './tracking-service.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function user(uid: string, role?: RoleKey, departmentId?: string): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: role ? [role] : [],
    tags: [],
    roleScopes: role
      ? [
          {
            subjectUid: uid,
            roleKey: role,
            scope: departmentId
              ? { type: 'department', id: departmentId }
              : { type: 'public', id: '*' },
            expiresAt: null,
          },
        ]
      : [],
  };
}
const owner = user('owner', 'counselor.youth_league');
const counselor = user('second-final-reviewer', 'counselor.youth_league_secretary');
const head = user('head', 'youth_league.practice.deputy_secretary', 'youth_league.practice');
const peer = user('peer', 'youth_league.practice.deputy_secretary', 'youth_league.practice');
const other = user(
  'other',
  'science_association.software.minister',
  'science_association.software',
);
const officer = user('officer', 'youth_league.finance');
const departments: FinanceDepartment[] = [
  { id: 'youth_league.practice', name: '实践组', portId: 'youth_league' },
  { id: 'science_association.software', name: '软件部', portId: 'science_association' },
];
const budget: FinanceBudgetInput = {
  year: '2026-2027',
  departmentId: departments[0].id,
  code: '2-1-1',
  name: '实践活动',
  reimbursementCents: 10000,
  directPaymentCents: 5000,
  notes: '',
};
function input(projectId: string, amountCents = 3000): FinanceClaimInput {
  return {
    projectId,
    kind: 'reimbursement',
    items: [{ description: '活动物料', quantity: '3 件' }],
    amountCents,
    payeeName: '收款同学',
    payeeStudentId: '2026010001',
    materials: ['发票', '活动说明'],
    externalReference: '校财务-001',
    externalSubmittedAt: '2026-10-23',
    notes: '',
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'freebbs-finance-'));
  temporary.push(directory);
  const service = new FinanceTrackingService({ directory, defaultDepartments: departments });
  const payload = await service.createProject(owner, 'project-1', budget);
  return { directory, service, projectId: payload.projects[0].id };
}

describe('finance shared-identity permissions and accounting', () => {
  it('requires private storage and never inherits finance authority from ordinary admins or demo UIDs', async () => {
    const unavailable = new FinanceTrackingService({ authMode: 'demo' });
    expect((await unavailable.read(owner)).configured).toBe(false);
    await expect(unavailable.createProject(owner, 'p', budget)).rejects.toMatchObject({
      status: 503,
    });
    const { service, directory } = await fixture();
    for (const actor of [
      user('demo-admin'),
      { ...user('admin', 'platform.admin'), businessAdmin: true },
      user('student-dev', 'counselor.student_development'),
    ]) {
      expect((await service.access(actor)).canManageBudget).toBe(false);
      await expect(service.createProject(actor, 'p', budget)).rejects.toMatchObject({
        status: 403,
      });
    }
    const demo = new FinanceTrackingService({ directory, authMode: 'demo' });
    expect((await demo.access(user('demo-admin'))).canManageBudget).toBe(false);
  });

  it('uses shared scoped appointments for department visibility and protects draft and aggregate privacy', async () => {
    const { service, projectId } = await fixture();
    const claim = (await service.createClaim(head, 'c1', input(projectId))).claims[0];
    expect((await service.read(peer)).claims).toEqual([]);
    expect((await service.read(officer)).claims).toEqual([]);
    await service.act(head, claim.id, 1, 'submit');
    expect((await service.read(peer)).claims).toHaveLength(1);
    expect((await service.read(officer)).claims).toHaveLength(1);
    const outside = await service.read(other);
    expect(outside.departments.map(({ id }) => id)).toEqual(['science_association.software']);
    expect(outside.projects).toEqual([]);
    expect(outside.claims).toEqual([]);
    expect(outside.settings).toBeNull();
    expect(JSON.stringify((await service.read(head)).projects)).not.toContain('2026010001');
    await expect(service.createClaim(other, 'foreign', input(projectId))).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.createClaim(officer, 'officer', input(projectId))).rejects.toMatchObject({
      status: 403,
    });
  });

  it('does not grant authority through finance settings and discards legacy duplicate personnel configuration', async () => {
    const { service, projectId } = await fixture();
    const settings = (await service.read(owner)).settings!;
    const result = await service.updateSettings(owner, {
      ...settings,
      grants: [
        {
          uid: 'unassigned',
          displayName: '旧二次赋权',
          role: 'department',
          departmentIds: [departments[0].id],
          portIds: [],
        },
      ],
    });
    expect(result.settings?.grants).toEqual([]);
    expect((await service.access(user('unassigned'))).canAccess).toBe(false);
    await expect(
      service.createClaim(user('unassigned'), 'fake', input(projectId)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.updateSettings(head, { ...result.settings! })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('supports multiple current global final reviewers and immediately honors role removal and expiry', async () => {
    const { service, projectId } = await fixture();
    await service.updateProject(counselor, projectId, 1, { ...budget, reimbursementCents: 20000 });
    await service.updateProject(owner, projectId, 2, { ...budget, reimbursementCents: 30000 });
    expect((await service.read(counselor)).projects[0].reimbursement.allocatedCents).toBe(30000);
    for (const actor of [
      user(counselor.uid),
      { ...counselor, roleScopes: [] },
      {
        ...counselor,
        roleScopes: counselor.roleScopes!.map((scope) => ({
          ...scope,
          expiresAt: '2020-01-01T00:00:00Z',
        })),
      },
      user('local', 'counselor.youth_league', departments[0].id),
    ]) {
      await expect(service.updateProject(actor, projectId, 3, budget)).rejects.toMatchObject({
        status: 403,
      });
    }
    expect((await service.read({ ...user('root'), rootAdmin: true })).canManageBudget).toBe(true);
  });

  it('rejects financial reads and writes through identity preview even for final reviewers', async () => {
    const { service } = await fixture();
    for (const actor of [
      { ...owner, previewing: true },
      { ...owner, viewer: { uid: 'real-admin', displayName: 'admin', canManageDevelopment: true } },
    ]) {
      await expect(service.read(actor)).rejects.toMatchObject({ status: 403 });
      await expect(service.access(actor)).rejects.toMatchObject({ status: 403 });
      await expect(service.createProject(actor, 'preview', budget)).rejects.toMatchObject({
        status: 403,
      });
    }
  });

  it('counts each cent in one review stage and keeps reimbursement and direct-payment ceilings independent', async () => {
    const { service, projectId } = await fixture();
    const id = (await service.createClaim(head, 'c1', input(projectId))).claims[0].id;
    expect((await service.read(head)).projects[0].reimbursement.remainingCents).toBe(10000);
    let payload = await service.act(head, id, 1, 'submit');
    expect(payload.projects[0].reimbursement).toMatchObject({
      departmentReviewCents: 3000,
      schoolReviewCents: 0,
      receivedCents: 0,
      remainingCents: 7000,
    });
    payload = await service.act(counselor, id, 2, 'approve');
    expect(payload.projects[0].reimbursement).toMatchObject({
      departmentReviewCents: 0,
      schoolReviewCents: 3000,
      receivedCents: 0,
      remainingCents: 7000,
    });
    payload = await service.act(head, id, 3, 'confirm_received');
    expect(payload.projects[0].reimbursement).toMatchObject({
      departmentReviewCents: 0,
      schoolReviewCents: 0,
      receivedCents: 3000,
      remainingCents: 7000,
    });
    const direct = (
      await service.createClaim(head, 'direct', {
        ...input(projectId, 6000),
        kind: 'direct_payment',
      })
    ).claims.find(({ kind }) => kind === 'direct_payment')!;
    payload = await service.act(head, direct.id, 1, 'submit');
    expect(payload.projects[0].directPayment).toMatchObject({
      remainingCents: -1000,
      overBudget: true,
    });
    expect(payload.projects[0].reimbursement.remainingCents).toBe(7000);
  });

  it('releases reservations on justified return and withdrawal and resets markers when resubmitted', async () => {
    const { service, projectId } = await fixture();
    const id = (await service.createClaim(head, 'c1', input(projectId))).claims[0].id;
    await service.act(head, id, 1, 'submit');
    await service.act(officer, id, 2, 'record_school_submission');
    await expect(service.act(counselor, id, 3, 'return')).rejects.toMatchObject({ status: 400 });
    let payload = await service.act(counselor, id, 3, 'return', '请补充发票抬头');
    expect(payload.projects[0].reimbursement.remainingCents).toBe(10000);
    await service.updateClaim(head, id, 4, input(projectId, 4000));
    payload = await service.act(head, id, 5, 'submit');
    expect(payload.claims[0].schoolSubmittedAt).toBeNull();
    payload = await service.act(head, id, 6, 'withdraw');
    expect(payload.projects[0].reimbursement.remainingCents).toBe(10000);
    await expect(service.updateClaim(head, id, 7, input(projectId))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('allows only final reviewers to approve and only the original department submitter to confirm receipt or edit', async () => {
    const { service, projectId } = await fixture();
    const id = (await service.createClaim(head, 'c1', input(projectId))).claims[0].id;
    await service.act(head, id, 1, 'submit');
    for (const actor of [head, peer, officer])
      await expect(service.act(actor, id, 2, 'approve')).rejects.toMatchObject({ status: 403 });
    await service.act(counselor, id, 2, 'approve');
    for (const actor of [owner, counselor, peer, officer]) {
      await expect(service.act(actor, id, 3, 'confirm_received')).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.updateClaim(actor, id, 3, input(projectId))).rejects.toMatchObject({
        status: 403,
      });
    }
    await expect(service.act(head, id, 3, 'withdraw')).rejects.toMatchObject({ status: 403 });
    await expect(service.act(other, id, 3, 'return', 'other')).rejects.toMatchObject({
      status: 404,
    });
    await service.act(owner, id, 3, 'record_teacher_approval');
    await service.act(head, id, 4, 'confirm_received');
    await expect(service.act(counselor, id, 5, 'return', 'late')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rechecks current department appointments rather than retaining revoked authority', async () => {
    const { service, projectId } = await fixture();
    const id = (await service.createClaim(head, 'c1', input(projectId))).claims[0].id;
    await expect(service.act(user(head.uid), id, 1, 'submit')).rejects.toMatchObject({
      status: 404,
    });
    const foreign = {
      ...head,
      roleScopes: head.roleScopes!.map((scope) => ({
        ...scope,
        scope: { type: 'department', id: 'science_association.software' },
      })),
    };
    expect((await service.read(foreign)).projects).toEqual([]);
  });

  it('serializes idempotent creates and rejects stale actions without double reserving money', async () => {
    const { service, directory, projectId } = await fixture();
    const otherProcess = new FinanceTrackingService({ directory, defaultDepartments: departments });
    await Promise.all([
      service.createClaim(head, 'same', input(projectId, 7000)),
      otherProcess.createClaim(head, 'same', input(projectId, 7000)),
    ]);
    const claim = (await service.read(head)).claims[0];
    expect((await service.read(head)).claims).toHaveLength(1);
    await expect(service.createClaim(head, 'same', input(projectId, 8000))).rejects.toMatchObject({
      status: 409,
    });
    const results = await Promise.allSettled([
      service.act(head, claim.id, 1, 'submit'),
      otherProcess.act(head, claim.id, 1, 'submit'),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
    expect((await service.read(head)).projects[0].reimbursement.remainingCents).toBe(3000);
    const next = (await service.createClaim(peer, 'second', input(projectId, 6000))).claims.find(
      ({ submitterUid }) => submitterUid === peer.uid,
    )!;
    await service.act(peer, next.id, 1, 'submit');
    expect((await service.read(head)).projects[0].reimbursement).toMatchObject({
      remainingCents: -3000,
      overBudget: true,
    });
  });

  it('persists private before/after audits without returning them in any workspace payload', async () => {
    const { service, directory, projectId } = await fixture();
    await service.updateProject(owner, projectId, 1, { ...budget, reimbursementCents: 20000 });
    const persisted = new FinanceTrackingService({ directory, defaultDepartments: departments });
    expect((await persisted.read(head)).projects[0].reimbursement.allocatedCents).toBe(20000);
    const files = await readdir(join(directory, 'finance-tracking'));
    const ledger = JSON.parse(
      await readFile(join(directory, 'finance-tracking', files[0]), 'utf8'),
    );
    expect(ledger.audit.at(-1)).toMatchObject({
      actorUid: owner.uid,
      action: 'project.update',
      before: { reimbursementCents: 10000 },
      after: { reimbursementCents: 20000 },
    });
    expect(await persisted.read(owner)).not.toHaveProperty('audit');
  });

  it('protects project identity, unique codes, master revisions and external submission information', async () => {
    const { service, projectId } = await fixture();
    await expect(service.createProject(owner, 'duplicate', budget)).rejects.toMatchObject({
      status: 409,
    });
    const id = (
      await service.createClaim(head, 'c1', {
        ...input(projectId),
        externalReference: '',
        externalSubmittedAt: '',
      })
    ).claims[0].id;
    await expect(service.act(head, id, 1, 'submit')).rejects.toMatchObject({ status: 400 });
    await expect(
      service.updateProject(owner, projectId, 1, { ...budget, departmentId: departments[1].id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.updateProject(owner, projectId, 1, { ...budget, year: '2027-2028' }),
    ).rejects.toMatchObject({ status: 409 });
    await service.updateProject(owner, projectId, 1, { ...budget, name: '实践活动修订' });
    await expect(service.updateProject(owner, projectId, 1, budget)).rejects.toMatchObject({
      status: 409,
    });
    const settings = (await service.read(owner)).settings!;
    await service.updateSettings(owner, settings);
    await expect(service.updateSettings(owner, settings)).rejects.toMatchObject({ status: 409 });
    await expect(
      service.updateSettings(owner, { ...(await service.read(owner)).settings!, departments: [] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('records school-finance submission only for reimbursements while keeping direct-payment review usable', async () => {
    const { service, projectId } = await fixture();
    const reimbursement = (await service.createClaim(head, 'reimbursement', input(projectId)))
      .claims[0];
    const direct = (
      await service.createClaim(head, 'direct', {
        ...input(projectId),
        kind: 'direct_payment',
        externalReference: '代发邮件主题',
      })
    ).claims.find(({ kind }) => kind === 'direct_payment')!;
    await service.act(head, reimbursement.id, 1, 'submit');
    await service.act(head, direct.id, 1, 'submit');
    expect(
      (await service.read(officer)).claims.find(({ id }) => id === reimbursement.id)!
        .allowedActions,
    ).toContain('record_school_submission');
    await service.act(officer, reimbursement.id, 2, 'record_school_submission');
    for (const actor of [officer, counselor, owner])
      await expect(
        service.act(actor, direct.id, 2, 'record_school_submission'),
      ).rejects.toMatchObject({ status: 403 });
    await service.act(counselor, direct.id, 2, 'approve');
    await service.act(owner, direct.id, 3, 'record_teacher_approval');
    const received = await service.act(head, direct.id, 4, 'confirm_received');
    expect(received.claims.find(({ id }) => id === direct.id)).toMatchObject({
      status: 'received',
      schoolSubmittedAt: null,
    });
  });

  it('synchronizes explicit shared team identities, keeps bindings and rejects unknown or duplicate team IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'freebbs-team-finance-'));
    temporary.push(directory);
    let teams = [
      { id: 'team-a', name: '甲队', status: 'active' },
      { id: 'team-b', name: '乙队', status: 'active' },
    ];
    const service = new FinanceTrackingService({
      directory,
      defaultDepartments: departments,
      getSharedTeams: async () => teams,
    });
    let payload = await service.read(owner);
    expect(payload.departments.filter(({ teamId }) => teamId)).toMatchObject([
      { id: 'sports_team.team-a', teamId: 'team-a' },
      { id: 'sports_team.team-b', teamId: 'team-b' },
    ]);
    const revision = payload.settings!.revision;
    expect((await service.read(owner)).settings!.revision).toBe(revision);
    teams = [{ ...teams[0], name: '甲队新名称' }, teams[1]];
    payload = await service.read(owner);
    expect(payload.settings!.revision).toBe(revision + 1);
    const captain = {
      ...user('captain'),
      tags: [
        {
          key: 'sports.team_captain',
          scope: { type: 'sports_team', id: 'team-a' },
          expiresAt: null,
        },
      ],
    };
    expect((await service.read(captain)).departments.map(({ teamId }) => teamId)).toEqual([
      'team-a',
    ]);
    const kept = await service.updateSettings(owner, { ...payload.settings!, departments });
    expect(kept.departments.filter(({ teamId }) => teamId)).toHaveLength(2);
    for (const extra of [
      { id: 'unknown-team', name: '未知', portId: 'sports' as const, teamId: 'not-real' },
      { id: 'duplicate-team', name: '重复', portId: 'sports' as const, teamId: 'team-a' },
    ])
      await expect(
        service.updateSettings(owner, {
          ...kept.settings!,
          departments: [...kept.departments, extra],
        }),
      ).rejects.toMatchObject({ status: 400 });
    const sportsLead = user('sports-director', 'department.sports_director');
    expect(
      (await service.read(sportsLead)).departments.filter(({ teamId }) => teamId),
    ).toHaveLength(2);
  });
});
