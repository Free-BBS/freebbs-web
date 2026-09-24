import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoleKey } from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { HttpError } from '../../core/errors/http-error.js';
import { createFestivalRouter } from './router.js';

const directories: string[] = [];
const video = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
async function fixture(maxUploadBytes = 1024) {
  const directory = await mkdtemp(join(tmpdir(), '.freebbs-festival-'));
  directories.push(directory);
  const store = createMemoryStore();
  const roles: Record<string, RoleKey[]> = {
    student: [],
    blocked: [],
    stranger: [],
    arts: ['department.arts_member'],
    director: ['department.arts_director'],
    lead: ['domain.arts_lead'],
    tuanwei: ['affiliation.tuanwei_lead'],
    admin: ['platform.super_admin'],
    sports: ['domain.sports_lead'],
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/festival',
    createFestivalRouter({
      store,
      uploadDirectory: directory,
      maxUploadBytes,
      authenticate: async (headers) => {
        const uid = headers['x-user'];
        if (typeof uid !== 'string' || !roles[uid])
          return { status: 401 as const, code: 'missing_identity' as const, message: 'Sign in' };
        return {
          status: 200 as const,
          user: {
            uid,
            displayName: uid,
            avatarUrl: null,
            baseRole: 'student' as const,
            roles: roles[uid]!,
            tags: [],
            policies:
              uid === 'blocked'
                ? []
                : [
                    {
                      id: 'baseline',
                      action: 'events.read',
                      resource: 'activity',
                      effect: 'allow' as const,
                    },
                  ],
          },
        };
      },
    }),
  );
  app.use(((error, _request, response, _next) => {
    void _next;
    response
      .status(error instanceof HttpError ? error.status : 500)
      .json({ data: { error: { message: error.message } } });
  }) as express.ErrorRequestHandler);
  const upload = (consent: boolean, uid = 'student') =>
    request(app)
      .post('/festival/submissions')
      .set('X-User', uid)
      .field('title', '我的学生节作品')
      .field('description', '原创舞蹈')
      .field('displayConsent', String(consent))
      .attach('video', video, { filename: 'work.mp4', contentType: 'video/mp4' });
  return { app, store, directory, roles, upload };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('student festival privacy and review', () => {
  it('explicitly reapproves consented rejected and removed works while rejecting stale or private decisions', async () => {
    const { app, upload, store } = await fixture();
    const id = (await upload(true).expect(201)).body.data.id;
    const decide = (decision: string, uid = 'arts') =>
      request(app)
        .post(`/festival/submissions/${id}/review`)
        .set('X-User', uid)
        .send({ decision, note: '复核意见' });
    await decide('reject').expect(200);
    await decide('approve').expect(409);
    await decide('reapprove', 'sports').expect(403);
    await decide('reapprove').expect(200);
    await request(app)
      .get(`/festival/submissions/${id}/media`)
      .set('X-User', 'student')
      .expect(200);
    await decide('unpublish').expect(200);
    const responses = await Promise.all([decide('reapprove'), decide('reapprove')]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      (await store.auditLogs.list()).filter((entry) => entry.action === 'festival.reapprove'),
    ).toHaveLength(2);
    const privateId = (await upload(false).expect(201)).body.data.id;
    await request(app)
      .post(`/festival/submissions/${privateId}/review`)
      .set('X-User', 'admin')
      .send({ decision: 'reapprove' })
      .expect(409);
  });
  it('identifies real videos when a browser provides only binary MIME metadata', async () => {
    const { app } = await fixture();
    const result = await request(app)
      .post('/festival/submissions')
      .set('X-User', 'student')
      .field('title', '无类型元数据视频')
      .field('displayConsent', 'false')
      .attach('video', video, { filename: 'clip.mp4', contentType: 'application/octet-stream' });
    expect(result.status).toBe(201);
    expect(result.body.data.mimeType).toBe('video/mp4');
    await request(app)
      .post('/festival/submissions')
      .set('X-User', 'student')
      .field('title', '伪装视频')
      .attach('video', Buffer.from('not a video'), {
        filename: 'clip.mp4',
        contentType: 'application/octet-stream',
      })
      .expect(415);
  });
  it('requires explicit consent and approval before displaying metadata or video', async () => {
    const { app, upload, store } = await fixture();
    const created = await upload(true).expect(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({
      status: 'pending',
      ownerUid: 'student',
      displayConsent: true,
      canViewMedia: false,
    });
    expect(created.body.data).not.toHaveProperty('storageKey');
    for (const uid of ['student', 'stranger', 'sports'])
      await request(app).get(`/festival/submissions/${id}/media`).set('X-User', uid).expect(404);
    const before = await request(app)
      .get('/festival/submissions?view=showcase')
      .set('X-User', 'stranger')
      .expect(200);
    expect(before.body.data.total).toBe(0);
    await request(app)
      .post(`/festival/submissions/${id}/review`)
      .set('X-User', 'sports')
      .send({ decision: 'approve', note: '' })
      .expect(403);
    await request(app)
      .post(`/festival/submissions/${id}/review`)
      .set('X-User', 'arts')
      .send({ decision: 'approve', note: '欢迎展示' })
      .expect(200);
    const published = await request(app)
      .get('/festival/submissions?view=showcase')
      .set('X-User', 'stranger')
      .expect(200);
    expect(published.body.data.items).toHaveLength(1);
    expect(published.body.data.items[0].canViewMedia).toBe(true);
    const media = await request(app)
      .get(`/festival/submissions/${id}/media`)
      .set('X-User', 'stranger')
      .expect(200);
    expect(media.headers['cache-control']).toContain('no-store');
    expect(media.headers['content-type']).toContain('video/mp4');
    await request(app).get(`/festival/submissions/${id}/media`).expect(401);
    await request(app)
      .post(`/festival/submissions/${id}/review`)
      .set('X-User', 'arts')
      .send({ decision: 'unpublish', note: '撤下' })
      .expect(200);
    await request(app)
      .get(`/festival/submissions/${id}/media`)
      .set('X-User', 'stranger')
      .expect(404);
    expect((await store.auditLogs.list()).filter((row) => row.resourceId === id)).toHaveLength(3);
  });
  it('keeps non-consented work private even from its owner and rejects forced publication', async () => {
    const { app, upload, roles } = await fixture();
    const created = await upload(false).expect(201);
    const id = created.body.data.id;
    for (const uid of ['arts', 'director', 'lead', 'tuanwei', 'admin']) {
      await request(app).get(`/festival/submissions/${id}/media`).set('X-User', uid).expect(200);
      await request(app)
        .post(`/festival/submissions/${id}/review`)
        .set('X-User', uid)
        .send({ decision: 'approve', note: '' })
        .expect(409);
    }
    roles.arts = [];
    await request(app).get(`/festival/submissions/${id}/media`).set('X-User', 'arts').expect(404);
    const mine = await request(app)
      .get('/festival/submissions?view=mine')
      .set('X-User', 'student')
      .expect(200);
    expect(mine.body.data.items[0]).toMatchObject({ status: 'private', canViewMedia: false });
    for (const uid of ['student', 'sports', 'stranger']) {
      await request(app).get('/festival/submissions?view=review').set('X-User', uid).expect(403);
      await request(app).get(`/festival/submissions/${id}/media`).set('X-User', uid).expect(404);
    }
  });
  it('validates actual file content, bounded size and metadata and cleans failed uploads', async () => {
    const { app, directory, store } = await fixture(64);
    const post = () => request(app).post('/festival/submissions').set('X-User', 'student');
    await post()
      .field('title', '坏文件')
      .field('displayConsent', 'true')
      .attach('video', Buffer.from('<script>bad</script>'), {
        filename: 'fake.mp4',
        contentType: 'video/mp4',
      })
      .expect(415);
    await post()
      .field('title', '太大')
      .field('displayConsent', 'false')
      .attach('video', Buffer.alloc(128), { filename: 'big.mp4', contentType: 'video/mp4' })
      .expect(413);
    await post()
      .field('title', '')
      .field('displayConsent', 'true')
      .attach('video', video, { filename: 'work.mp4', contentType: 'video/mp4' })
      .expect(400);
    await post()
      .field('title', '篡改')
      .field('displayConsent', 'true')
      .field('status', 'approved')
      .attach('video', video, { filename: 'work.mp4', contentType: 'video/mp4' })
      .expect(400);
    expect(await readdir(directory)).toEqual([]);
    expect(await store.festivalSubmissions.list()).toEqual([]);
  });
  it('authenticates uploads before writing and respects module disabling', async () => {
    const { app, store, directory, upload } = await fixture();
    await upload(true, 'blocked').expect(403);
    await request(app)
      .get('/festival/submissions?view=showcase')
      .set('X-User', 'blocked')
      .expect(403);
    await request(app)
      .post('/festival/submissions')
      .attach('video', video, { filename: 'work.mp4', contentType: 'video/mp4' })
      .expect(401);
    const module = (await store.modules.list()).find((row) => row.moduleId === 'events')!;
    await store.modules.update(module.id, { enabled: false });
    await upload(true).expect(503);
    expect(await readdir(directory)).toEqual([]);
  });
  it('serializes competing decisions and paginates only visible records', async () => {
    const { app, upload } = await fixture();
    const id = (await upload(true).expect(201)).body.data.id;
    const results = await Promise.all(
      ['approve', 'reject'].map((decision) =>
        request(app)
          .post(`/festival/submissions/${id}/review`)
          .set('X-User', 'arts')
          .send({ decision, note: '' }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    await request(app)
      .get('/festival/submissions?view=showcase&page=-1')
      .set('X-User', 'student')
      .expect(400);
    const others = await request(app)
      .get('/festival/submissions?view=mine')
      .set('X-User', 'stranger')
      .expect(200);
    expect(others.body.data.total).toBe(0);
  });
});
