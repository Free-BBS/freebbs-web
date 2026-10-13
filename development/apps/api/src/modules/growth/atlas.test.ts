import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createAtlasRouter } from './atlas-router.js';
import { HttpError } from '../../core/errors/http-error.js';
import type {
  AchievementAtlas,
  LearningAchievementEvidence,
  MapEvidence,
} from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { featureStorage } from '../../core/database/feature-storage.js';

const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(
  provider?: (uid: string) => Promise<LearningAchievementEvidence>,
  mapEnvironment: NodeJS.ProcessEnv = { DEVELOPMENT_MAP_INGEST_TOKEN: 'atlas-test-only' },
) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-'));
  paths.push(directory);
  const store = createMemoryStore({ seed: false });
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-student', 'demo-captain']),
    collectionsUploadDirectory: directory,
    environment: {
      NODE_ENV: 'test',
      AUTH_MODE: 'demo',
      DATA_MODE: 'memory',
      ...mapEnvironment,
    },
    learningAchievementProvider: provider,
  });
  const atlas = async (uid = 'demo-student'): Promise<AchievementAtlas> =>
    (await request(app).get('/api/development/v1/growth/atlas').set('X-Demo-User', uid).expect(200))
      .body.data;
  async function activity() {
    const activity = await store.activities.create({
      title: '同一场篮球赛',
      description: '',
      status: 'finished',
      endsAt: '2026-01-01T00:00:00Z',
      ownerUid: 'demo-student',
      organizationId: 'sports_center',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      scope: { type: 'public', id: '*' },
    });
    const registration = await store.activityRegistrations.create({
      activityId: activity.id,
      participantUid: 'demo-student',
      status: 'registered',
      ownerUid: 'demo-student',
      scope: { type: 'activity', id: activity.id },
    });
    return { activity, registration };
  }
  async function evidence(id: string, extra: Partial<MapEvidence> = {}) {
    const value: MapEvidence = {
      id,
      uid: 'demo-student',
      subjectHash: 'test',
      landmarkId: 'basketball',
      periodId: '2026_winter',
      type: 'activity',
      title: '同一场篮球赛',
      domain: 'sports',
      occurredAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...extra,
    };
    await featureStorage<MapEvidence>(directory, 'map-evidence').change(id, () => ({
      record: value,
      result: null,
    }));
  }
  return { directory, store, app, atlas, activity, evidence };
}

describe('shared achievement atlas', () => {
  it('preserves valid main-auth identity preview for growth summaries while keeping atlas and Map private', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-main-preview-'));
    paths.push(directory);
    const store = createMemoryStore();
    const scope = { type: 'public', id: '*' } as const;
    const users = ['lead', 'target'].map((uid, index) => ({
      uid,
      username: uid,
      displayName: uid,
      studentId: `202300000${index}`,
      avatarUrl: null,
    }));
    for (const user of users) {
      await store.subjects.create({
        uid: user.uid,
        displayName: user.displayName,
        avatarUrl: null,
        status: 'active',
        ownerUid: 'lead',
        scope,
      });
      await store.developmentAccess.create({
        subjectUid: user.uid,
        studentId: user.studentId,
        username: user.username,
        accessLevel: user.uid === 'lead' ? 'lead' : 'member',
        status: 'active',
        ownerUid: 'lead',
        scope,
      });
    }
    await store.roleAssignments.create({
      subjectUid: 'lead',
      roleKey: 'platform.admin',
      expiresAt: null,
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
    const activity = await store.activities.create({
      title: 'Target participant activity',
      description: '',
      status: 'finished',
      endsAt: '2026-01-01T00:00:00Z',
      ownerUid: 'lead',
      organizationId: 'sports_center',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      scope,
    });
    await store.activityRegistrations.create({
      activityId: activity.id,
      participantUid: 'target',
      status: 'registered',
      ownerUid: 'target',
      scope: { type: 'activity', id: activity.id },
    });
    const app = createApp({
      store,
      authMode: 'main',
      collectionsUploadDirectory: directory,
      environment: {
        NODE_ENV: 'test',
        AUTH_MODE: 'main',
        DATA_MODE: 'memory',
        DEVELOPMENT_MAP_INGEST_TOKEN: 'atlas-test-only',
      },
      authClient: {
        introspect: async (token) => {
          const user = users.find((user) => user.uid === token);
          return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
        },
      },
      userDirectory: {
        list: async () => users,
        get: async (uid) => users.find((user) => user.uid === uid) ?? null,
      },
    });
    const headers = { Authorization: 'Bearer lead', 'X-Development-Preview-Uid': 'target' };
    const identity = await request(app).get('/api/development/v1/me').set(headers).expect(200);
    expect(identity.body.data).toMatchObject({ uid: 'target', previewing: true });
    const summary = await request(app)
      .get('/api/development/v1/growth/summary')
      .set(headers)
      .expect(200);
    expect(summary.body.data.activities).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: activity.id })]),
    );
    for (const route of ['atlas', 'map/status']) {
      const privateData = await request(app)
        .get('/api/development/v1/growth/' + route)
        .set(headers)
        .expect(403);
      expect(privateData.body.data.error.code).toBe('preview_identity_denied');
    }
    await request(app)
      .put('/api/development/v1/growth/showcase')
      .set(headers)
      .send({ ids: [], revision: 0 })
      .expect(403);
    const ownAtlas = await request(app)
      .get('/api/development/v1/growth/atlas')
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(ownAtlas.body.data.uid).toBe('lead');
  });
  it('enables Map with a verifier and keeps the atlas and growth summary usable with missing or malformed Map configuration', async () => {
    const digest = createHash('sha256').update('atlas-test-only').digest('hex');
    for (const mapEnvironment of [
      { DEVELOPMENT_MAP_TOKEN_SHA256: digest },
      {},
      { DEVELOPMENT_MAP_TOKEN_SHA256: 'invalid' },
    ]) {
      const f = await fixture(
        async () => ({
          checkinDays: 7,
          circuitCleared: 0,
          circuitTotal: 5,
          ownedAchievementIds: [],
        }),
        mapEnvironment,
      );
      const data = await f.atlas();
      const configured = mapEnvironment.DEVELOPMENT_MAP_TOKEN_SHA256 === digest;
      expect(data.map).toEqual({ configured, linked: false });
      expect(data.achievements).toHaveLength(38);
      expect(
        data.achievements
          .filter((item) => item.family === 'map')
          .every((item) => item.available === configured),
      ).toBe(true);
      expect(data.sources.learning).toBe('ready');
      expect(data.achievements.find((item) => item.id === 'learning-checkin-7')?.unlocked).toBe(
        true,
      );
      await request(f.app)
        .get('/api/development/v1/growth/summary')
        .set('X-Demo-User', 'demo-student')
        .expect(200);
    }
  });
  it('denies private atlas reads through an administrator preview identity', async () => {
    const getAtlas = vi.fn(async () => ({}) as AchievementAtlas);
    const app = express();
    app.use(
      createAtlasRouter({
        authenticate: async () => ({
          status: 200,
          user: {
            uid: 'another-user',
            displayName: 'Another',
            avatarUrl: null,
            baseRole: 'student',
            roles: [],
            tags: [],
            previewing: true,
            viewer: { uid: 'real-viewer', displayName: 'Viewer', canManageDevelopment: true },
          },
        }),
        service: {
          getAtlas,
          saveShowcase: vi.fn(async () => ({}) as AchievementAtlas),
          getMiniappAtlas: vi.fn(async () => ({}) as AchievementAtlas),
          saveMiniappShowcase: vi.fn(async () => ({}) as AchievementAtlas),
        },
      }),
    );
    app.use(
      (
        error: HttpError,
        _request: express.Request,
        response: express.Response,
        _next: express.NextFunction,
      ) => {
        void _next;
        response.status(error.status).json({ code: error.code });
      },
    );
    await request(app).get('/atlas').expect(403);
    expect(getAtlas).not.toHaveBeenCalled();
  });
  it('accepts a bounded hundred-record Unicode history sync through the real application parser', async () => {
    const f = await fixture();
    const binding = (
      await request(f.app)
        .post('/api/development/v1/growth/map/binding')
        .set('X-Demo-User', 'demo-student')
        .send({})
        .expect(201)
    ).body.data;
    const service = (path: string, body: object) =>
      request(f.app)
        .post(`/api/development/v1/connectors/map${path}`)
        .set('Authorization', 'Bearer atlas-test-only')
        .send(body);
    await service('/binding/claim', {
      code: binding.code,
      subject: 'testapp:testopenid',
      publicId: 'EE-LOCAL',
    }).expect(200);
    await request(f.app)
      .post(`/api/development/v1/growth/map/binding/${binding.id}/confirm`)
      .set('X-Demo-User', 'demo-student')
      .send({})
      .expect(200);
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: `event-${i}`,
      landmarkId: `point-${i}`,
      periodId: '2026_autumn',
      type: 'activity',
      title: '校园活动'.repeat(40),
      domain: 'other',
      occurredAt: '2026-01-01T00:00:00Z',
      mapBadgeIds: [
        'first_arrival',
        'builder',
        'erudite',
        'pioneer_call',
        'season_complete',
        'autumn_trilogy',
        'winter_starlight',
        'four_seasons_traveler',
        'arts_debut',
        'sports_debut',
        'liaison_debut',
        'rights_debut',
      ],
    }));
    expect(
      Buffer.byteLength(JSON.stringify({ subject: 'testapp:testopenid', items })),
    ).toBeGreaterThan(64 * 1024);
    await service('/sync', { subject: 'testapp:testopenid', items }).expect(200);
    expect((await f.atlas()).counts.verifiedActivity).toBe(100);
  }, 15_000); // One hundred durable atomic writes need an I/O budget during the full suite.
  it('exposes all six families without inventing unavailable learning progress', async () => {
    const f = await fixture();
    const atlas = await f.atlas();
    expect(new Set(atlas.achievements.map((item) => item.family))).toEqual(
      new Set(['daily', 'learning', 'creation', 'campus', 'contribution', 'map']),
    );
    expect(atlas.sources.learning).toBe('not_configured');
    expect(
      atlas.achievements
        .filter((item) => item.family === 'learning')
        .every((item) => !item.available && !item.unlocked),
    ).toBe(true);
    expect(atlas.showcaseRevision).toBe(0);
    await request(f.app).get('/api/development/v1/growth/atlas').expect(401);
  });
  it('keeps registrations separate and merges explicitly linked Map evidence by event', async () => {
    const f = await fixture();
    const { activity } = await f.activity();
    await f.evidence('scan1', { activityId: activity.id });
    await f.evidence('scan2', { activityId: activity.id, landmarkId: 'basketball-door2' });
    await f.evidence('library', { type: 'landmark', landmarkId: 'library' });
    await f.evidence('future', { occurredAt: '2999-01-01T00:00:00Z' });
    await f.evidence('someone', { uid: 'demo-captain' });
    const atlas = await f.atlas();
    expect(atlas.counts).toEqual({ registration: 1, verifiedActivity: 1, mapExploration: 1 });
    expect(atlas.achievements.find((item) => item.id === 'first-step')?.progress).toBe(1);
    expect(atlas.achievements.find((item) => item.id === 'three-steps')?.unlocked).toBe(false);
    const summary = (
      await request(f.app)
        .get('/api/development/v1/growth/summary')
        .set('X-Demo-User', 'demo-student')
        .expect(200)
    ).body.data;
    expect(summary.verifiedTotal).toBe(1);
    expect(summary.total).toBe(1);
    expect(summary.activities[0].source).toBe('map');
    expect((await f.atlas('demo-captain')).counts.verifiedActivity).toBe(1);
  });
  it('uses genuine learning records and preserves previously awarded learning nameplates', async () => {
    const f = await fixture(async (uid) => ({
      checkinDays: uid === 'demo-student' ? 7 : 0,
      circuitCleared: 2,
      circuitTotal: 5,
      ownedAchievementIds: ['plate_circuit_master', 'plate_fishbone_master'],
    }));
    const atlas = await f.atlas();
    expect(atlas.sources.learning).toBe('ready');
    expect(atlas.achievements.find((item) => item.id === 'learning-checkin-7')?.unlocked).toBe(
      true,
    );
    expect(atlas.achievements.find((item) => item.id === 'plate_circuit_master')?.unlocked).toBe(
      true,
    );
    expect(atlas.achievements.find((item) => item.id === 'plate_fishbone_master')?.unlocked).toBe(
      true,
    );
  });
  it('grants creation and contribution badges from owned valid content instead of organization roles', async () => {
    const f = await fixture();
    await f.activity();
    for (const [status, ownerUid] of [
      ['active', 'demo-student'],
      ['hidden', 'demo-student'],
      ['active', 'demo-captain'],
    ] as const) {
      await f.store.communityPosts.create({
        kind: 'daily',
        title: '日常分享',
        body: '今天的一点记录',
        tags: [],
        displayMode: 'named',
        sourceType: null,
        sourceId: null,
        status,
        ownerUid,
        scope: { type: 'public', id: '*' },
      });
    }
    const atlas = await f.atlas();
    expect(atlas.achievements.find((b) => b.id === 'creation-first-post')).toMatchObject({
      progress: 1,
      unlocked: true,
    });
    expect(atlas.achievements.find((b) => b.id === 'creation-three-posts')).toMatchObject({
      progress: 1,
      unlocked: false,
    });
    expect(atlas.achievements.find((b) => b.id === 'contribution-events-1')).toMatchObject({
      progress: 1,
      unlocked: true,
    });
    expect(
      (await f.atlas('demo-captain')).achievements.find((b) => b.id === 'contribution-events-1')
        ?.unlocked,
    ).toBe(false);
  });
  it('counts a closed published collection as an existing organizer contribution', async () => {
    const f = await fixture();
    await f.store.collectionForms.create({
      title: '已经结束的报名',
      description: '',
      coverUrl: null,
      organizationId: null,
      currentDraftVersionId: null,
      publishedVersionId: null,
      opensAt: null,
      closesAt: null,
      status: 'closed',
      ownerUid: 'demo-student',
      scope: { type: 'public', id: '*' },
    });
    expect(
      (await f.atlas()).achievements.find((b) => b.id === 'contribution-events-1'),
    ).toMatchObject({ progress: 1, unlocked: true });
  });
  it('survives a learning provider outage without falsely reporting readiness', async () => {
    const f = await fixture(async () => {
      throw new Error('learning DB unavailable');
    });
    await f.evidence('verified');
    const atlas = await f.atlas();
    expect(atlas.sources.learning).toBe('unavailable');
    expect(atlas.counts.verifiedActivity).toBe(1);
  });
  it('persists server-owned six-slot showcase and rejects stale or unearned selections', async () => {
    const f = await fixture();
    await f.evidence('verified');
    await f.atlas();
    const send = (ids: string[], revision: number) =>
      request(f.app)
        .put('/api/development/v1/growth/showcase')
        .set('X-Demo-User', 'demo-student')
        .send({ ids, revision });
    await send(['first-step'], 0).expect(200);
    expect((await f.atlas()).showcaseIds).toEqual(['first-step']);
    await send([], 0).expect(409);
    await send(['learning-checkin-7'], 1).expect(400);
    await send(['first-step', 'first-step'], 1).expect(400);
    expect((await f.atlas('demo-captain')).showcaseIds).toEqual([]);
  });
  it('retains existing legacy badges explicitly as registration-based awards', async () => {
    const f = await fixture();
    const { registration } = await f.activity();
    await featureStorage(f.directory, 'achievement-atlas').change('demo-student', () => ({
      record: {
        id: 'demo-student',
        awards: {
          'first-step': {
            earnedAt: '2025-12-01T00:00:00Z',
            source: '旧版成长档案 · 已结束报名或核验记录',
          },
        },
        showcaseIds: [],
        revision: 0,
      },
      result: null,
    }));
    const first = (await f.atlas()).achievements.find((item) => item.id === 'first-step');
    expect(first?.unlocked).toBe(true);
    expect(first?.source).toContain('旧版');
    await f.store.activityRegistrations.update(registration.id, { status: 'cancelled' });
    const retained = (await f.atlas()).achievements.find((item) => item.id === 'first-step');
    expect(retained?.unlocked).toBe(true);
    expect(retained?.earnedAt).toBeTruthy();
  });
  it('imports stable Map commemorative badges without treating special landmarks as attendance', async () => {
    const f = await fixture();
    await f.evidence('origin', { type: 'special', title: '开端' });
    const atlas = await f.atlas();
    expect(atlas.counts.verifiedActivity).toBe(0);
    expect(atlas.achievements.find((item) => item.id === 'pioneer_call')?.unlocked).toBe(true);
  });
});
