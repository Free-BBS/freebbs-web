import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  FinanceBudgetInput,
  FinanceClaimInput,
  FinanceDepartment,
} from '@freebbs-development/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { financeClaimChecklist } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { FinanceTrackingService } from './tracking-service.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const chief = (uid: string): AuthorizationContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: ['counselor.youth_league'],
  tags: [],
  roleScopes: [
    {
      subjectUid: uid,
      roleKey: 'counselor.youth_league',
      scope: { type: 'public', id: '*' },
      expiresAt: null,
    },
  ],
});
const root = { ...chief('designated-reviewer'), rootAdmin: true };
const second = chief('second-final-reviewer');
const peerRoot = { ...chief('another-root'), rootAdmin: true };
const department: FinanceDepartment = {
  id: 'youth_league.shared_rooms',
  name: '系用房',
  portId: 'youth_league',
};
const ordinary: FinanceDepartment = {
  id: 'youth_league.practice',
  name: '实践组',
  portId: 'youth_league',
};
const budget: FinanceBudgetInput = {
  year: '2026-2027',
  departmentId: department.id,
  code: '1-1-1',
  name: '公共空间费用',
  reimbursementCents: 10000,
  directPaymentCents: 5000,
  notes: '',
};
const claimInput = (projectId: string): FinanceClaimInput => ({
  projectId,
  kind: 'reimbursement',
  items: [{ description: '物料', quantity: '1' }],
  amountCents: 2000,
  invoiceLines: [{ category: 'activity_materials', amountCents: 2000, repeatCount: 1 }],
  checklist: financeClaimChecklist({ kind: 'reimbursement' }).map(({ key }) => key),
  payeeName: '收款同学',
  payeeStudentId: '2026010001',
  materials: ['发票'],
  externalReference: '学校提交编号',
  externalSubmittedAt: '2026-11-03',
  notes: '',
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-exclusive-'));
  temporary.push(directory);
  const service = new FinanceTrackingService({
    directory,
    defaultDepartments: [department, ordinary],
  });
  const initial = await service.read(root);
  await service.updateSettings(root, {
    ...initial.settings!,
    departments: [{ ...department, reviewPolicy: { reviewerUids: [root.uid] } }, ordinary],
  });
  const payload = await service.createProject(root, 'p1', budget);
  return { service, directory, projectId: payload.projects[0].id };
}

describe('directory-specific final review restrictions', () => {
  it('restricts approval and return without changing existing visibility, submission or receipt rights', async () => {
    const { service, projectId } = await fixture();
    const created = (await service.createClaim(second, 'c1', claimInput(projectId))).claims[0];
    await service.act(second, created.id, 1, 'submit');
    for (const actor of [second, peerRoot]) {
      const visible = (await service.read(actor)).claims[0];
      expect(visible.id).toBe(created.id);
      expect(visible.allowedActions).not.toContain('approve');
      expect(visible.allowedActions).not.toContain('return');
      await expect(service.act(actor, created.id, 2, 'approve')).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.act(actor, created.id, 2, 'return', '请补材料')).rejects.toMatchObject({
        status: 403,
      });
    }
    expect((await service.read(root)).claims[0].allowedActions).toContain('approve');
    await service.act(root, created.id, 2, 'approve');
    expect((await service.read(second)).claims[0].allowedActions).not.toContain('confirm_received');
    await service.act(root, created.id, 3, 'record_school_submission');
    const schoolClaim = (await service.read(second)).claims[0];
    expect(schoolClaim.allowedActions).toContain('confirm_received');
    expect(schoolClaim.allowedActions).not.toContain('record_teacher_approval');
    await expect(
      service.act(second, created.id, 4, 'record_teacher_approval'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.act(second, created.id, 4, 'return', '退回')).rejects.toMatchObject({
      status: 403,
    });
    await service.act(root, created.id, 4, 'record_teacher_approval');
    const received = await service.act(second, created.id, 5, 'confirm_received');
    expect(received.claims[0].status).toBe('received');
    expect(received.claims[0].history.map(({ action }) => action)).toEqual([
      'create',
      'submit',
      'approve',
      'record_school_submission',
      'record_teacher_approval',
      'confirm_received',
    ]);
  });

  it('requires current shared final-reviewer authority even when the UID is listed', async () => {
    const { service, projectId } = await fixture();
    const restrictedSettings = (await service.read(root)).settings!;
    await service.updateSettings(root, {
      ...restrictedSettings,
      departments: [{ ...department, reviewPolicy: { reviewerUids: [second.uid] } }, ordinary],
    });
    const created = (await service.createClaim(second, 'c1', claimInput(projectId))).claims[0];
    await service.act(second, created.id, 1, 'submit');
    const expired = {
      ...second,
      roleScopes: second.roleScopes!.map((assignment) => ({
        ...assignment,
        expiresAt: '2020-01-01T00:00:00Z',
      })),
    };
    await expect(service.act(expired, created.id, 2, 'approve')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.act(root, created.id, 2, 'approve')).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.act(second, created.id, 2, 'approve')).resolves.toMatchObject({
      claims: [expect.objectContaining({ status: 'initial_approved' })],
    });
  });

  it('permits final reviewers to maintain ordinary settings but reserves review policies to root administrators', async () => {
    const { service } = await fixture();
    const settings = (await service.read(second)).settings!;
    const renamed = await service.updateSettings(second, {
      ...settings,
      departments: settings.departments.map((entry) => ({ ...entry, name: `${entry.name}预算` })),
    });
    for (const departments of [
      [department, ordinary],
      [ordinary],
      [{ ...department, reviewPolicy: { reviewerUids: [second.uid] } }, ordinary],
      [
        { ...department, portId: 'bbs' as const, reviewPolicy: { reviewerUids: [root.uid] } },
        ordinary,
      ],
      [
        ...renamed.settings!.departments,
        {
          id: 'new',
          name: '新目录',
          portId: 'bbs' as const,
          reviewPolicy: { reviewerUids: [second.uid] },
        },
      ],
    ]) {
      await expect(
        service.updateSettings(second, { ...renamed.settings!, departments }),
      ).rejects.toMatchObject({ status: 403 });
    }
    const replaced = await service.updateSettings(root, {
      ...renamed.settings!,
      departments: [{ ...department, reviewPolicy: { reviewerUids: [second.uid] } }, ordinary],
    });
    expect(replaced.settings?.departments[0].reviewPolicy).toEqual({ reviewerUids: [second.uid] });
  });

  it('blocks moving a restricted budget to a different department and preserves normal budgets', async () => {
    const { service, projectId } = await fixture();
    await expect(
      service.updateProject(second, projectId, 1, { ...budget, departmentId: ordinary.id }),
    ).rejects.toMatchObject({ status: 403 });
    await service.updateProject(root, projectId, 1, { ...budget, departmentId: ordinary.id });
    const created = (await service.createClaim(second, 'c1', claimInput(projectId))).claims[0];
    await service.act(second, created.id, 1, 'submit');
    await expect(service.act(second, created.id, 2, 'approve')).resolves.toMatchObject({
      claims: [expect.objectContaining({ status: 'initial_approved' })],
    });
  });

  it('persists policy changes, validates reviewer UID lists, and honors changes on pending claims', async () => {
    const { service, directory, projectId } = await fixture();
    const created = (await service.createClaim(second, 'c1', claimInput(projectId))).claims[0];
    await service.act(second, created.id, 1, 'submit');
    const settings = (await service.read(root)).settings!;
    for (const reviewerUids of [[], [''], [root.uid, root.uid], [' a', 'a'], Array(21).fill('x')]) {
      await expect(
        service.updateSettings(root, {
          ...settings,
          departments: [{ ...department, reviewPolicy: { reviewerUids } }, ordinary],
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
    await service.updateSettings(root, {
      ...settings,
      departments: [{ ...department, reviewPolicy: { reviewerUids: [second.uid] } }, ordinary],
    });
    const reloaded = new FinanceTrackingService({ directory });
    await expect(reloaded.act(root, created.id, 2, 'approve')).rejects.toMatchObject({
      status: 403,
    });
    await expect(reloaded.act(second, created.id, 2, 'approve')).resolves.toMatchObject({
      claims: [expect.objectContaining({ status: 'initial_approved' })],
    });
  });
});
