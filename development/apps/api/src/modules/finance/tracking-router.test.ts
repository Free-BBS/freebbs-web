import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { FinanceClaimInput, RoleKey } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { afterEach, describe, expect, it } from 'vitest';
import { financeClaimChecklist } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import { createFinanceTrackingRouter } from './tracking-router.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
function actor(uid: string): AuthorizationContext {
  const role: RoleKey | undefined =
    uid === 'owner'
      ? 'counselor.youth_league'
      : uid === 'head'
        ? 'youth_league.practice.deputy_secretary'
        : undefined;
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: role ? [role] : [],
    tags: [],
    roleScopes: role
      ? [{ subjectUid: uid, roleKey: role, scope: { type: 'public', id: '*' }, expiresAt: null }]
      : [],
  };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-router-'));
  directories.push(directory);
  const app = express();
  app.use(express.json());
  app.use(
    '/finance/tracking',
    createFinanceTrackingRouter({
      directory,
      authenticate: async (headers) => {
        const uid = headers['x-test-user'];
        if (typeof uid !== 'string')
          return { status: 401, code: 'missing_identity', message: '请登录' };
        return {
          status: 200,
          user: uid === 'preview' ? { ...actor('owner'), previewing: true } : actor(uid),
        };
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
  await request(app)
    .put('/finance/tracking/settings')
    .set('X-Test-User', 'owner')
    .send({
      revision: 1,
      departments: [{ id: 'youth_league.practice', name: '实践组', portId: 'youth_league' }],
      grants: [
        {
          uid: 'head',
          displayName: '组长',
          role: 'department',
          departmentIds: ['youth_league.practice'],
          portIds: [],
        },
      ],
    })
    .expect(200);
  const project = await request(app)
    .post('/finance/tracking/projects')
    .set('X-Test-User', 'owner')
    .send({
      requestId: 'project',
      year: '2026-2027',
      departmentId: 'youth_league.practice',
      code: '2-1-1',
      name: '实践活动',
      reimbursementCents: 10000,
      directPaymentCents: 5000,
      notes: '',
    })
    .expect(201);
  const input: FinanceClaimInput = {
    projectId: project.body.data.projects[0].id,
    kind: 'reimbursement',
    items: [{ description: '活动物料', quantity: '2 件' }],
    amountCents: 3000,
    invoiceLines: [{ category: 'activity_materials', amountCents: 3000, repeatCount: 1 }],
    checklist: financeClaimChecklist({ kind: 'reimbursement' }).map(({ key }) => key),
    payeeName: '同学',
    payeeStudentId: '2026010001',
    materials: ['发票'],
    externalReference: '校财务-001',
    externalSubmittedAt: '2026-10-23',
    notes: '',
  };
  return { app, input };
}

describe('finance tracking HTTP boundary', () => {
  it('persists applicable material situations, requires their checklist and resets confirmations after a change', async () => {
    const { app, input } = await fixture();
    const draft: FinanceClaimInput = {
      ...input,
      materialSituations: ['printing', 'ride_hailing', 'unclear_invoice'],
      invoiceLines: [{ category: 'distributed_goods', amountCents: 100001, repeatCount: 1 }],
      checklist: [],
    };
    const created = await request(app)
      .post('/finance/tracking/claims')
      .set('X-Test-User', 'head')
      .send({ requestId: 'material-situations', ...draft })
      .expect(201);
    const original = created.body.data.claims[0];
    expect(original.materialSituations).toEqual(['ride_hailing', 'unclear_invoice', 'printing']);
    const read = await request(app).get('/finance/tracking').set('X-Test-User', 'head').expect(200);
    expect(read.body.data.claims[0].materialSituations).toEqual(original.materialSituations);
    await request(app)
      .post(`/finance/tracking/claims/${original.id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: 1, action: 'submit' })
      .expect(400);
    const completed = financeClaimChecklist(draft).map(({ key }) => key);
    // Unrelated order changes do not invalidate confirmations, but omitting one required material blocks submission.
    const incomplete = await request(app)
      .put(`/finance/tracking/claims/${original.id}`)
      .set('X-Test-User', 'head')
      .send({
        revision: 1,
        ...draft,
        checklist: completed.filter((key) => key !== 'printing_details_ready'),
      })
      .expect(200);
    expect(incomplete.body.data.claims[0].checklist).toContain('ride_itinerary_ready');
    await request(app)
      .post(`/finance/tracking/claims/${original.id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: 2, action: 'submit' })
      .expect(400);
    const changed: FinanceClaimInput = {
      ...draft,
      materialSituations: ['ride_hailing', 'unclear_invoice'],
    };
    const changedResult = await request(app)
      .put(`/finance/tracking/claims/${original.id}`)
      .set('X-Test-User', 'head')
      .send({ revision: 2, ...changed, checklist: completed })
      .expect(200);
    expect(changedResult.body.data.claims[0].materialSituations).toEqual(
      changed.materialSituations,
    );
    expect(changedResult.body.data.claims[0].checklist).toEqual([]);
    const updated = await request(app)
      .put(`/finance/tracking/claims/${original.id}`)
      .set('X-Test-User', 'head')
      .send({
        revision: 3,
        ...changed,
        checklist: financeClaimChecklist(changed).map(({ key }) => key),
      })
      .expect(200);
    expect(updated.body.data.claims[0].revision).toBe(4);
    await request(app)
      .post(`/finance/tracking/claims/${original.id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: 4, action: 'submit' })
      .expect(200);
  });
  it('round-trips a long direct-payment draft through checklist editing and submission', async () => {
    const { app, input } = await fixture();
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = await request(app)
      .post('/finance/tracking/files/work-proof')
      .set('X-Test-User', 'head')
      .attach('file', bytes, { filename: 'proof.png', contentType: 'image/png' })
      .expect(201);
    const draft: FinanceClaimInput = {
      ...input,
      kind: 'direct_payment',
      amountCents: 3000,
      invoiceLines: undefined,
      checklist: [],
      directPayment: {
        hourlyRateCents: 1000,
        workContent: '测试工作说明'.repeat(300),
        proofFileIds: [upload.body.data.id],
      },
    };
    const created = await request(app)
      .post('/finance/tracking/claims')
      .set('X-Test-User', 'head')
      .send({ requestId: 'long-work', ...draft })
      .expect(201);
    const claim = created.body.data.claims[0];
    expect(claim.items[0].description).toHaveLength(500);
    expect(claim.directPayment.workContent).toBe(draft.directPayment!.workContent);
    const edited = await request(app)
      .put(`/finance/tracking/claims/${claim.id}`)
      .set('X-Test-User', 'head')
      .send({
        revision: 1,
        ...draft,
        items: claim.items,
        checklist: financeClaimChecklist(draft).map(({ key }) => key),
      })
      .expect(200);
    const submitted = await request(app)
      .post(`/finance/tracking/claims/${claim.id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: edited.body.data.claims[0].revision, action: 'submit' })
      .expect(200);
    expect(submitted.body.data.claims[0]).toMatchObject({
      status: 'department_review',
      directPayment: { workContent: draft.directPayment!.workContent },
    });
  });
  it('authenticates every route and exposes a minimal access response without financial details', async () => {
    const { app } = await fixture();
    await request(app).get('/finance/tracking').expect(401);
    await request(app).post('/finance/tracking/projects').send({}).expect(401);
    const result = await request(app)
      .get('/finance/tracking/access')
      .set('X-Test-User', 'head')
      .expect(200);
    expect(result.body.data).toEqual({ configured: true, canAccess: true, canManageBudget: false });
    expect(result.headers['cache-control']).toBe('private, no-store');
    const anonymous = await request(app)
      .get('/finance/tracking/access')
      .set('X-Test-User', 'unassigned')
      .expect(200);
    expect(anonymous.body.data.canAccess).toBe(false);
    await request(app).get('/finance/tracking').set('X-Test-User', 'preview').expect(403);
    await request(app).get('/finance/tracking/access').set('X-Test-User', 'preview').expect(403);
  });

  it('rejects untrusted ownership, status, amounts and malformed dates before persistence', async () => {
    const { app, input } = await fixture();
    for (const patch of [
      { submitterUid: 'owner' },
      { departmentId: 'other' },
      { status: 'received' },
      { revision: 99 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { amountCents: Number.MAX_SAFE_INTEGER + 1 },
      { externalSubmittedAt: '2026-02-31' },
      { externalSubmittedAt: 'tomorrow' },
      { invoiceLines: [{ category: 'other', amountCents: 3000, repeatCount: 0 }] },
      { materialSituations: 'printing' },
      { materialSituations: null },
      { materialSituations: { printing: true } },
      { materialSituations: ['unknown'] },
      { materialSituations: [1] },
      { materialSituations: ['printing', 'printing', 'printing', 'printing'] },
    ]) {
      await request(app)
        .post('/finance/tracking/claims')
        .set('X-Test-User', 'head')
        .send({ requestId: 'invalid', ...input, ...patch })
        .expect(400);
    }
    const after = await request(app)
      .get('/finance/tracking')
      .set('X-Test-User', 'head')
      .expect(200);
    expect(after.body.data.claims).toEqual([]);
    expect(after.body.data.projects[0].reimbursement.remainingCents).toBe(10000);
  });

  it('keeps claims idempotent, reserves only on submit and checks optimistic revisions', async () => {
    const { app, input } = await fixture();
    let result = await request(app)
      .post('/finance/tracking/claims')
      .set('X-Test-User', 'head')
      .send({ requestId: 'claim', ...input })
      .expect(201);
    const id = result.body.data.claims[0].id;
    const duplicate = await request(app)
      .post('/finance/tracking/claims')
      .set('X-Test-User', 'head')
      .send({ ...input, requestId: 'claim' })
      .expect(201);
    expect(duplicate.body.data.claims).toHaveLength(1);
    result = await request(app)
      .post(`/finance/tracking/claims/${id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: 1, action: 'submit' })
      .expect(200);
    expect(result.body.data.projects[0].reimbursement.remainingCents).toBe(7000);
    await request(app)
      .post(`/finance/tracking/claims/${id}/actions`)
      .set('X-Test-User', 'head')
      .send({ revision: 1, action: 'submit' })
      .expect(409);
    await request(app)
      .put(`/finance/tracking/claims/${id}`)
      .set('X-Test-User', 'head')
      .send({ revision: 2, ...input })
      .expect(409);
    const final = await request(app)
      .get('/finance/tracking')
      .set('X-Test-User', 'head')
      .expect(200);
    expect(final.body.data.claims[0].history).toHaveLength(2);
  });

  it('rejects malformed legacy grants without allowing them to replace shared identity authorization', async () => {
    const { app } = await fixture();
    for (const grant of [
      {
        uid: 'head',
        displayName: '组长',
        role: 'counselor',
        departmentIds: [],
        portIds: ['not-a-port'],
      },
    ]) {
      await request(app)
        .put('/finance/tracking/settings')
        .set('X-Test-User', 'owner')
        .send({
          revision: 2,
          departments: [{ id: 'youth_league.practice', name: '实践组', portId: 'youth_league' }],
          grants: [grant],
        })
        .expect(400);
    }
    await request(app)
      .put('/finance/tracking/settings')
      .set('X-Test-User', 'head')
      .send({
        revision: 2,
        departments: [{ id: 'youth_league.practice', name: '实践组', portId: 'youth_league' }],
        grants: [],
      })
      .expect(403);
  });

  it('ignores legacy organization-viewer grants instead of maintaining a second personnel authority', async () => {
    const { app, input } = await fixture();
    await request(app)
      .put('/finance/tracking/settings')
      .set('X-Test-User', 'owner')
      .send({
        revision: 2,
        departments: [{ id: 'youth_league.practice', name: '实践组', portId: 'youth_league' }],
        grants: [
          {
            uid: 'viewer',
            displayName: '团委负责人',
            role: 'organization_viewer',
            departmentIds: [],
            portIds: ['youth_league'],
          },
        ],
      })
      .expect(200);
    const visible = await request(app)
      .get('/finance/tracking')
      .set('X-Test-User', 'viewer')
      .expect(200);
    expect(visible.body.data.projects).toHaveLength(0);
    expect(visible.body.data.canManageBudget).toBe(false);
    expect(visible.body.data.submittableDepartmentIds).toEqual([]);
    await request(app)
      .post('/finance/tracking/claims')
      .set('X-Test-User', 'viewer')
      .send({ requestId: 'viewer-claim', ...input })
      .expect(403);
  });
});
