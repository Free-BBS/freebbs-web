import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AchievementAtlas,
  CommunityContentStatus,
  CommunityPostKind,
  FestivalSubmission,
  LearningAchievementEvidence,
  MapEvidence,
} from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { changeActivityWorkspace } from '../events/workspace-storage.js';
import { createAtlasService } from './atlas-service.js';

const miniappIds = [
  'first-step',
  'steady-explorer',
  'ten-steps',
  'two-domains',
  'multi-domain',
  'two-months',
  'three-months',
  'map-landmarks-3',
  'map-night',
  'pioneer_call',
];
const paths: string[] = [];
afterEach(async () => {
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});

async function fixture(learning?: LearningAchievementEvidence) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-refinement-'));
  paths.push(directory);
  const store = createMemoryStore({ seed: false });
  const service = createAtlasService({
    store,
    uploadDirectory: directory,
    environment: { DEVELOPMENT_MAP_INGEST_TOKEN: 'test-only' },
    now: () => new Date('2026-10-12T00:00:00Z'),
    ...(learning ? { learningAchievementProvider: async () => learning } : {}),
  });
  const atlas = () => service.getAtlas('student');
  async function evidence(id: string, extra: Partial<MapEvidence> = {}) {
    const value: MapEvidence = {
      id,
      uid: 'student',
      subjectHash: 'trusted-owner',
      landmarkId: id,
      periodId: '2026_autumn',
      type: 'landmark',
      title: id,
      domain: 'other',
      occurredAt: '2026-10-01T03:00:00Z',
      updatedAt: '2026-10-01T03:00:00Z',
      ...extra,
    };
    await featureStorage<MapEvidence>(directory, 'map-evidence').change(id, () => ({
      record: value,
      result: null,
    }));
  }
  async function activity(
    ownerUid = 'student',
    status = 'finished',
    endsAt = '2026-10-01T00:00:00Z',
  ) {
    return store.activities.create({
      title: '有记录的活动',
      description: '',
      status,
      endsAt,
      ownerUid,
      organizationId: 'sports_center',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      scope: { type: 'public', id: '*' },
    });
  }
  async function recap(activityId: string, authorUid = 'student', blocks = true) {
    await changeActivityWorkspace(directory, 'development_activity', activityId, (workspace) => {
      workspace.recaps.push({
        id: `recap-${workspace.recaps.length}`,
        title: '复盘',
        authorUid,
        blocks: blocks
          ? [{ id: 'paragraph', kind: 'paragraph', text: '活动收获', assetId: null, caption: '' }]
          : [],
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      });
    });
  }
  async function post(
    status: CommunityContentStatus = 'active',
    ownerUid = 'student',
    kind: CommunityPostKind = 'daily',
  ) {
    return store.communityPosts.create({
      kind,
      title: '原创记录',
      body: '内容',
      tags: [],
      displayMode: 'named',
      sourceType: null,
      sourceId: null,
      status,
      ownerUid,
      scope: { type: 'public', id: '*' },
    });
  }
  async function festival(status: FestivalSubmission['status'], ownerUid = 'student') {
    return store.festivalSubmissions.create({
      title: '春晚投稿',
      description: '',
      authorName: '本人',
      ownerUid,
      status,
      displayConsent: false,
      mimeType: 'audio/mpeg',
      sizeBytes: 1,
      reviewedAt: null,
      reviewNote: '',
      storageKey: 'test-owned-festival',
      scope: { type: 'private', id: ownerUid },
    });
  }
  async function awards(ids: string[], showcaseIds: Array<string | null> = []) {
    await featureStorage(directory, 'achievement-atlas').change('student', () => ({
      record: {
        id: 'student',
        awards: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              earnedAt: '2025-01-01T00:00:00Z',
              source: '已拥有的历史奖励',
            },
          ]),
        ),
        showcaseIds,
        revision: 0,
      },
      result: null,
    }));
  }
  return { directory, store, service, atlas, evidence, activity, recap, post, festival, awards };
}
const learning = { checkinDays: 30, circuitCleared: 1, circuitTotal: 5, ownedAchievementIds: [] };
const badge = (atlas: AchievementAtlas, id: string) =>
  atlas.achievements.find((item) => item.id === id);

describe('refined achievement evidence and catalogs', () => {
  it('places shared platform checkins in daily while keeping circuits in learning', async () => {
    const f = await fixture(learning);
    await f.awards(['learning-checkin-1']);
    const data = await f.atlas();
    for (const days of [1, 7, 30]) {
      expect(badge(data, `learning-checkin-${days}`)).toMatchObject({
        family: 'daily',
        source: '平台每日签到，学习端与发展端共用',
        unlocked: true,
      });
      expect(badge(data, `learning-checkin-${days}`)?.description).toContain('平台每日签到');
    }
    expect(badge(data, 'learning-circuit-first')).toMatchObject({ family: 'learning' });
  });

  it('projects exactly ten current miniapp badges without downloading learning history', async () => {
    const f = await fixture(learning);
    expect(typeof f.service.getMiniappAtlas).toBe('function');
    const data = await f.service.getMiniappAtlas('student');
    expect(data.achievements.map((item) => item.id)).toEqual(miniappIds);
    expect(data.achievements.every((item) => ['campus', 'map'].includes(item.family))).toBe(true);
    expect(data.showcaseAchievements).toEqual([]);
    expect(data.archivedAchievements).toEqual([]);
  });

  it('removes old Map cards from the current catalog and keeps only earned archived badges', async () => {
    const f = await fixture();
    await f.awards(['builder'], ['builder', null]);
    await f.evidence('old-history', { mapBadgeIds: ['sports_debut'] });
    const data = await f.atlas();
    expect(
      data.achievements.filter((item) => item.family === 'map').map((item) => item.id),
    ).toEqual(['map-landmarks-3', 'map-night', 'pioneer_call']);
    expect(data.archivedAchievements?.map((item) => item.id)).toEqual(['builder', 'sports_debut']);
    expect(data.archivedAchievements?.every((item) => item.unlocked && item.earnedAt)).toBe(true);
    expect(data.showcaseAchievements?.map((item) => item.id)).toEqual(['builder']);
    expect(typeof f.service.saveMiniappShowcase).toBe('function');
    const saved = await f.service.saveMiniappShowcase(
      'student',
      ['sports_debut', null, 'builder'],
      0,
    );
    expect(saved.showcaseIds).toEqual(['sports_debut', null, 'builder']);
    expect(saved.showcaseAchievements?.map((item) => item.id)).toEqual(['sports_debut', 'builder']);
    await expect(f.service.saveShowcase('student', ['erudite'], 1)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('counts three distinct ordinary landmarks across periods, excluding special and activity points', async () => {
    const f = await fixture();
    await f.evidence('p1', { landmarkId: 'library' });
    await f.evidence('p2', { landmarkId: 'library', periodId: '2026_winter' });
    await f.evidence('p3', { landmarkId: 'hall' });
    await f.evidence('special', { type: 'special' });
    await f.evidence('activity', { type: 'activity' });
    await f.evidence('other-account', { uid: 'another-user' });
    await f.evidence('future', { occurredAt: '2999-01-01T00:00:00Z' });
    expect(badge(await f.atlas(), 'map-landmarks-3')).toMatchObject({
      progress: 2,
      unlocked: false,
    });
    await f.evidence('p4', { landmarkId: 'garden' });
    expect(badge(await f.atlas(), 'map-landmarks-3')).toMatchObject({
      progress: 3,
      unlocked: true,
    });
  });

  it.each([
    ['2026-10-01T11:59:59Z', false],
    ['2026-10-01T12:00:00Z', true],
    ['2026-10-01T21:59:59Z', true],
    ['2026-10-01T22:00:00Z', false],
    ['2026-10-02T00:00:00+08:00', true],
  ])(
    'uses the Beijing 20:00 inclusive / 06:00 exclusive night boundary for %s',
    async (occurredAt, unlocked) => {
      const f = await fixture();
      await f.evidence('point', { occurredAt });
      expect(badge(await f.atlas(), 'map-night')?.unlocked).toBe(unlocked);
    },
  );

  it('rejects future and foreign night evidence and badge-ID-only pioneer grants', async () => {
    const f = await fixture();
    await f.evidence('foreign-night', { uid: 'another-user', occurredAt: '2026-10-01T12:00:00Z' });
    await f.evidence('future-night', { occurredAt: '2999-01-01T12:00:00Z' });
    await f.evidence('not-origin', {
      type: 'special',
      title: '其他纪念点',
      mapBadgeIds: ['pioneer_call'],
    });
    await f.evidence('wrong-origin-type', { title: '开端' });
    expect(badge(await f.atlas(), 'map-night')?.unlocked).toBe(false);
    expect(badge(await f.atlas(), 'pioneer_call')).toMatchObject({
      title: '开端',
      unlocked: false,
    });
    await f.evidence('origin', { type: 'special', title: '开端' });
    expect(badge(await f.atlas(), 'pioneer_call')?.unlocked).toBe(true);
  });

  it('requires a valid cleared circuit and verified participation for cross exploration', async () => {
    const f = await fixture(learning);
    const activity = await f.activity();
    await f.store.activityRegistrations.create({
      activityId: activity.id,
      participantUid: 'student',
      status: 'registered',
      ownerUid: 'student',
      scope: { type: 'activity', id: activity.id },
    });
    const before = await f.atlas();
    expect(badge(before, 'first-step')?.unlocked).toBe(false);
    expect(badge(before, 'cross-learning-campus')).toMatchObject({
      progress: 1,
      target: 2,
      unlocked: false,
    });
    await f.evidence('verified', { type: 'activity', activityId: activity.id });
    expect(badge(await f.atlas(), 'cross-learning-campus')?.unlocked).toBe(true);
    const emptyCircuit = await fixture({
      ...learning,
      circuitCleared: 0,
      ownedAchievementIds: ['plate_circuit_master'],
    });
    await emptyCircuit.evidence('verified', { type: 'activity' });
    expect(badge(await emptyCircuit.atlas(), 'cross-learning-campus')?.unlocked).toBe(false);
  });

  it('requires an owned approved festival submission and an active original post for expression', async () => {
    const f = await fixture();
    await f.festival('pending');
    await f.festival('approved', 'another-user');
    await f.post('hidden');
    await f.post('active', 'another-user');
    await f.post('active', 'student', 'festival_showcase');
    expect(badge(await f.atlas(), 'cross-stage-expression')).toMatchObject({
      progress: 0,
      target: 2,
      unlocked: false,
    });
    await f.festival('approved');
    expect(badge(await f.atlas(), 'cross-stage-expression')?.unlocked).toBe(false);
    await f.post();
    expect(badge(await f.atlas(), 'cross-stage-expression')?.unlocked).toBe(true);
  });

  it('requires the owner to recap their own published ended activity to finish an organizer journey', async () => {
    const f = await fixture();
    const own = await f.activity();
    const foreign = await f.activity('another-user');
    const draft = await f.activity('student', 'draft');
    const future = await f.activity('student', 'published', '2999-01-01T00:00:00Z');
    await f.recap(own.id, 'another-user');
    await f.recap(own.id, 'student', false);
    await f.recap(foreign.id);
    await f.recap(draft.id);
    await f.recap(future.id);
    expect(badge(await f.atlas(), 'cross-organizer-recap')?.unlocked).toBe(false);
    await f.recap(own.id);
    expect(badge(await f.atlas(), 'cross-organizer-recap')?.unlocked).toBe(true);
  });

  it('keeps earned web-only showcase metadata and all null slots in a thin miniapp response', async () => {
    const f = await fixture();
    const post = await f.post();
    const full = await f.atlas();
    await f.store.communityPosts.update(post.id, { status: 'hidden' });
    expect(typeof f.service.saveMiniappShowcase).toBe('function');
    const data = await f.service.saveMiniappShowcase(
      'student',
      [null, 'creation-first-post', null],
      full.showcaseRevision,
    );
    expect(data.achievements.map((item) => item.id)).toEqual(miniappIds);
    expect(data.showcaseIds).toEqual([null, 'creation-first-post', null]);
    expect(data.showcaseAchievements).toHaveLength(1);
    expect(data.showcaseAchievements?.[0]).toMatchObject({
      id: 'creation-first-post',
      unlocked: true,
      earnedAt: expect.any(String),
    });
    await expect(f.service.saveMiniappShowcase('student', [], 0)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.service.saveMiniappShowcase('student', ['creation-first-post', 'creation-first-post'], 1),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.saveMiniappShowcase('student', Array(7).fill(null), 1),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.saveMiniappShowcase('student', ['learning-checkin-30'], 1),
    ).rejects.toMatchObject({ status: 400 });
    expect((await f.service.getMiniappAtlas('another-user')).showcaseAchievements).toEqual([]);
  });
});
