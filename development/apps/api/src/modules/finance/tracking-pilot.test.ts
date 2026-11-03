import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FinanceBudgetInput, FinanceClaimInput } from '@freebbs-development/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { FinanceTrackingService } from './tracking-service.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const owner: AuthorizationContext = {
  uid: 'pilot-owner',
  displayName: 'owner',
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
  rootAdmin: true,
};
const otherRoot: AuthorizationContext = { ...owner, uid: 'other-root', displayName: 'other root' };
const counselor: AuthorizationContext = {
  ...owner,
  uid: 'counselor',
  displayName: 'counselor',
  rootAdmin: false,
  roles: ['counselor.youth_league'],
  roleScopes: [
    {
      subjectUid: 'counselor',
      roleKey: 'counselor.youth_league',
      scope: { type: 'public', id: '*' },
      expiresAt: null,
    },
  ],
};
const departments = [
  { id: 'youth_league.practice', name: '实践组', portId: 'youth_league' as const },
];
const budget: FinanceBudgetInput = {
  year: '2026-2027',
  departmentId: departments[0].id,
  code: '2-1-1',
  name: '试运行项目',
  reimbursementCents: 10000,
  directPaymentCents: 0,
  notes: '非公开预算',
};
const claimInput = (projectId: string): FinanceClaimInput => ({
  projectId,
  kind: 'reimbursement',
  items: [{ description: '物料', quantity: '1' }],
  amountCents: 1000,
  payeeName: '收款同学',
  payeeStudentId: '2026010001',
  materials: ['发票'],
  externalReference: '学校编号',
  externalSubmittedAt: '2026-11-03',
  notes: '',
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-pilot-'));
  directories.push(directory);
  const existing = new FinanceTrackingService({ directory, defaultDepartments: departments });
  const workspace = await existing.createProject(owner, 'p1', budget);
  const project = workspace.projects[0];
  const input = claimInput(project.id);
  const claim = (await existing.createClaim(owner, 'c1', input)).claims[0];
  return { directory, existing, project, claim, input };
}

describe('finance deployment pilot gate', () => {
  it('denies every service read/write/import path to other roots and final reviewers before accessing storage', async () => {
    const { directory, project, claim, input } = await fixture();
    const getSharedTeams = vi.fn(async () => []);
    const service = new FinanceTrackingService({
      directory,
      pilotUids: [owner.uid],
      getSharedTeams,
    });
    const settings = (await service.read(owner)).settings!;
    getSharedTeams.mockClear();
    for (const actor of [otherRoot, counselor]) {
      expect(await service.access(actor)).toEqual({
        configured: false,
        canAccess: false,
        canManageBudget: false,
      });
      expect(() => service.assertCanImport(actor)).toThrow();
      for (const operation of [
        () => service.read(actor),
        () => service.updateSettings(actor, settings),
        () => service.createProject(actor, 'blocked-project', { ...budget, code: 'new' }),
        () => service.updateProject(actor, project.id, 1, budget),
        () => service.createClaim(actor, 'blocked-claim', input),
        () => service.updateClaim(actor, claim.id, 1, input),
        () => service.act(actor, claim.id, 1, 'submit'),
        () =>
          service.previewImport(actor, Buffer.from('invalid'), 'budget.xlsx', {
            year: budget.year,
            mappings: [],
          }),
        () => service.commitImport(actor, 'not-an-existing-preview'),
      ])
        await expect(operation()).rejects.toMatchObject({ status: 403 });
    }
    expect(getSharedTeams).not.toHaveBeenCalled();
    const result = await service.read(owner);
    expect(result.projects).toHaveLength(1);
    expect(result.claims).toHaveLength(1);
  });

  it('keeps actual-identity and shared-role requirements inside the pilot and rejects explicit empty configuration', async () => {
    const { directory } = await fixture();
    for (const pilotUids of [[], [''], [' a b'], ['x'.repeat(129)]])
      expect(() => new FinanceTrackingService({ directory, pilotUids })).toThrow(
        'FINANCE_PILOT_UIDS',
      );
    const service = new FinanceTrackingService({ directory, pilotUids: [owner.uid] });
    for (const actor of [
      { ...owner, previewing: true },
      {
        ...owner,
        viewer: { uid: 'someone-else', displayName: 'viewer', canManageDevelopment: true },
      },
    ]) {
      await expect(service.read(actor)).rejects.toMatchObject({ status: 403 });
      await expect(service.access(actor)).rejects.toMatchObject({ status: 403 });
    }
    const student = { ...owner, uid: 'student', rootAdmin: false };
    const studentPilot = new FinanceTrackingService({ directory, pilotUids: [student.uid] });
    expect((await studentPilot.access(student)).canAccess).toBe(false);
    expect((await studentPilot.read(student)).projects).toEqual([]);
    await expect(studentPilot.createProject(student, 'not-allowed', budget)).rejects.toMatchObject({
      status: 403,
    });
    expect((await new FinanceTrackingService({ directory }).access(counselor)).canAccess).toBe(
      true,
    );
  });

  it('uses the deployment environment in the real app and blocks all HTTP paths including template and upload preview', async () => {
    const { directory, project, claim, input } = await fixture();
    const store = createMemoryStore();
    const users = [owner, otherRoot, counselor];
    for (const user of users)
      await store.subjects.create({
        uid: user.uid,
        displayName: user.displayName,
        avatarUrl: null,
        status: 'active',
        ownerUid: 'setup',
        scope: { type: 'public', id: '*' },
      });
    await store.roleAssignments.create({
      subjectUid: counselor.uid,
      roleKey: 'counselor.youth_league',
      expiresAt: null,
      status: 'active',
      ownerUid: 'setup',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      environment: {
        NODE_ENV: 'test',
        AUTH_MODE: 'main',
        FINANCE_PILOT_UIDS: owner.uid,
        PLATFORM_ROOT_ADMIN_UIDS: `${owner.uid},${otherRoot.uid}`,
      },
      store,
      financeDirectory: directory,
      authClient: {
        introspect: async (token) => {
          const user = users.find(({ uid }) => uid === token);
          return user ? { ...user, roles: [], rootAdmin: false, roleScopes: [] } : null;
        },
      },
    });
    const base = '/api/development/v1/finance/tracking';
    await request(app).get(base).expect(401);
    const authorized = await request(app)
      .get(base)
      .set('Authorization', `Bearer ${owner.uid}`)
      .expect(200);
    expect(authorized.body.data.projects[0].notes).toBe('非公开预算');
    await request(app)
      .get(`${base}/imports/template`)
      .set('Authorization', `Bearer ${owner.uid}`)
      .expect(200);
    const settings = authorized.body.data.settings;
    for (const actor of [otherRoot, counselor]) {
      const authorization = `Bearer ${actor.uid}`;
      const access = await request(app)
        .get(`${base}/access`)
        .set('Authorization', authorization)
        .expect(200);
      expect(access.body.data).toEqual({
        configured: false,
        canAccess: false,
        canManageBudget: false,
      });
      await request(app).get(base).set('Authorization', authorization).expect(403);
      await request(app)
        .get(`${base}/imports/template`)
        .set('Authorization', authorization)
        .expect(403);
      await request(app)
        .post(`${base}/imports/preview`)
        .set('Authorization', authorization)
        .field('year', budget.year)
        .attach('file', Buffer.from('invalid'), 'budget.xlsx')
        .expect(403);
      await request(app)
        .post(`${base}/imports/commit`)
        .set('Authorization', authorization)
        .send({ previewId: '00000000-0000-4000-8000-000000000001' })
        .expect(403);
      await request(app)
        .put(`${base}/settings`)
        .set('Authorization', authorization)
        .send(settings)
        .expect(403);
      await request(app)
        .post(`${base}/projects`)
        .set('Authorization', authorization)
        .send({ ...budget, requestId: 'blocked' })
        .expect(403);
      await request(app)
        .put(`${base}/projects/${project.id}`)
        .set('Authorization', authorization)
        .send({ ...budget, revision: 1 })
        .expect(403);
      await request(app)
        .post(`${base}/claims`)
        .set('Authorization', authorization)
        .send({ ...input, requestId: 'blocked' })
        .expect(403);
      await request(app)
        .put(`${base}/claims/${claim.id}`)
        .set('Authorization', authorization)
        .send({ ...input, revision: 1 })
        .expect(403);
      await request(app)
        .post(`${base}/claims/${claim.id}/actions`)
        .set('Authorization', authorization)
        .send({ revision: 1, action: 'submit' })
        .expect(403);
    }
    expect(await readdir(directory)).not.toContain('finance-imports');
  });
});
