import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createConnectorsRouter } from './router.js';
import { HttpError } from '../../core/errors/http-error.js';
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(
  environment: NodeJS.ProcessEnv = { DEVELOPMENT_MAP_INGEST_TOKEN: 'test-only' },
) {
  const directory = await mkdtemp(join(tmpdir(), 'connectors-'));
  paths.push(directory);
  const app = express();
  app.use(express.json());
  app.use(
    '/connectors',
    createConnectorsRouter({
      uploadDirectory: directory,
      environment,
      authenticate: async (headers) => ({
        status: 200,
        user: {
          uid: String(headers['x-user'] ?? 'student'),
          displayName: 'user',
          avatarUrl: null,
          baseRole: 'student',
          roles: headers['x-user'] === 'admin' ? ['platform.admin'] : [],
          businessAdmin: headers['x-user'] === 'admin',
          tags: [],
        },
      }),
    }),
  );
  app.use(
    (
      error: HttpError,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      res.status(error.status ?? 500).json({ code: error.code, message: error.message });
    },
  );
  return { app, directory };
}
it('isolates connector settings and reports failed delivery instead of false success', async () => {
  const { app } = await fixture();
  await request(app).get('/connectors/status').expect(403);
  await request(app).get('/connectors/jobs').expect(403);
  const status = await request(app).get('/connectors/status').set('x-user', 'admin').expect(200);
  expect(status.body.data.find((item: { id: string }) => item.id === 'email').configured).toBe(
    false,
  );
  const draft = await request(app)
    .post('/connectors/jobs')
    .set('x-user', 'admin')
    .send({ channel: 'email', title: '反馈', text: '完成', recipients: ['test@example.org'] })
    .expect(201);
  const id = draft.body.data.id;
  await request(app)
    .post(`/connectors/jobs/${id}/send`)
    .set('x-user', 'admin')
    .send({ revision: 1 })
    .expect(503);
  const jobs = await request(app).get('/connectors/jobs').set('x-user', 'admin').expect(200);
  expect(jobs.body.data[0].status).toBe('failed');
  await request(app)
    .post(`/connectors/jobs/${id}/send`)
    .set('x-user', 'admin')
    .send({ revision: 3 })
    .expect(409);
});
it('retires arbitrary UID imports while still rejecting a missing service token', async () => {
  const { app } = await fixture();
  const data = {
    items: [
      {
        id: 'map1',
        uid: 'student',
        title: '读书交流',
        occurredAt: '2026-10-01T00:00:00Z',
        domain: 'tms',
      },
    ],
  };
  await request(app)
    .post('/connectors/map/experiences')
    .set('x-user', 'admin')
    .send(data)
    .expect(401);
  await request(app)
    .post('/connectors/map/experiences')
    .set('Authorization', 'Bearer test-only')
    .send(data)
    .expect(410);
  await request(app)
    .post('/connectors/map/experiences')
    .set('Authorization', 'Bearer test-only')
    .send({ ...data, items: [{ ...data.items[0], uid: 'other' }] })
    .expect(410);
});
it('reports digest configuration and authenticates the retired import endpoint with the original token only', async () => {
  const digest = createHash('sha256').update('test-only').digest('hex');
  const { app } = await fixture({ DEVELOPMENT_MAP_TOKEN_SHA256: digest });
  const status = await request(app).get('/connectors/status').set('x-user', 'admin').expect(200);
  expect(status.body.data.find((item: { id: string }) => item.id === 'map').configured).toBe(true);
  await request(app)
    .post('/connectors/map/experiences')
    .set('Authorization', 'Bearer test-only')
    .send({})
    .expect(410);
  for (const value of [digest, 'wrong-token'])
    await request(app)
      .post('/connectors/map/experiences')
      .set('Authorization', 'Bearer ' + value)
      .send({})
      .expect(401);
  for (const environment of [{}, { DEVELOPMENT_MAP_TOKEN_SHA256: 'invalid' }]) {
    const missing = await fixture(environment);
    const status = await request(missing.app)
      .get('/connectors/status')
      .set('x-user', 'admin')
      .expect(200);
    expect(status.body.data.find((item: { id: string }) => item.id === 'map').configured).toBe(
      false,
    );
    await request(missing.app)
      .post('/connectors/map/experiences')
      .set('Authorization', 'Bearer test-only')
      .send({})
      .expect(503);
  }
});
