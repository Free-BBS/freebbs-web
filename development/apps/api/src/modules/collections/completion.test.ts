import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const member = { 'X-Demo-User': 'demo-rights-member' };
const student = { 'X-Demo-User': 'demo-student' };
const prefix = '/api/development/v1/collections';
async function fixture(publicRegistration = true) {
  const directory = await mkdtemp(join(tmpdir(), 'collection-completion-'));
  directories.push(directory);
  const store = createMemoryStore();
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-rights-member', 'demo-student']),
    collectionsUploadDirectory: directory,
  });
  const schema = {
    title: '公开报名',
    description: '',
    publicRegistration,
    fields: [
      {
        id: 'text',
        kind: 'short_text',
        label: '意见',
        helpText: '',
        options: [],
        rules: [{ id: 'req', kind: 'required', value: true }],
      },
    ],
    formRules: [],
    outputs: [{ id: 'xlsx', kind: 'excel', label: 'Excel', fileName: '结果.csv' }],
  };
  const created = await request(app)
    .post(`${prefix}/forms`)
    .set(member)
    .send({ title: schema.title, schema })
    .expect(201);
  return { app, store, directory, id: created.body.data.id as string };
}
async function draftSchema(
  app: ReturnType<typeof createApp>,
  id: string,
  patch: Record<string, unknown>,
) {
  const detail = await request(app).get(`${prefix}/forms/${id}`).set(member).expect(200);
  await request(app)
    .put(`${prefix}/forms/${id}/draft`)
    .set(member)
    .send({ schema: { ...detail.body.data.schema, ...patch } })
    .expect(200);
}

it('keeps previous answers visible and downloadable after republishing', async () => {
  const { app, id } = await fixture(false);
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).send({}).expect(200);
  await request(app)
    .post(`${prefix}/forms/${id}/responses`)
    .set(student)
    .send({ answers: { text: '历史答案' } })
    .expect(201);
  await draftSchema(app, id, {
    fields: [
      {
        id: 'new-text',
        kind: 'short_text',
        label: '新版问题',
        helpText: '',
        options: [],
        rules: [],
      },
    ],
  });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).send({}).expect(200);
  const results = await request(app).get(`${prefix}/forms/${id}/results`).set(member).expect(200);
  expect(
    results.body.data.versions.some((version: { schema: { fields: Array<{ id: string }> } }) =>
      version.schema.fields.some((field) => field.id === 'text'),
    ),
  ).toBe(true);
  const output = await request(app)
    .get(`${prefix}/forms/${id}/exports/xlsx?allVersions=1`)
    .set(member)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(output.body);
  expect(JSON.stringify(book.worksheets[0]?.getSheetValues())).toContain('历史答案');
});
it('isolates public opt-in, drafts, session ownership, receipts and guest capacity from authenticated routes', async () => {
  const { app, id, store } = await fixture();
  await request(app).get(`${prefix}/public/forms/${id}`).expect(404);
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  await request(app).get(`${prefix}/public/forms/${id}`).expect(200);
  const session = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  await request(app)
    .post(`${prefix}/public/forms/${id}/responses`)
    .send({ sessionToken: session.body.data.sessionToken, answers: {} })
    .expect(400);
  const submission = await request(app)
    .post(`${prefix}/public/forms/${id}/responses`)
    .send({ sessionToken: session.body.data.sessionToken, answers: { text: '访客意见' } })
    .expect(201);
  const token = submission.body.data.receiptToken;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  await request(app).get(`${prefix}/public/receipts/${token}`).expect(200);
  await request(app)
    .get(`${prefix}/public/receipts/${'0'.repeat(64)}`)
    .expect(404);
  await request(app)
    .post(`${prefix}/public/forms/${id}/responses`)
    .send({ sessionToken: session.body.data.sessionToken, answers: { text: '重复' } })
    .expect(409);
  expect(
    (await store.collectionResponses.list({ query: id })).filter((item) => item.formId === id),
  ).toHaveLength(0);
  await request(app).get(`${prefix}/forms/${id}/results`).expect(401);
  await request(app).get(`${prefix}/forms/${id}/results`).set(student).expect(404);
  const results = await request(app).get(`${prefix}/forms/${id}/results`).set(member).expect(200);
  expect(results.body.data.total).toBe(1);
  const privateForm = await fixture(false);
  await request(privateForm.app)
    .post(`${prefix}/forms/${privateForm.id}/publish`)
    .set(member)
    .expect(200);
  await request(privateForm.app).get(`${prefix}/public/forms/${privateForm.id}`).expect(404);
});
it('exports a parseable XLSX workbook including guest responses and correct extension', async () => {
  const { app, id } = await fixture();
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  await request(app)
    .post(`${prefix}/forms/${id}/responses`)
    .set(student)
    .send({ answers: { text: '  =2+2' } })
    .expect(201);
  const exported = await request(app)
    .get(`${prefix}/forms/${id}/exports/xlsx`)
    .set(member)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .expect(200);
  expect(exported.headers['content-type']).toContain(
    'openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(decodeURIComponent(exported.headers['content-disposition'])).toContain('结果.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.body);
  expect(workbook.worksheets[0]?.getCell('C1').value).toBe('意见');
  expect(workbook.worksheets[0]?.getCell('C2').value).toBe('  =2+2');
});
it('imports Chinese roster columns, deduplicates, reports invalid rows and protects recipient identities', async () => {
  const { app, id } = await fixture();
  const imported = await request(app)
    .post(`${prefix}/forms/${id}/recipients/import`)
    .set(member)
    .attach(
      'file',
      Buffer.from('姓名,学号\n张三,00123\n张三,00123\n,00999\n李四,00456'),
      '名单.csv',
    )
    .expect(200);
  expect(imported.body.data).toMatchObject({ imported: 2, duplicates: 1, errors: [{ row: 4 }] });
  const recipients = await request(app)
    .get(`${prefix}/forms/${id}/recipients`)
    .set(member)
    .expect(200);
  expect(recipients.body.data.total).toBe(2);
  await request(app).get(`${prefix}/forms/${id}/recipients`).set(student).expect(404);
});
it('saves reusable templates in the publisher scope and refuses student template writes', async () => {
  const { app, id } = await fixture(false);
  const detail = await request(app).get(`${prefix}/forms/${id}`).set(member).expect(200);
  const saved = await request(app)
    .post(`${prefix}/templates`)
    .set(member)
    .send({ name: '部门下次复用', schema: detail.body.data.schema })
    .expect(201);
  const listed = await request(app).get(`${prefix}/templates`).set(member).expect(200);
  expect(listed.body.data.some((item: { id: string }) => item.id === saved.body.data.id)).toBe(
    true,
  );
  await request(app)
    .post(`${prefix}/templates`)
    .set(student)
    .send({ name: '越权模板', schema: detail.body.data.schema })
    .expect(403);
  const other = await request(app).get(`${prefix}/templates`).set(student).expect(200);
  expect(other.body.data).toEqual([]);
});
it('honors published schedule and combined capacity under concurrent guest and authenticated submissions', async () => {
  const { app, id } = await fixture();
  await draftSchema(app, id, { formRules: [{ id: 'capacity', kind: 'capacity', value: 1 }] });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  const session = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  const [guest, native] = await Promise.all([
    request(app)
      .post(`${prefix}/public/forms/${id}/responses`)
      .send({ sessionToken: session.body.data.sessionToken, answers: { text: 'guest' } }),
    request(app)
      .post(`${prefix}/forms/${id}/responses`)
      .set(student)
      .send({ answers: { text: 'native' } }),
  ]);
  expect([guest.status, native.status].sort()).toEqual([201, 409]);
  const results = await request(app).get(`${prefix}/forms/${id}/results`).set(member).expect(200);
  expect(results.body.data.stats.submitted).toBe(1);
  const future = await fixture();
  await draftSchema(future.app, future.id, {
    formRules: [
      {
        id: 'schedule',
        kind: 'schedule',
        value: { start: new Date(Date.now() + 3600000).toISOString() },
      },
    ],
  });
  await request(future.app).post(`${prefix}/forms/${future.id}/publish`).set(member).expect(200);
  await request(future.app).post(`${prefix}/public/forms/${future.id}/session`).expect(409);
});
it('keeps public assets bound to the correct session, form and receipt after restart', async () => {
  const { app, id, store, directory } = await fixture();
  await draftSchema(app, id, {
    fields: [
      {
        id: 'file',
        kind: 'file',
        label: '材料',
        helpText: '',
        options: [],
        rules: [{ id: 'required', kind: 'required', value: true }],
      },
    ],
  });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  const one = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  const two = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  await request(app)
    .post(`${prefix}/public/forms/${id}/assets`)
    .attach('file', Buffer.from('secret'), '材料.txt')
    .expect(404);
  const uploaded = await request(app)
    .post(`${prefix}/public/forms/${id}/assets`)
    .set('X-Collection-Session', one.body.data.sessionToken)
    .field('fieldId', 'file')
    .attach('file', Buffer.from('secret'), '材料.txt')
    .expect(201);
  await request(app).get(uploaded.body.data.url).expect(401);
  await request(app)
    .post(`${prefix}/public/forms/${id}/responses`)
    .send({ sessionToken: two.body.data.sessionToken, answers: { file: uploaded.body.data } })
    .expect(400);
  const submitted = await request(app)
    .post(`${prefix}/public/forms/${id}/responses`)
    .send({ sessionToken: one.body.data.sessionToken, answers: { file: uploaded.body.data } })
    .expect(201);
  const restarted = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-rights-member', 'demo-student']),
    collectionsUploadDirectory: directory,
  });
  const receipt = await request(restarted)
    .get(`${prefix}/public/receipts/${submitted.body.data.receiptToken}`)
    .expect(200);
  const file = await request(restarted).get(receipt.body.data.answers.file.url).expect(200);
  expect(file.text).toBe('secret');
  await request(restarted)
    .get(`${prefix}/public/receipts/${'0'.repeat(64)}/assets/${uploaded.body.data.id}`)
    .expect(404);
  await request(restarted)
    .get(`${prefix}/forms/${id}/guest-assets/${uploaded.body.data.id}`)
    .set(student)
    .expect(404);
});
it('rejects unrestricted public identity fields and malformed or duplicate rule declarations', async () => {
  const { app, id } = await fixture();
  await draftSchema(app, id, {
    formRules: [{ id: 'audience', kind: 'audience', value: 'social_org' }],
  });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(400);
  const original = (await request(app).get(`${prefix}/forms/${id}`).set(member)).body.data.schema;
  for (const patch of [
    { formRules: [{ id: 'schedule', kind: 'schedule', value: { start: 'broken' } }] },
    { formRules: [{ id: 'capacity', kind: 'capacity', value: 'ten' }] },
    { fields: [original.fields[0], original.fields[0]] },
  ]) {
    await request(app)
      .put(`${prefix}/forms/${id}/draft`)
      .set(member)
      .send({ schema: { ...original, ...patch } })
      .expect(400);
  }
});
it('requires login-provided identity for restricted roster and tracks only the matching completed recipient', async () => {
  const { store, directory, id } = await fixture(false);
  const demo = new DemoAuthClient(['demo-rights-member', 'demo-student']);
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      async introspect(uid) {
        const user = await demo.introspect(uid);
        return user && uid === 'demo-student'
          ? { ...user, displayName: '张三', studentId: '00123' }
          : user;
      },
    },
    collectionsUploadDirectory: directory,
  });
  await draftSchema(app, id, { recipientMode: 'restricted' });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(400);
  await request(app)
    .post(`${prefix}/forms/${id}/recipients/import`)
    .set(member)
    .attach('file', Buffer.from('姓名,学号\n张三,00123\n李四,00456'), '名单.csv')
    .expect(200);
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  await request(app).get(`${prefix}/public/forms/${id}`).expect(404);
  await request(app)
    .post(`${prefix}/forms/${id}/responses`)
    .set(member)
    .send({ answers: { text: '00123' } })
    .expect(403);
  await request(app)
    .post(`${prefix}/forms/${id}/responses`)
    .set(student)
    .send({ answers: { text: '完成' } })
    .expect(201);
  const recipients = await request(app)
    .get(`${prefix}/forms/${id}/recipients?completion=completed`)
    .set(member)
    .expect(200);
  expect(recipients.body.data.items).toMatchObject([
    { name: '张三', studentId: '00123', completed: true },
  ]);
  expect(recipients.body.data.stats).toEqual({ total: 2, completed: 1, pending: 1 });
});
it('accepts actual WebM audio recorder MIME parameters and bounds guest sessions', async () => {
  const { app, id } = await fixture();
  await draftSchema(app, id, {
    fields: [
      {
        id: 'audio',
        kind: 'audio',
        label: '录音',
        helpText: '',
        options: [],
        rules: [{ id: 'types', kind: 'file_types', value: ['audio/webm'] }],
      },
    ],
  });
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).expect(200);
  const session = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  const audio = await request(app)
    .post(`${prefix}/public/forms/${id}/assets`)
    .set('X-Collection-Session', session.body.data.sessionToken)
    .field('fieldId', 'audio')
    .attach('file', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), {
      filename: '录音.webm',
      contentType: 'audio/webm;codecs=opus',
    })
    .expect(201);
  expect(audio.body.data.mimeType).toBe('audio/webm');
  for (let index = 1; index < 20; index++)
    await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  await request(app).post(`${prefix}/public/forms/${id}/session`).expect(429);
});
