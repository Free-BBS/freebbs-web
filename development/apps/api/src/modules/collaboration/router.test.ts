import express from 'express';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { createMaterialsRouter } from './materials.js';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { createCollaborationRouter } from './router.js';
import { HttpError } from '../../core/errors/http-error.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'collaboration-'));
  directories.push(directory);
  const app = express();
  app.use(express.json());
  app.use(
    '/tools',
    createCollaborationRouter({
      uploadDirectory: directory,
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'student');
        const user: UserContext = {
          uid,
          displayName: uid,
          avatarUrl: null,
          baseRole: 'student',
          roles:
            uid === 'staff' || uid === 'colleague'
              ? ['department.rights_development_member']
              : uid === 'counselor'
                ? ['counselor.practice']
                : [],
          tags: [],
        };
        return { status: 200 as const, user };
      },
    }),
  );
  app.use(
    '/tools',
    createMaterialsRouter({
      uploadDirectory: directory,
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'student');
        const user: UserContext = {
          uid,
          displayName: uid,
          avatarUrl: null,
          baseRole: 'student',
          roles:
            uid === 'staff' || uid === 'colleague'
              ? ['department.rights_development_member']
              : uid === 'counselor'
                ? ['counselor.practice']
                : [],
          tags: [],
        };
        return { status: 200 as const, user };
      },
    }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      const e = error as HttpError;
      response.status(e.status ?? 500).json({ message: e.message });
    },
  );
  return { app };
}
describe('collaboration API', () => {
  it('shares only occupied resource times while keeping participant entries private and refreshing after edits/deletion', async () => {
    const { app } = await fixture();
    const created = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({ kind: 'booking', title: '共享预约', status: 'published' });
    const id = created.body.data.id;
    const booking = {
      resource: '摄影棚',
      startsAt: '2026-10-12T10:00:00Z',
      endsAt: '2026-10-12T11:00:00Z',
    };
    const submitted = await request(app)
      .post(`/tools/${id}/entries`)
      .send({
        revision: 1,
        ...booking,
        text: 'private booking purpose',
        values: { private: 'private detail' },
      });
    expect(submitted.status).toBe(200);
    const entryId = submitted.body.data.entries[0].id;
    const other = await request(app).get(`/tools/${id}`).set('x-user', 'other');
    expect(other.status).toBe(200);
    expect(other.body.data.entries).toEqual([]);
    expect(other.body.data.history).toEqual([]);
    expect(other.body.data.bookingOccupancy).toEqual([booking]);
    expect(JSON.stringify(other.body)).not.toContain('private booking purpose');
    expect(JSON.stringify(other.body)).not.toContain(entryId);
    const owner = await request(app).get(`/tools/${id}`);
    expect(owner.body.data.entries[0].text).toBe('private booking purpose');
    expect(owner.body.data.bookingOccupancy).toEqual([booking]);
    const conflict = await request(app)
      .post(`/tools/${id}/entries`)
      .set('x-user', 'other')
      .send({ revision: 2, ...booking });
    expect(conflict.status).toBe(409);
    const moved = { ...booking, resource: '会议室' };
    const edited = await request(app)
      .post(`/tools/${id}/entries`)
      .send({ revision: 2, entryId, ...moved, text: 'still private' });
    expect(edited.body.data.bookingOccupancy).toEqual([moved]);
    const deleted = await request(app)
      .delete(`/tools/${id}/entries/${entryId}`)
      .send({ revision: 3 });
    expect(deleted.body.data.bookingOccupancy).toEqual([]);
    expect(
      (await request(app).get(`/tools/${id}`).set('x-user', 'other')).body.data.bookingOccupancy,
    ).toEqual([]);
  });
  it('keeps draft and department booking occupancy inaccessible to outsiders', async () => {
    const { app } = await fixture();
    for (const settings of [
      { status: 'draft' },
      {
        status: 'published',
        audience: 'department',
        departmentId: 'student_union.rights_development_center',
      },
    ]) {
      const created = await request(app)
        .post('/tools')
        .set('x-user', 'staff')
        .send({ kind: 'booking', title: '受限预约', ...settings });
      expect(created.status).toBe(201);
      expect((await request(app).get(`/tools/${created.body.data.id}`)).status).toBe(404);
      expect((await request(app).get('/tools')).body.data.items).toEqual([]);
    }
  });
  it('keeps drafts private and rejects stale revisions', async () => {
    const { app } = await fixture();
    const create = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({
        kind: 'availability',
        title: '例会时间',
        slots: [
          {
            id: 'a',
            title: '周一',
            startsAt: '2026-10-11T08:00:00Z',
            endsAt: '2026-10-11T09:00:00Z',
            capacity: 10,
          },
        ],
      });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect((await request(app).get(`/tools/${id}`)).status).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/tools/${id}`)
          .set('x-user', 'staff')
          .send({ revision: 9, status: 'published' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/tools/${id}`)
          .set('x-user', 'staff')
          .send({ revision: 1, status: 'published' })
      ).status,
    ).toBe(200);
    const response = await request(app)
      .post(`/tools/${id}/entries`)
      .send({ revision: 2, choices: ['a'] });
    expect(response.status).toBe(200);
    const view = await request(app).get(`/tools/${id}`).set('x-user', 'other');
    expect(view.body.data.entries).toHaveLength(0);
    expect(view.body.data.aggregates).toEqual({ a: 1 });
    expect(
      (await request(app).patch(`/tools/${id}`).send({ revision: 3, status: 'closed' })).status,
    ).toBe(403);
  });
  it('serializes concurrent bookings and permits only one conflicting request', async () => {
    const { app } = await fixture();
    const create = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({ kind: 'booking', title: '视频预约', status: 'published' });
    const id = create.body.data.id;
    const body = {
      revision: 1,
      resource: '摄影棚',
      startsAt: '2026-10-12T10:00:00Z',
      endsAt: '2026-10-12T11:00:00Z',
    };
    const results = await Promise.all(
      ['a', 'b'].map((uid) =>
        request(app).post(`/tools/${id}/entries`).set('x-user', uid).send(body),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('collaboration full workflows', () => {
  it('uploads real bytes and keeps XLSX ZIP and individual files private', async () => {
    const { app } = await fixture();
    const created = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({ kind: 'materials', title: '材料', status: 'published' });
    const id = created.body.data.id;
    const submitted = await request(app)
      .post(`/tools/${id}/entries`)
      .send({ revision: 1, text: '我的报告' });
    const entry = submitted.body.data.entries[0];
    const uploaded = await request(app)
      .post(`/tools/${id}/entries/${entry.id}/files`)
      .field('revision', '2')
      .attach('files', Buffer.from('real private content'), 'report.txt');
    expect(uploaded.status).toBe(200);
    const file = uploaded.body.data.files[0];
    const fileUrl = `/tools/${id}/entries/${entry.id}/files/${file.id}`;
    expect((await request(app).get(fileUrl).set('x-user', 'other')).status).toBe(403);
    expect((await request(app).get(`/tools/${id}/export`)).status).toBe(403);
    expect((await request(app).post(`/tools/${id}/materials/archive`).send({})).status).toBe(403);
    const own = await request(app).get(fileUrl);
    expect(own.body.toString()).toBe('real private content');
    const archive = await request(app)
      .post(`/tools/${id}/materials/archive`)
      .set('x-user', 'staff')
      .send({ pattern: '{index}-{name}', folders: false })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(archive.status).toBe(200);
    const zip = await JSZip.loadAsync(archive.body);
    expect(await zip.file('001-report.txt')!.async('string')).toBe('real private content');
    const exported = await request(app)
      .get(`/tools/${id}/export`)
      .set('x-user', 'staff')
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    expect(workbook.worksheets[0]?.getRow(2).getCell(4).value).toBe('我的报告');
  });
  it('allows assigned counselor to see review assets but not export or manage', async () => {
    const { app } = await fixture();
    const created = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({
        kind: 'review',
        title: '审核',
        status: 'published',
        audience: 'all',
        stages: [{ title: '辅导员审核', roleKeys: ['counselor.practice'] }],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const submission = await request(app)
      .post(`/tools/${id}/entries`)
      .send({ revision: 1, text: '审核材料' });
    const entry = submission.body.data.entries[0];
    const uploaded = await request(app)
      .post(`/tools/${id}/entries/${entry.id}/files`)
      .field('revision', '2')
      .attach('files', Buffer.from('review document'), 'review.txt');
    expect(uploaded.status).toBe(200);
    const viewed = await request(app).get(`/tools/${id}`).set('x-user', 'counselor');
    expect(viewed.body.data.canManage).toBe(false);
    expect(viewed.body.data.entries[0].canReview).toBe(true);
    expect(
      (
        await request(app)
          .get(`/tools/${id}/entries/${entry.id}/files/${uploaded.body.data.files[0].id}`)
          .set('x-user', 'counselor')
      ).status,
    ).toBe(200);
    expect((await request(app).get(`/tools/${id}/export`).set('x-user', 'counselor')).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .post(`/tools/${id}/entries/${entry.id}/review`)
          .set('x-user', 'staff')
          .send({ revision: 3, decision: 'approved' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/tools/${id}/entries/${entry.id}/review`)
          .set('x-user', 'counselor')
          .send({ revision: 3, decision: 'approved' })
      ).status,
    ).toBe(200);
  });
  it('checks manual assignment capacity and limits acceptance to participant', async () => {
    const { app } = await fixture();
    const created = await request(app)
      .post('/tools')
      .set('x-user', 'staff')
      .send({
        kind: 'practice',
        title: '双选',
        status: 'published',
        slots: [
          {
            id: 'a',
            title: '支队A',
            startsAt: '2026-10-11T08:00:00Z',
            endsAt: '2026-10-11T09:00:00Z',
            capacity: 1,
          },
        ],
      });
    const id = created.body.data.id;
    const first = await request(app)
      .post(`/tools/${id}/entries`)
      .send({ revision: 1, choices: ['a'] });
    const entry = first.body.data.entries[0];
    await request(app)
      .post(`/tools/${id}/entries`)
      .set('x-user', 'other')
      .send({ revision: 2, choices: ['a'] });
    const all = await request(app).get(`/tools/${id}`).set('x-user', 'staff');
    const other = all.body.data.entries[1];
    expect(
      (
        await request(app)
          .post(`/tools/${id}/entries/${entry.id}/assignment`)
          .set('x-user', 'staff')
          .send({ revision: 3, slotId: 'a' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/tools/${id}/entries/${other.id}/assignment`)
          .set('x-user', 'staff')
          .send({ revision: 4, slotId: 'a' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/tools/${id}/entries/${entry.id}/assignment`)
          .set('x-user', 'other')
          .send({ revision: 4, decision: 'accepted' })
      ).status,
    ).toBe(403);
    const accepted = await request(app)
      .post(`/tools/${id}/entries/${entry.id}/assignment`)
      .send({ revision: 4, decision: 'accepted' });
    expect(accepted.body.data.entries[0].assignmentStatus).toBe('accepted');
  });
});

it('limits shared table columns and configuration to the owner', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({
      kind: 'shared_table',
      title: '统计表',
      departmentId: 'student_union.rights_development_center',
      audience: 'department',
      status: 'published',
      columns: [
        { id: 'note', label: '备注', kind: 'text', required: false },
        {
          id: 'verified',
          label: '确认',
          kind: 'text',
          required: false,
          editRoleKeys: ['department.rights_development_director'],
        },
      ],
    });
  expect(created.status).toBe(201);
  const id = created.body.data.id;
  expect(
    (
      await request(app)
        .patch(`/tools/${id}`)
        .set('x-user', 'colleague')
        .send({ revision: 1, columns: [] })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post(`/tools/${id}/entries`)
        .set('x-user', 'colleague')
        .send({ revision: 1, values: { note: '允许', verified: '越权' } })
    ).status,
  ).toBe(403);
  const row = await request(app)
    .post(`/tools/${id}/entries`)
    .set('x-user', 'staff')
    .send({ revision: 1, values: { note: '备注', verified: '已确认' } });
  expect(row.status).toBe(200);
  const entry = row.body.data.entries[0];
  const allowed = await request(app)
    .post(`/tools/${id}/entries`)
    .set('x-user', 'colleague')
    .send({ revision: 2, entryId: entry.id, values: { note: '成员修改', verified: '已确认' } });
  expect(allowed.status).toBe(200);
  expect(
    (
      await request(app)
        .post(`/tools/${id}/entries`)
        .set('x-user', 'colleague')
        .send({
          revision: 3,
          entryId: entry.id,
          values: { note: '成员修改', verified: '更改确认' },
        })
    ).status,
  ).toBe(403);
});

it('requires structured daily safety fields and hides coordinator roster', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({
      kind: 'materials',
      title: '每日安全',
      status: 'published',
      expectedReporterUids: ['student', 'other'],
      columns: [
        { id: 'report_date', label: '报告日期', kind: 'date', required: true },
        {
          id: 'safety',
          label: '安全状态',
          kind: 'choice',
          required: true,
          options: ['安全', '求助'],
        },
      ],
    });
  const id = created.body.data.id;
  expect(
    (await request(app).post(`/tools/${id}/entries`).send({ revision: 1, text: '报告' })).status,
  ).toBe(400);
  const submitted = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 1, text: '全员安全', values: { report_date: '2026-10-10', safety: '安全' } });
  expect(submitted.status).toBe(200);
  expect(submitted.body.data.expectedReporterUids).toBeUndefined();
  const coordinator = await request(app).get(`/tools/${id}`).set('x-user', 'staff');
  expect(coordinator.body.data.expectedReporterUids).toEqual(['student', 'other']);
  expect(coordinator.body.data.entries[0].values.report_date).toBe('2026-10-10');
});

it('preserves confirmed attendance across later sessions and rejects edits or deletion', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({ kind: 'attendance', title: '训练', status: 'published' });
  const id = created.body.data.id;
  const first = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 1, text: '第一次训练' });
  const entry = first.body.data.entries[0];
  expect(
    (
      await request(app)
        .post(`/tools/${id}/entries/${entry.id}/review`)
        .set('x-user', 'staff')
        .send({ revision: 2, decision: 'approved' })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post(`/tools/${id}/entries`)
        .send({ revision: 3, entryId: entry.id, text: '覆盖旧训练' })
    ).status,
  ).toBe(409);
  expect(
    (await request(app).delete(`/tools/${id}/entries/${entry.id}`).send({ revision: 3 })).status,
  ).toBe(409);
  const second = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 3, text: '第二次训练' });
  expect(second.status).toBe(200);
  expect(second.body.data.entries).toHaveLength(2);
  expect(second.body.data.entries[0].text).toBe('第一次训练');
  expect(second.body.data.entries[0].reviewStatus).toBe('approved');
  expect(second.body.data.entries[0].decisions).toHaveLength(1);
});
it('lets department managers save unchanged schema and ordinary settings', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({
      kind: 'materials',
      title: '旧标题',
      departmentId: 'student_union.rights_development_center',
      status: 'published',
      columns: [{ id: 'date', label: '日期', kind: 'date', required: true }],
    });
  const space = created.body.data;
  const changed = await request(app)
    .patch(`/tools/${space.id}`)
    .set('x-user', 'colleague')
    .send({ revision: 1, title: '新标题', columns: space.columns });
  expect(changed.status).toBe(200);
  expect(changed.body.data.title).toBe('新标题');
  expect(
    (
      await request(app)
        .patch(`/tools/${space.id}`)
        .set('x-user', 'colleague')
        .send({ revision: 2, columns: [] })
    ).status,
  ).toBe(403);
});
it('keeps all ZIP files when duplicate names collide repeatedly', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({ kind: 'materials', title: '归档', status: 'published' });
  const id = created.body.data.id;
  const submitted = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 1, text: '文件' });
  const entry = submitted.body.data.entries[0];
  const uploaded = await request(app)
    .post(`/tools/${id}/entries/${entry.id}/files`)
    .field('revision', '2')
    .attach('files', Buffer.from('first'), 'a.txt')
    .attach('files', Buffer.from('second'), '3-1-a.txt')
    .attach('files', Buffer.from('third'), 'a.txt');
  expect(uploaded.status).toBe(200);
  const archive = await request(app)
    .post(`/tools/${id}/materials/archive`)
    .set('x-user', 'staff')
    .send({ pattern: '{name}', folders: false })
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  const zip = await JSZip.loadAsync(archive.body);
  expect(Object.keys(zip.files)).toHaveLength(3);
  expect(await zip.file('a.txt')!.async('string')).toBe('first');
  expect(await zip.file('3-1-a.txt')!.async('string')).toBe('second');
  expect(await zip.file('3-2-a.txt')!.async('string')).toBe('third');
});
it('resubmits rejected review under the same ID preserving attachment and decision history', async () => {
  const { app } = await fixture();
  const created = await request(app)
    .post('/tools')
    .set('x-user', 'staff')
    .send({
      kind: 'review',
      title: '审核',
      status: 'published',
      stages: [{ title: '审核', roleKeys: ['counselor.practice'] }],
    });
  const id = created.body.data.id;
  const submitted = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 1, text: '初稿' });
  const entry = submitted.body.data.entries[0];
  const uploaded = await request(app)
    .post(`/tools/${id}/entries/${entry.id}/files`)
    .field('revision', '2')
    .attach('files', Buffer.from('attachment'), 'draft.txt');
  expect(uploaded.status).toBe(200);
  expect(
    (
      await request(app)
        .post(`/tools/${id}/entries/${entry.id}/review`)
        .set('x-user', 'counselor')
        .send({ revision: 3, decision: 'rejected', note: '请修订' })
    ).status,
  ).toBe(200);
  const revised = await request(app)
    .post(`/tools/${id}/entries`)
    .send({ revision: 4, entryId: entry.id, text: '修订稿' });
  expect(revised.body.data.entries).toHaveLength(1);
  expect(revised.body.data.entries[0].id).toBe(entry.id);
  expect(revised.body.data.entries[0].files).toHaveLength(1);
  expect(revised.body.data.entries[0].decisions[0].note).toBe('请修订');
  expect(revised.body.data.entries[0].reviewStatus).toBe('pending');
});
