import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinanceDepartment } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { FinanceTrackingService } from './tracking-service.js';
import { createFinanceTrackingRouter } from './tracking-router.js';

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const chief = (uid = 'counselor'): AuthorizationContext => ({
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
const departments: FinanceDepartment[] = [
  { id: 'youth_league.practice', name: '实践组', portId: 'youth_league' },
];
async function workbook(
  rows: ExcelJS.CellValue[][] = [
    ['2026-2027', '团委', 'youth_league.practice', '2-1-1', '实践活动', 100, 50, ''],
  ],
) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('预算');
  sheet.addRow([
    '年度',
    '组织',
    '部门',
    '项目编号',
    '项目名称',
    '报销额度（元）',
    '代发额度（元）',
    '备注',
  ]);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-import-'));
  temporary.push(directory);
  return {
    directory,
    service: new FinanceTrackingService({ directory, defaultDepartments: departments }),
  };
}

describe('finance budget import transactions', () => {
  it('invalidates a preview when the shared sports directory changes before confirmation', async () => {
    const { directory } = await fixture();
    const teams = [{ id: 'team-a', name: '甲队', status: 'active' }];
    const service = new FinanceTrackingService({
      directory,
      defaultDepartments: departments,
      getSharedTeams: async () => teams,
    });
    const preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    teams.push({ id: 'team-b', name: '乙队', status: 'active' });
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 409,
    });
    const after = await service.read(chief());
    expect(after.projects).toEqual([]);
    expect(after.departments.filter(({ teamId }) => teamId)).toHaveLength(2);
  });
  it('keeps preview out of the ledger and atomically commits a bound plan only once', async () => {
    const { directory, service } = await fixture();
    const preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    expect(preview.canCommit).toBe(true);
    expect(preview.entries[0].action).toBe('create');
    expect((await service.read(chief())).projects).toEqual([]);
    expect(await readdir(directory)).toEqual(['finance-imports']);
    const secondProcess = new FinanceTrackingService({
      directory,
      defaultDepartments: departments,
    });
    const commits = await Promise.all([
      service.commitImport(chief(), preview.previewId),
      secondProcess.commitImport(chief(), preview.previewId),
    ]);
    expect(commits.every(({ summary }) => summary.created === 1 && summary.updated === 0)).toBe(
      true,
    );
    expect((await service.read(chief())).projects).toHaveLength(1);
    const revision = (await service.read(chief())).projects[0].revision;
    const repeat = await service.previewImport(chief(), await workbook(), 'renamed.xlsx', {
      year: '2026-2027',
    });
    expect(repeat.entries[0].action).toBe('unchanged');
    expect((await service.commitImport(chief(), repeat.previewId)).summary).toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    expect((await service.read(chief())).projects[0].revision).toBe(revision);
  });

  it('updates allowances without changing claims, received amounts, project IDs or unlisted projects', async () => {
    const { service } = await fixture();
    const initial = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    const imported = await service.commitImport(chief(), initial.previewId);
    const project = imported.workspace.projects[0];
    await service.createProject(chief(), 'unlisted', {
      year: '2026-2027',
      departmentId: project.departmentId,
      code: '2-1-2',
      name: '保留项目',
      reimbursementCents: 2000,
      directPaymentCents: 0,
      notes: '',
    });
    const created = await service.createClaim(chief(), 'claim', {
      projectId: project.id,
      kind: 'reimbursement',
      amountCents: 3000,
      items: [{ description: '物料', quantity: '1 批' }],
      payeeName: '收款人',
      payeeStudentId: 'fake-id',
      materials: ['发票'],
      externalReference: '校财务-001',
      externalSubmittedAt: '2026-10-23',
      notes: '',
    });
    const claimId = created.claims[0].id;
    await service.act(chief(), claimId, 1, 'submit');
    await service.act(chief(), claimId, 2, 'approve');
    await service.act(chief(), claimId, 3, 'confirm_received');
    const beforeClaims = JSON.stringify((await service.read(chief())).claims);
    const updated = await service.previewImport(
      chief(),
      await workbook([
        ['2026-2027', '团委', project.departmentId, project.code, project.name, 20, 50, '调额'],
      ]),
      'new-budget.xlsx',
      { year: '2026-2027' },
    );
    expect(updated.entries[0].action).toBe('update');
    expect(
      updated.issues.some(
        ({ severity, message }) => severity === 'warning' && message.includes('超支'),
      ),
    ).toBe(true);
    const committed = await service.commitImport(chief(), updated.previewId);
    expect(committed.summary).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(committed.workspace.projects).toHaveLength(2);
    expect(committed.workspace.projects[0]).toMatchObject({
      id: project.id,
      reimbursementCents: 2000,
      reimbursement: { receivedCents: 3000, remainingCents: -1000, overBudget: true },
    });
    expect(JSON.stringify(committed.workspace.claims)).toBe(beforeClaims);
    // Retrying an older committed preview must not restore old allowances.
    await service.commitImport(chief(), initial.previewId);
    expect((await service.read(chief())).projects[0].reimbursementCents).toBe(2000);
  });

  it('rejects stale settings, existing project revisions and concurrent same-key creation without partial writes', async () => {
    const { service } = await fixture();
    let preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    const settings = (await service.read(chief())).settings!;
    await service.updateSettings(chief(), {
      ...settings,
      departments: [{ ...departments[0], name: '实践组（更新）' }],
    });
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 409,
    });
    expect((await service.read(chief())).projects).toEqual([]);
    preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    await service.createProject(chief(), 'concurrent', {
      year: '2026-2027',
      departmentId: departments[0].id,
      code: '2-1-1',
      name: '并发项目',
      reimbursementCents: 500,
      directPaymentCents: 0,
      notes: '',
    });
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 409,
    });
    expect((await service.read(chief())).projects[0].name).toBe('并发项目');
    preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    const current = (await service.read(chief())).projects[0];
    await service.updateProject(chief(), current.id, current.revision, {
      ...current,
      notes: '并发改动',
    });
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 409,
    });
    expect((await service.read(chief())).projects[0].notes).toBe('并发改动');
  });

  it('binds previews to one final reviewer, expires them and rejects replaced or invalid plans', async () => {
    const { service } = await fixture();
    const preview = await service.previewImport(chief(), await workbook(), 'budget.xlsx', {
      year: '2026-2027',
    });
    await expect(
      service.commitImport(chief('another-counselor'), preview.previewId),
    ).rejects.toMatchObject({ status: 404 });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 410,
    });
    vi.restoreAllMocks();
    const replacement = await service.previewImport(chief(), await workbook(), 'new.xlsx', {
      year: '2026-2027',
    });
    await expect(service.commitImport(chief(), preview.previewId)).rejects.toMatchObject({
      status: 404,
    });
    const invalid = await service.previewImport(
      chief(),
      await workbook([['2026-2027', '团委', 'unknown', 'x', '未知项目', 100, 0, '']]),
      'unknown.xlsx',
      { year: '2026-2027' },
    );
    expect(invalid.canCommit).toBe(false);
    await expect(service.commitImport(chief(), invalid.previewId)).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.commitImport(chief(), replacement.previewId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await service.read(chief())).projects).toEqual([]);
  });
});

describe('finance import HTTP boundary', () => {
  async function appFixture() {
    const { directory } = await fixture();
    const app = express();
    app.use(express.json());
    app.use(
      '/finance/tracking',
      createFinanceTrackingRouter({
        directory,
        defaultDepartments: departments,
        authenticate: async (headers) => {
          if (headers['x-user'] === 'chief') return { status: 200, user: chief() };
          if (headers['x-user'] === 'preview')
            return { status: 200, user: { ...chief(), previewing: true } };
          if (headers['x-user'] === 'admin')
            return {
              status: 200,
              user: {
                ...chief('admin'),
                roles: ['platform.admin'],
                roleScopes: [],
                businessAdmin: true,
              },
            };
          return { status: 401, code: 'missing_identity', message: '请登录' };
        },
      }),
    );
    app.use((error: Error, _request: Request, response: Response, next: NextFunction) => {
      void next;
      response
        .status(error instanceof HttpError ? error.status : 500)
        .json({ error: error.message });
    });
    return app;
  }
  it('requires actual final-reviewer access for template, preview and commit', async () => {
    const app = await appFixture();
    await request(app).get('/finance/tracking/imports/template').expect(401);
    for (const uid of ['admin', 'preview']) {
      await request(app).get('/finance/tracking/imports/template').set('X-User', uid).expect(403);
      await request(app)
        .post('/finance/tracking/imports/preview')
        .set('X-User', uid)
        .field('year', '2026-2027')
        .attach('file', Buffer.from('invalid'), 'x.xlsx')
        .expect(403);
      await request(app)
        .post('/finance/tracking/imports/commit')
        .set('X-User', uid)
        .send({ previewId: '00000000-0000-4000-8000-000000000001' })
        .expect(403);
    }
  });
  it('validates file type, size, year and mappings then returns a usable two-step flow', async () => {
    const app = await appFixture();
    const bytes = await workbook();
    await request(app)
      .post('/finance/tracking/imports/preview')
      .set('X-User', 'chief')
      .attach('file', bytes, 'budget.xlsx')
      .expect(400);
    await request(app)
      .post('/finance/tracking/imports/preview')
      .set('X-User', 'chief')
      .field('year', '2026-2027')
      .field('mappings', 'not json')
      .attach('file', bytes, 'budget.xlsx')
      .expect(400);
    await request(app)
      .post('/finance/tracking/imports/preview')
      .set('X-User', 'chief')
      .field('year', '2026-2027')
      .attach('file', bytes, 'budget.xls')
      .expect(400);
    await request(app)
      .post('/finance/tracking/imports/preview')
      .set('X-User', 'chief')
      .field('year', '2026-2027')
      .attach('file', Buffer.alloc(8 * 1024 * 1024 + 1), 'budget.xlsx')
      .expect(413);
    const preview = await request(app)
      .post('/finance/tracking/imports/preview')
      .set('X-User', 'chief')
      .field('year', '2026-2027')
      .attach('file', bytes, 'budget.xlsx')
      .expect(200);
    expect(preview.body.data.canCommit).toBe(true);
    const committed = await request(app)
      .post('/finance/tracking/imports/commit')
      .set('X-User', 'chief')
      .send({ previewId: preview.body.data.previewId })
      .expect(200);
    expect(committed.body.data.summary).toEqual({ created: 1, updated: 0, unchanged: 0 });
    const template = await request(app)
      .get('/finance/tracking/imports/template')
      .set('X-User', 'chief')
      .expect(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    expect(template.headers['cache-control']).toBe('private, no-store');
  });
});
