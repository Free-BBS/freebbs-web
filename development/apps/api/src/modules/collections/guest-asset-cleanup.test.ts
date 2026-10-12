import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { readCollectionFeature, tokenHash, withCollectionFeature } from './feature-storage.js';
import type { StoredCollectionAsset } from './uploads.js';

const directories: string[] = [];
const prefix = '/api/development/v1/collections';
const member = { 'X-Demo-User': 'demo-rights-member' };
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(attemptLimit = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'collection-guest-cleanup-'));
  directories.push(directory);
  const store = createMemoryStore();
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-rights-member']),
    collectionsUploadDirectory: directory,
  });
  const schema = {
    title: '附件清理',
    description: '',
    publicRegistration: true,
    fields: [
      {
        id: 'text',
        kind: 'short_text',
        label: '姓名',
        helpText: '',
        options: [],
        rules: [{ id: 'required', kind: 'required', value: true }],
      },
      { id: 'file', kind: 'file', label: '附件', helpText: '', options: [], rules: [] },
      { id: 'other', kind: 'file', label: '其他附件', helpText: '', options: [], rules: [] },
    ],
    formRules: [{ id: 'attempts', kind: 'attempt_limit', value: attemptLimit }],
    outputs: [],
  };
  const created = await request(app)
    .post(`${prefix}/forms`)
    .set(member)
    .send({ title: schema.title, schema })
    .expect(201);
  const id = created.body.data.id as string;
  await request(app).post(`${prefix}/forms/${id}/publish`).set(member).send({}).expect(200);
  const session = await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
  const sessionToken = session.body.data.sessionToken as string;
  return {
    app,
    id,
    directory,
    store,
    sessionToken,
    async upload(name: string) {
      const result = await request(app)
        .post(`${prefix}/public/forms/${id}/assets`)
        .set('X-Collection-Session', sessionToken)
        .field('fieldId', 'file')
        .attach('file', Buffer.from(name), `${name}.txt`)
        .expect(201);
      return result.body.data as StoredCollectionAsset;
    },
    submit(answers: Record<string, unknown>) {
      return request(app)
        .post(`${prefix}/public/forms/${id}/responses`)
        .send({ sessionToken, answers });
    },
    async expire() {
      await withCollectionFeature(directory, id, async (state) => {
        for (const session of state.sessions) session.createdAt = Date.now() - 86400001;
      });
      await request(app).post(`${prefix}/public/forms/${id}/session`).expect(201);
    },
    path(asset: StoredCollectionAsset) {
      return join(directory, 'guest-assets', `${asset.id}.txt`);
    },
  };
}

async function missing(path: string) {
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

it('removes replaced uploads on submit and keeps the used receipt download after expiry', async () => {
  const f = await fixture();
  const replaced = await f.upload('replaced');
  const used = await f.upload('used');
  const submitted = await f.submit({ text: '姓名', file: used }).expect(201);
  await missing(f.path(replaced));
  expect(
    (await readCollectionFeature(f.directory, f.id)).sessions[0]?.assets.map((asset) => asset.id),
  ).toEqual([used.id]);
  await f.expire();
  expect((await readCollectionFeature(f.directory, f.id)).sessions).toHaveLength(1);
  const download = await request(f.app)
    .get(`${prefix}/public/receipts/${submitted.body.data.receiptToken}/assets/${used.id}`)
    .expect(200);
  expect(download.text).toBe('used');
});

it('removes an upload omitted from a successful response', async () => {
  const f = await fixture();
  const removed = await f.upload('removed');
  await f.submit({ text: '姓名' }).expect(201);
  await missing(f.path(removed));
  expect((await readCollectionFeature(f.directory, f.id)).sessions[0]?.assets).toEqual([]);
});

it('keeps attachment references from earlier responses when another attempt omits them', async () => {
  const f = await fixture(2);
  const used = await f.upload('first-attempt');
  const first = await f.submit({ text: '第一次', file: [used] }).expect(201);
  await f.submit({ text: '第二次' }).expect(201);
  expect(
    (await readCollectionFeature(f.directory, f.id)).sessions[0]?.assets.map((asset) => asset.id),
  ).toEqual([used.id]);
  await f.expire();
  await request(f.app)
    .get(`${prefix}/public/receipts/${first.body.data.receiptToken}/assets/${used.id}`)
    .expect(200);
});

it('uses each response version when keeping attachments after republishing', async () => {
  const f = await fixture(2);
  const used = await f.upload('old-version');
  const first = await f.submit({ text: '第一次', file: used }).expect(201);
  const detail = await request(f.app).get(`${prefix}/forms/${f.id}`).set(member).expect(200);
  await request(f.app)
    .put(`${prefix}/forms/${f.id}/draft`)
    .set(member)
    .send({
      schema: {
        ...detail.body.data.schema,
        fields: detail.body.data.schema.fields.filter(
          (field: { id: string }) => field.id !== 'file',
        ),
      },
    })
    .expect(200);
  await request(f.app).post(`${prefix}/forms/${f.id}/publish`).set(member).send({}).expect(200);
  await f.submit({ text: '第二次' }).expect(201);
  await f.expire();
  const downloaded = await request(f.app)
    .get(`${prefix}/public/receipts/${first.body.data.receiptToken}/assets/${used.id}`)
    .expect(200);
  expect(downloaded.text).toBe('old-version');
});

it('removes all uploads when an unsubmitted session expires', async () => {
  const f = await fixture();
  const asset = await f.upload('abandoned');
  await f.expire();
  await missing(f.path(asset));
  expect((await readCollectionFeature(f.directory, f.id)).sessions[0]?.assets).toEqual([]);
});

it('retains uploads for retry after rejected answers or mismatched attachment ownership', async () => {
  const f = await fixture();
  const asset = await f.upload('retry');
  for (const answers of [
    { file: asset },
    { text: asset },
    { text: '姓名', other: asset },
    { text: '姓名', file: { ...asset, url: '../../outside.txt' } },
  ]) {
    await f.submit(answers).expect(400);
    expect(await readFile(f.path(asset), 'utf8')).toBe('retry');
  }
  expect(
    (await readCollectionFeature(f.directory, f.id)).sessions[0]?.assets.map((item) => item.id),
  ).toEqual([asset.id]);
  await f.submit({ text: '姓名', file: asset }).expect(201);
});

it('retains uploads if writing the submission receipt fails', async () => {
  const f = await fixture();
  const unused = await f.upload('not-yet-unused');
  const used = await f.upload('not-yet-used');
  await writeFile(join(f.directory, 'guest-receipts'), 'blocks receipt storage');
  await f.submit({ text: '姓名', file: used }).expect(500);
  expect(await readFile(f.path(unused), 'utf8')).toBe('not-yet-unused');
  expect(await readFile(f.path(used), 'utf8')).toBe('not-yet-used');
  expect((await readCollectionFeature(f.directory, f.id)).responses).toEqual([]);
});

it('retains draft uploads if persisting the response state fails after receipt creation', async () => {
  const f = await fixture();
  const unused = await f.upload('retry-unused');
  const used = await f.upload('retry-used');
  const statePath = join(f.directory, 'collection-features', `${tokenHash(f.id)}.json`);
  const previous = await readFile(statePath);
  const transaction = f.store.transaction.bind(f.store);
  const failure = vi.spyOn(f.store, 'transaction').mockImplementationOnce(async (operation) =>
    transaction(async (store) => {
      const result = await operation(store);
      // Obstruct the final state rename only after the real receipt has been written.
      await rm(statePath);
      await mkdir(statePath);
      return result;
    }),
  );
  await f.submit({ text: '姓名', file: used }).expect(500);
  failure.mockRestore();
  await rm(statePath, { recursive: true });
  await writeFile(statePath, previous);
  expect(await readFile(f.path(unused), 'utf8')).toBe('retry-unused');
  expect(await readFile(f.path(used), 'utf8')).toBe('retry-used');
  expect((await readCollectionFeature(f.directory, f.id)).responses).toEqual([]);
  await f.submit({ text: '姓名', file: used }).expect(201);
  await missing(f.path(unused));
});

it('retries failed cleanup for an expired submitted session without losing its bookkeeping', async () => {
  const f = await fixture();
  const unused = await f.upload('blocked');
  const used = await f.upload('retained');
  await rm(f.path(unused));
  await mkdir(f.path(unused));
  await writeFile(join(f.path(unused), 'blocked.txt'), 'blocks file removal');
  const submitted = await f.submit({ text: '姓名', file: used }).expect(201);
  await f.expire();
  const pending = await readCollectionFeature(f.directory, f.id);
  expect(
    pending.sessions.some((session) => session.assets.some((asset) => asset.id === unused.id)),
  ).toBe(true);
  await rm(f.path(unused), { recursive: true });
  await writeFile(f.path(unused), 'blocked');
  await request(f.app).post(`${prefix}/public/forms/${f.id}/session`).expect(201);
  await missing(f.path(unused));
  expect(
    (await readCollectionFeature(f.directory, f.id)).sessions.every((session) =>
      session.assets.every((asset) => asset.id !== unused.id),
    ),
  ).toBe(true);
  await request(f.app)
    .get(`${prefix}/public/receipts/${submitted.body.data.receiptToken}/assets/${used.id}`)
    .expect(200);
});
