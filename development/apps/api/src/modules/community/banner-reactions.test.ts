import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { PUBLISHED_FESTIVAL_BANNER_IDS } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { BASE_STUDENT_PERMISSIONS } from '../../core/authorization/permission-catalog.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { BannerReactionsService } from './banner-reactions.js';
import { bannerReactionsDataDirectory } from './banner-reaction-directory.js';
import { createCommunityRouter } from './router.js';

const { createDevelopmentBannerReactionsDirectory } = createRequire(import.meta.url)(
  '../../../../../../backend/development-integration.js',
) as {
  createDevelopmentBannerReactionsDirectory(
    uploadDirectory: string,
    environment?: { BANNER_REACTIONS_DATA_DIR?: string },
  ): string;
};

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

const bannerId = PUBLISHED_FESTIVAL_BANNER_IDS[0]!;
const anotherBannerId = PUBLISHED_FESTIVAL_BANNER_IDS[1]!;
const route = `/community/banner-reactions/${bannerId}`;
describe('shared banner reactions', () => {
  it('counts distinct readers and supports idempotent likes and cancellation', async () => {
    const { app } = await fixture();
    const first = await request(app).get(route).set('X-User', 'student-a').expect(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body.data).toEqual({
      bannerId,
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
    const another = await request(app)
      .get(`/community/banner-reactions/${anotherBannerId}`)
      .set('X-User', 'student-a')
      .expect(200);
    expect(another.body.data).toMatchObject({
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
    const result = await restored.read(bannerId, 'student-a');
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

  it('accepts all seven published banners with independent persisted totals', async () => {
    const { app, directory: root } = await fixture();
    expect(PUBLISHED_FESTIVAL_BANNER_IDS).toHaveLength(7);
    for (const id of PUBLISHED_FESTIVAL_BANNER_IDS) {
      const path = `/community/banner-reactions/${id}`;
      expect(
        (
          await request(app)
            .put(path)
            .set('X-User', 'student-a')
            .send({ liked: true, blessed: true })
            .expect(200)
        ).body.data,
      ).toMatchObject({ bannerId: id, likeCount: 1, liked: true, blessingCount: 1, blessed: true });
      expect(
        (await request(app).get(path).set('X-User', 'student-b').expect(200)).body.data,
      ).toMatchObject({
        bannerId: id,
        likeCount: 1,
        liked: false,
        blessingCount: 1,
        blessed: false,
      });
    }
    expect(await readdir(join(root, 'banner-reactions'))).toHaveLength(7);
  });

  it('rejects unknown and preview IDs for every interaction without creating any storage', async () => {
    const { app, directory: root } = await fixture();
    const unknownIds = [
      'boys-day-placement-preview',
      'preview-boys-day-placeholder',
      'boys-day-2026-unpublished',
      ...Array.from({ length: 32 }, (_, index) => `unknown-banner-${index}`),
    ];
    for (const id of unknownIds) {
      const path = `/community/banner-reactions/${id}`;
      const response = await request(app).get(path).set('X-User', 'student-a').expect(404);
      expect(response.body.data.error.code).toBe('banner_not_published');
      for (const input of [{ liked: false }, { liked: true }, { blessed: true }])
        await request(app).put(path).set('X-User', 'student-a').send(input).expect(404);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('leaves existing files and counts unchanged after rejected unknown interactions', async () => {
    const { app, directory: root } = await fixture();
    await request(app).put(route).set('X-User', 'student-a').send({ liked: true }).expect(200);
    const storedDirectory = join(root, 'banner-reactions');
    const files = await readdir(storedDirectory);
    const before = await Promise.all(
      files.map((file) => readFile(join(storedDirectory, file), 'utf8')),
    );
    for (let index = 0; index < 16; index++)
      for (const input of [{ liked: false }, { liked: true }, { blessed: true }])
        await request(app)
          .put(`/community/banner-reactions/unknown-${index}`)
          .set('X-User', 'student-a')
          .send(input)
          .expect(404);
    expect(await readdir(root)).toEqual(['banner-reactions']);
    expect(await readdir(storedDirectory)).toEqual(files);
    expect(
      await Promise.all(files.map((file) => readFile(join(storedDirectory, file), 'utf8'))),
    ).toEqual(before);
    expect(
      (await request(app).get(route).set('X-User', 'student-a').expect(200)).body.data,
    ).toMatchObject({ likeCount: 1, liked: true, blessingCount: 0 });
  });

  it('checks publication before accessing even a pre-existing invalid unknown storage record', async () => {
    const root = await directory();
    const service = new BannerReactionsService({ directory: root, nodeEnvironment: 'test' });
    const unknown = 'old-unpublished-record';
    const storedDirectory = join(root, 'banner-reactions');
    await mkdir(storedDirectory);
    const filename = `${createHash('sha256').update(unknown).digest('hex')}.json`;
    await writeFile(join(storedDirectory, filename), 'invalid JSON must never be read');
    await expect(service.read(unknown, 'student-a')).rejects.toMatchObject({
      status: 404,
      code: 'banner_not_published',
    });
    for (const input of [{ liked: false }, { liked: true }, { blessed: true } as const])
      await expect(service.update(unknown, 'student-a', input)).rejects.toMatchObject({
        status: 404,
        code: 'banner_not_published',
      });
    expect(await readdir(storedDirectory)).toEqual([filename]);
    expect(await readFile(join(storedDirectory, filename), 'utf8')).toBe(
      'invalid JSON must never be read',
    );
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
    const base = `/api/development/v1/community/banner-reactions/${bannerId}`;
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
  it('persists production reactions in the main backend default without writing public uploads', async () => {
    const root = await directory();
    const uploads = join(root, 'uploads');
    await mkdir(uploads);
    const configured = createDevelopmentBannerReactionsDirectory(uploads, {});
    expect(configured).toBe(join(root, 'banner-reactions-private'));
    const options = {
      directory: configured,
      nodeEnvironment: 'production',
      publicDirectories: [uploads],
    };
    const service = new BannerReactionsService(options);
    await expect(
      service.update(bannerId, 'student-a', { liked: true, blessed: true }),
    ).resolves.toMatchObject({ likeCount: 1, liked: true, blessingCount: 1, blessed: true });
    const restarted = new BannerReactionsService(options);
    await expect(restarted.read(bannerId, 'student-a')).resolves.toMatchObject({
      likeCount: 1,
      liked: true,
      blessingCount: 1,
      blessed: true,
    });
    expect(await readdir(uploads)).toEqual([]);
    expect(await readdir(join(configured, 'banner-reactions'))).toHaveLength(1);
  });

  it('still rejects public, parent and symlink-overlapping explicit backend overrides', async () => {
    const root = await directory();
    const uploads = join(root, 'uploads');
    await mkdir(uploads);
    const link = join(root, 'private-link');
    await symlink(uploads, link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const override of [uploads, join(uploads, 'reactions'), root, join(link, 'reactions')]) {
      const configured = createDevelopmentBannerReactionsDirectory(uploads, {
        BANNER_REACTIONS_DATA_DIR: override,
      });
      expect(
        () =>
          new BannerReactionsService({
            directory: configured,
            nodeEnvironment: 'production',
            publicDirectories: [uploads],
          }),
      ).toThrow('must not overlap');
    }
  });

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
