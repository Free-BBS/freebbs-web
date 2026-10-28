import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { HttpError } from '../../core/errors/http-error.js';
import { createOrganizationGroupRouter } from './router.js';
import { inspectFile } from './files.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
function appFor(directory?: string, production = false) {
  const app = express();
  app.use(express.json());
  app.use(
    '/org',
    createOrganizationGroupRouter({
      uploadDirectory: directory,
      nodeEnvironment: production ? 'production' : 'test',
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'alice');
        if (uid === 'anonymous')
          return { status: 401, code: 'missing_identity', message: 'Login required' };
        const user: UserContext = {
          uid,
          displayName: uid,
          studentId: uid === 'alice' ? '001' : uid === 'bob' ? '002' : '003',
          avatarUrl: null,
          baseRole: 'student',
          tags:
            ['alice', 'bob', 'carol'].includes(uid) && headers['x-revoked'] !== 'true'
              ? [
                  {
                    key: 'class.youth_league_secretary',
                    scope: { type: 'class', id: uid === 'carol' ? 'b' : 'a' },
                  },
                ]
              : [],
          businessAdmin: uid === 'lead',
          roles:
            uid === 'lead'
              ? ['platform.admin']
              : uid === 'department'
                ? ['youth_league.organization.member']
                : uid === 'counselor'
                  ? ['counselor.practice']
                  : [],
          ...(uid === 'preview' ? { developmentAccess: 'lead' as const, previewing: true } : {}),
        };
        return { status: 200, user };
      },
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      const e =
        error instanceof HttpError ? error : new HttpError(500, 'unexpected', String(error));
      res.status(e.status).json({ error: { code: e.code, message: e.message } });
    },
  );
  return app;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'organization-group-'));
  directories.push(directory);
  const app = appFor(directory);
  const initial = (await request(app).get('/org/workspace').set('x-user', 'lead')).body.data;
  const settings = {
    revision: initial.revision,
    classes: [
      { id: 'a', label: 'A班' },
      { id: 'b', label: 'B班' },
    ],
    members: [
      { uid: 'alice', studentId: '001', classId: 'a', submitClassIds: ['a'] },
      { uid: 'bob', studentId: '002', classId: 'a', submitClassIds: ['a'] },
      { uid: 'carol', studentId: '003', classId: 'b', submitClassIds: ['b'] },
    ],
    managerUids: ['manager'],
  };
  const configured = await request(app).patch('/org/settings').set('x-user', 'lead').send(settings);
  expect(configured.status).toBe(200);
  const year = initial.years[0];
  const published = await request(app)
    .post(`/org/years/${year.id}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: year.revision,
      activityTypes: [{ id: 'meeting', label: '班会' }],
      fields: [],
    });
  expect(published.status).toBe(201);
  return { app, directory, yearId: year.id as string, versionId: published.body.data.id as string };
}
async function photo(app: express.Express, yearId: string, uid = 'alice') {
  const uploaded = await request(app)
    .post('/org/uploads')
    .set('x-user', uid)
    .field('yearId', yearId)
    .field('purpose', 'activity_photo')
    .attach('file', png, { filename: 'photo.png', contentType: 'image/png' });
  expect(uploaded.status).toBe(201);
  return uploaded.body.data.id as string;
}
async function create(
  f: Awaited<ReturnType<typeof fixture>>,
  uid = 'alice',
  values: Record<string, unknown> = {},
) {
  const id = 'photoIds' in values ? '' : await photo(f.app, f.yearId, uid);
  return request(f.app)
    .post('/org/entries')
    .set('x-user', uid)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      yearId: f.yearId,
      expectedVersionId: f.versionId,
      classId: uid === 'carol' ? 'b' : 'a',
      participantCount: 30,
      activityTypeId: 'meeting',
      summary: '活动',
      difficulties: '私密困难',
      photoIds: [id],
      extraAnswers: {},
      ...values,
    });
}

it('initializes an empty formal directory and denies implicit department management and preview grants', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'organization-empty-'));
  directories.push(directory);
  const app = appFor(directory);
  const initial = await request(app).get('/org/workspace').set('x-user', 'lead');
  expect(initial.status).toBe(200);
  expect(initial.body.data.classes).toEqual([]);
  expect(initial.body.data.members).toEqual([]);
  expect(initial.body.data.years[0].label).toBe('2026—2027');
  expect(initial.body.data.setupRequired).toBe(true);
  expect(initial.body.data.versions[0].template).toBe('class_activity_v2');
  expect(initial.body.data.versions[0].corePresentation.summary.label).toBe('活动内容');
  expect(initial.body.data.versions[0].corePresentation.participantNames.label).toBe(
    '具体参与人员',
  );
  expect(
    initial.body.data.versions[0].activityTypes.map((row: { label: string }) => row.label),
  ).toEqual([
    '主题团日',
    '支部事业',
    '社会实践',
    '志愿服务',
    '学风建设',
    '体育建设',
    '美育建设',
    '党团共建',
    '宣传成果',
  ]);
  expect(
    (
      await request(app)
        .patch('/org/settings')
        .set('x-user', 'department')
        .send({ revision: 1, managerUids: ['department'] })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .patch('/org/settings')
        .set('x-user', 'preview')
        .send({ revision: 1, managerUids: ['preview'] })
    ).status,
  ).toBe(403);
  expect((await request(app).get('/org/workspace').set('x-user', 'anonymous')).status).toBe(401);
});
async function v2Fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'organization-v2-'));
  directories.push(directory);
  const app = appFor(directory);
  const initial = (await request(app).get('/org/workspace').set('x-user', 'lead')).body.data;
  const configured = await request(app)
    .patch('/org/settings')
    .set('x-user', 'lead')
    .send({
      revision: initial.revision,
      classes: [
        { id: 'a', label: 'A班' },
        { id: 'b', label: 'B班' },
      ],
      managerUids: ['manager'],
      ordinaryExport: true,
    });
  expect(configured.status).toBe(200);
  return {
    app,
    directory,
    yearId: initial.activeYearId as string,
    versionId: initial.years[0].currentVersionId as string,
  };
}
async function createV2(
  f: Awaited<ReturnType<typeof v2Fixture>>,
  uid = 'alice',
  overrides: object = {},
) {
  return request(f.app)
    .post('/org/entries')
    .set('x-user', uid)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      yearId: f.yearId,
      expectedVersionId: f.versionId,
      classId: uid === 'carol' ? 'b' : 'a',
      participantCount: 2,
      activityDate: '2026-10-28',
      activityTypeIds: ['theme_day', 'study'],
      summary: '一起读书和讨论',
      participantNames: '张三、李四',
      photoIds: [],
      ...overrides,
    });
}
it('accepts the eight-field template without photos and normalizes multi-tag records in statistics, search and export', async () => {
  const f = await v2Fixture();
  const created = await createV2(f);
  expect(created.status).toBe(201);
  expect(created.body.data.activityTypeIds).toEqual(['theme_day', 'study']);
  expect(created.body.data.activityTypeLabels).toEqual(['主题团日', '学风建设']);
  expect(created.body.data.participantNames).toBe('张三、李四');
  expect(created.body.data.photos).toEqual([]);
  const list = await request(f.app).get('/org/entries?activityTypeId=study');
  expect(list.body.data.total).toBe(1);
  expect(list.body.data.statistics).toMatchObject({
    activityCount: 1,
    participantTimes: 2,
    byActivityType: { theme_day: 1, study: 1 },
  });
  expect((await request(f.app).get('/org/entries?query=李四')).body.data.total).toBe(1);
  const exported = await request(f.app)
    .get('/org/export.xlsx?activityTypeId=study')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  expect(exported.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.body);
  expect(book.worksheets[0]!.getRow(1).values).toEqual([
    undefined,
    '班级',
    '参与人数',
    '活动时间',
    '活动标签',
    '活动内容',
    '活动照片',
    '备注',
    '具体参与人员',
    '提交时间（上海）',
    '填报人',
  ]);
  expect(book.worksheets[0]!.getRow(2).values).toContain('主题团日、学风建设');
  expect(book.worksheets[0]!.getRow(2).values).toContain('张三、李四');
});
it('uses the saved version field labels for validation and export without rewriting historical labels on template publication', async () => {
  const f = await v2Fixture();
  const workspace = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const source = workspace.versions.find((row: { id: string }) => row.id === f.versionId);
  const published = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: workspace.years[0].revision,
      template: source.template,
      activityTypes: source.activityTypes,
      fields: [],
      corePresentation: {
        ...source.corePresentation,
        summary: { label: '原活动概况' },
        participantNames: { label: '原参与名单' },
      },
    });
  expect(published.status).toBe(201);
  f.versionId = published.body.data.id;
  const invalid = await createV2(f, 'alice', { summary: '字'.repeat(201) });
  expect(invalid.status).toBe(400);
  expect(invalid.body.error.message).toContain('原活动概况');
  expect((await createV2(f)).status).toBe(201);
  const exported = await request(f.app)
    .get('/org/export.xlsx')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.body);
  expect(book.worksheets[0]!.getRow(1).values).toContain('原活动概况');
  expect(book.worksheets[0]!.getRow(1).values).toContain('原参与名单');
  const afterPublish = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body
    .data;
  expect(
    (
      await request(f.app)
        .post(`/org/years/${f.yearId}/template`)
        .set('x-user', 'manager')
        .send({ revision: afterPublish.years[0].revision })
    ).status,
  ).toBe(201);
  const afterTemplate = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body
    .data;
  const historical = afterTemplate.versions.find((row: { id: string }) => row.id === f.versionId);
  expect(historical.corePresentation.summary.label).toBe('原活动概况');
  expect(historical.corePresentation.participantNames.label).toBe('原参与名单');
});

it('requires v2 dates and participant names, limits descriptions, and rejects empty, unknown or duplicate labels', async () => {
  const f = await v2Fixture();
  for (const invalid of [
    { activityDate: null },
    { activityDate: undefined },
    { participantNames: '' },
    { participantNames: ' '.repeat(3) },
    { participantNames: '人'.repeat(4001) },
    { summary: '字'.repeat(201) },
    { activityTypeIds: [] },
    { activityTypeIds: ['unknown'] },
    { activityTypeIds: ['theme_day', 'theme_day'] },
  ])
    expect((await createV2(f, 'alice', invalid)).status).toBe(400);
  expect(
    (
      await createV2(f, 'alice', {
        participantNames: '同学甲\n同学乙（志愿者）',
        summary: '字'.repeat(200),
      })
    ).status,
  ).toBe(201);
});
it('limits v2 photos to five and five MiB, preserving zero-photo submissions', async () => {
  const f = await v2Fixture();
  const ids: string[] = [];
  for (let index = 0; index < 6; index++) ids.push(await photo(f.app, f.yearId));
  expect((await createV2(f, 'alice', { photoIds: ids })).status).toBe(400);
  const saved = await createV2(f, 'alice', { photoIds: ids.slice(0, 5) });
  expect(saved.status).toBe(201);
  expect(saved.body.data.photos).toHaveLength(5);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${saved.body.data.id}`)
        .send({ revision: 1, photoIds: [] })
    ).status,
  ).toBe(200);
  const large = Buffer.concat([
    png.subarray(0, -12),
    Buffer.alloc(5 * 1024 ** 2 + 1 - png.length),
    png.subarray(-12),
  ]);
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'activity_photo')
        .attach('file', large, { filename: 'large.png', contentType: 'image/png' })
    ).status,
  ).toBe(413);
  const exact = large.subarray(0, large.length - 1);
  png.subarray(-12).copy(exact, exact.length - 12);
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'activity_photo')
        .attach('file', exact, { filename: 'exact.png', contentType: 'image/png' })
    ).status,
  ).toBe(201);
});
it('keeps v2 photos at five and five MiB through upload, creation and editing while legacy versions retain lower settings', async () => {
  const f = await v2Fixture();
  const workspace = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'manager')
        .send({
          revision: workspace.revision,
          maxPhotos: 1,
          maxPhotoBytes: 1024 ** 2,
        })
    ).status,
  ).toBe(200);
  const large = Buffer.concat([
    png.subarray(0, -12),
    Buffer.alloc(2 * 1024 ** 2 - png.length),
    png.subarray(-12),
  ]);
  async function upload(bytes: Buffer, entryId?: string) {
    const req = request(f.app)
      .post('/org/uploads')
      .field('yearId', f.yearId)
      .field('purpose', 'activity_photo');
    if (entryId) req.field('entryId', entryId);
    return req.attach('file', bytes, { filename: 'photo.png', contentType: 'image/png' });
  }
  const first = await upload(large);
  const pendingForLegacy = await upload(large);
  expect(first.status).toBe(201);
  expect(first.body.data.size).toBeGreaterThan(1024 ** 2);
  expect(pendingForLegacy.status).toBe(201);
  const second = await photo(f.app, f.yearId);
  const created = await createV2(f, 'alice', { photoIds: [first.body.data.id, second] });
  expect(created.status).toBe(201);
  expect(created.body.data.photos).toHaveLength(2);
  expect((await upload(Buffer.alloc(5 * 1024 ** 2 + 1))).status).toBe(413);
  const beforeLegacy = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body
    .data;
  const legacy = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: beforeLegacy.years[0].revision,
      activityTypes: [{ id: 'meeting', label: '班会' }],
      fields: [],
    });
  expect(legacy.status).toBe(201);
  // An existing v2 record uses its original rules even after a legacy questionnaire is published.
  const editPhoto = await upload(large, created.body.data.id);
  expect(editPhoto.status).toBe(201);
  const edited = await request(f.app)
    .patch(`/org/entries/${created.body.data.id}`)
    .send({
      revision: 1,
      photoIds: [editPhoto.body.data.id, second],
    });
  expect(edited.status).toBe(200);
  expect(edited.body.data.photos).toHaveLength(2);
  expect((await upload(Buffer.alloc(5 * 1024 ** 2 + 1), created.body.data.id)).status).toBe(413);
  // Legacy new uploads and binding still use the historical one-MiB limit.
  expect((await upload(large)).status).toBe(413);
  const oldContext = { ...f, versionId: legacy.body.data.id as string };
  expect(
    (await create(oldContext, 'alice', { photoIds: [pendingForLegacy.body.data.id] })).status,
  ).toBe(400);
  const smallOne = await photo(f.app, f.yearId);
  const smallTwo = await photo(f.app, f.yearId);
  expect((await create(oldContext, 'alice', { photoIds: [smallOne, smallTwo] })).status).toBe(400);
  const oldRecord = await create(oldContext, 'alice', { photoIds: [smallOne] });
  expect(oldRecord.status).toBe(201);
  expect((await upload(large, oldRecord.body.data.id)).status).toBe(413);
});

it('applies the fixed v2 limits to additional image answers and their binding as well as core photos', async () => {
  const f = await v2Fixture();
  let workspace = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'manager')
        .send({
          revision: workspace.revision,
          maxPhotos: 1,
          maxPhotoBytes: 1024 ** 2,
        })
    ).status,
  ).toBe(200);
  workspace = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const template = workspace.versions.find((row: { id: string }) => row.id === f.versionId);
  const published = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: workspace.years[0].revision,
      template: 'class_activity_v2',
      activityTypes: template.activityTypes,
      fields: [{ id: 'gallery', label: '现场照片', kind: 'image', required: false }],
    });
  expect(published.status).toBe(201);
  f.versionId = published.body.data.id;
  const large = Buffer.concat([
    png.subarray(0, -12),
    Buffer.alloc(2 * 1024 ** 2 - png.length),
    png.subarray(-12),
  ]);
  const uploaded = await request(f.app)
    .post('/org/uploads')
    .field('yearId', f.yearId)
    .field('purpose', 'activity_photo')
    .attach('file', large, { filename: 'large.png', contentType: 'image/png' });
  expect(uploaded.status).toBe(201);
  const other = await photo(f.app, f.yearId);
  const saved = await createV2(f, 'alice', {
    photoIds: [],
    extraAnswers: { gallery: [uploaded.body.data.id, other] },
  });
  expect(saved.status).toBe(201);
  expect(saved.body.data.extraPhotos).toHaveLength(2);
});

it('keeps ordinary users on their own records across old visibility settings and grants global readers without management', async () => {
  const f = await v2Fixture();
  const firstPhoto = await photo(f.app, f.yearId);
  const own = await createV2(f, 'alice', { photoIds: [firstPhoto] });
  await createV2(f, 'bob');
  await createV2(f, 'carol');
  for (const scope of [{ kind: 'all' }, { kind: 'same_class' }, { kind: 'users', ids: ['bob'] }]) {
    const w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
    if (scope.kind === 'users') continue; // the legacy fixture below covers persisted user scopes.
    await request(f.app)
      .patch('/org/settings')
      .set('x-user', 'manager')
      .send({ revision: w.revision, viewScope: scope });
    expect((await request(f.app).get('/org/entries').set('x-user', 'bob')).body.data.total).toBe(1);
    expect(
      (await request(f.app).get(`/org/entries/${own.body.data.id}`).set('x-user', 'bob')).status,
    ).toBe(404);
    expect((await request(f.app).get(`/org/files/${firstPhoto}`).set('x-user', 'bob')).status).toBe(
      404,
    );
  }
  for (const uid of ['department', 'counselor']) {
    const workspace = (await request(f.app).get('/org/workspace').set('x-user', uid)).body.data;
    expect(workspace.canViewAll).toBe(true);
    expect(workspace.canManage).toBe(false);
    expect(workspace.canGrantSecretaries).toBe(uid === 'department');
    expect(workspace.members).toEqual([]);
    expect((await request(f.app).get('/org/entries').set('x-user', uid)).body.data.total).toBe(3);
    expect((await request(f.app).get(`/org/files/${firstPhoto}`).set('x-user', uid)).status).toBe(
      200,
    );
    expect(
      (
        await request(f.app)
          .patch('/org/settings')
          .set('x-user', uid)
          .send({ revision: workspace.revision, ordinaryExport: true })
      ).status,
    ).toBe(403);
    expect((await request(f.app).get('/org/export.xlsx').set('x-user', uid)).status).toBe(200);
  }
  const foreignExport = await request(f.app)
    .get('/org/export.xlsx?authorUid=alice')
    .set('x-user', 'bob')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  expect(foreignExport.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(foreignExport.body);
  expect(book.worksheets[0]!.rowCount).toBe(1);
  expect(
    (await request(f.app).get('/org/entries/statistics?authorUid=alice').set('x-user', 'bob')).body
      .data.activityCount,
  ).toBe(0);
});
it('does not let old manual members retain submission or edit rights after their shared secretary tag is revoked', async () => {
  const f = await fixture();
  const saved = await create(f);
  const workspace = (await request(f.app).get('/org/workspace').set('x-revoked', 'true')).body.data;
  expect(workspace.canSubmit).toBe(false);
  expect(workspace.allowedSubmitClassIds).toEqual([]);
  expect((await request(f.app).get('/org/entries').set('x-revoked', 'true')).body.data.total).toBe(
    1,
  );
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${saved.body.data.id}`)
        .set('x-revoked', 'true')
        .send({ revision: 1, summary: '撤销后修改' })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(f.app)
        .post('/org/entries')
        .set('x-revoked', 'true')
        .set('Idempotency-Key', 'revoked')
        .send({
          yearId: f.yearId,
          expectedVersionId: f.versionId,
          classId: 'a',
          participantCount: 2,
          activityTypeId: 'meeting',
          summary: '撤销后填报',
          photoIds: [],
        })
    ).status,
  ).toBe(409);
});
it('explicitly upgrades old questionnaires while retaining legacy single tags, original edit rules and fields', async () => {
  const f = await fixture();
  const old = await create(f);
  const statePath = join(
    f.directory,
    'organization-group',
    `${createHash('sha256').update('youth_league.organization').digest('hex')}.json`,
  );
  const legacy = JSON.parse(await readFile(statePath, 'utf8'));
  delete legacy.entries[0].activityTypeIds;
  delete legacy.entries[0].participantNames;
  await writeFile(statePath, JSON.stringify(legacy));
  const before = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    before.versions.find((v: { id: string }) => v.id === f.versionId).template,
  ).toBeUndefined();
  const upgraded = await request(f.app)
    .post(`/org/years/${f.yearId}/template`)
    .set('x-user', 'manager')
    .send({ revision: before.years[0].revision });
  expect(upgraded.status).toBe(201);
  expect(upgraded.body.data.template).toBe('class_activity_v2');
  const after = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(after.versions.some((v: { id: string }) => v.id === f.versionId)).toBe(true);
  expect(
    (await request(f.app).get(`/org/entries/${old.body.data.id}`)).body.data.activityTypeIds,
  ).toEqual(['meeting']);
  expect(
    (await request(f.app).get(`/org/entries/${old.body.data.id}`)).body.data.participantNames,
  ).toBe('');
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${old.body.data.id}`)
        .send({ revision: 1, summary: '修改旧记录，无须新增参与者姓名' })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${old.body.data.id}`)
        .send({ revision: 2, photoIds: [] })
    ).status,
  ).toBe(400);
});
it('permits repeated valid activities with identity from authentication, preserving assets after restart', async () => {
  const f = await fixture();
  const first = await create(f);
  const second = await create(f);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body.data.id).not.toBe(second.body.data.id);
  expect(first.body.data.authorUid).toBe('alice');
  const app = appFor(f.directory);
  const listed = await request(app).get('/org/entries');
  expect(listed.body.data.total).toBe(2);
  expect(listed.body.data.statistics.participantTimes).toBe(60);
  expect(
    (await request(app).get(`/org/files/${first.body.data.photos[0].id}?preview=1`)).status,
  ).toBe(200);
  expect(
    (await request(app).get(`/org/files/${first.body.data.photos[0].id}`).set('x-user', 'carol'))
      .status,
  ).toBe(404);
});
it.each([0, -1, 1.5, '20—30', '30'])(
  'rejects invalid participant count %s while retaining pending upload',
  async (count) => {
    const f = await fixture();
    const id = await photo(f.app, f.yearId);
    const input = {
      yearId: f.yearId,
      expectedVersionId: f.versionId,
      classId: 'a',
      participantCount: count,
      activityTypeId: 'meeting',
      summary: '活动',
      photoIds: [id],
    };
    expect(
      (await request(f.app).post('/org/entries').set('Idempotency-Key', 'invalid').send(input))
        .status,
    ).toBe(400);
    expect(
      (
        await request(f.app)
          .post('/org/entries')
          .set('Idempotency-Key', 'valid')
          .send({ ...input, participantCount: 30 })
      ).status,
    ).toBe(201);
  },
);
it('counts Unicode code points including whitespace and enforces photos and immutable input fields', async () => {
  const f = await fixture();
  expect((await create(f, 'alice', { summary: '😀'.repeat(200) })).status).toBe(201);
  expect((await create(f, 'alice', { summary: '😀'.repeat(200) + ' ' })).status).toBe(400);
  expect((await create(f, 'alice', { photoIds: [] })).status).toBe(400);
  expect((await create(f, 'alice', { authorUid: 'bob' })).status).toBe(400);
  expect((await create(f, 'alice', { classId: 'b' })).status).toBe(403);
  const other = await photo(f.app, f.yearId, 'bob');
  expect((await create(f, 'alice', { photoIds: [other] })).status).toBe(403);
});
it('supports independent edit/new switches, own edits, entry locks and stale revision conflicts', async () => {
  const f = await fixture();
  const e = (await create(f)).body.data;
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${e.id}`)
        .set('x-user', 'bob')
        .send({ revision: 1, summary: '偷改' })
    ).status,
  ).toBe(403);
  const updates = await Promise.all(
    ['一', '二'].map((summary) =>
      request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 1, summary }),
    ),
  );
  expect(updates.map((x) => x.status).sort()).toEqual([200, 409]);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${e.id}/lock`)
        .set('x-user', 'manager')
        .send({ revision: 2, locked: true })
    ).status,
  ).toBe(200);
  expect(
    (await request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 3, summary: '锁定' }))
      .status,
  ).toBe(409);
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .patch(`/org/years/${f.yearId}`)
        .set('x-user', 'manager')
        .send({ revision: w.years[0].revision, submissionOpen: false, editOpen: true })
    ).status,
  ).toBe(200);
  expect((await create(f, 'alice', { photoIds: [e.photos[0].id] })).status).toBe(409);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${e.id}/lock`)
        .set('x-user', 'manager')
        .send({ revision: 3, locked: false })
    ).status,
  ).toBe(200);
  expect(
    (await request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 4, summary: '修改' }))
      .status,
  ).toBe(200);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch(`/org/years/${f.yearId}`)
    .set('x-user', 'manager')
    .send({ revision: w.years[0].revision, submissionOpen: true, editOpen: false });
  expect((await create(f)).status).toBe(201);
  expect(
    (await request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 5, summary: '禁止' }))
      .status,
  ).toBe(409);
});
it('uses the same scopes and field projection for list/search/statistics/files/export while allowing owner edit context', async () => {
  const f = await fixture();
  const mine = (await create(f, 'alice', { summary: '=SUM(1)', activityDate: '2026-10-08' })).body
    .data;
  await create(f, 'bob');
  await create(f, 'carol');
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch('/org/settings')
    .set('x-user', 'manager')
    .send({
      revision: w.revision,
      viewScope: { kind: 'same_class' },
      hideDifficulties: true,
      ordinaryExport: true,
    });
  const list = await request(f.app).get('/org/entries');
  expect(list.body.data.total).toBe(1);
  expect(list.body.data.items[0]).not.toHaveProperty('difficulties');
  expect((await request(f.app).get('/org/entries?query=私密困难')).body.data.total).toBe(0);
  expect(
    (await request(f.app).get(`/org/entries/${mine.id}/edit-context`)).body.data.entry.difficulties,
  ).toBe('私密困难');
  expect(
    (await request(f.app).get(`/org/entries/${mine.id}/edit-context`).set('x-user', 'bob')).status,
  ).toBe(404);
  const filtered = await request(f.app).get(
    '/org/entries?authorUid=alice&dateFrom=2026-10-08&dateTo=2026-10-08',
  );
  expect(filtered.body.data.total).toBe(1);
  expect(filtered.body.data.statistics.participantTimes).toBe(30);
  const exported = await request(f.app)
    .get('/org/export.xlsx?authorUid=alice')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  expect(exported.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.body);
  const sheet = book.worksheets[0]!;
  expect(sheet.rowCount).toBe(2);
  expect(sheet.getRow(1).values).not.toContain('备注');
  expect(sheet.getRow(2).values).toContain("'=SUM(1)");
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch('/org/settings')
    .set('x-user', 'manager')
    .send({ revision: w.revision, viewScope: { kind: 'users', ids: ['bob'] } });
  expect((await request(f.app).get('/org/entries')).body.data.total).toBe(1);
  expect((await request(f.app).get('/org/entries').set('x-user', 'bob')).body.data.total).toBe(1);
  expect((await request(f.app).get(`/org/entries/${mine.id}`).set('x-user', 'bob')).status).toBe(
    404,
  );
  expect(
    (await request(f.app).get(`/org/files/${mine.photos[0].id}`).set('x-user', 'bob')).status,
  ).toBe(404);
});
it('publishes immutable versions and edits old answers against old schema; prevents core rule removal', async () => {
  const f = await fixture();
  const old = (await create(f)).body.data;
  const w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const v2 = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: w.years[0].revision,
      activityTypes: [{ id: 'new', label: '新类型' }],
      fields: [{ id: 'place', label: '地点', kind: 'choice', required: true, options: ['室内'] }],
    });
  expect(v2.status).toBe(201);
  expect((await create(f)).status).toBe(409);
  const edited = await request(f.app)
    .patch(`/org/entries/${old.id}`)
    .send({ revision: 1, summary: '旧版本仍可修改' });
  expect(edited.status).toBe(200);
  expect(edited.body.data.versionId).toBe(f.versionId);
  const editContext = await request(f.app).get(`/org/entries/${old.id}/edit-context`);
  expect(editContext.body.data.version.fields).toEqual([]);
  const exported = await request(f.app)
    .get('/org/export.xlsx')
    .set('x-user', 'manager')
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(exported.body);
  expect(book.worksheets[0]!.getRow(2).values).toContain('该版本无此题');
  const w2 = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .post(`/org/years/${f.yearId}/versions`)
        .set('x-user', 'manager')
        .send({
          revision: w2.years[0].revision,
          activityTypes: [{ id: 'new', label: '新类型' }],
          fields: [],
          photoRequired: false,
        })
    ).status,
  ).toBe(400);
});
it('enforces archived years, configured dates and preserves historical records across new years', async () => {
  const f = await fixture();
  const e = (await create(f)).body.data;
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch(`/org/years/${f.yearId}`)
    .set('x-user', 'manager')
    .send({ revision: w.years[0].revision, startDate: '2026-09-01', endDate: '2027-08-31' });
  expect((await create(f, 'alice', { activityDate: '2025-01-01' })).status).toBe(400);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch(`/org/years/${f.yearId}`)
    .set('x-user', 'manager')
    .send({ revision: w.years[0].revision, archived: true });
  expect((await create(f, 'alice', { photoIds: [e.photos[0].id] })).status).toBe(409);
  expect(
    (await request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 1, summary: '修改' }))
      .status,
  ).toBe(409);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .post('/org/years')
        .set('x-user', 'manager')
        .send({ revision: w.revision, label: '2027—2028', copyFromYearId: f.yearId })
    ).status,
  ).toBe(201);
  expect((await request(f.app).get(`/org/entries?yearId=${f.yearId}`)).body.data.total).toBe(1);
});
it('keeps retry idempotency, rejects changed replay and foreign asset rebinding', async () => {
  const f = await fixture();
  const id = await photo(f.app, f.yearId);
  const input = {
    yearId: f.yearId,
    expectedVersionId: f.versionId,
    classId: 'a',
    participantCount: 30,
    activityTypeId: 'meeting',
    summary: '活动',
    photoIds: [id],
  };
  const first = await request(f.app).post('/org/entries').set('Idempotency-Key', 'one').send(input);
  const retry = await request(f.app).post('/org/entries').set('Idempotency-Key', 'one').send(input);
  expect(first.status).toBe(201);
  expect(retry.body.data.id).toBe(first.body.data.id);
  expect(
    (
      await request(f.app)
        .post('/org/entries')
        .set('Idempotency-Key', 'one')
        .send({ ...input, summary: '改变' })
    ).status,
  ).toBe(409);
  expect(
    (await request(f.app).post('/org/entries').set('Idempotency-Key', 'two').send(input)).status,
  ).toBe(403);
});
it('uses shared secretary class tags for deadline and resource read scopes, retaining only legacy roster read compatibility', async () => {
  const f = await v2Fixture();
  async function material(classId: string) {
    const deadline = await request(f.app)
      .post('/org/deadlines')
      .set('x-user', 'manager')
      .send({
        yearId: f.yearId,
        title: `${classId}班截止事项`,
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        scope: { kind: 'classes', ids: [classId] },
      });
    expect(deadline.status).toBe(201);
    const uploaded = await request(f.app)
      .post('/org/uploads')
      .set('x-user', 'manager')
      .field('yearId', f.yearId)
      .field('purpose', 'resource')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
        filename: `${classId}.pdf`,
        contentType: 'application/pdf',
      });
    expect(uploaded.status).toBe(201);
    const resource = await request(f.app)
      .post('/org/resources')
      .set('x-user', 'manager')
      .send({
        yearId: f.yearId,
        title: `${classId}班资料`,
        fileId: uploaded.body.data.id,
        scope: { kind: 'classes', ids: [classId] },
        deadlineId: deadline.body.data.id,
      });
    expect(resource.status).toBe(201);
    return {
      deadline: deadline.body.data,
      resource: resource.body.data,
      fileId: uploaded.body.data.id as string,
    };
  }
  const own = await material('a');
  const other = await material('b');
  expect((await request(f.app).get('/org/workspace')).body.data.members).toEqual([]);
  expect(
    (await request(f.app).get('/org/deadlines')).body.data.items.map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual([own.deadline.id]);
  expect(
    (await request(f.app).get('/org/resources')).body.data.items.map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual([own.resource.id]);
  expect((await request(f.app).get(`/org/files/${own.fileId}`)).status).toBe(200);
  expect((await request(f.app).get(`/org/files/${other.fileId}`)).status).toBe(404);
  expect((await request(f.app).get('/org/deadlines').set('x-revoked', 'true')).status).toBe(403);
  expect((await request(f.app).get('/org/resources').set('x-revoked', 'true')).status).toBe(403);
  expect(
    (await request(f.app).get(`/org/files/${own.fileId}`).set('x-revoked', 'true')).status,
  ).toBe(404);
  const w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'manager')
        .send({
          revision: w.revision,
          members: [{ uid: 'alice', studentId: '001', classId: 'a', submitClassIds: ['a'] }],
        })
    ).status,
  ).toBe(200);
  expect(
    (await request(f.app).get('/org/deadlines').set('x-revoked', 'true')).body.data.items.map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual([own.deadline.id]);
  expect(
    (await request(f.app).get('/org/resources').set('x-revoked', 'true')).body.data.items.map(
      (row: { id: string }) => row.id,
    ),
  ).toEqual([own.resource.id]);
  expect(
    (await request(f.app).get(`/org/files/${own.fileId}`).set('x-revoked', 'true')).status,
  ).toBe(200);
  expect(
    (await request(f.app).get('/org/workspace').set('x-revoked', 'true')).body.data.canSubmit,
  ).toBe(false);
});

it('filters deadlines, sorts future ascending, distinguishes cancellation and intersects old resource file access', async () => {
  const f = await fixture();
  const future = new Date(Date.now() + 86400000).toISOString();
  expect(
    (
      await request(f.app)
        .post('/org/deadlines')
        .send({ yearId: f.yearId, title: '禁止', dueAt: future, scope: { kind: 'all' } })
    ).status,
  ).toBe(403);
  const d = await request(f.app)
    .post('/org/deadlines')
    .set('x-user', 'manager')
    .send({ yearId: f.yearId, title: '截止', dueAt: future, scope: { kind: 'all' } });
  expect(d.status).toBe(201);
  const upload = await request(f.app)
    .post('/org/uploads')
    .set('x-user', 'manager')
    .field('yearId', f.yearId)
    .field('purpose', 'resource')
    .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
      filename: '资料.pdf',
      contentType: 'application/pdf',
    });
  expect(upload.status).toBe(201);
  const resource = await request(f.app)
    .post('/org/resources')
    .set('x-user', 'manager')
    .send({
      yearId: f.yearId,
      title: '资料',
      fileId: upload.body.data.id,
      deadlineId: d.body.data.id,
      scope: { kind: 'all' },
    });
  expect(resource.status).toBe(201);
  expect((await request(f.app).get(`/org/files/${upload.body.data.id}?preview=1`)).status).toBe(
    200,
  );
  await request(f.app)
    .patch(`/org/deadlines/${d.body.data.id}`)
    .set('x-user', 'manager')
    .send({ revision: 1, scope: { kind: 'classes', ids: ['b'] }, status: 'cancelled' });
  expect((await request(f.app).get('/org/resources')).body.data.items).toHaveLength(0);
  expect((await request(f.app).get(`/org/files/${upload.body.data.id}?preview=1`)).status).toBe(
    404,
  );
  const visible = await request(f.app).get('/org/deadlines').set('x-user', 'carol');
  expect(visible.body.data.items[0].displayStatus).toBe('cancelled');
});
it('rejects invalid MIME/signatures, active content and ordinary public-resource uploads', async () => {
  const f = await fixture();
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'resource')
        .attach('file', png, 'a.png')
    ).status,
  ).toBe(403);
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'activity_photo')
        .attach('file', Buffer.from('<html>bad</html>'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .set('x-user', 'manager')
        .field('yearId', f.yearId)
        .field('purpose', 'resource')
        .attach('file', Buffer.from('<svg/>'), { filename: 'a.svg', contentType: 'image/svg+xml' })
    ).status,
  ).toBe(400);
  expect(
    (await request(appFor(undefined, true)).get('/org/workspace').set('x-user', 'lead')).status,
  ).toBe(503);
});

it('filters the legacy roster by exact UID/studentId while using shared appointments for new submission rights', async () => {
  const f = await fixture();
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'lead')).body.data;
  const ordinary = (await request(f.app).get('/org/workspace')).body.data;
  expect(ordinary.members.map((r: { uid: string }) => r.uid)).toEqual(['alice']);
  expect(ordinary.managerUids).toEqual([]);
  expect(ordinary.canManage).toBe(false);
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'manager')
        .send({ revision: w.revision, managerUids: ['manager'] })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'lead')
        .send({ revision: w.revision, classes: [{ id: 'toString', label: '非法' }] })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'lead')
        .send({
          revision: w.revision,
          members: [{ uid: 'alice', studentId: '001', classId: 'unknown', submitClassIds: ['a'] }],
        })
    ).status,
  ).toBe(400);
  const members = w.members.map((r: { uid: string; studentId: string }) =>
    r.uid === 'alice' ? { ...r, studentId: '999' } : r,
  );
  const changed = await request(f.app)
    .patch('/org/settings')
    .set('x-user', 'lead')
    .send({ revision: w.revision, members });
  expect(changed.status).toBe(200);
  const shared = (await request(f.app).get('/org/workspace')).body.data;
  expect(shared.allowedSubmitClassIds).toEqual(['a']);
  expect(shared.members).toEqual([]);
  expect((await request(f.app).get('/org/entries')).status).toBe(200);
  expect((await request(f.app).get('/org/entries').set('x-revoked', 'true')).status).toBe(403);
  w = changed.body.data;
  expect(
    (
      await request(f.app)
        .patch('/org/settings')
        .set('x-user', 'lead')
        .send({ revision: w.revision, members: [...members, members[0]] })
    ).status,
  ).toBe(400);
});
it('atomically rejects simultaneous settings/year/deadline edits with stale revision', async () => {
  const f = await fixture();
  const w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const changes = await Promise.all(
    [false, true].map((ordinaryExport) =>
      request(f.app)
        .patch('/org/settings')
        .set('x-user', 'manager')
        .send({ revision: w.revision, ordinaryExport }),
    ),
  );
  expect(changes.map((r) => r.status).sort()).toEqual([200, 409]);
  const years = await Promise.all(
    [false, true].map((editOpen) =>
      request(f.app)
        .patch(`/org/years/${f.yearId}`)
        .set('x-user', 'manager')
        .send({ revision: w.years[0].revision, editOpen }),
    ),
  );
  expect(years.map((r) => r.status).sort()).toEqual([200, 409]);
  const d = (
    await request(f.app)
      .post('/org/deadlines')
      .set('x-user', 'manager')
      .send({
        yearId: f.yearId,
        title: '事项',
        dueAt: '2030-01-01T12:00:00+08:00',
        scope: { kind: 'all' },
      })
  ).body.data;
  const ds = await Promise.all(
    ['更新1', '更新2'].map((title) =>
      request(f.app)
        .patch(`/org/deadlines/${d.id}`)
        .set('x-user', 'manager')
        .send({ revision: 1, title }),
    ),
  );
  expect(ds.map((r) => r.status).sort()).toEqual([200, 409]);
});
it('persists drafts, validates each extra field kind and retains original options on edits', async () => {
  const f = await fixture();
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const definition = {
    activityTypes: [{ id: 'meeting', label: '班会' }],
    corePresentation: { summary: { label: '活动说明', help: '200字以内' } },
    fields: [
      { id: 'text', label: '标题', kind: 'text', required: true, maxLength: 10 },
      { id: 'long', label: '记录', kind: 'long_text', required: false },
      { id: 'integer', label: '次数', kind: 'integer', required: true, min: 1, max: 10 },
      { id: 'date', label: '日期', kind: 'date', required: true },
      { id: 'choice', label: '地点', kind: 'choice', required: true, options: ['室内', '室外'] },
      {
        id: 'multi',
        label: '标签',
        kind: 'multi_choice',
        required: true,
        options: ['交流', '实践'],
      },
      { id: 'image', label: '其他照片', kind: 'image', required: true },
    ],
  };
  const draft = await request(f.app)
    .put(`/org/years/${f.yearId}/draft`)
    .set('x-user', 'manager')
    .send({ revision: w.years[0].revision, ...definition });
  expect(draft.status).toBe(200);
  expect(
    (await request(appFor(f.directory)).get('/org/workspace').set('x-user', 'manager')).body.data
      .years[0].draft.corePresentation.summary.label,
  ).toBe('活动说明');
  expect((await request(f.app).get('/org/workspace')).body.data.years[0].draft).toBeNull();
  const published = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({ revision: draft.body.data.revision, ...definition });
  expect(published.status).toBe(201);
  f.versionId = published.body.data.id;
  const corePhoto = await photo(f.app, f.yearId);
  const extraPhoto = await photo(f.app, f.yearId);
  const answers = {
    text: '名称',
    integer: 2,
    date: '2026-10-11',
    choice: '室内',
    multi: ['交流'],
    image: [extraPhoto],
  };
  const created = await create(f, 'alice', { photoIds: [corePhoto], extraAnswers: answers });
  expect(created.status).toBe(201);
  expect(created.body.data.extraPhotos).toHaveLength(1);
  for (const bad of [
    { integer: 1.5 },
    { date: '2026-02-30' },
    { choice: '未知' },
    { multi: ['未知'] },
    { text: '12345678901' },
    { image: [] },
  ])
    expect(
      (
        await request(f.app)
          .patch(`/org/entries/${created.body.data.id}`)
          .send({ revision: 1, extraAnswers: { ...answers, ...bad } })
      ).status,
    ).toBe(400);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  const removed = await request(f.app)
    .post(`/org/years/${f.yearId}/versions`)
    .set('x-user', 'manager')
    .send({
      revision: w.years[0].revision,
      activityTypes: [{ id: 'changed', label: '新活动' }],
      fields: definition.fields.map((field) =>
        field.id === 'choice' ? { ...field, options: ['新地点'] } : field,
      ),
    });
  expect(removed.status).toBe(201);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${created.body.data.id}`)
        .send({ revision: 1, summary: '原选项修改' })
    ).status,
  ).toBe(200);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  expect(
    (
      await request(f.app)
        .post(`/org/years/${f.yearId}/versions`)
        .set('x-user', 'manager')
        .send({
          revision: w.years[0].revision,
          activityTypes: [{ id: 'meeting', label: '班会' }],
          fields: [{ id: 'choice', label: '另一题', kind: 'integer', required: false }],
        })
    ).status,
  ).toBe(409);
});
it('enforces photo quantity and size, preserves originals when last photo removal fails and supports closed-new edit uploads', async () => {
  const f = await fixture();
  const e = (await create(f)).body.data;
  let w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch('/org/settings')
    .set('x-user', 'manager')
    .send({ revision: w.revision, maxPhotos: 1 });
  const additional = await photo(f.app, f.yearId);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${e.id}`)
        .send({ revision: 1, photoIds: [e.photos[0].id, additional] })
    ).status,
  ).toBe(400);
  expect(
    (await request(f.app).patch(`/org/entries/${e.id}`).send({ revision: 1, photoIds: [] })).status,
  ).toBe(400);
  expect((await request(f.app).get(`/org/entries/${e.id}`)).body.data.photos[0].id).toBe(
    e.photos[0].id,
  );
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch(`/org/years/${f.yearId}`)
    .set('x-user', 'manager')
    .send({ revision: w.years[0].revision, submissionOpen: false });
  const editUpload = await request(f.app)
    .post('/org/uploads')
    .field('yearId', f.yearId)
    .field('purpose', 'activity_photo')
    .field('entryId', e.id)
    .attach('file', png, { filename: 'new.png', contentType: 'image/png' });
  expect(editUpload.status).toBe(201);
  expect(
    (
      await request(f.app)
        .patch(`/org/entries/${e.id}`)
        .send({ revision: 1, photoIds: [editUpload.body.data.id] })
    ).status,
  ).toBe(200);
  expect((await request(f.app).get(`/org/files/${e.photos[0].id}`)).status).toBe(404);
  w = (await request(f.app).get('/org/workspace').set('x-user', 'manager')).body.data;
  await request(f.app)
    .patch('/org/settings')
    .set('x-user', 'manager')
    .send({ revision: w.revision, maxPhotoBytes: 1 });
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'activity_photo')
        .field('entryId', e.id)
        .attach('file', png, { filename: 'new.png', contentType: 'image/png' })
    ).status,
  ).toBe(413);
});
it('retains bound history and cleans expired pending files without allowing their binding', async () => {
  const f = await fixture();
  const e = (await create(f)).body.data;
  const expired = await photo(f.app, f.yearId);
  const filename = join(
    f.directory,
    'organization-group',
    `${createHash('sha256').update('youth_league.organization').digest('hex')}.json`,
  );
  const s = JSON.parse(await readFile(filename, 'utf8'));
  for (const a of s.assets) a.createdAt = new Date(Date.now() - 8 * 86400000).toISOString();
  await writeFile(filename, JSON.stringify(s));
  expect((await create(f, 'alice', { photoIds: [expired] })).status).toBe(403);
  expect((await request(f.app).get(`/org/files/${expired}`)).status).toBe(404);
  await photo(f.app, f.yearId);
  await expect(
    access(join(f.directory, 'organization-group-assets', `${expired}.bin`)),
  ).rejects.toThrow();
  expect((await request(f.app).get(`/org/files/${e.photos[0].id}`)).status).toBe(200);
});
it('uploads actual Office and ZIP files, denies preview and stale replacement, revokes old URLs after replacement', async () => {
  const f = await fixture();
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Sheet1').addRow(['hello']);
  const xlsx = Buffer.from(await book.xlsx.writeBuffer());
  const uploaded = await request(f.app)
    .post('/org/uploads')
    .set('x-user', 'manager')
    .field('yearId', f.yearId)
    .field('purpose', 'resource')
    .attach('file', xlsx, {
      filename: 'a.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  expect(uploaded.status).toBe(201);
  expect(uploaded.body.data.previewable).toBe(false);
  const r = (
    await request(f.app)
      .post('/org/resources')
      .set('x-user', 'manager')
      .send({
        yearId: f.yearId,
        title: 'Excel',
        fileId: uploaded.body.data.id,
        scope: { kind: 'all' },
      })
  ).body.data;
  expect((await request(f.app).get(`/org/files/${uploaded.body.data.id}?preview=1`)).status).toBe(
    400,
  );
  expect((await request(f.app).get(`/org/files/${uploaded.body.data.id}`)).status).toBe(200);
  const zip = new JSZip();
  zip.file('a.txt', 'safe');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const replacement = await request(f.app)
    .post('/org/uploads')
    .set('x-user', 'manager')
    .field('yearId', f.yearId)
    .field('purpose', 'resource')
    .attach('file', bytes, { filename: 'a.zip', contentType: 'application/zip' });
  expect(replacement.status).toBe(201);
  expect(
    (
      await request(f.app)
        .patch(`/org/resources/${r.id}`)
        .set('x-user', 'manager')
        .send({ revision: 1, fileId: replacement.body.data.id })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(f.app)
        .patch(`/org/resources/${r.id}`)
        .set('x-user', 'manager')
        .send({ revision: 1, title: 'stale' })
    ).status,
  ).toBe(409);
  expect((await request(f.app).get(`/org/files/${uploaded.body.data.id}`)).status).toBe(404);
  expect(
    (await request(f.app).get(`/org/files/${replacement.body.data.id}`)).headers[
      'x-content-type-options'
    ],
  ).toBe('nosniff');
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .set('x-user', 'manager')
        .field('yearId', f.yearId)
        .field('purpose', 'resource')
        .attach('file', bytes, {
          filename: 'fake.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
    ).status,
  ).toBe(400);
});
it('preserves Chinese multipart filenames in safe download metadata', async () => {
  const f = await fixture();
  const uploaded = await request(f.app)
    .post('/org/uploads')
    .set('x-user', 'manager')
    .field('yearId', f.yearId)
    .field('purpose', 'resource')
    .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
      filename: '组织组资料.pdf',
      contentType: 'application/pdf',
    });
  expect(uploaded.status).toBe(201);
  expect(uploaded.body.data.originalName).toBe('组织组资料.pdf');
  const downloaded = await request(f.app)
    .get(`/org/files/${uploaded.body.data.id}`)
    .set('x-user', 'manager');
  expect(downloaded.headers['content-disposition']).toContain(encodeURIComponent('组织组资料.pdf'));
});
it('normalizes verified resource uploads with generic transport MIME without accepting explicit mismatches or spoofed content', async () => {
  const f = await fixture();
  const book = new ExcelJS.Workbook();
  book.addWorksheet('Sheet1').addRow(['transport MIME']);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const upload = (content: Buffer, filename: string, mime: string, purpose = 'resource') =>
    request(f.app)
      .post('/org/uploads')
      .set('x-user', 'manager')
      .field('yearId', f.yearId)
      .field('purpose', purpose)
      .attach('file', content, { filename, contentType: mime });
  const generic = await upload(bytes, 'Windows.xlsx', 'application/octet-stream');
  expect(generic.status).toBe(201);
  expect(generic.body.data.mime).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(generic.body.data.previewable).toBe(false);
  const downloaded = await request(f.app)
    .get(`/org/files/${generic.body.data.id}`)
    .set('x-user', 'manager');
  expect(downloaded.headers['content-type']).toContain(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect((await upload(bytes, 'wrong.xlsx', 'application/pdf')).status).toBe(400);
  expect(
    (await upload(Buffer.from('<html>spoof</html>'), 'fake.xlsx', 'application/octet-stream'))
      .status,
  ).toBe(400);
  const zip = new JSZip();
  zip.file('safe.txt', 'data');
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  const zipped = await upload(archive, 'Windows.zip', 'application/octet-stream');
  expect(zipped.status).toBe(201);
  expect(zipped.body.data.mime).toBe('application/zip');
  expect((await upload(archive, 'fake.docx', 'application/octet-stream')).status).toBe(400);
  const image = await upload(png, 'resource.png', 'application/octet-stream');
  expect(image.status).toBe(201);
  expect(image.body.data.mime).toBe('image/png');
  expect(image.body.data.previewable).toBe(true);
  expect(
    (await upload(png, 'photo.png', 'application/octet-stream', 'activity_photo')).status,
  ).toBe(409);
});
it('recognizes empty resource MIME and common RAR alias only after recognized content validation', async () => {
  const file = {
    buffer: png,
    originalname: 'resource.png',
    mimetype: '',
    size: png.length,
  } as Express.Multer.File;
  expect((await inspectFile(file, 'resource')).mime).toBe('image/png');
  await expect(
    inspectFile({ ...file, buffer: Buffer.from('spoof'), originalname: 'bad.png' }, 'resource'),
  ).rejects.toMatchObject({ status: 400 });
  await expect(inspectFile(file, 'activity_photo')).rejects.toMatchObject({ status: 400 });
  const rar = {
    buffer: Buffer.from('526172211a07003b07007300000d00000000000000000000c43d7b00400700', 'hex'),
    originalname: 'archive.rar',
    mimetype: 'application/x-rar-compressed',
  } as Express.Multer.File;
  expect((await inspectFile(rar, 'resource')).mime).toBe('application/vnd.rar');
  await expect(
    inspectFile({ ...rar, mimetype: 'application/pdf' }, 'resource'),
  ).rejects.toMatchObject({ status: 400 });
});
it('uploads and previews a structurally valid PDF 2.0 while rejecting explicit MIME mismatch and incomplete PDF signatures', async () => {
  const f = await fixture();
  let document = '%PDF-2.0\n';
  const offsets = [0];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 4 >>\nstream\nq\nQ\nendstream',
  ];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = Buffer.byteLength(document);
  document += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  const bytes = Buffer.from(document);
  const upload = (mime: string, body = bytes) =>
    request(f.app)
      .post('/org/uploads')
      .set('x-user', 'manager')
      .field('yearId', f.yearId)
      .field('purpose', 'resource')
      .attach('file', body, { filename: 'PDF-2.0.pdf', contentType: mime });
  const uploaded = await upload('application/pdf');
  expect(uploaded.status).toBe(201);
  expect(uploaded.body.data.mime).toBe('application/pdf');
  expect(uploaded.body.data.previewable).toBe(true);
  const preview = await request(f.app)
    .get(`/org/files/${uploaded.body.data.id}?preview=1`)
    .set('x-user', 'manager');
  expect(preview.status).toBe(200);
  expect(preview.headers['content-type']).toContain('application/pdf');
  expect(preview.headers['content-disposition']).toContain('inline');
  expect(
    (await upload('application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
      .status,
  ).toBe(400);
  expect((await upload('application/pdf', Buffer.from('%PDF-2.0\nincomplete'))).status).toBe(400);
});
it('sorts future UTC deadlines ascending and hides class/user/department scopes from unassigned viewers', async () => {
  const f = await fixture();
  const at = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  for (const item of [
    { title: 'later', dueAt: at(3), scope: { kind: 'all' } },
    { title: 'early', dueAt: at(1), scope: { kind: 'all' } },
    { title: 'expired', dueAt: at(-1), scope: { kind: 'all' } },
    { title: 'b-only', dueAt: at(1), scope: { kind: 'classes', ids: ['b'] } },
    { title: 'bob-only', dueAt: at(1), scope: { kind: 'users', ids: ['bob'] } },
    { title: 'department', dueAt: at(1), scope: { kind: 'department' } },
  ])
    expect(
      (
        await request(f.app)
          .post('/org/deadlines')
          .set('x-user', 'manager')
          .send({ yearId: f.yearId, ...item })
      ).status,
    ).toBe(201);
  const mine = (await request(f.app).get('/org/deadlines')).body.data.items;
  expect(mine.map((d: { title: string }) => d.title)).toEqual(['early', 'later', 'expired']);
  expect(mine[2].displayStatus).toBe('expired');
  expect(
    (await request(f.app).get('/org/deadlines').set('x-user', 'bob')).body.data.items.some(
      (d: { title: string }) => d.title === 'bob-only',
    ),
  ).toBe(true);
  expect(
    (await request(f.app).get('/org/deadlines').set('x-user', 'department')).body.data.items.some(
      (d: { title: string }) => d.title === 'department',
    ),
  ).toBe(true);
  expect(
    (
      await request(f.app)
        .post('/org/deadlines')
        .set('x-user', 'manager')
        .send({
          yearId: f.yearId,
          title: '无时区',
          dueAt: '2030-01-01T12:00:00',
          scope: { kind: 'all' },
        })
    ).status,
  ).toBe(400);
});
it('blocks immutable field overrides in updates, missing idempotency and wrong MIME even with valid image bytes', async () => {
  const f = await fixture();
  const e = (await create(f)).body.data;
  for (const malicious of [
    { yearId: 'wrong' },
    { versionId: crypto.randomUUID() },
    { authorUid: 'bob' },
    { ownerUid: 'bob' },
    { departmentId: 'another' },
    { createdAt: '2030-01-01' },
  ])
    expect(
      (
        await request(f.app)
          .patch(`/org/entries/${e.id}`)
          .send({ revision: 1, ...malicious })
      ).status,
    ).toBe(400);
  expect(
    (
      await request(f.app)
        .post('/org/entries')
        .send({
          yearId: f.yearId,
          expectedVersionId: f.versionId,
          classId: 'a',
          participantCount: 30,
          activityTypeId: 'meeting',
          summary: '活动',
          photoIds: [e.photos[0].id],
        })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(f.app)
        .post('/org/uploads')
        .field('yearId', f.yearId)
        .field('purpose', 'activity_photo')
        .attach('file', png, { filename: 'a.jpg', contentType: 'image/jpeg' })
    ).status,
  ).toBe(400);
});
