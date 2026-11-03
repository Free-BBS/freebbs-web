import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ROOT_ADMIN_UIDS, FINANCE_PORTS } from '@freebbs-development/contracts';
import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { DEFAULT_FINANCE_DEPARTMENTS } from './default-departments.js';
import { FinanceTrackingService } from './tracking-service.js';
import { financeDepartmentAccess } from './shared-access.js';

describe('public budget categories', () => {
  it('keeps the six work ports and adds a separate category for department-wide rooms', () => {
    expect(FINANCE_PORTS.slice(0, 6).map(({ id }) => id)).toEqual([
      'youth_league',
      'student_union',
      'science_association',
      'media_center',
      'sports',
      'bbs',
    ]);
    expect(FINANCE_PORTS[6]).toEqual({ id: 'department_common', name: '系级公共' });
    expect(new Set(DEFAULT_FINANCE_DEPARTMENTS.map(({ id }) => id)).size).toBe(
      DEFAULT_FINANCE_DEPARTMENTS.length,
    );
    const rooms = DEFAULT_FINANCE_DEPARTMENTS.find(({ id }) => id === 'department_common.rooms')!;
    expect(rooms).toEqual({
      id: 'department_common.rooms',
      name: '系用房',
      portId: 'department_common',
      reviewPolicy: { reviewerUids: DEFAULT_ROOT_ADMIN_UIDS.slice(0, 1) },
    });
    const officer: AuthorizationContext = {
      uid: 'officer',
      displayName: 'officer',
      avatarUrl: null,
      baseRole: 'student',
      roles: ['youth_league.finance'],
      tags: [],
      roleScopes: [
        {
          subjectUid: 'officer',
          roleKey: 'youth_league.finance',
          scope: { type: 'public', id: '*' },
          expiresAt: null,
        },
      ],
    };
    expect(financeDepartmentAccess(officer, rooms)).toEqual({
      read: false,
      submit: false,
      officer: false,
    });
    expect(
      DEFAULT_FINANCE_DEPARTMENTS.find(({ id }) => id === 'sports.reserve')?.teamId,
    ).toBeUndefined();
  });

  it('connects the actual default rooms policy to the designated root without a counselor appointment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-default-rooms-'));
    const root: AuthorizationContext = {
      uid: DEFAULT_ROOT_ADMIN_UIDS[0],
      displayName: 'designated root',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      rootAdmin: true,
    };
    try {
      const service = new FinanceTrackingService({
        directory,
        defaultDepartments: DEFAULT_FINANCE_DEPARTMENTS,
      });
      const initial = await service.read(root);
      expect(initial.canManageReviewPolicies).toBe(true);
      const created = await service.createProject(root, 'default-rooms-project', {
        year: '2026-2027',
        departmentId: 'department_common.rooms',
        code: '1-1-1',
        name: '系用房测试项目',
        reimbursementCents: 10000,
        directPaymentCents: 0,
        notes: '',
      });
      const projectId = created.projects[0].id;
      const claim = (
        await service.createClaim(root, 'default-rooms-claim', {
          projectId,
          kind: 'reimbursement',
          items: [{ description: '测试物料', quantity: '1' }],
          amountCents: 1000,
          payeeName: '收款同学',
          payeeStudentId: '2026010001',
          materials: ['发票'],
          externalReference: '测试提交编号',
          externalSubmittedAt: '2026-11-03',
          notes: '',
        })
      ).claims[0];
      const submitted = await service.act(root, claim.id, 1, 'submit');
      expect(submitted.claims[0].allowedActions).toContain('approve');
      const approved = await service.act(root, claim.id, 2, 'approve');
      expect(approved.claims[0].status).toBe('school_review');
      expect(approved.claims[0].history.at(-1)?.actorUid).toBe(root.uid);
      expect(approved.projects[0].reimbursement.schoolReviewCents).toBe(1000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not migrate an existing ledger or replace its directory when application defaults change', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-existing-catalog-'));
    const root: AuthorizationContext = {
      uid: 'root',
      displayName: 'root',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      rootAdmin: true,
    };
    try {
      const old = new FinanceTrackingService({ directory, defaultDepartments: [] });
      const initial = await old.read(root);
      await old.updateSettings(root, initial.settings!);
      const upgraded = new FinanceTrackingService({
        directory,
        defaultDepartments: DEFAULT_FINANCE_DEPARTMENTS,
      });
      const result = await upgraded.read(root);
      expect(result.departments).toEqual([]);
      expect(result.settings?.revision).toBe(2);
      expect(result.projects).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
