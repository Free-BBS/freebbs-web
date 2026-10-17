import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { UserContext } from '@freebbs-development/contracts';
import { createCollaborationRouter } from './router.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'collaboration-isolation-'));
  directories.push(directory);
  let ownerRoles: UserContext['roles'] = ['department.rights_development_member'];
  const app = express();
  app.use(express.json());
  app.use(
    '/tools',
    createCollaborationRouter({
      uploadDirectory: directory,
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'student');
        return {
          status: 200 as const,
          user: {
            uid,
            displayName: uid,
            avatarUrl: null,
            baseRole: 'student' as const,
            roles:
              uid === 'owner'
                ? ownerRoles
                : uid === 'colleague'
                  ? ['department.rights_development_member']
                  : [],
            tags: [],
          },
        };
      },
    }),
  );
  app.use(
    (
      error: { status?: number; code?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      response.status(error.status ?? 500).json({ code: error.code });
    },
  );
  const create = async () =>
    (
      await request(app)
        .post('/tools')
        .set('x-user', 'owner')
        .send({
          kind: 'materials',
          title: '部门材料收集',
          departmentId: 'student_union.rights_development_center',
          audience: 'all',
          status: 'published',
        })
        .expect(201)
    ).body.data;
  return {
    app,
    create,
    leaveDepartment: () => {
      ownerRoles = ['department.arts_member'];
    },
  };
}

it('accepts independent new participant records while rejecting stale edits and changed definitions', async () => {
  const f = await fixture();
  const space = await f.create();
  const first = (
    await request(f.app)
      .post(`/tools/${space.id}/entries`)
      .set('x-user', 'student')
      .send({ revision: 1, text: '第一位同学的材料' })
      .expect(200)
  ).body.data;
  const second = (
    await request(f.app)
      .post(`/tools/${space.id}/entries`)
      .set('x-user', 'another')
      .send({ revision: 1, text: '另一位同学的独立材料' })
      .expect(200)
  ).body.data;
  expect(second.revision).toBe(3);
  expect(second.entries).toHaveLength(1);
  const entry = first.entries[0];
  const changed = await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .set('x-user', 'student')
    .send({
      revision: 3,
      definitionRevision: 1,
      entryId: entry.id,
      entryRevision: entry.revision,
      text: '本人更新材料',
    })
    .expect(200);
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .set('x-user', 'student')
    .send({
      revision: changed.body.data.revision,
      definitionRevision: 1,
      entryId: entry.id,
      entryRevision: entry.revision,
      text: '旧窗口覆盖',
    })
    .expect(409);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .set('x-user', 'owner')
    .send({ revision: changed.body.data.revision, description: '组织更新填写要求' })
    .expect(200);
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .set('x-user', 'third')
    .send({ revision: 1, text: '未查看新要求的旧表单' })
    .expect(409);
});

it('denies former-owner management and transfer after organizational membership changes', async () => {
  const f = await fixture();
  const space = await f.create();
  f.leaveDepartment();
  const readable = (
    await request(f.app).get(`/tools/${space.id}`).set('x-user', 'owner').expect(200)
  ).body.data;
  expect(readable.canManage).toBe(false);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .set('x-user', 'owner')
    .send({ revision: 1, title: '越组织修改' })
    .expect(403);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .set('x-user', 'owner')
    .send({ revision: 1, departmentId: 'student_union.arts_center' })
    .expect(403);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .set('x-user', 'colleague')
    .send({ revision: 1, title: '本组织维护' })
    .expect(200);
});
