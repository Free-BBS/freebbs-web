import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';

const directories: string[] = [];
const workspace = '/api/development/v1/events/workspaces/development_activity/activity-night-run';
const headers = { 'X-Demo-User': 'demo-admin' };
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-content-budget-'));
  directories.push(directory);
  const store = createMemoryStore();
  await store.activities.update('activity-night-run', { status: 'finished' });
  return createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
    collectionsUploadDirectory: directory,
  });
}
const paragraphs = (count: number, length: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p-${index}`,
    kind: 'paragraph',
    text: '中'.repeat(length),
    assetId: null,
    caption: '',
  }));
it('saves multiple long Chinese paragraphs in introductions and recaps', async () => {
  const app = await fixture();
  const blocks = paragraphs(2, 12000);
  expect(Buffer.byteLength(JSON.stringify({ revision: 0, blocks }))).toBeGreaterThan(64 * 1024);
  await request(app)
    .put(`${workspace}/intro`)
    .set(headers)
    .send({ revision: 0, blocks })
    .expect(200);
  const recap = (
    await request(app)
      .post(`${workspace}/recaps`)
      .set(headers)
      .send({ revision: 1, title: '中文活动复盘', blocks })
      .expect(201)
  ).body.data.recaps[0];
  await request(app)
    .put(`${workspace}/recaps/${recap.id}`)
    .set(headers)
    .send({ revision: 2, title: '更新中文复盘', blocks })
    .expect(200);
  const saved = (await request(app).get(workspace).set(headers).expect(200)).body.data;
  expect(saved.intro).toEqual(blocks);
  expect(saved.recaps[0].blocks).toEqual(blocks);
});
it('rejects content beyond the shared byte budget without replacing saved content', async () => {
  const app = await fixture();
  const original = paragraphs(1, 10);
  await request(app)
    .put(`${workspace}/intro`)
    .set(headers)
    .send({ revision: 0, blocks: original })
    .expect(200);
  const result = await request(app)
    .put(`${workspace}/intro`)
    .set(headers)
    .send({ revision: 1, blocks: paragraphs(9, 19900) })
    .expect(400);
  expect(result.body.data.error.message).toContain('512');
  expect((await request(app).get(workspace).set(headers).expect(200)).body.data.intro).toEqual(
    original,
  );
});
it('keeps unrelated API bodies at 64 KiB and bounds activity content bodies', async () => {
  const app = await fixture();
  await request(app)
    .post('/api/development/v1/events/activities')
    .set(headers)
    .send({ text: '中'.repeat(24000) })
    .expect(413);
  await request(app)
    .put(`${workspace}/intro`)
    .set(headers)
    .send({ revision: 0, blocks: paragraphs(12, 20000) })
    .expect(413);
});
