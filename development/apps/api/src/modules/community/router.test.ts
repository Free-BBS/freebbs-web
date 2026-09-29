import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { BASE_STUDENT_PERMISSIONS, ROLE_PERMISSION_CATALOG } from '../../core/authorization/permission-catalog.js';
import type { AuthorizationContext, PermissionRule } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { createCommunityRouter } from './router.js';

import type { RoleKey } from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../../core/database/types.js';

function actor(uid: string, role?: RoleKey): AuthorizationContext {
  const roleRules: readonly PermissionRule[] = role ? ROLE_PERMISSION_CATALOG[role] : [];
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: role ? [role] : [],
    tags: [],
    policies: [...BASE_STUDENT_PERMISSIONS, ...roleRules].map((rule, index) => ({
      ...rule,
      id: `${uid}-${index}`,
      effect: 'allow' as const,
    })),
  };
}

async function testApp() {
  const store = createMemoryStore({ seed: false });
  const actors = new Map([
    ['student', actor('student')],
    ['viewer', actor('viewer')],
    ['member', actor('member', 'youth_league.freshman.member')],
    ['leader', actor('leader', 'youth_league.freshman.leader')],
  ]);
  await store.modules.create({
    moduleId: 'community',
    name: '無界广场',
    description: '生活讨论',
    enabled: true,
    status: 'enabled',
    ownerUid: 'leader',
    scope: { type: 'public', id: '*' },
  });
  for (const context of actors.values()) {
    await store.subjects.create({
      uid: context.uid,
      displayName: context.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: context.uid,
      scope: { type: 'public', id: '*' },
    });
  }
  const app = express();
  app.use(express.json());
  app.use((request_, response, next) => {
    response.locals.requestId = 'test-request';
    next();
  });
  app.use(
    '/community',
    createCommunityRouter({
      store,
      authenticate: async (headers) => {
        const key = String(headers['x-user'] ?? '');
        const user = actors.get(key);
        return user
          ? { status: 200 as const, user }
          : { status: 401 as const, code: 'missing_identity' as const, message: 'required' };
      },
      now: () => new Date('2026-09-29T12:00:00.000Z'),
    }),
  );
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const value = error as { status?: number; code?: string; message?: string };
    response.status(value.status ?? 500).json({
      data: { error: { code: value.code ?? 'internal_error', message: value.message ?? 'error' } },
      requestId: response.locals.requestId,
    });
  });
  return { app, store };
}

describe('community router', () => {
  let app: express.Express;
  let store: DevelopmentStore;

  beforeEach(async () => {
    ({ app, store } = await testApp());
  });

  it('authenticates and strictly validates post creation', async () => {
    await request(app).get('/community/feed').expect(401);
    await request(app)
      .post('/community/posts')
      .set('X-User', 'student')
      .send({ kind: 'daily', title: '', body: '正文', tags: [], displayMode: 'named' })
      .expect(400);
  });

  it('serves the complete post interaction lifecycle', async () => {
    const created = await request(app)
      .post('/community/posts')
      .set('X-User', 'student')
      .send({
        kind: 'daily',
        title: '草坪桌游',
        body: '晚上七点见。',
        tags: ['桌游'],
        displayMode: 'anonymous',
      })
      .expect(201);
    const postId = created.body.data.id as string;

    await request(app)
      .patch(`/community/posts/${postId}`)
      .set('X-User', 'student')
      .send({ title: '草坪桌游局' })
      .expect(200);
    await request(app)
      .post(`/community/posts/${postId}/comments`)
      .set('X-User', 'viewer')
      .send({ body: '带卡牌来', parentId: null, displayMode: 'anonymous' })
      .expect(201);
    await request(app)
      .put(`/community/targets/post/${postId}/like`)
      .set('X-User', 'viewer')
      .expect(200);
    await request(app)
      .post(`/community/posts/${postId}/views`)
      .set('X-User', 'viewer')
      .expect(204);
    await request(app)
      .post(`/community/posts/${postId}/reports`)
      .set('X-User', 'viewer')
      .send({ reason: '测试举报' })
      .expect(201);

    const detail = await request(app)
      .get(`/community/posts/${postId}`)
      .set('X-User', 'viewer')
      .expect(200);
    expect(detail.body.data).toMatchObject({
      item: { title: '草坪桌游局', likeCount: 1, author: { displayName: '匿名小羊 1' } },
    });
    expect(detail.body.data.item.author).not.toHaveProperty('uid');
    expect(detail.body.data.comments[0].author).not.toHaveProperty('uid');

    const trending = await request(app)
      .get('/community/trending')
      .set('X-User', 'viewer')
      .expect(200);
    expect(trending.body.data.items[0].postId).toBe(postId);
    expect(trending.body.data.generatedAt).toBe('2026-09-29T12:00:00.000Z');
  });

  it('enforces manual leader approval and keeps conversion idempotent', async () => {
    const created = await request(app)
      .post('/community/posts')
      .set('X-User', 'student')
      .send({
        kind: 'wish',
        title: 'Unity 工作坊',
        body: '想学基础操作。',
        tags: [],
        displayMode: 'named',
      })
      .expect(201);
    const postId = created.body.data.id as string;

    await request(app)
      .post(`/community/wishes/${postId}/responses`)
      .set('X-User', 'student')
      .send({ body: '无权回应' })
      .expect(403);
    await request(app)
      .post(`/community/wishes/${postId}/responses`)
      .set('X-User', 'member')
      .send({ body: '正在联系讲师。' })
      .expect(200);
    await request(app)
      .post(`/community/wishes/${postId}/conversion-requests`)
      .set('X-User', 'member')
      .send({
        title: 'Unity 入门工作坊',
        description: '从场景搭建开始。',
        organizationId: 'tuanwei',
        startsAt: null,
      })
      .expect(200);
    await request(app)
      .post(`/community/wishes/${postId}/conversion-requests/approve`)
      .set('X-User', 'member')
      .expect(403);
    const first = await request(app)
      .post(`/community/wishes/${postId}/conversion-requests/approve`)
      .set('X-User', 'leader')
      .expect(201);
    const second = await request(app)
      .post(`/community/wishes/${postId}/conversion-requests/approve`)
      .set('X-User', 'leader')
      .expect(200);

    expect(second.body.data.id).toBe(first.body.data.id);
    expect((await store.activities.list()).filter(({ sourceCommunityPostId }) => sourceCommunityPostId === postId)).toHaveLength(1);
  });
});
