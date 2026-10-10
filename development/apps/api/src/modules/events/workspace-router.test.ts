import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
const root = '/api/development/v1/events';
const ref = `${root}/workspaces/development_activity/activity-night-run`;
const as = (uid = 'demo-student') => ({ 'X-Demo-User': uid });
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'activity-workspaces-'));
  directories.push(directory);
  const store = createMemoryStore();
  await store.activities.update('activity-night-run', {
    organizationId: 'sports_center',
    endsAt: '2026-01-01T00:00:00.000Z',
    status: 'finished',
  });
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: new DemoAuthClient([
      'demo-student',
      'demo-admin',
      'demo-sports-member',
      'demo-arts-member',
    ]),
    collectionsUploadDirectory: directory,
  });
  return { app, store, directory };
}
const block = {
  id: 'intro',
  kind: 'paragraph',
  text: '一起记录我们的精彩',
  assetId: null,
  caption: '',
};
describe('activity workspace API', () => {
  it('returns the new lifecycle immediately when an explicit completion mark is cleared', async () => {
    const { store, directory } = await fixture();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
      collectionsUploadDirectory: directory,
      learningSurveyResolver: async (id) => ({
        id,
        title: '活动',
        description: '',
        opensAt: null,
        closesAt: null,
        status: 'published',
        requiresLogin: false,
      }),
    });
    const path = `${root}/workspaces/learning_survey/reset-completion`;
    expect(
      (
        await request(app)
          .put(`${path}/schedule`)
          .set(as('demo-admin'))
          .send({ revision: 0, startsAt: null, endsAt: null, finished: true })
          .expect(200)
      ).body.data.ended,
    ).toBe(true);
    const result = (
      await request(app)
        .put(`${path}/schedule`)
        .set(as('demo-admin'))
        .send({ revision: 1, startsAt: null, endsAt: null, finished: false })
        .expect(200)
    ).body.data;
    expect(result).toMatchObject({ ended: false, canRecap: false });
    expect(
      (await request(app).get(path).set(as('demo-admin')).expect(200)).body.data,
    ).toMatchObject({ ended: false, canRecap: false });
  });
  it('keeps learning and native registration closure separate from actual completion and limits learning editors', async () => {
    const { store, directory } = await fixture();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin', 'demo-sports-member', 'demo-student']),
      collectionsUploadDirectory: directory,
      learningSurveyResolver: async (id) => ({
        id,
        title: '公开报名',
        description: '分享活动',
        opensAt: null,
        closesAt: '2020-01-01T00:00:00Z',
        status: 'published',
        requiresLogin: false,
      }),
    });
    const learning = `${root}/workspaces/learning_survey/public-signup`;
    expect(
      (await request(app).get(learning).set(as('demo-sports-member')).expect(200)).body.data,
    ).toMatchObject({
      ended: false,
      canEdit: false,
      canRecap: false,
      activity: { status: 'closed', endsAt: null },
    });
    await request(app)
      .post(`${learning}/recaps`)
      .set(as('demo-admin'))
      .send({ revision: 0, title: '还未结束', blocks: [block] })
      .expect(409);
    await request(app)
      .put(`${learning}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, startsAt: null, endsAt: null, finished: true })
      .expect(200);
    await request(app)
      .post(`${learning}/recaps`)
      .set(as('demo-admin'))
      .send({ revision: 1, title: '真正结束后复盘', blocks: [block] })
      .expect(201);
    const native = `${root}/workspaces/native_collection/collection-autumn-workshop`;
    await store.collectionForms.update('collection-autumn-workshop', {
      closesAt: '2020-01-01T00:00:00Z',
    });
    expect(
      (await request(app).get(native).set(as('demo-admin')).expect(200)).body.data,
    ).toMatchObject({ ended: false, canRecap: false });
    await request(app)
      .put(`${native}/schedule`)
      .set(as('demo-admin'))
      .send({
        revision: 0,
        startsAt: '2020-01-01T10:00:00Z',
        endsAt: '2020-01-01T09:00:00Z',
        finished: false,
      })
      .expect(400);
    await request(app)
      .put(`${native}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, startsAt: null, endsAt: '2020-01-01T10:00:00Z', finished: false })
      .expect(200);
    expect(
      (await request(app).get(native).set(as('demo-admin')).expect(200)).body.data.canRecap,
    ).toBe(true);
  });
  it('rejects cross-organization edits and explicit update denies even for privileged members', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${ref}/intro`)
      .set(as('demo-arts-member'))
      .send({ revision: 0, blocks: [block] })
      .expect(403);
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'events.update',
      resource: 'activity',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await request(app)
      .put(`${ref}/intro`)
      .set(as('demo-sports-member'))
      .send({ revision: 0, blocks: [block] })
      .expect(403);
  });
  it('serializes simultaneous edits without losing data and keeps bookmark changes outside content revisions', async () => {
    const { app } = await fixture();
    const results = await Promise.all(
      ['first', 'second'].map((text) =>
        request(app)
          .put(`${ref}/intro`)
          .set(as('demo-sports-member'))
          .send({ revision: 0, blocks: [{ ...block, text }] }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await request(app).put(`${ref}/following`).set(as()).send({ following: true }).expect(200);
    const saved = (await request(app).get(ref).set(as()).expect(200)).body.data;
    expect(saved.revision).toBe(1);
    expect(saved.intro[0].text).toBe(
      results.find((r) => r.status === 200)!.body.data.intro[0].text,
    );
  });
  it('supports timeline edits, deletion and own inbox pagination/read-all without changing another user', async () => {
    const { app } = await fixture();
    await request(app).put(`${ref}/following`).set(as()).send({ following: true }).expect(200);
    await request(app)
      .put(`${ref}/following`)
      .set(as('demo-arts-member'))
      .send({ following: true })
      .expect(200);
    const update = (
      await request(app)
        .post(`${ref}/updates`)
        .set(as('demo-sports-member'))
        .send({ revision: 0, label: '开放报名', occursAt: '2026-10-09T09:00:00Z', description: '' })
        .expect(201)
    ).body.data.updates[0];
    await request(app)
      .patch(`${ref}/updates/${update.id}`)
      .set(as('demo-sports-member'))
      .send({
        revision: 1,
        label: '报名延期',
        occursAt: '2026-10-10T09:00:00Z',
        description: '延长一天',
      })
      .expect(200);
    const first = (await request(app).get(`${root}/notifications?limit=1`).set(as()).expect(200))
      .body.data;
    expect(first.nextCursor).toBeTruthy();
    const second = (
      await request(app)
        .get(`${root}/notifications?limit=1&before=${encodeURIComponent(first.nextCursor)}`)
        .set(as())
        .expect(200)
    ).body.data;
    expect(second.notifications[0].id).not.toBe(first.notifications[0].id);
    await request(app).post(`${root}/notifications/read-all`).set(as()).send({}).expect(200);
    expect(
      (await request(app).get(`${root}/notifications`).set(as()).expect(200)).body.data.unreadCount,
    ).toBe(0);
    expect(
      (await request(app).get(`${root}/notifications`).set(as('demo-arts-member')).expect(200)).body
        .data.unreadCount,
    ).toBe(2);
    await request(app)
      .delete(`${ref}/updates/${update.id}`)
      .set(as('demo-sports-member'))
      .send({ revision: 2 })
      .expect(200);
    expect((await request(app).get(ref).set(as()).expect(200)).body.data.updates).toHaveLength(0);
  });
  it('allows readable finished content and member editing, rejects ordinary writes and stale revisions', async () => {
    const { app } = await fixture();
    await request(app).get(ref).expect(401);
    expect((await request(app).get(ref).set(as()).expect(200)).body.data).toMatchObject({
      ended: true,
      canEdit: false,
      canRecap: false,
      revision: 0,
    });
    await request(app)
      .put(`${ref}/intro`)
      .set(as())
      .send({ revision: 0, blocks: [block] })
      .expect(403);
    expect(
      (
        await request(app)
          .put(`${ref}/intro`)
          .set(as('demo-sports-member'))
          .send({ revision: 0, blocks: [block] })
          .expect(200)
      ).body.data,
    ).toMatchObject({ revision: 1, intro: [block], canEdit: true, canRecap: true });
    await request(app)
      .put(`${ref}/intro`)
      .set(as('demo-sports-member'))
      .send({ revision: 0, blocks: [] })
      .expect(409);
    expect((await request(app).get(ref).set(as()).expect(200)).body.data.intro).toEqual([block]);
  });
  it('allows custom timeline and recap after completion, not merely expired registration', async () => {
    const { app, store } = await fixture();
    const update = await request(app)
      .post(`${ref}/updates`)
      .set(as('demo-sports-member'))
      .send({
        revision: 0,
        label: '决赛精彩回顾',
        occursAt: '2026-10-01T18:00:00+08:00',
        description: '感谢大家参与',
      })
      .expect(201);
    expect(update.body.data.updates[0]).toMatchObject({
      label: '决赛精彩回顾',
      authorUid: 'demo-sports-member',
    });
    expect(
      (
        await request(app)
          .post(`${ref}/recaps`)
          .set(as('demo-sports-member'))
          .send({ revision: 1, title: '赛后复盘', blocks: [block] })
          .expect(201)
      ).body.data.recaps[0].title,
    ).toBe('赛后复盘');
    await store.activities.update('activity-night-run', {
      status: 'published',
      endsAt: '2099-01-01T00:00:00Z',
      registrationDeadline: '2020-01-01T00:00:00Z',
    });
    expect(
      (await request(app).get(ref).set(as('demo-sports-member')).expect(200)).body.data.canRecap,
    ).toBe(false);
    await request(app)
      .post(`${ref}/recaps`)
      .set(as('demo-sports-member'))
      .send({ revision: 2, title: '不能提前复盘', blocks: [block] })
      .expect(409);
  });
  it('follows idempotently, notifies only subscribed users and stops future notifications after unfollow', async () => {
    const { app } = await fixture();
    await request(app).put(`${ref}/following`).set(as()).send({ following: true }).expect(200);
    await request(app).put(`${ref}/following`).set(as()).send({ following: true }).expect(200);
    await request(app)
      .post(`${ref}/updates`)
      .set(as('demo-sports-member'))
      .send({
        revision: 0,
        label: '复盘发布',
        occursAt: '2026-10-09T09:00:00Z',
        description: '来看看本次活动',
      })
      .expect(201);
    const inbox = (await request(app).get(`${root}/notifications`).set(as()).expect(200)).body.data;
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.notifications).toHaveLength(1);
    expect(inbox.notifications[0].link).toBe(
      '/development/collections/activities/development_activity/activity-night-run',
    );
    expect(
      (await request(app).get(`${root}/notifications`).set(as('demo-arts-member')).expect(200)).body
        .data.unreadCount,
    ).toBe(0);
    const notice = inbox.notifications[0];
    await request(app)
      .post(`${root}/notifications/development_activity/activity-night-run/${notice.id}/read`)
      .set(as('demo-arts-member'))
      .send({})
      .expect(404);
    await request(app)
      .post(`${root}/notifications/development_activity/activity-night-run/${notice.id}/read`)
      .set(as())
      .send({})
      .expect(200);
    expect(
      (await request(app).get(`${root}/notifications`).set(as()).expect(200)).body.data.unreadCount,
    ).toBe(0);
    await request(app).put(`${ref}/following`).set(as()).send({ following: false }).expect(200);
    await request(app)
      .post(`${ref}/updates`)
      .set(as('demo-sports-member'))
      .send({ revision: 1, label: '后续安排', occursAt: '2026-10-10T09:00:00Z', description: '' })
      .expect(201);
    expect(
      (await request(app).get(`${root}/notifications`).set(as()).expect(200)).body.data
        .notifications,
    ).toHaveLength(1);
  });
  it('persists across app recreation and rechecks current scope before showing notifications', async () => {
    const { app, store, directory } = await fixture();
    await request(app).put(`${ref}/following`).set(as()).send({ following: true }).expect(200);
    await request(app)
      .post(`${ref}/updates`)
      .set(as('demo-admin'))
      .send({ revision: 0, label: '新动态', occursAt: '2026-10-09T09:00:00Z', description: '' })
      .expect(201);
    const restarted = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-admin']),
      collectionsUploadDirectory: directory,
    });
    expect(
      (await request(restarted).get(ref).set(as()).expect(200)).body.data.updates,
    ).toHaveLength(1);
    expect(
      (await request(restarted).get(`${root}/notifications`).set(as()).expect(200)).body.data
        .unreadCount,
    ).toBe(1);
    await store.activities.update('activity-night-run', {
      scope: { type: 'organization', id: 'private' },
    });
    await request(app).get(ref).set(as()).expect(404);
    expect(
      (await request(app).get(`${root}/notifications`).set(as()).expect(200)).body.data
        .notifications,
    ).toHaveLength(0);
  });
  it('validates image signatures and ownership, protects uploaded media', async () => {
    const { app } = await fixture();
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/fcAAAAASUVORK5CYII=',
      'base64',
    );
    await request(app)
      .post(`${ref}/assets`)
      .set(as('demo-sports-member'))
      .attach('file', Buffer.from('<script>bad</script>'), {
        filename: 'bad.png',
        contentType: 'image/png',
      })
      .expect(400);
    const asset = (
      await request(app)
        .post(`${ref}/assets`)
        .set(as('demo-sports-member'))
        .attach('file', image, { filename: '小羊.png', contentType: 'image/png' })
        .expect(201)
    ).body.data;
    expect(asset.name).toBe('小羊.png');
    await request(app).get(asset.url).expect(401);
    const media = await request(app).get(asset.url).set(as()).expect(200);
    expect(media.headers['content-type']).toContain('image/png');
    expect(media.body).toEqual(image);
    await request(app)
      .put(`${ref}/intro`)
      .set(as('demo-sports-member'))
      .send({ revision: 0, blocks: [{ ...block, kind: 'image', assetId: 'not-owned' }] })
      .expect(400);
    await request(app)
      .put(`${ref}/intro`)
      .set(as('demo-sports-member'))
      .send({ revision: 0, blocks: [{ ...block, kind: 'image', assetId: asset.id }] })
      .expect(200);
  });
});
