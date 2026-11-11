import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { BASE_STUDENT_PERMISSIONS } from '../../core/authorization/permission-catalog.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { BannerReactionsService } from './banner-reactions.js';
import { bannerReactionsDataDirectory } from './banner-reaction-directory.js';
import { createCommunityRouter } from './router.js';

const roots: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'banner-reactions-'));
  roots.push(root);
  return root;
}
afterAll(async () => {
  for (const root of roots) {
    if (!isAbsolute(root) || !basename(root).startsWith('banner-reactions-'))
      throw new Error('Unexpected temporary directory');
    await rm(root, { recursive: true, force: true });
  }
});

function actor(uid: string): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: BASE_STUDENT_PERMISSIONS.map((rule, index) => ({
      ...rule,
      id: `${uid}-${index}`,
      effect: 'allow',
    })),
  };
}

async function fixture(options: { productionWithoutStorage?: boolean } = {}) {
  const root = await directory();
  const store = createMemoryStore({ seed: false });
  const denied = actor('denied');
  denied.policies!.push({
    id: 'explicit-interaction-denial',
    action: 'community.post.interact',
    resource: 'community_post',
    scope: { type: 'public', id: '*' },
    effect: 'deny',
  });
  const users = [
    actor('student-a'),
    actor('student-b'),
    { ...actor('preview'), previewing: true },
    actor('inactive'),
    denied,
    {
      ...actor('mismatch'),
      viewer: { uid: 'another-viewer', displayName: 'viewer', canManageDevelopment: false },
    },
  ];
  const module = await store.modules.create({
    moduleId: 'community',
    name: '無界广场',
    description: '',
    enabled: true,
    status: 'enabled',
    ownerUid: 'administrator',
    scope: { type: 'public', id: '*' },
  });
  for (const user of users)
    await store.subjects.create({
      uid: user.uid,
      displayName: user.displayName,
      avatarUrl: null,
      status: user.uid === 'inactive' ? 'inactive' : 'active',
      ownerUid: user.uid,
      scope: { type: 'public', id: '*' },
    });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.requestId = 'reaction-test';
    next();
  });
  app.use(
    '/community',
    createCommunityRouter({
      store,
      nodeEnvironment: options.productionWithoutStorage ? 'production' : 'test',
      bannerReactionsDirectory: options.productionWithoutStorage ? undefined : root,
      authenticate: async (headers) => {
        const user = users.find(({ uid }) => uid === headers['x-user']);
        return user
          ? { status: 200 as const, user }
          : { status: 401 as const, code: 'missing_identity' as const, message: 'required' };
      },
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next;
      const value = error as { status?: number; code?: string; message?: string };
      res
        .status(value.status ?? 500)
        .json({ data: { error: { code: value.code, message: value.message } } });
    },
  );
  return { app, store, module, directory: root };
}

const route = '/community/banner-reactions/boys-day-2026-class-a';
describe('shared banner reactions', () => {
  it('counts distinct readers and supports idempotent likes and cancellation', async () => {
    const { app } = await fixture();
    const first = await request(app).get(route).set('X-User', 'student-a').expect(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body.data).toEqual({
      bannerId: 'boys-day-2026-class-a',
      likeCount: 0,
      liked: false,
      blessingCount: 0,
      blessed: false,
    });
    for (let index = 0; index < 2; index++)
      expect(
        (await request(app).put(route).set('X-User', 'student-a').send({ liked: true }).expect(200))
          .body.data,
      ).toMatchObject({ likeCount: 1, liked: true });
    expect(
      (await request(app).get(route).set('X-User', 'student-b').expect(200)).body.data,
    ).toMatchObject({ likeCount: 1, liked: false });
    expect(
      (await request(app).put(route).set('X-User', 'student-b').send({ liked: true }).expect(200))
        .body.data,
    ).toMatchObject({ likeCount: 2, liked: true });
    expect(
      (await request(app).put(route).set('X-User', 'student-a').send({ liked: false }).expect(200))
        .body.data,
    ).toMatchObject({ likeCount: 1, liked: false });
  });

  it('sends only one blessing per reader under concurrent retries and separates banner IDs', async () => {
    const { app } = await fixture();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        request(app)
          .put(route)
          .set('X-User', index % 2 ? 'student-a' : 'student-b')
          .send({ blessed: true })
          .expect(200),
      ),
    );
    const total = await request(app).get(route).set('X-User', 'student-a').expect(200);
    expect(total.body.data).toMatchObject({ blessingCount: 2, blessed: true });
    const preview = await request(app)
      .get('/community/banner-reactions/preview-boys-day-placement')
      .set('X-User', 'student-a')
      .expect(200);
    expect(preview.body.data).toMatchObject({
      likeCount: 0,
      liked: false,
      blessingCount: 0,
      blessed: false,
    });
  });

  it('persists across service instances without returning or storing plaintext user IDs', async () => {
    const { app, directory: root } = await fixture();
    await request(app)
      .put(route)
      .set('X-User', 'student-a')
      .send({ liked: true, blessed: true })
      .expect(200);
    const restored = new BannerReactionsService({ directory: root, nodeEnvironment: 'test' });
    const result = await restored.read('boys-day-2026-class-a', 'student-a');
    expect(result).toMatchObject({ likeCount: 1, liked: true, blessingCount: 1, blessed: true });
    expect(JSON.stringify(result)).not.toContain('student-a');
    const files = await readdir(join(root, 'banner-reactions'));
    const stored = await readFile(
      join(
        root,
        'banner-reactions',
        files.find((file) => file.endsWith('.json'))!,
      ),
      'utf8',
    );
    expect(stored).not.toContain('student-a');
  });

  it.each([
    {},
    { liked: 'yes' },
    { blessed: false },
    { liked: true, uid: 'student-b' },
    { likeCount: 100 },
  ])('rejects forged or malformed mutation bodies %j', async (body) => {
    const { app } = await fixture();
    await request(app).put(route).set('X-User', 'student-a').send(body).expect(400);
  });

  it.each(['invalid.id', 'x'.repeat(81), '_reserved', 'space%20id'])(
    'rejects invalid banner identifier %s',
    async (id) => {
      const { app } = await fixture();
      await request(app)
        .get(`/community/banner-reactions/${id}`)
        .set('X-User', 'student-a')
        .expect(400);
    },
  );

  it('requires authentication and an active account and forbids preview mutations', async () => {
    const { app } = await fixture();
    await request(app).get(route).expect(401);
    await request(app).put(route).send({ liked: true }).expect(401);
    await request(app).get(route).set('X-User', 'inactive').expect(403);
    await request(app).put(route).set('X-User', 'preview').send({ liked: true }).expect(403);
    await request(app).get(route).set('X-User', 'preview').expect(200);
  });

  it('honors the community module gate', async () => {
    const { app, store, module } = await fixture();
    await store.modules.update(module.id, { enabled: false });
    await request(app).get(route).set('X-User', 'student-a').expect(503);
    await request(app).put(route).set('X-User', 'student-a').send({ liked: true }).expect(503);
  });

  it('honors explicit interaction denials and prevents a mismatched viewer from writing', async () => {
    const { app } = await fixture();
    for (const uid of ['denied', 'mismatch'])
      await request(app).put(route).set('X-User', uid).send({ liked: true }).expect(403);
    expect(
      (await request(app).get(route).set('X-User', 'student-a').expect(200)).body.data,
    ).toMatchObject({ likeCount: 0, blessingCount: 0 });
  });

  it('fails closed in production without a configured persistent private directory', async () => {
    const { app } = await fixture({ productionWithoutStorage: true });
    const response = await request(app).get(route).set('X-User', 'student-a').expect(503);
    expect(response.body.data.error.code).toBe('banner_storage_not_configured');
    await request(app).put(route).set('X-User', 'student-a').send({ liked: true }).expect(503);
  });

  it('wires environment configuration and normal demo identities through createApp', async () => {
    const root = await directory();
    const environment = {
      NODE_ENV: 'test',
      AUTH_MODE: 'demo',
      BANNER_REACTIONS_DATA_DIR: join(root, 'private-reactions'),
    };
    const app = createApp({
      environment,
      store: createMemoryStore(),
      systemSettingsDirectory: join(root, 'settings'),
    });
    const base = '/api/development/v1/community/banner-reactions/env-configured-banner';
    const saved = await request(app)
      .put(base)
      .set('X-Demo-User', 'demo-student')
      .send({ liked: true })
      .expect(200);
    expect(saved.body.data).toMatchObject({ likeCount: 1, liked: true });
    const restarted = createApp({
      environment,
      store: createMemoryStore(),
      systemSettingsDirectory: join(root, 'settings'),
    });
    expect(
      (await request(restarted).get(base).set('X-Demo-User', 'demo-student').expect(200)).body.data,
    ).toMatchObject({ likeCount: 1, liked: true });
  });
});

describe('private banner reaction directory', () => {
  it.each(['', '   '])(
    'uses the local fallback for blank development configuration %j',
    (value) => {
      expect(
        bannerReactionsDataDirectory({ directory: value, nodeEnvironment: 'development' }),
      ).toBe(bannerReactionsDataDirectory({ nodeEnvironment: 'development' }));
      expect(
        bannerReactionsDataDirectory({ directory: value, nodeEnvironment: 'production' }),
      ).toBeUndefined();
    },
  );

  it('requires an absolute production directory and rejects overlap in both directions', async () => {
    expect(bannerReactionsDataDirectory({ nodeEnvironment: 'production' })).toBeUndefined();
    expect(() =>
      bannerReactionsDataDirectory({ directory: 'relative/path', nodeEnvironment: 'production' }),
    ).toThrow('absolute private path');
    expect(() =>
      bannerReactionsDataDirectory({
        directory: resolve('public', 'banner-data'),
        nodeEnvironment: 'production',
      }),
    ).toThrow('must not overlap');
    const root = await directory();
    expect(() =>
      bannerReactionsDataDirectory({ directory: root, publicDirectories: [join(root, 'uploads')] }),
    ).toThrow('must not overlap');
    expect(() =>
      bannerReactionsDataDirectory({
        directory: join(root, 'uploads', 'private'),
        publicDirectories: [join(root, 'uploads')],
      }),
    ).toThrow('must not overlap');
  });
});
