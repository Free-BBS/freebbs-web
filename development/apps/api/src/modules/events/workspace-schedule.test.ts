import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';

const root = '/api/development/v1';
const id = 'activity-night-run';
const workspace = `${root}/events/workspaces/development_activity/${id}`;
const event = `${root}/events/activities/${id}`;
const as = (uid = 'demo-student') => ({ 'X-Demo-User': uid });
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture(deadline: string | null = null) {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-schedule-'));
  directories.push(directory);
  const store = createMemoryStore();
  await store.activities.update(id, {
    status: 'published',
    startsAt: null,
    endsAt: '2020-01-01T00:00:00Z',
    registrationDeadline: deadline,
    capacity: 2,
  });
  const options = {
    store,
    authMode: 'demo' as const,
    authClient: new DemoAuthClient(['demo-admin', 'demo-student', 'demo-arts-member']),
    collectionsUploadDirectory: directory,
  };
  return { store, options, app: createApp(options) };
}
const future = { startsAt: null, endsAt: '2099-01-01T00:00:00Z', finished: false };

describe('authoritative workspace event schedules over HTTP', () => {
  it('archives an activity completed in its workspace using the same status shown by management', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future, finished: true })
      .expect(200);
    const finished = (
      await request(app)
        .get(`${root}/events/activities?status=finished`)
        .set(as('demo-admin'))
        .expect(200)
    ).body.data;
    expect(finished.find((item: { id: string }) => item.id === id)?.status).toBe('finished');
    const archived = (
      await request(app)
        .post(`${event}/transitions`)
        .set(as('demo-admin'))
        .send({ to: 'archived' })
        .expect(200)
    ).body.data;
    expect(archived).toMatchObject({ status: 'archived', endsAt: future.endsAt });
    expect((await store.activities.get(id))?.status).toBe('archived');
    expect((await request(app).get(event).set(as()).expect(200)).body.data.status).toBe('archived');
    const cleared = (
      await request(app)
        .put(`${workspace}/schedule`)
        .set(as('demo-admin'))
        .send({ revision: 1, ...future })
        .expect(200)
    ).body.data;
    expect(cleared).toMatchObject({ ended: true, activity: { activityStatus: 'archived' } });
    await request(app).post(`${event}/registrations`).set(as()).send({}).expect(409);
  });
  it('does not archive a published activity after its workspace completion is cleared', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future, finished: true })
      .expect(200);
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 1, ...future })
      .expect(200);
    await request(app)
      .post(`${event}/transitions`)
      .set(as('demo-admin'))
      .send({ to: 'archived' })
      .expect(409);
    expect((await store.activities.get(id))?.status).toBe('published');
  });
  it.each(['draft', 'pending', 'approved', 'rejected'] as const)(
    'does not let a completion overlay bypass the %s workflow',
    async (status) => {
      const { app, store } = await fixture();
      await request(app)
        .put(`${workspace}/schedule`)
        .set(as('demo-admin'))
        .send({ revision: 0, ...future, finished: true })
        .expect(200);
      await store.activities.update(id, { status });
      await request(app)
        .post(`${event}/transitions`)
        .set(as('demo-admin'))
        .send({ to: 'archived' })
        .expect(409);
      expect((await store.activities.get(id))?.status).toBe(status);
    },
  );
  it('keeps the original archive authorization after workspace completion', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future, finished: true })
      .expect(200);
    await request(app).post(`${event}/transitions`).set(as()).send({ to: 'archived' }).expect(404);
    expect((await store.activities.get(id))?.status).toBe('published');
  });
  it.each([null, '2099-01-01T00:00:00Z'])(
    'extends an expired published activity with signup deadline %s across every read and registration after restart',
    async (deadline) => {
      const { app, options } = await fixture(deadline);
      const saved = (
        await request(app)
          .put(`${workspace}/schedule`)
          .set(as('demo-admin'))
          .send({ revision: 0, ...future })
          .expect(200)
      ).body.data;
      expect(saved).toMatchObject({ ended: false, canRecap: false, schedule: future });
      expect(saved.activity).toMatchObject({
        endsAt: future.endsAt,
        activityStatus: 'published',
        status: 'open',
      });
      const restarted = createApp(options);
      expect(
        (await request(restarted).get(workspace).set(as()).expect(200)).body.data,
      ).toMatchObject({ ended: false, canRecap: false });
      expect((await request(restarted).get(event).set(as()).expect(200)).body.data).toMatchObject({
        endsAt: future.endsAt,
        status: 'published',
      });
      const list = (await request(restarted).get(`${root}/events/activities`).set(as()).expect(200))
        .body.data;
      expect(list.find((item: { id: string }) => item.id === id)).toMatchObject({
        endsAt: future.endsAt,
      });
      const catalog = (
        await request(restarted)
          .get(`${root}/collections/registrations?includePast=true`)
          .set(as())
          .expect(200)
      ).body.data;
      expect(catalog.find((item: { id: string }) => item.id === id)).toMatchObject({
        endsAt: future.endsAt,
        status: 'open',
      });
      const department = (
        await request(restarted)
          .get(`${root}/organizations/student_union/sports_center/activities`)
          .set(as())
          .expect(200)
      ).body.data;
      expect(department.active.find((item: { id: string }) => item.id === id)).toMatchObject({
        endsAt: future.endsAt,
      });
      await request(restarted).post(`${event}/registrations`).set(as()).send({}).expect(201);
      await request(restarted)
        .post(`${event}/registrations`)
        .set(as('demo-arts-member'))
        .send({})
        .expect(409);
    },
  );

  it('closes registration immediately after an earlier end and keeps stale schedule revisions ineffective', async () => {
    const { app, store } = await fixture();
    await store.activities.update(id, { endsAt: future.endsAt });
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future })
      .expect(200);
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 1, ...future, endsAt: '2020-02-01T00:00:00Z' })
      .expect(200);
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 1, ...future })
      .expect(409);
    expect((await request(app).get(workspace).set(as()).expect(200)).body.data).toMatchObject({
      ended: true,
      revision: 2,
    });
    expect((await request(app).get(event).set(as()).expect(200)).body.data.endsAt).toBe(
      '2020-02-01T00:00:00Z',
    );
    expect(
      (await request(app).post(`${event}/registrations`).set(as()).send({}).expect(409)).body.data
        .error.code,
    ).toBe('activity_registration_closed');
  });

  it('allows clearing workspace completion but preserves explicit source completion and expired signup deadlines', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future, finished: true })
      .expect(200);
    expect(
      (await request(app).post(`${event}/registrations`).set(as()).send({}).expect(409)).body.data
        .error.code,
    ).toBe('activity_not_published');
    const reset = (
      await request(app)
        .put(`${workspace}/schedule`)
        .set(as('demo-admin'))
        .send({ revision: 1, ...future })
        .expect(200)
    ).body.data;
    expect(reset).toMatchObject({ ended: false, canRecap: false });
    await store.activities.update(id, { registrationDeadline: '2020-01-01T00:00:00Z' });
    await request(app).post(`${event}/registrations`).set(as()).send({}).expect(409);
    await store.activities.update(id, { status: 'finished', registrationDeadline: null });
    expect(
      (
        await request(app)
          .put(`${workspace}/schedule`)
          .set(as('demo-admin'))
          .send({ revision: 2, ...future })
          .expect(200)
      ).body.data.ended,
    ).toBe(true);
    await request(app).post(`${event}/registrations`).set(as()).send({}).expect(409);
  });

  it('keeps an elapsed date distinct from an explicit completion mark', async () => {
    const { app } = await fixture();
    expect(
      (await request(app).get(workspace).set(as('demo-admin')).expect(200)).body.data,
    ).toMatchObject({ ended: true, schedule: { finished: false } });
  });

  it('rejects legacy date edits after a workspace schedule exists without accepting a shadowed update', async () => {
    const { app } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future })
      .expect(200);
    const result = await request(app)
      .patch(`${root}/events/activities`)
      .set(as('demo-admin'))
      .send({ id, endsAt: '2080-01-01T00:00:00Z' })
      .expect(409);
    expect(result.body.data.error.code).toBe('activity_schedule_managed');
    expect((await request(app).get(event).set(as()).expect(200)).body.data.endsAt).toBe(
      future.endsAt,
    );
    await request(app)
      .patch(`${root}/events/activities`)
      .set(as('demo-admin'))
      .send({ id, capacity: 3 })
      .expect(200);
    expect((await request(app).get(event).set(as()).expect(200)).body.data.capacity).toBe(3);
  });

  it('filters legacy lists using effective workspace completion', async () => {
    const { app } = await fixture();
    await request(app)
      .put(`${workspace}/schedule`)
      .set(as('demo-admin'))
      .send({ revision: 0, ...future, finished: true })
      .expect(200);
    const finished = (
      await request(app).get(`${root}/events/activities?status=finished`).set(as()).expect(200)
    ).body.data;
    const published = (
      await request(app).get(`${root}/events/activities?status=published`).set(as()).expect(200)
    ).body.data;
    expect(finished.some((item: { id: string }) => item.id === id)).toBe(true);
    expect(published.some((item: { id: string }) => item.id === id)).toBe(false);
  });

  it('exposes native actual event dates without changing the signup window', async () => {
    const { app, store } = await fixture();
    const nativeId = 'collection-autumn-workshop';
    await store.collectionForms.update(nativeId, { opensAt: null, closesAt: null });
    const native = `${root}/events/workspaces/native_collection/${nativeId}`;
    await request(app)
      .put(`${native}/schedule`)
      .set(as('demo-admin'))
      .send({
        revision: 0,
        startsAt: '2020-01-01T00:00:00Z',
        endsAt: '2020-02-01T00:00:00Z',
        finished: false,
      })
      .expect(200);
    const catalog = (
      await request(app)
        .get(`${root}/collections/registrations?includePast=true`)
        .set(as())
        .expect(200)
    ).body.data;
    expect(catalog.find((item: { id: string }) => item.id === nativeId)).toMatchObject({
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-02-01T00:00:00Z',
      status: 'open',
    });
  });
});
