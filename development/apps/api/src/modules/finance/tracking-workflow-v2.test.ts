import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import {
  financeClaimChecklist,
  financeClaimWarnings,
  type FinanceClaimInput,
  type FinanceInvoiceLine,
  type FinanceWorkflowGuide,
  type RoleKey,
  type ScopeRef,
  type FinanceDepartment,
} from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { FinanceTrackingService } from './tracking-service.js';
import { createFinanceTrackingRouter } from './tracking-router.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const chief: AuthorizationContext = {
  uid: 'test-chief',
  displayName: '测试辅导员',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  rootAdmin: true,
};
const head: AuthorizationContext = {
  uid: 'test-head',
  displayName: '测试部门负责人',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['youth_league.practice.deputy_secretary'],
  tags: [],
  roleScopes: [
    {
      subjectUid: 'test-head',
      roleKey: 'youth_league.practice.deputy_secretary',
      scope: { type: 'department', id: 'youth_league.practice' },
      expiresAt: null,
    },
  ],
};
const officer: AuthorizationContext = {
  uid: 'test-officer',
  displayName: '测试经费负责人',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['youth_league.finance'],
  tags: [],
  roleScopes: [
    {
      subjectUid: 'test-officer',
      roleKey: 'youth_league.finance',
      scope: { type: 'organization', id: 'youth_league' },
      expiresAt: null,
    },
  ],
};
const department = { id: 'youth_league.practice', name: '实践组', portId: 'youth_league' as const };
const guide: FinanceWorkflowGuide = {
  portId: 'youth_league',
  financeOfficer: { name: '示例经费负责人', employeeNumber: 'TEST001' },
  counselors: [{ name: '示例辅导员', employeeNumber: 'TEST002' }],
  teacher: { name: '示例老师', employeeNumber: 'TEST003' },
  reimbursementSteps: [],
  directPaymentSteps: [],
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-workflow-v2-'));
  roots.push(directory);
  const service = new FinanceTrackingService({ directory, defaultDepartments: [department] });
  await service.updateSettings(chief, {
    ...(await service.read(chief)).settings!,
    workflowGuides: [guide],
  });
  const data = await service.createProject(chief, 'budget', {
    year: '2026-2027',
    departmentId: department.id,
    code: '2-4-1',
    name: '测试活动',
    reimbursementCents: 600000,
    directPaymentCents: 200000,
    notes: '',
  });
  return { service, directory, projectId: data.projects[0].id };
}
function invoice(
  projectId: string,
  lines: FinanceInvoiceLine[] = [
    { category: 'activity_materials', amountCents: 80000, repeatCount: 1 },
  ],
): FinanceClaimInput {
  const input: FinanceClaimInput = {
    projectId,
    kind: 'reimbursement',
    amountCents: 1,
    items: [],
    payeeName: '测试收款人',
    payeeStudentId: 'TEST-STUDENT',
    materials: [],
    externalReference: '',
    externalSubmittedAt: '',
    notes: '',
    invoiceLines: lines,
  };
  input.checklist = financeClaimChecklist(input, guide).map(({ key }) => key);
  return input;
}
async function proof(service: FinanceTrackingService, uid = head.uid) {
  const buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=',
    'base64',
  );
  return service.privateFileStore!.create(uid, 'work_proof', {
    originalname: 'test-proof.png',
    mimetype: 'image/png',
    buffer,
    size: buffer.length,
  } as Express.Multer.File);
}

describe('v2 invoice checklist and counselor workflow', () => {
  it('keeps never-submitted withdrawn drafts and their proof private while retaining submitted history visibility', async () => {
    const { service, projectId } = await fixture();
    const file = await proof(service);
    const input: FinanceClaimInput = {
      ...invoice(projectId),
      kind: 'direct_payment',
      amountCents: 1000,
      directPayment: {
        hourlyRateCents: 1000,
        workContent: '测试私有草稿',
        proofFileIds: [file.id],
      },
    };
    input.checklist = financeClaimChecklist(input).map(({ key }) => key);
    const draft = (await service.createClaim(head, 'private-withdrawal', input)).claims[0];
    await service.act(head, draft.id, 1, 'withdraw');
    const peer: AuthorizationContext = {
      ...head,
      uid: 'test-peer',
      roleScopes: head.roleScopes!.map((scope) => ({ ...scope, subjectUid: 'test-peer' })),
    };
    for (const actor of [officer, peer]) {
      expect((await service.read(actor)).claims).toEqual([]);
      await expect(
        service.authorizeFileRead(actor, await service.privateFileStore!.getMetadata(file.id)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.act(actor, draft.id, 2, 'approve')).rejects.toMatchObject({
        status: 404,
      });
    }
    expect((await service.read(head)).claims).toHaveLength(1);
    expect((await service.read(chief)).claims).toHaveLength(1);
    const submitted = (
      await service.createClaim(head, 'submitted-withdrawal', invoice(projectId))
    ).claims.at(-1)!;
    await service.act(head, submitted.id, 1, 'submit');
    await service.act(head, submitted.id, 2, 'withdraw');
    expect((await service.read(officer)).claims.map((claim) => claim.id)).toEqual([submitted.id]);
  });
  it('saves incomplete drafts without reservations and validates the full form only on submission', async () => {
    const { service, projectId } = await fixture();
    const input = {
      ...invoice(projectId, []),
      amountCents: 0,
      payeeName: '',
      payeeStudentId: '',
      checklist: [],
    };
    const created = (await service.createClaim(head, 'draft', input)).claims[0];
    expect(created.amountCents).toBe(0);
    expect((await service.read(head)).projects[0].reimbursement.remainingCents).toBe(600000);
    await expect(service.act(head, created.id, 1, 'submit')).rejects.toMatchObject({
      status: 400,
      code: 'finance_claim_incomplete',
    });
    await service.updateClaim(head, created.id, 1, invoice(projectId));
    expect((await service.act(head, created.id, 2, 'submit')).claims[0].status).toBe(
      'department_review',
    );
  });

  it('computes whole-invoice totals on the server and applies thresholds to individual invoices', async () => {
    const { service, projectId } = await fixture();
    const input = invoice(projectId, [{ category: 'other', amountCents: 100000, repeatCount: 20 }]);
    expect(financeClaimChecklist(input).map((i) => i.key)).not.toContain(
      'payment_screenshot_ready',
    );
    const claim = (await service.createClaim(head, 'repeated', input)).claims[0];
    expect(claim.amountCents).toBe(2000000);
    const submitted = await service.act(head, claim.id, 1, 'submit');
    expect(submitted.projects[0].reimbursement).toMatchObject({
      remainingCents: -1400000,
      overBudget: true,
    });
    const over = invoice(projectId, [{ category: 'venue', amountCents: 500001, repeatCount: 1 }]);
    expect(financeClaimWarnings(over)).toEqual([]);
    expect(financeClaimChecklist(over).map((i) => i.key)).toContain('payment_screenshot_ready');
    expect(
      financeClaimWarnings(
        invoice(projectId, [{ category: 'rental_service', amountCents: 500000, repeatCount: 1 }]),
      ),
    ).toEqual([]);
    expect(
      financeClaimWarnings(
        invoice(projectId, [{ category: 'rental_service', amountCents: 500001, repeatCount: 1 }]),
      ),
    ).toEqual(['单张金额超过5,000元，请先与团委辅导员确认开票及办理要求']);
  });

  it('requires payment screenshots and issue lists only when their invoice conditions are met', async () => {
    const { service, projectId } = await fixture();
    const input = invoice(projectId, [
      { category: 'distributed_goods', amountCents: 100001, repeatCount: 1 },
    ]);
    input.checklist = input.checklist!.filter((key) => key !== 'distribution_list_ready');
    const claim = (await service.createClaim(head, 'conditions', input)).claims[0];
    await expect(service.act(head, claim.id, 1, 'submit')).rejects.toMatchObject({
      code: 'finance_checklist_incomplete',
    });
    const complete = invoice(projectId, input.invoiceLines);
    complete.checklist = complete.checklist!.filter((key) => key !== 'payment_screenshot_ready');
    await service.updateClaim(head, claim.id, 1, complete);
    await expect(service.act(head, claim.id, 2, 'submit')).rejects.toMatchObject({
      code: 'finance_checklist_incomplete',
    });
    await service.updateClaim(head, claim.id, 2, invoice(projectId, input.invoiceLines));
    expect((await service.act(head, claim.id, 3, 'submit')).claims[0].status).toBe(
      'department_review',
    );
  });

  it('keeps initial approval in transit until the counselor separately confirms school-finance approval', async () => {
    const { service, projectId } = await fixture();
    const claim = (await service.createClaim(head, 'stages', invoice(projectId))).claims[0];
    await service.act(head, claim.id, 1, 'submit');
    for (const action of ['approve', 'record_school_submission'] as const)
      await expect(service.act(officer, claim.id, 2, action)).rejects.toMatchObject({
        status: 403,
      });
    const initial = await service.act(chief, claim.id, 2, 'approve');
    expect(initial.claims[0]).toMatchObject({
      status: 'initial_approved',
      initialApprovedAt: expect.any(String),
      counselorFinancialApprovedAt: null,
    });
    expect(initial.projects[0].reimbursement).toMatchObject({
      departmentReviewCents: 80000,
      schoolReviewCents: 0,
      remainingCents: 520000,
    });
    await expect(service.act(head, claim.id, 3, 'confirm_received')).rejects.toMatchObject({
      status: 403,
    });
    const school = await service.act(chief, claim.id, 3, 'record_school_submission');
    await expect(service.act(chief, claim.id, 4, 'return', '校内尚在办理')).rejects.toMatchObject({
      status: 403,
    });
    expect(school.claims[0]).toMatchObject({
      status: 'school_review',
      counselorFinancialApprovedAt: expect.any(String),
    });
    expect(school.projects[0].reimbursement).toMatchObject({
      departmentReviewCents: 0,
      schoolReviewCents: 80000,
      remainingCents: 520000,
    });
    await expect(service.act(chief, claim.id, 4, 'confirm_received')).rejects.toMatchObject({
      status: 403,
    });
    const paid = await service.act(head, claim.id, 4, 'confirm_received');
    expect(paid.projects[0].reimbursement).toMatchObject({
      schoolReviewCents: 0,
      receivedCents: 80000,
      remainingCents: 520000,
    });
  });

  it('allows returned applications to be corrected and resubmitted with their history intact', async () => {
    const { service, projectId } = await fixture();
    const claim = (await service.createClaim(head, 'returned', invoice(projectId))).claims[0];
    await service.act(head, claim.id, 1, 'submit');
    await expect(service.act(chief, claim.id, 2, 'return')).rejects.toMatchObject({ status: 400 });
    const returned = await service.act(chief, claim.id, 2, 'return', '请补充领用清单');
    expect(returned.projects[0].reimbursement.remainingCents).toBe(600000);
    await service.updateClaim(
      head,
      claim.id,
      3,
      invoice(projectId, [{ category: 'distributed_goods', amountCents: 70000, repeatCount: 1 }]),
    );
    const resubmitted = await service.act(head, claim.id, 4, 'submit');
    expect(resubmitted.claims[0].id).toBe(claim.id);
    expect(resubmitted.claims[0].history.map((e) => e.action)).toEqual([
      'create',
      'submit',
      'return',
      'edit',
      'submit',
    ]);
    expect(resubmitted.projects[0].reimbursement.remainingCents).toBe(530000);
  });

  it('uses a separate direct-payment form, private work proof and the same four approval stages', async () => {
    const { service, projectId } = await fixture();
    const file = await proof(service);
    const input: FinanceClaimInput = {
      ...invoice(projectId),
      kind: 'direct_payment',
      amountCents: 250000,
      invoiceLines: undefined,
      directPayment: {
        hourlyRateCents: 5000,
        workContent: '测试活动整理',
        proofFileIds: [file.id],
      },
    };
    input.checklist = financeClaimChecklist(input, guide).map((i) => i.key);
    const claim = (await service.createClaim(head, 'direct', input)).claims[0];
    await service.act(head, claim.id, 1, 'submit');
    await service.act(chief, claim.id, 2, 'approve');
    const school = await service.act(chief, claim.id, 3, 'record_school_submission');
    expect(school.projects[0].directPayment).toMatchObject({
      remainingCents: -50000,
      overBudget: true,
      schoolReviewCents: 250000,
    });
    const paid = await service.act(head, claim.id, 4, 'confirm_received');
    expect(paid.projects[0].directPayment.receivedCents).toBe(250000);
    expect(paid.projects[0].reimbursement.remainingCents).toBe(600000);
    await service.authorizeFileRead(officer, await service.privateFileStore!.getMetadata(file.id));
    const otherFile = await proof(service, 'unrelated-owner');
    await expect(
      service.createClaim(head, 'foreign-proof', {
        ...input,
        directPayment: { ...input.directPayment!, proofFileIds: [otherFile.id] },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('applies edited guide steps to new submissions and does not treat old acknowledgements as current', async () => {
    const { service, projectId } = await fixture();
    const claim = (await service.createClaim(head, 'guide', invoice(projectId))).claims[0];
    const settings = (await service.read(chief)).settings!;
    const updatedGuide = { ...guide, reimbursementSteps: ['准备发票后在学校系统授权经费负责人'] };
    await service.updateSettings(chief, { ...settings, workflowGuides: [updatedGuide] });
    expect((await service.read(head)).workflowGuides).toEqual([updatedGuide]);
    await expect(service.act(head, claim.id, 1, 'submit')).rejects.toMatchObject({
      code: 'finance_checklist_incomplete',
    });
    const updated = invoice(projectId);
    updated.checklist = financeClaimChecklist(updated, updatedGuide).map((i) => i.key);
    expect(financeClaimChecklist(updated, updatedGuide).at(-1)!.label).toMatch(/^已了解：/);
    await service.updateClaim(head, claim.id, 1, updated);
    expect((await service.act(head, claim.id, 2, 'submit')).claims[0].status).toBe(
      'department_review',
    );
  });

  it('downgrades legacy school-review labels without claiming school-finance approval has occurred', async () => {
    const { service, directory, projectId } = await fixture();
    const created = (await service.createClaim(head, 'legacy', invoice(projectId))).claims[0];
    const path = join(directory, 'finance-tracking', 'finance-tracking.json');
    // Use the on-disk storage contract to model a pre-v2 record, not new API input.
    let filePath = path;
    try {
      await readFile(filePath);
    } catch {
      const candidates = await readdir(join(directory, 'finance-tracking'));
      filePath = join(
        directory,
        'finance-tracking',
        candidates.find((f) => f.endsWith('.json'))!,
      );
    }
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const record = raw.claims ? raw : raw.record;
    const claim = record.claims.find((c: { id: string }) => c.id === created.id);
    delete claim.workflowVersion;
    claim.status = 'school_review';
    claim.schoolSubmittedAt = '2026-10-01T00:00:00Z';
    await writeFile(filePath, JSON.stringify(raw));
    const read = await service.read(chief);
    expect(read.claims[0]).toMatchObject({
      status: 'initial_approved',
      counselorFinancialApprovedAt: null,
    });
    expect(read.claims[0].allowedActions).toContain('record_school_submission');
    expect(read.claims[0].allowedActions).not.toContain('record_teacher_approval');
    await service.act(chief, created.id, created.revision, 'record_school_submission');
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    expect(
      persisted.audit.some(
        (event: { action: string; before: unknown }) =>
          event.action === 'workflow.compat_v2' &&
          JSON.stringify(event.before).includes('school_review'),
      ),
    ).toBe(true);
  });

  it('shares numbered public pools across original member IDs without merging ordinary project channels', async () => {
    const { service, projectId } = await fixture();
    const current = (await service.read(chief)).settings!;
    await service.updateSettings(chief, {
      ...current,
      departments: [
        ...current.departments,
        { id: 'media_center.common', name: '媒体公共', portId: 'media_center' },
      ],
    });
    const ids: string[] = [];
    for (const [index, amount] of [231000, 99000, 165000].entries()) {
      const data = await service.createProject(chief, `common-${index}`, {
        year: '2026-2027',
        departmentId: 'media_center.common',
        code: `5-4-${index + 1}`,
        name: `原始分项${index + 1}`,
        reimbursementCents: amount,
        directPaymentCents: 0,
        notes: `原始说明${index + 1}`,
      });
      ids.push(data.projects.find((p) => p.code === '5-4')!.memberProjectIds!.at(-1)!);
    }
    const pools = (await service.read(chief)).projects;
    const pool = pools.find((p) => p.code === '5-4')!;
    expect(pool.memberProjectIds).toHaveLength(3);
    expect(pool.reimbursementCents).toBe(495000);
    const claims = [];
    for (const [index, id] of pool.memberProjectIds!.entries()) {
      const claim = (
        await service.createClaim(
          chief,
          `pool-claim-${index}`,
          invoice(id, [{ category: 'activity_materials', amountCents: 180000, repeatCount: 1 }]),
        )
      ).claims.at(-1)!;
      await service.act(chief, claim.id, 1, 'submit');
      claims.push(claim);
    }
    expect(
      (await service.read(chief)).projects.find((p) => p.code === '5-4')!.reimbursement,
    ).toMatchObject({ departmentReviewCents: 540000, remainingCents: -45000, overBudget: true });
    await expect(
      service.createClaim(chief, 'wrong-channel', {
        ...invoice(ids[0]),
        kind: 'direct_payment',
        directPayment: { hourlyRateCents: 0, workContent: '', proofFileIds: [] },
      }),
    ).rejects.toMatchObject({ code: 'finance_channel_unavailable' });
    await expect(
      service.updateProject(chief, pool.id, pool.revision, {
        year: pool.year,
        departmentId: pool.departmentId,
        code: pool.code,
        name: pool.name,
        reimbursementCents: pool.reimbursementCents,
        directPaymentCents: 0,
        notes: '',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await service.act(chief, claims[0].id, 2, 'return', '补充材料');
    expect(
      (await service.read(chief)).projects.find((p) => p.code === '5-4')!.reimbursement
        .remainingCents,
    ).toBe(135000);
    expect(
      (await service.read(chief)).projects.find((p) => p.id === projectId)!.directPayment
        .remainingCents,
    ).toBe(200000);
  });

  it('lets work-port officers and leaders read all submitted port claims without gaining approval authority', async () => {
    const { service } = await fixture();
    const initial = (await service.read(chief)).settings!;
    const departments = [
      ...initial.departments,
      { id: 'media_center.creative', name: '创设', portId: 'media_center' as const },
      { id: 'media_center.audiovisual', name: '影策', portId: 'media_center' as const },
      { id: 'student_union.sports_center', name: '体育中心', portId: 'sports' as const },
      { id: 'sports_team.test-team', name: '测试代表队', portId: 'sports' as const },
      { id: 'bbs.platform', name: 'BBS', portId: 'bbs' as const },
    ];
    await service.updateSettings(chief, { ...initial, departments });
    for (const [index, department] of departments.entries()) {
      if (index === 0) continue;
      const data = await service.createProject(chief, `role-project-${index}`, {
        year: '2026-2027',
        departmentId: department.id,
        code: `TEST-${index}`,
        name: '测试预算',
        reimbursementCents: 100000,
        directPaymentCents: 0,
        notes: '',
      });
      const project = data.projects.find((p) => p.departmentId === department.id)!;
      const claim = (
        await service.createClaim(chief, `role-claim-${index}`, invoice(project.id))
      ).claims.at(-1)!;
      await service.act(chief, claim.id, 1, 'submit');
    }
    const cases: [RoleKey, string, number][] = [
      ['media_center.finance', 'media_center', 2],
      ['media_center.director', 'media_center', 2],
      ['sports.finance', 'sports', 2],
      ['bbs.finance', 'bbs', 1],
      ['bbs.lead', 'bbs', 1],
    ];
    for (const [role, port, count] of cases) {
      const actor: AuthorizationContext = {
        uid: `actor-${role}`,
        displayName: role,
        avatarUrl: null,
        baseRole: 'student',
        roles: [role],
        tags: [],
        roleScopes: [
          {
            subjectUid: `actor-${role}`,
            roleKey: role,
            scope: { type: 'organization', id: port },
            expiresAt: null,
          },
        ],
      };
      const data = await service.read(actor);
      expect(data.projects).toHaveLength(count);
      expect(data.claims).toHaveLength(count);
      expect(data.submittableDepartmentIds).toEqual([]);
      expect(data.settings).toBeNull();
      expect(data.claims.every((claim) => !claim.allowedActions.length)).toBe(true);
      for (const action of ['approve', 'return', 'record_school_submission'] as const)
        await expect(
          service.act(actor, data.claims[0].id, 2, action, '测试'),
        ).rejects.toMatchObject({ status: 403 });
      if (role !== 'media_center.finance') {
        const wrong = {
          ...actor,
          roleScopes: actor.roleScopes!.map((scope) => ({
            ...scope,
            scope: { type: 'public' as const, id: '*' },
          })),
        };
        expect((await service.read(wrong)).projects).toEqual([]);
      }
    }
  });
});

const approvalMatrixDepartments: FinanceDepartment[] = [
  department,
  { id: 'student_union.arts_center', name: '测试文艺中心', portId: 'student_union' },
  { id: 'science_association.software', name: '测试软件部', portId: 'science_association' },
  { id: 'media_center.creative', name: '测试创设', portId: 'media_center' },
  { id: 'sports_team.matrix-team', name: '测试代表队', portId: 'sports' },
  { id: 'bbs.platform', name: '测试BBS', portId: 'bbs' },
];
interface ReadOnlyApprovalCase {
  label: string;
  role: RoleKey;
  scope: ScopeRef;
  departmentId: string;
}
const readOnlyApprovalCases: ReadOnlyApprovalCase[] = [
  {
    label: '团委部门负责人',
    role: 'youth_league.practice.deputy_secretary',
    scope: { type: 'department', id: department.id },
    departmentId: department.id,
  },
  {
    label: '学生会部门主任',
    role: 'department.arts_director',
    scope: { type: 'department', id: 'student_union.arts_center' },
    departmentId: 'student_union.arts_center',
  },
  {
    label: '科协部门部长',
    role: 'science_association.software.minister',
    scope: { type: 'department', id: 'science_association.software' },
    departmentId: 'science_association.software',
  },
  {
    label: '媒体中心部门部长',
    role: 'media_center.creative.minister',
    scope: { type: 'department', id: 'media_center.creative' },
    departmentId: 'media_center.creative',
  },
  {
    label: '学生会工作口负责人',
    role: 'student_union.executive_president',
    scope: { type: 'organization', id: 'student_union' },
    departmentId: 'student_union.arts_center',
  },
  {
    label: '科协工作口负责人',
    role: 'science_association.chair',
    scope: { type: 'organization', id: 'science_association' },
    departmentId: 'science_association.software',
  },
  {
    label: '媒体中心工作口负责人',
    role: 'media_center.director',
    scope: { type: 'organization', id: 'media_center' },
    departmentId: 'media_center.creative',
  },
  {
    label: '体育工作口负责人',
    role: 'domain.sports_lead',
    scope: { type: 'department', id: 'student_union.sports_center' },
    departmentId: 'sports_team.matrix-team',
  },
  {
    label: 'BBS工作口负责人',
    role: 'bbs.lead',
    scope: { type: 'organization', id: 'bbs' },
    departmentId: 'bbs.platform',
  },
  {
    label: '团委经费负责人',
    role: 'youth_league.finance',
    scope: { type: 'organization', id: 'youth_league' },
    departmentId: department.id,
  },
  {
    label: '学生会经费负责人',
    role: 'student_union.finance',
    scope: { type: 'organization', id: 'student_union' },
    departmentId: 'student_union.arts_center',
  },
  {
    label: '科协经费负责人',
    role: 'science_association.office.vice_chair',
    scope: { type: 'organization', id: 'science_association' },
    departmentId: 'science_association.software',
  },
  {
    label: '媒体中心经费负责人',
    role: 'media_center.finance',
    scope: { type: 'organization', id: 'media_center' },
    departmentId: 'media_center.creative',
  },
  {
    label: '体育经费负责人',
    role: 'sports.finance',
    scope: { type: 'organization', id: 'sports' },
    departmentId: 'sports_team.matrix-team',
  },
  {
    label: 'BBS经费负责人',
    role: 'bbs.finance',
    scope: { type: 'organization', id: 'bbs' },
    departmentId: 'bbs.platform',
  },
];
function assignedActor(uid: string, role: RoleKey, scope: ScopeRef): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [role],
    tags: [],
    roleScopes: [{ subjectUid: uid, roleKey: role, scope, expiresAt: null }],
  };
}
const ordinaryCounselor = assignedActor('matrix-counselor', 'counselor.youth_league', {
  type: 'public',
  id: '*',
});
async function approvalHttpFixture(targetDepartmentId: string, actors: AuthorizationContext[]) {
  const directory = await mkdtemp(join(tmpdir(), 'finance-approval-matrix-'));
  roots.push(directory);
  const service = new FinanceTrackingService({
    directory,
    defaultDepartments: approvalMatrixDepartments,
  });
  const created = await service.createProject(chief, 'matrix-budget', {
    year: '2026-2027',
    departmentId: targetDepartmentId,
    code: 'MATRIX-APPROVAL',
    name: '合成权限测试预算',
    reimbursementCents: 100000,
    directPaymentCents: 0,
    notes: '',
  });
  const claim = (await service.createClaim(chief, 'matrix-claim', invoice(created.projects[0].id)))
    .claims[0];
  await service.act(chief, claim.id, 1, 'submit');
  const users = new Map([chief, ordinaryCounselor, ...actors].map((actor) => [actor.uid, actor]));
  const app = express();
  app.use(express.json());
  app.use(
    '/finance/tracking',
    createFinanceTrackingRouter({
      directory,
      authenticate: async (headers) => {
        const uid = headers['x-test-user'];
        const actor = typeof uid === 'string' ? users.get(uid) : undefined;
        return actor
          ? { status: 200, user: actor }
          : { status: 401, code: 'missing_identity', message: '请登录' };
      },
    }),
  );
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    response.status(error instanceof HttpError ? error.status : 500).json({
      data: {
        error: {
          code: error instanceof HttpError ? error.code : 'unexpected',
          message: error.message,
        },
      },
    });
  });
  return { app, service, claim };
}
describe('approval authorization at valid HTTP workflow stages', () => {
  it.each(readOnlyApprovalCases)(
    '$label cannot approve, return or confirm school processing at their valid stages',
    async (testCase) => {
      const actor = assignedActor(`matrix-${testCase.role}`, testCase.role, testCase.scope);
      const { app, service, claim } = await approvalHttpFixture(testCase.departmentId, [actor]);
      const before = (await service.read(actor)).claims.find((item) => item.id === claim.id)!;
      expect(before).toBeDefined();
      expect(before.status).toBe('department_review');
      for (const action of ['approve', 'return'] as const) {
        expect(before.allowedActions).not.toContain(action);
        await request(app)
          .post(`/finance/tracking/claims/${claim.id}/actions`)
          .set('X-Test-User', actor.uid)
          .send({ revision: 2, action, note: '不应允许操作' })
          .expect(403);
      }
      const initial = await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', ordinaryCounselor.uid)
        .send({ revision: 2, action: 'approve' })
        .expect(200);
      expect(initial.body.data.claims[0].status).toBe('initial_approved');
      const after = (await service.read(actor)).claims.find((item) => item.id === claim.id)!;
      for (const action of ['return', 'record_school_submission'] as const) {
        expect(after.allowedActions).not.toContain(action);
        await request(app)
          .post(`/finance/tracking/claims/${claim.id}/actions`)
          .set('X-Test-User', actor.uid)
          .send({ revision: 3, action, note: '不应允许操作' })
          .expect(403);
      }
      const unchanged = (await service.read(chief)).claims[0];
      expect(unchanged).toMatchObject({
        revision: 3,
        status: 'initial_approved',
        counselorFinancialApprovedAt: null,
      });
      const school = await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', ordinaryCounselor.uid)
        .send({ revision: 3, action: 'record_school_submission' })
        .expect(200);
      expect(school.body.data.claims[0]).toMatchObject({
        status: 'school_review',
        counselorFinancialApprovedAt: expect.any(String),
      });
    },
  );
  it.each(['counselor.youth_league', 'counselor.youth_league_secretary'] as const)(
    '%s can return, approve and confirm school processing without rootAdmin',
    async (role) => {
      const actor = assignedActor(`matrix-positive-${role}`, role, { type: 'public', id: '*' });
      const { app, claim } = await approvalHttpFixture(department.id, [actor]);
      const returned = await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', actor.uid)
        .send({ revision: 2, action: 'return', note: '请核对说明' })
        .expect(200);
      expect(returned.body.data.claims[0].status).toBe('returned');
      await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', chief.uid)
        .send({ revision: 3, action: 'submit' })
        .expect(200);
      const approved = await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', actor.uid)
        .send({ revision: 4, action: 'approve' })
        .expect(200);
      expect(approved.body.data.claims[0].status).toBe('initial_approved');
      const school = await request(app)
        .post(`/finance/tracking/claims/${claim.id}/actions`)
        .set('X-Test-User', actor.uid)
        .send({ revision: 5, action: 'record_school_submission' })
        .expect(200);
      expect(school.body.data.claims[0].status).toBe('school_review');
    },
  );
});
