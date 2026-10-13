import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AchievementAtlas } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';

const root = '/api/development/v1';
const admin = { 'X-Demo-User': 'demo-admin' };
const future = '2999-01-01T00:00:00Z';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(source: 'development_activity' | 'native_collection') {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-completion-'));
  directories.push(directory);
  const app = createApp({
    store: createMemoryStore(),
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin', 'demo-student']),
    collectionsUploadDirectory: directory,
    environment: { NODE_ENV: 'test', AUTH_MODE: 'demo', DATA_MODE: 'memory' },
  });
  const atlas = async (uid = 'demo-admin'): Promise<AchievementAtlas> =>
    (await request(app).get(`${root}/growth/atlas`).set('X-Demo-User', uid).expect(200)).body.data;
  const baseline = await atlas();
  let id: string;
  if (source === 'development_activity') {
    id = (
      await request(app)
        .post(`${root}/events/activities`)
        .set(admin)
        .send({ title: '提前结束的活动', description: '活动复盘回归', endsAt: future })
        .expect(201)
    ).body.data.id;
    for (const to of ['pending', 'approved', 'published'])
      await request(app)
        .post(`${root}/events/activities/${id}/transitions`)
        .set(admin)
        .send({ to })
        .expect(200);
    await request(app)
      .post(`${root}/events/activities/${id}/registrations`)
      .set(admin)
      .send({})
      .expect(201);
  } else {
    const schema = {
      title: '提前结束的报名表活动',
      description: '活动复盘回归',
      fields: [
        { id: 'note', kind: 'short_text', label: '报名备注', helpText: '', options: [], rules: [] },
      ],
      formRules: [],
      outputs: [],
    };
    id = (
      await request(app)
        .post(`${root}/collections/forms`)
        .set(admin)
        .send({ title: schema.title, description: schema.description, schema })
        .expect(201)
    ).body.data.id;
    await request(app)
      .post(`${root}/collections/forms/${id}/publish`)
      .set(admin)
      .send({})
      .expect(200);
    await request(app)
      .post(`${root}/collections/forms/${id}/responses`)
      .set(admin)
      .send({ answers: { note: '本人报名' } })
      .expect(201);
  }
  const workspace = `${root}/events/workspaces/${source}/${id}`;
  const schedule = async (finished: boolean, endsAt = future, revision = 0) =>
    (
      await request(app)
        .put(`${workspace}/schedule`)
        .set(admin)
        .send({ revision, startsAt: null, endsAt, finished })
        .expect(200)
    ).body.data;
  const recap = () =>
    request(app)
      .post(`${workspace}/recaps`)
      .set(admin)
      .send({
        revision: 1,
        title: '本人活动复盘',
        blocks: [
          {
            id: 'reflection',
            kind: 'paragraph',
            text: '活动已完成，记录真实收获。',
            assetId: null,
            caption: '',
          },
        ],
      });
  return { app, id, atlas, baseline, workspace, schedule, recap };
}

describe('completed activity achievement flows', () => {
  it.each([
    ['development_activity', 'schedule'],
    ['native_collection', 'schedule'],
    ['development_activity', 'finished'],
    ['development_activity', 'archived'],
  ] as const)(
    'counts signup and owner recaps for %s ended by %s before its planned date',
    async (source, completion) => {
      const f = await fixture(source);
      expect((await f.atlas()).counts.registration).toBe(f.baseline.counts.registration);
      await f.schedule(completion === 'schedule');
      if (completion !== 'schedule') {
        for (const to of completion === 'archived' ? ['finished', 'archived'] : ['finished'])
          await request(f.app)
            .post(`${root}/events/activities/${f.id}/transitions`)
            .set(admin)
            .send({ to })
            .expect(200);
      }
      const workspace = (await request(f.app).get(f.workspace).set(admin).expect(200)).body.data;
      expect(workspace).toMatchObject({
        ended: true,
        canRecap: true,
        schedule: { endsAt: future },
      });
      await f.recap().expect(201);
      const atlas = await f.atlas();
      expect(atlas.counts.registration).toBe(f.baseline.counts.registration + 1);
      expect(atlas.counts.verifiedActivity).toBe(f.baseline.counts.verifiedActivity);
      for (const id of ['contribution-recap', 'cross-organizer-recap'])
        expect(atlas.achievements.find((badge) => badge.id === id)).toMatchObject({
          progress: 1,
          unlocked: true,
        });
      const other = await f.atlas('demo-student');
      for (const id of ['contribution-recap', 'cross-organizer-recap'])
        expect(other.achievements.find((badge) => badge.id === id)?.unlocked).toBe(false);
    },
  );

  it.each(['development_activity', 'native_collection'] as const)(
    'does not count a future unfinished %s or allow an early recap',
    async (source) => {
      const f = await fixture(source);
      expect(await f.schedule(false)).toMatchObject({ ended: false, canRecap: false });
      await f.recap().expect(409);
      const atlas = await f.atlas();
      expect(atlas.counts.registration).toBe(f.baseline.counts.registration);
      for (const id of ['contribution-recap', 'cross-organizer-recap'])
        expect(atlas.achievements.find((badge) => badge.id === id)?.unlocked).toBe(false);
    },
  );

  it.each(['development_activity', 'native_collection'] as const)(
    'uses the elapsed date when %s has no explicit completion',
    async (source) => {
      const f = await fixture(source);
      expect(await f.schedule(false, '2020-01-01T00:00:00Z')).toMatchObject({
        ended: true,
        canRecap: true,
      });
      await f.recap().expect(201);
      const atlas = await f.atlas();
      expect(atlas.counts.registration).toBe(f.baseline.counts.registration + 1);
      expect(
        atlas.achievements.find((badge) => badge.id === 'cross-organizer-recap')?.unlocked,
      ).toBe(true);
    },
  );
});
