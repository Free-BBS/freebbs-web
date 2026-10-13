import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { createPublishingRouter } from './router.js';
import { HttpError } from '../../core/errors/http-error.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(production = false, store?: DevelopmentStore) {
  const directory = await mkdtemp(join(tmpdir(), 'publishing-'));
  directories.push(directory);
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/publishing',
    createPublishingRouter({
      store,
      uploadDirectory: production ? 'relative' : directory,
      nodeEnvironment: production ? 'production' : 'test',
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'student');
        const user: UserContext = {
          uid,
          displayName: uid,
          avatarUrl: null,
          baseRole: 'student',
          roles: uid.startsWith('staff')
            ? ['department.rights_development_member']
            : uid === 'otherstaff'
              ? ['department.arts_member']
              : uid === 'admin'
                ? ['platform.admin']
                : [],
          tags: [],
          businessAdmin: uid === 'admin',
        };
        return { status: 200 as const, user };
      },
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      const e = error as HttpError;
      res.status(e.status ?? 500).json({ message: e.message });
    },
  );
  return app;
}
describe('publishing authorization and interactions', () => {
  it('advertises only enabled publishing categories and hides creation when both are disabled', async () => {
    const store = createMemoryStore();
    const app = await fixture(false, store);
    for (const item of await store.modules.list())
      if (['information', 'knowledge'].includes(item.moduleId))
        await store.modules.update(item.id, { enabled: false, status: 'disabled' });
    const result = await request(app).get('/publishing').set('x-user', 'staff');
    expect(result.body.data.canCreate).toBe(false);
    expect(result.body.data.availableCategories).toEqual([]);
  });
  it('hides disabled module content and blocks detail and mutations', async () => {
    const store = createMemoryStore();
    const app = await fixture(false, store);
    const created = await request(app)
      .post('/publishing')
      .set('x-user', 'staff')
      .send({ category: 'article', title: '发布文章', status: 'published' });
    expect(created.status).toBe(201);
    const module = (await store.modules.list()).find((row) => row.moduleId === 'information')!;
    await store.modules.update(module.id, { enabled: false, status: 'disabled' });
    const id = created.body.data.id;
    expect((await request(app).get('/publishing')).body.data.items).toEqual([]);
    expect((await request(app).get(`/publishing/${id}`)).status).toBe(503);
    expect(
      (
        await request(app)
          .patch(`/publishing/${id}`)
          .set('x-user', 'staff')
          .send({ revision: 1, title: '修改' })
      ).status,
    ).toBe(503);
    expect(
      (await request(app).post(`/publishing/${id}/reaction`).send({ revision: 1, liked: true }))
        .status,
    ).toBe(503);
    expect(
      (
        await request(app)
          .post('/publishing')
          .set('x-user', 'staff')
          .send({ category: 'notices', title: '通知' })
      ).status,
    ).toBe(503);
  });
  it('keeps drafts private, restricts edits and detects stale versions', async () => {
    const app = await fixture();
    const create = await request(app).post('/publishing').set('x-user', 'staff').send({
      category: 'article',
      title: '春日故事',
      departmentId: 'student_union.rights_development_center',
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect((await request(app).get(`/publishing/${id}`)).status).toBe(404);
    expect((await request(app).get(`/publishing/${id}`).set('x-user', 'otherstaff')).status).toBe(
      404,
    );
    expect(
      (await request(app).patch(`/publishing/${id}`).send({ revision: 1, title: '冒名编辑' }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/publishing/${id}`)
          .set('x-user', 'staff2')
          .send({ revision: 8, status: 'published' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/publishing/${id}`)
          .set('x-user', 'staff2')
          .send({ revision: 1, status: 'published' })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`/publishing/${id}`)).status).toBe(200);
    expect(
      (
        await request(app)
          .patch(`/publishing/${id}`)
          .set('x-user', 'admin')
          .send({ revision: 2, status: 'archived' })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`/publishing/${id}`)).status).toBe(404);
  });
  it('forces contacts into their department and rejects foreign scopes', async () => {
    const app = await fixture();
    expect(
      (await request(app).post('/publishing').send({ category: 'contacts', title: '目录' })).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/publishing')
          .set('x-user', 'staff')
          .send({ category: 'contacts', title: '目录' })
      ).status,
    ).toBe(400);
    const created = await request(app).post('/publishing').set('x-user', 'staff').send({
      category: 'contacts',
      title: '自愿联系',
      departmentId: 'student_union.rights_development_center',
      audience: 'all',
      status: 'published',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.audience).toBe('department');
    expect((await request(app).get(`/publishing/${created.body.data.id}`)).status).toBe(404);
    expect((await request(app).get('/publishing')).body.data.items).toEqual([]);
    expect(
      (
        await request(app)
          .post('/publishing')
          .set('x-user', 'staff')
          .send({ category: 'article', title: '越界', departmentId: 'student_union.arts_center' })
      ).status,
    ).toBe(403);
  });
  it('stores one like and rating per user without exposing identities', async () => {
    const app = await fixture();
    const created = await request(app)
      .post('/publishing')
      .set('x-user', 'staff')
      .send({ category: 'book_share', title: '一本好书', status: 'published' });
    const id = created.body.data.id;
    let response = await request(app)
      .post(`/publishing/${id}/reaction`)
      .send({ revision: 1, liked: true, rating: 5 });
    expect(response.status).toBe(200);
    expect(response.body.data.likeCount).toBe(1);
    expect(response.body.data.ratingAverage).toBe(5);
    expect(response.body.data.reactions).toBeUndefined();
    response = await request(app)
      .post(`/publishing/${id}/reaction`)
      .send({ revision: 2, liked: false, rating: 3 });
    expect(response.status).toBe(200);
    expect(response.body.data.likeCount).toBe(0);
    expect(response.body.data.ratingCount).toBe(1);
    expect(response.body.data.myRating).toBe(3);
    expect(
      (await request(app).post(`/publishing/${id}/reaction`).send({ revision: 3, rating: 6 }))
        .status,
    ).toBe(400);
    expect(
      (await request(app).post(`/publishing/${id}/reaction`).send({ revision: 1, liked: true }))
        .status,
    ).toBe(409);
  });
  it('rejects unsafe links, bounded data and unavailable production storage', async () => {
    const app = await fixture();
    expect(
      (
        await request(app)
          .post('/publishing')
          .set('x-user', 'staff')
          .send({ category: 'article', title: '危险链接', images: ['javascript:alert(1)'] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/publishing')
          .set('x-user', 'staff')
          .send({ category: 'article', title: '大内容', text: '中'.repeat(30000) })
      ).status,
    ).toBe(413);
    expect((await request(await fixture(true)).get('/publishing')).status).toBe(503);
  });
});
