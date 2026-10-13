import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AchievementAtlas,
  MapBindingRequest,
  MapEvidence,
} from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { createMapBridgeRouters, readMapConnection } from './router.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const subject = 'wx123:openid-one';
const item = {
  id: 'checkin-1',
  landmarkId: 'landmark-1',
  periodId: '2026_autumn',
  type: 'activity',
  title: '校园活动',
  occurredAt: '2026-10-01T10:00:00.000Z',
  domain: 'arts',
  mapBadgeIds: ['first_arrival'],
};

async function fixture(
  environment: NodeJS.ProcessEnv = { DEVELOPMENT_MAP_INGEST_TOKEN: 'test-secret' },
  nodeEnvironment = 'test',
  uploadDirectory?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'map-bridge-'));
  directories.push(directory);
  let instant = new Date('2026-10-12T10:00:00.000Z');
  const store = createMemoryStore({ seed: false });
  const atlas = (uid: string): AchievementAtlas => ({
    version: 1,
    uid,
    achievements: [],
    showcaseIds: [],
    showcaseRevision: 0,
    map: { configured: true, linked: true },
    counts: { registration: 0, verifiedActivity: 0, mapExploration: 0 },
    sources: { learning: 'not_configured' },
    updatedAt: instant.toISOString(),
  });
  const options = {
    store,
    uploadDirectory: uploadDirectory ?? directory,
    nodeEnvironment,
    environment,
    now: () => instant,
    authenticate: async (headers: Readonly<Record<string, string | string[] | undefined>>) => {
      const uid = headers['x-user'];
      if (typeof uid !== 'string')
        return {
          status: 401 as const,
          code: 'missing_identity' as const,
          message: 'Login required',
        };
      return {
        status: 200 as const,
        user: {
          uid,
          displayName: uid,
          avatarUrl: null,
          baseRole: 'student' as const,
          roles: [],
          tags: [],
          previewing: headers['x-preview'] === 'true',
          ...(headers['x-viewer']
            ? {
                viewer: {
                  uid: String(headers['x-viewer']),
                  displayName: 'viewer',
                  canManageDevelopment: true,
                },
              }
            : {}),
        },
      };
    },
    getAtlas: async (uid: string) => atlas(uid),
    saveShowcase: async (uid: string, ids: Array<string | null>, revision: number) => {
      if (revision !== 0) throw new HttpError(409, 'showcase_conflict', 'Refresh');
      if (ids.some((value) => value !== null))
        throw new HttpError(400, 'locked_achievement', 'Not owned');
      return { ...atlas(uid), showcaseIds: ids, showcaseRevision: 1 };
    },
  };
  const mount = () => {
    const app = express();
    app.use(express.json());
    const routers = createMapBridgeRouters(options);
    app.use('/growth/map', routers.userRouter);
    app.use('/connectors/map', routers.serviceRouter);
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      void _next;
      res.status(error instanceof HttpError ? error.status : 500).json({
        data: { error: { code: error.code ?? 'internal_error', message: error.message } },
      });
    };
    app.use(errors);
    return app;
  };
  const app = mount();
  const user = (method: 'get' | 'post' | 'delete', path: string, uid = 'alice') => {
    const client = request(app);
    return client[method]('/growth/map' + path).set('x-user', uid);
  };
  const service = (path: string, body: object) =>
    request(app)
      .post('/connectors/map' + path)
      .set('Authorization', 'Bearer test-secret')
      .send(body);
  const binding = async (uid = 'alice'): Promise<MapBindingRequest> =>
    (await user('post', '/binding', uid).send({}).expect(201)).body.data;
  const linked = async (uid = 'alice', mapSubject = subject) => {
    const value = await binding(uid);
    await service('/binding/claim', {
      code: value.code,
      subject: mapSubject,
      publicId: 'Map用户',
    }).expect(200);
    await user('post', `/binding/${value.id}/confirm`, uid).send({}).expect(200);
    return value;
  };
  return {
    app,
    mount,
    directory,
    store,
    user,
    service,
    binding,
    linked,
    advance: (milliseconds: number) => {
      instant = new Date(instant.getTime() + milliseconds);
    },
  };
}

describe('Map binding HTTP bridge', () => {
  it('uses a SHA-256 verifier for all service operations without accepting the verifier as a token', async () => {
    const digest = createHash('sha256').update('test-secret').digest('hex');
    const f = await fixture({ DEVELOPMENT_MAP_TOKEN_SHA256: digest.toUpperCase() });
    expect((await f.user('get', '/status').expect(200)).body.data.configured).toBe(true);
    await f.linked();
    await f.service('/sync', { subject, items: [item] }).expect(200);
    await f.service('/atlas', { subject }).expect(200);
    await f.service('/showcase', { subject, ids: [null], revision: 0 }).expect(200);
    for (const token of ['wrong-token', digest, digest.toUpperCase()]) {
      for (const path of ['/binding/claim', '/sync', '/atlas', '/showcase']) {
        await request(f.app)
          .post('/connectors/map' + path)
          .set('Authorization', 'Bearer ' + token)
          .send({ subject })
          .expect(401);
      }
    }
  });
  it('retains plaintext token precedence and disables missing or malformed verifiers', async () => {
    const digest = createHash('sha256').update('other-token').digest('hex');
    const legacy = await fixture({
      DEVELOPMENT_MAP_INGEST_TOKEN: 'test-secret',
      DEVELOPMENT_MAP_TOKEN_SHA256: digest,
    });
    await legacy.linked();
    await legacy.service('/atlas', { subject }).expect(200);
    await request(legacy.app)
      .post('/connectors/map/atlas')
      .set('Authorization', 'Bearer other-token')
      .send({ subject })
      .expect(401);
    for (const value of [
      undefined,
      '',
      'g'.repeat(64),
      'a'.repeat(63),
      'a'.repeat(65),
      ' ' + digest,
      digest + '\n',
    ]) {
      const f = await fixture({ DEVELOPMENT_MAP_TOKEN_SHA256: value });
      expect((await f.user('get', '/status').expect(200)).body.data).toEqual({
        configured: false,
        linked: false,
      });
      await f.user('post', '/binding').send({}).expect(503);
      await f.service('/atlas', { subject }).expect(503);
    }
  });
  it('requires personal login and service token, excludes preview identity', async () => {
    const f = await fixture();
    await request(f.app).get('/growth/map/status').expect(401);
    await request(f.app)
      .post('/connectors/map/binding/claim')
      .send({ code: 'AAAAAA', subject, publicId: 'x' })
      .expect(401);
    await request(f.app)
      .post('/connectors/map/atlas')
      .set('Authorization', 'Basic test-secret')
      .send({ subject })
      .expect(401);
    await request(f.app)
      .post('/connectors/map/atlas')
      .set('Authorization', 'Bearer wrong-token')
      .send({ subject })
      .expect(401);
    await f.user('post', '/binding').set('x-preview', 'true').send({}).expect(403);
    await f.user('post', '/binding').set('x-viewer', 'administrator').send({}).expect(403);
    expect((await f.user('get', '/status').expect(200)).body.data).toEqual({
      configured: true,
      linked: false,
    });
  });
  it('requires a claim followed by explicit confirmation; hides cloud identity', async () => {
    const f = await fixture();
    const value = await f.binding();
    expect(value.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(Date.parse(value.expiresAt)).toBe(Date.parse('2026-10-12T10:05:00.000Z'));
    await f.user('post', `/binding/${value.id}/confirm`).send({}).expect(409);
    await f.service('/atlas', { subject }).expect(409);
    const claim = await f
      .service('/binding/claim', { code: value.code, subject, publicId: 'Map用户' })
      .expect(200);
    expect(claim.body.data).toMatchObject({ id: value.id, status: 'claimed' });
    await f.service('/sync', { subject, items: [item] }).expect(409);
    const pending = (await f.user('get', '/status').expect(200)).body.data;
    expect(pending.pending).toMatchObject({ status: 'claimed', publicId: 'Map用户' });
    expect(JSON.stringify(pending)).not.toContain('openid');
    expect(JSON.stringify(pending)).not.toContain('subjectHash');
    await f.user('post', `/binding/${value.id}/confirm`, 'bob').send({}).expect(404);
    expect(
      (await f.user('post', `/binding/${value.id}/confirm`).send({}).expect(200)).body.data,
    ).toMatchObject({ linked: true, publicId: 'Map用户' });
    await f
      .service('/binding/claim', { code: value.code, subject, publicId: 'Map用户' })
      .expect(409);
    await f.user('post', `/binding/${value.id}/confirm`).send({}).expect(409);
    expect((await f.service('/atlas', { subject }).expect(200)).body.data.uid).toBe('alice');
    await f.service('/atlas', { subject, uid: 'bob' }).expect(400);
    await f.service('/showcase', { subject, ids: ['unearned'], revision: 0 }).expect(400);
    await f.service('/showcase', { subject, ids: [], revision: 3 }).expect(409);
    expect(
      (await f.service('/showcase', { subject, ids: [], revision: 0 }).expect(200)).body.data
        .showcaseRevision,
    ).toBe(1);
  });
  it('expires both claim and confirmation and throttles regenerating codes', async () => {
    const f = await fixture();
    const value = await f.binding();
    await f.user('post', '/binding').send({}).expect(429);
    f.advance(300_000);
    await f.service('/binding/claim', { code: value.code, subject, publicId: 'x' }).expect(410);
    expect((await f.user('get', '/status').expect(200)).body.data.pending.status).toBe('expired');
    const next = await f.binding();
    await f.service('/binding/claim', { code: next.code, subject, publicId: 'x' }).expect(200);
    f.advance(300_000);
    await f.user('post', `/binding/${next.id}/confirm`).send({}).expect(410);
  });
  it('serializes account conflicts across router instances and concurrent claims', async () => {
    const f = await fixture();
    const alice = await f.binding();
    const bob = await f.binding('bob');
    const otherApp = f.mount();
    const responses = await Promise.all([
      f.service('/binding/claim', { code: alice.code, subject, publicId: 'one' }),
      request(otherApp)
        .post('/connectors/map/binding/claim')
        .set('Authorization', 'Bearer test-secret')
        .send({ code: bob.code, subject, publicId: 'one' }),
    ]);
    expect(responses.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner =
      responses[0].status === 200 ? { uid: 'alice', binding: alice } : { uid: 'bob', binding: bob };
    const confirmations = await Promise.all([
      f.user('post', `/binding/${winner.binding.id}/confirm`, winner.uid).send({}),
      request(otherApp)
        .post(`/growth/map/binding/${winner.binding.id}/confirm`)
        .set('x-user', winner.uid)
        .send({}),
    ]);
    expect(confirmations.map((result) => result.status).sort()).toEqual([200, 409]);
    expect((await f.service('/atlas', { subject }).expect(200)).body.data.uid).toBe(winner.uid);
    await f.user('post', '/binding', winner.uid).send({}).expect(409);
  });
  it('disables safely when token or absolute production storage is absent', async () => {
    for (const f of [
      await fixture({ DEVELOPMENT_MAP_INGEST_TOKEN: '' }),
      await fixture(undefined, 'production', 'relative-directory'),
    ]) {
      expect((await f.user('get', '/status').expect(200)).body.data).toEqual({
        configured: false,
        linked: false,
      });
      await f.user('post', '/binding').send({}).expect(503);
      await f.service('/sync', { subject, items: [] }).expect(503);
      expect(await readMapConnection(f.directory, 'alice', false)).toEqual({
        configured: false,
        linked: false,
      });
    }
  });
});

describe('Map evidence ownership and validation', () => {
  it('ignores new client badge grants while retaining only awards already stored in old evidence', async () => {
    const f = await fixture();
    await f.linked();
    await f.service('/sync', { subject, items: [item] }).expect(200);
    const storage = featureStorage<MapEvidence>(f.directory, 'map-evidence');
    const saved = (await storage.list())[0];
    expect(saved.mapBadgeIds).toEqual([]);
    await storage.change(saved.id, (current) => ({
      record: { ...current!, mapBadgeIds: ['first_arrival'] },
      result: null,
    }));
    await f
      .service('/sync', { subject, items: [{ ...item, mapBadgeIds: ['builder'] }] })
      .expect(200);
    expect((await storage.get(saved.id))?.mapBadgeIds).toEqual(['first_arrival']);
  });
  it('preserves nullable showcase slots through shared server validation', async () => {
    const f = await fixture();
    await f.linked();
    const slots = [null, null, null, null, null, null];
    expect(
      (await f.service('/showcase', { subject, ids: slots, revision: 0 }).expect(200)).body.data
        .showcaseIds,
    ).toEqual(slots);
  });
  it('enriches title, domain and mapping without accepting incoming badge grants', async () => {
    const f = await fixture();
    await f.linked();
    await f.service('/sync', { subject, items: [{ ...item, domain: 'other' }] }).expect(200);
    const activity = await f.store.activities.create({
      title: '校园活动',
      description: '',
      status: 'finished',
      ownerUid: 'alice',
      scope: { type: 'public', id: '*' },
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    });
    f.advance(60_000);
    await f
      .service('/sync', {
        subject,
        items: [{ ...item, title: '修正标题', activityId: activity.id, mapBadgeIds: ['builder'] }],
      })
      .expect(200);
    let saved = (await featureStorage<MapEvidence>(f.directory, 'map-evidence').list())[0];
    expect(saved).toMatchObject({
      title: '修正标题',
      domain: 'arts',
      activityId: activity.id,
      mapBadgeIds: [],
    });
    await f
      .service('/sync', {
        subject,
        items: [{ ...item, title: '修正标题', domain: 'other', mapBadgeIds: [] }],
      })
      .expect(200);
    saved = (await featureStorage<MapEvidence>(f.directory, 'map-evidence').list())[0];
    expect(saved).toMatchObject({
      domain: 'arts',
      activityId: activity.id,
      mapBadgeIds: [],
    });
    const otherActivity = await f.store.activities.create({
      title: '另一个活动',
      description: '',
      status: 'finished',
      ownerUid: 'alice',
      scope: { type: 'public', id: '*' },
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    });
    for (const changed of [
      { ...item, activityId: otherActivity.id },
      { ...item, domain: 'sports' },
      { ...item, type: 'landmark' },
      { ...item, occurredAt: '2026-10-02T00:00:00.000Z' },
    ])
      await f.service('/sync', { subject, items: [changed] }).expect(409);
    expect(await featureStorage<MapEvidence>(f.directory, 'map-evidence').list()).toEqual([saved]);
  });
  it('persists stable digest IDs, replays idempotently, and rejects conflicting batches before writes', async () => {
    const f = await fixture();
    await f.linked();
    const first = (await f.service('/sync', { subject, items: [item, item] }).expect(200)).body
      .data;
    expect(first).toMatchObject({ imported: 1, duplicates: 1 });
    const saved = await featureStorage<MapEvidence>(f.directory, 'map-evidence').list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ uid: 'alice', landmarkId: 'landmark-1', type: 'activity' });
    expect(saved[0]?.id).toMatch(/^map:[a-f0-9]{64}$/);
    expect(saved[0]?.subjectHash).toMatch(/^[a-f0-9]{64}$/);
    const replay = (await f.service('/sync', { subject, items: [item] }).expect(200)).body.data;
    expect(replay).toMatchObject({ imported: 0, duplicates: 1 });
    await f
      .service('/sync', {
        subject,
        items: [
          { ...item, id: 'second' },
          { ...item, landmarkId: 'changed-landmark' },
        ],
      })
      .expect(409);
    expect(await featureStorage<MapEvidence>(f.directory, 'map-evidence').list()).toHaveLength(1);
    await f
      .service('/sync', {
        subject,
        items: [
          { ...item, id: 'third' },
          { ...item, id: 'third', landmarkId: 'other' },
        ],
      })
      .expect(409);
    expect(await featureStorage<MapEvidence>(f.directory, 'map-evidence').list()).toHaveLength(1);
    expect(await readMapConnection(f.directory, 'alice', true)).toMatchObject({
      linked: true,
      lastSyncedAt: first.lastSyncedAt,
    });
  });
  it('rejects fabricated types, future dates, unknown badges, uid injection and >100 rows', async () => {
    const f = await fixture();
    await f.linked();
    for (const invalid of [
      { ...item, type: 'verified' },
      { ...item, occurredAt: '2026-12-01T00:00:00.000Z' },
      { ...item, title: ' ' },
      { ...item, mapBadgeIds: ['fabricated'] },
      { ...item, uid: 'bob' },
      { ...item, occurredAt: 'invalid' },
    ])
      await f.service('/sync', { subject, items: [invalid] }).expect(400);
    await f
      .service('/sync', { subject, items: Array.from({ length: 101 }, () => item) })
      .expect(400);
    expect(await featureStorage<MapEvidence>(f.directory, 'map-evidence').list()).toHaveLength(0);
    await f
      .service('/sync', {
        subject,
        items: [
          { ...item, type: 'landmark', id: 'exploration' },
          { ...item, type: 'special', id: 'special' },
        ],
      })
      .expect(200);
  });
  it('only accepts explicit existing legacy activity and collection form references', async () => {
    const f = await fixture();
    await f.linked();
    await f.service('/sync', { subject, items: [{ ...item, activityId: 'missing' }] }).expect(400);
    await f
      .service('/sync', { subject, items: [{ ...item, activityId: 'collection:missing' }] })
      .expect(400);
    const activity = await f.store.activities.create({
      title: 'Same title',
      description: '',
      status: 'finished',
      ownerUid: 'alice',
      scope: { type: 'public', id: '*' },
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    });
    const form = await f.store.collectionForms.create({
      title: 'Same title',
      description: '',
      coverUrl: null,
      organizationId: null,
      currentDraftVersionId: null,
      publishedVersionId: null,
      opensAt: null,
      closesAt: null,
      status: 'published',
      ownerUid: 'alice',
      scope: { type: 'public', id: '*' },
    });
    await f
      .service('/sync', {
        subject,
        items: [
          { ...item, id: 'legacy', activityId: activity.id },
          { ...item, id: 'collection', activityId: `collection:${form.id}` },
          { ...item, id: 'unmapped' },
        ],
      })
      .expect(200);
    expect(await featureStorage<MapEvidence>(f.directory, 'map-evidence').list()).toHaveLength(3);
  });
  it('unlink revokes service access without transferring historical ownership', async () => {
    const f = await fixture();
    await f.linked();
    await f.service('/sync', { subject, items: [item] }).expect(200);
    expect((await f.user('delete', '/binding').expect(200)).body.data.linked).toBe(false);
    for (const [path, body] of [
      ['/atlas', { subject }],
      ['/sync', { subject, items: [item] }],
      ['/showcase', { subject, ids: [], revision: 0 }],
    ] as const)
      await f.service(path, body).expect(409);
    const bob = await f.binding('bob');
    await f.service('/binding/claim', { code: bob.code, subject, publicId: 'Map用户' }).expect(409);
    expect((await featureStorage<MapEvidence>(f.directory, 'map-evidence').list())[0]?.uid).toBe(
      'alice',
    );
    f.advance(30_000);
    await f.linked();
    expect(
      (await f.service('/sync', { subject, items: [item] }).expect(200)).body.data,
    ).toMatchObject({ imported: 0, duplicates: 1 });
    expect((await f.user('get', '/status', 'bob').expect(200)).body.data.linked).toBe(false);
  });
});
