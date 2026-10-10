import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DEPARTMENT_DIRECTORY, type RoleKey } from '@freebbs-development/contracts';
import { listRegistrations } from './registrations.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';

const member = { 'X-Demo-User': 'demo-rights-member' };
const student = { 'X-Demo-User': 'demo-student' };
const home = '/api/development/v1/organizations/student_union/rights_development_center/home';
const activities = home.replace('/home', '/activities');
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'department-home-'));
  directories.push(directory);
  const store = createMemoryStore();
  const options = {
    store,
    authMode: 'demo' as const,
    authClient: new DemoAuthClient(['demo-rights-member', 'demo-student', 'demo-admin']),
    collectionsUploadDirectory: directory,
  };
  return { store, options, app: createApp(options) };
}
const schema = {
  title: 'Department activity',
  description: 'Published description',
  fields: [{ id: 'note', kind: 'short_text', label: 'Note', helpText: '', options: [], rules: [] }],
  formRules: [],
  outputs: [],
};

async function legacyDraft(store: ReturnType<typeof createMemoryStore>, ownerUid: string) {
  const form = await store.collectionForms.create({
    title: schema.title,
    description: schema.description,
    coverUrl: null,
    organizationId: 'rights_development_center',
    currentDraftVersionId: null,
    publishedVersionId: null,
    opensAt: null,
    closesAt: null,
    capacity: null,
    status: 'draft',
    ownerUid,
    scope: { type: 'public', id: '*' },
  });
  const version = await store.collectionVersions.create({
    formId: form.id,
    version: 1,
    schema: schema as import('@freebbs-development/contracts').CollectionSchema,
    publishedAt: null,
    status: 'draft',
    ownerUid,
    scope: { type: 'collection_form', id: form.id },
  });
  await store.collectionForms.update(form.id, { currentDraftVersionId: version.id });
  return form;
}

describe('department homepages and published activities', () => {
  it('preserves a legacy parent when the development owner saves a schema-only draft', async () => {
    const { app, store } = await fixture();
    const form = await legacyDraft(store, 'demo-rights-member');
    await request(app)
      .put(`/api/development/v1/collections/forms/${form.id}/draft`)
      .set({ 'X-Demo-User': 'demo-admin' })
      .send({ schema })
      .expect(200);
    expect((await store.collectionForms.get(form.id))?.organizationId).toBe(
      'rights_development_center',
    );
  });
  it('preserves a legacy parent when a multi-organization member saves a schema-only draft', async () => {
    const { app, store } = await fixture();
    const form = await legacyDraft(store, 'demo-rights-member');
    await store.roleAssignments.create({
      subjectUid: 'demo-rights-member',
      roleKey: 'department.arts_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await request(app)
      .put(`/api/development/v1/collections/forms/${form.id}/draft`)
      .set(member)
      .send({ schema })
      .expect(200);
    expect((await store.collectionForms.get(form.id))?.organizationId).toBe(
      'rights_development_center',
    );
  });
  it('derives a new parent for an explicit cross-parent department change on a legacy draft', async () => {
    const { app, store } = await fixture();
    const form = await legacyDraft(store, 'demo-rights-member');
    await store.roleAssignments.create({
      subjectUid: 'demo-rights-member',
      roleKey: 'affiliation.tms_member',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const changed = await request(app)
      .put(`/api/development/v1/collections/forms/${form.id}/draft`)
      .set(member)
      .send({ schema: { ...schema, publisherDepartmentId: 'tms.position' } })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      organizationId: 'tms',
      publisherDepartmentId: 'tms.position',
    });
    expect((await store.collectionForms.get(form.id))?.organizationId).toBe('tms');
  });
  it('persists a browser-style UTF-8 filename unchanged through upload and app reload', async () => {
    const { app, options } = await fixture();
    const filename = '部门主页-é.html';
    const saved = await request(app)
      .put(home)
      .set(member)
      .field('revision', '0')
      .attach('file', Buffer.from('<h1>部门主页</h1>'), filename)
      .expect(200);
    expect(saved.body.data.originalFilename).toBe(filename);
    const reopened = await request(createApp(options)).get(home).set(student).expect(200);
    expect(reopened.body.data).toMatchObject({
      originalFilename: filename,
      html: '<h1>部门主页</h1>',
      revision: 1,
    });
  });
  it('authorizes every canonical option role and the development owner through the HTTP route', async () => {
    const { app, store } = await fixture();
    const assignment = (await store.roleAssignments.list({ query: 'demo-rights-member' })).find(
      ({ subjectUid }) => subjectUid === 'demo-rights-member',
    )!;
    for (const department of DEPARTMENT_DIRECTORY) {
      const route = `/api/development/v1/organizations/${department.organizationKey}/${department.departmentKey}/home`;
      let revision = 0;
      for (const roleKey of department.roleKeys) {
        await store.roleAssignments.update(assignment.id, { roleKey });
        const response = await request(app)
          .put(route)
          .set(member)
          .field('revision', String(revision))
          .attach('file', Buffer.from('<h1>Member</h1>'), 'index.html')
          .expect(200);
        expect(response.body.data.canEdit).toBe(true);
        revision += 1;
      }
      await request(app)
        .put(route)
        .set({ 'X-Demo-User': 'demo-admin' })
        .field('revision', String(revision))
        .attach('file', Buffer.from('<h1>Owner</h1>'), 'index.html')
        .expect(200);
    }
  });
  it('keeps missing production homepage storage feature-only and readiness available', async () => {
    const app = createApp({
      environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
      store: createMemoryStore(),
      authMode: 'main',
      authClient: {
        introspect: async () => ({
          uid: 'u',
          displayName: 'User',
          avatarUrl: null,
          baseRole: 'student' as const,
          roles: [],
          tags: [],
        }),
      },
      previewAllowedUids: ['u'],
    });
    await request(app).get(home).set('Authorization', 'Bearer test').expect(503);
    await request(app).get('/api/development/v1/ready').expect(200);
  });
  it('uses explicit multi-department membership, keeps the published binding immutable, and leaves media organization null', async () => {
    const { app, store } = await fixture();
    for (const roleKey of [
      'youth_league.organization.member',
      'youth_league.freshman.member',
      'media_center.creative.member',
    ] as RoleKey[]) {
      await store.roleAssignments.create({
        subjectUid: 'demo-rights-member',
        roleKey,
        expiresAt: null,
        status: 'active',
        ownerUid: 'demo-admin',
        scope: { type: 'public', id: '*' },
      });
    }
    const created = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({
        title: schema.title,
        schema: { ...schema, publisherDepartmentId: 'youth_league.organization' },
      })
      .expect(201);
    expect(created.body.data.organizationId).toBe('tuanwei');
    const id = created.body.data.id as string;
    await request(app)
      .post(`/api/development/v1/collections/forms/${id}/publish`)
      .set(member)
      .send({})
      .expect(200);
    await request(app)
      .put(`/api/development/v1/collections/forms/${id}/draft`)
      .set(member)
      .send({
        schema: { ...schema, publisherDepartmentId: 'youth_league.freshman', title: 'Draft' },
      })
      .expect(200);
    const oldRelated = await request(app)
      .get('/api/development/v1/organizations/youth_league/organization/activities')
      .set(student)
      .expect(200);
    expect(oldRelated.body.data.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          title: schema.title,
          publisherDepartmentId: 'youth_league.organization',
        }),
      ]),
    );
    const newRelated = await request(app)
      .get('/api/development/v1/organizations/youth_league/freshman/activities')
      .set(student)
      .expect(200);
    expect(newRelated.body.data.active.some((item: { id: string }) => item.id === id)).toBe(false);
    await request(app)
      .put(`/api/development/v1/collections/forms/${id}/draft`)
      .set(member)
      .send({ schema: { ...schema, publisherDepartmentId: 'media_center.creative' } })
      .expect(200);
    const publishedDetail = await request(app)
      .get(`/api/development/v1/collections/forms/${id}`)
      .set(student)
      .expect(200);
    expect(publishedDetail.body.data.organizationId).toBe('tuanwei');
    const media = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({
        title: schema.title,
        schema: { ...schema, publisherDepartmentId: 'media_center.creative' },
      })
      .expect(201);
    expect(media.body.data.organizationId).toBeNull();
  });
  it('authenticates and authorizes before parsing multipart, rejecting unknown departments', async () => {
    const { app, store } = await fixture();
    for (const assignment of await store.roleAssignments.list({ query: 'demo-admin' })) {
      if (assignment.subjectUid === 'demo-admin')
        await store.roleAssignments.update(assignment.id, { roleKey: 'platform.admin' });
    }
    await request(app)
      .put(home)
      .set('Content-Type', 'multipart/form-data')
      .send('bad boundary')
      .expect(401);
    await request(app)
      .put(home)
      .set(student)
      .set('Content-Type', 'multipart/form-data')
      .send('bad boundary')
      .expect(403);
    await request(app)
      .put(home)
      .set({ 'X-Demo-User': 'demo-admin' })
      .set('Content-Type', 'multipart/form-data')
      .send('bad boundary')
      .expect(403);
    await request(app)
      .get(home.replace('rights_development_center', 'unknown'))
      .set(member)
      .expect(404);
  });
  it('saves a member homepage durably with revision conflicts and preserves the previous valid upload', async () => {
    const { app, options } = await fixture();
    const empty = await request(app).get(home).set(member).expect(200);
    expect(empty.body.data).toMatchObject({ html: null, revision: 0, canEdit: true });
    const saved = await request(app)
      .put(home)
      .set(member)
      .field('revision', '0')
      .attach('file', Buffer.from('<!doctype html><h1>部门</h1>'), 'home.html')
      .expect(200);
    expect(saved.body.data).toMatchObject({
      revision: 1,
      originalFilename: 'home.html',
      editor: { uid: 'demo-rights-member' },
    });
    await request(app)
      .put(home)
      .set(member)
      .field('revision', '0')
      .attach('file', Buffer.from('<p>stale</p>'), 'home.html')
      .expect(409);
    for (const [buffer, name] of [
      [Buffer.from([0xff, 0xfe, 0, 10]), 'bad.html'],
      [Buffer.from('<p>bad</p>'), 'bad.exe'],
      [Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'huge.html'],
    ] as const) {
      const result = await request(app)
        .put(home)
        .set(member)
        .field('revision', '1')
        .attach('file', buffer, name);
      expect([400, 413]).toContain(result.status);
    }
    await request(app)
      .put(home)
      .set(member)
      .set('Content-Type', 'multipart/form-data')
      .send('bad boundary')
      .expect(400);
    const reopened = await request(createApp(options)).get(home).set(student).expect(200);
    expect(reopened.body.data).toMatchObject({
      html: '<!doctype html><h1>部门</h1>',
      revision: 1,
      canEdit: false,
    });
    const concurrent = await Promise.all(
      ['one', 'two'].map((text) =>
        request(createApp(options))
          .put(home)
          .set(member)
          .field('revision', '1')
          .attach('file', Buffer.from(`<p>${text}</p>`), 'home.htm'),
      ),
    );
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
  });
  it('validates exact publishing membership and explicit parent organization', async () => {
    const { app } = await fixture();
    for (const publisherDepartmentId of ['youth_league.organization', 'unknown']) {
      const result = await request(app)
        .post('/api/development/v1/collections/forms')
        .set(member)
        .send({ title: schema.title, schema: { ...schema, publisherDepartmentId } });
      expect([400, 403]).toContain(result.status);
    }
    await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({
        title: schema.title,
        organizationId: 'tms',
        schema: { ...schema, publisherDepartmentId: 'student_union.rights_development_center' },
      })
      .expect(400);
  });
  it('revalidates department membership when publishing a previously authorized draft', async () => {
    const { app, store } = await fixture();
    const created = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({ title: schema.title, schema })
      .expect(201);
    for (const assignment of await store.roleAssignments.list({ query: 'demo-rights-member' })) {
      if (assignment.subjectUid === 'demo-rights-member')
        await store.roleAssignments.delete(assignment.id);
    }
    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/publish`)
      .set(member)
      .send({})
      .expect(403);
  });
  it('keeps historical unbound native schemas compatible without attributing a newer draft organization', async () => {
    const { app, store } = await fixture();
    const form = await store.collectionForms.create({
      title: schema.title,
      description: schema.description,
      coverUrl: null,
      organizationId: 'rights_development_center',
      currentDraftVersionId: null,
      publishedVersionId: null,
      opensAt: null,
      closesAt: null,
      capacity: null,
      status: 'published',
      ownerUid: 'demo-rights-member',
      scope: { type: 'public', id: '*' },
    });
    const oldVersion = await store.collectionVersions.create({
      formId: form.id,
      version: 1,
      schema: schema as import('@freebbs-development/contracts').CollectionSchema,
      publishedAt: new Date().toISOString(),
      status: 'published',
      ownerUid: 'demo-rights-member',
      scope: { type: 'collection_form', id: form.id },
    });
    await store.collectionForms.update(form.id, { publishedVersionId: oldVersion.id });
    await request(app)
      .get(`/api/development/v1/collections/forms/${form.id}`)
      .set(student)
      .expect(200);
    const catalog = await request(app)
      .get('/api/development/v1/collections/registrations')
      .set(student)
      .expect(200);
    expect(
      catalog.body.data.find((item: { id: string }) => item.id === form.id).publisherDepartmentId,
    ).toBeNull();
  });
  it('associates published versions, hides draft audience changes, and reads closed details without submissions', async () => {
    const { app, store } = await fixture();
    const created = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({ title: schema.title, schema })
      .expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.schema.publisherDepartmentId).toBe(
      'student_union.rights_development_center',
    );
    await request(app)
      .post(`/api/development/v1/collections/forms/${id}/publish`)
      .set(member)
      .send({})
      .expect(200);
    await request(app)
      .put(`/api/development/v1/collections/forms/${id}/draft`)
      .set(member)
      .send({
        schema: {
          ...schema,
          title: 'New draft title',
          formRules: [{ id: 'audience', kind: 'audience', value: 'tms' }],
        },
      })
      .expect(200);
    const related = await request(app).get(activities).set(student).expect(200);
    expect(related.body.data.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          title: schema.title,
          publisherDepartmentId: 'student_union.rights_development_center',
        }),
      ]),
    );
    expect(
      related.body.data.active.find((item: { id: string }) => item.id === id).detailsPath,
    ).toBe(`/collections/registrations?focus=native_collection%3A${id}`);
    await store.collectionForms.update(id, { status: 'closed' });
    const past = await request(app).get(activities).set(student).expect(200);
    expect(past.body.data.past).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, status: 'closed' })]),
    );
    expect(
      past.body.data.past.find((item: { id: string }) => item.id === id).detailsPath,
    ).toContain('includePast=true');
    const history = await request(app)
      .get('/api/development/v1/collections/registrations?includePast=true')
      .set(student)
      .expect(200);
    expect(history.body.data.some((item: { id: string }) => item.id === id)).toBe(true);
    await request(app).get(`/api/development/v1/collections/forms/${id}`).set(student).expect(200);
    await request(app)
      .post(`/api/development/v1/collections/forms/${id}/responses`)
      .set(student)
      .send({ answers: {} })
      .expect(409);
    await request(app)
      .post(`/api/development/v1/collections/forms/${id}/publish`)
      .set(member)
      .send({})
      .expect(200);
    const privateRelated = await request(app).get(activities).set(student).expect(200);
    expect(
      [...privateRelated.body.data.active, ...privateRelated.body.data.past].some(
        (item: { id: string }) => item.id === id,
      ),
    ).toBe(false);
  });
  it('discovers scoped events only for explicit scoped readers and honors denies even for owners', async () => {
    const { store } = await fixture();
    const scope = { type: 'club', id: 'private-club' };
    const event = await store.activities.create({
      title: 'Private event',
      description: '',
      contact: '',
      registrationDeadline: null,
      capacity: null,
      sourceCommunityPostId: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      ownerUid: 'owner',
      organizationId: 'tms',
      status: 'archived',
      scope,
    });
    const actor: AuthorizationContext = {
      uid: 'reader',
      displayName: 'Reader',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [{ id: 'base', action: 'events.read', resource: 'activity', effect: 'allow' }],
    };
    expect((await listRegistrations(store, actor, true)).some(({ id }) => id === event.id)).toBe(
      false,
    );
    actor.policies!.push({
      id: 'scoped',
      action: 'events.read',
      resource: 'activity',
      scope,
      effect: 'allow',
    });
    const authorized = await listRegistrations(store, actor, true);
    expect(authorized.find(({ id }) => id === event.id)?.detailsPath).toBe(`/events/${event.id}`);
    actor.roles = ['platform.super_admin'];
    actor.policies!.push({
      id: 'deny',
      action: 'events.read',
      resource: 'activity',
      scope,
      effect: 'deny',
    });
    expect((await listRegistrations(store, actor, true)).some(({ id }) => id === event.id)).toBe(
      false,
    );
  });
  it('excludes scoped events from the general catalog and maps only deterministic legacy departments', async () => {
    const { app, store } = await fixture();
    const base = {
      title: 'Legacy',
      description: '',
      contact: '',
      registrationDeadline: null,
      capacity: null,
      sourceCommunityPostId: null,
      technicalSupportStatus: 'not_requested' as const,
      technicalSupportNote: null,
      ownerUid: 'demo-rights-member',
    };
    const publicEvent = await store.activities.create({
      ...base,
      organizationId: 'rights_development_center',
      status: 'finished',
      scope: { type: 'public', id: '*' },
    });
    const privateEvent = await store.activities.create({
      ...base,
      organizationId: 'rights_development_center',
      status: 'published',
      scope: { type: 'club', id: 'private-club' },
    });
    const ambiguous = await store.activities.create({
      ...base,
      organizationId: 'tuanwei',
      status: 'published',
      scope: { type: 'public', id: '*' },
    });
    const pending = await store.activities.create({
      ...base,
      organizationId: 'rights_development_center',
      status: 'pending',
      scope: { type: 'public', id: '*' },
    });
    const related = await request(app).get(activities).set(student).expect(200);
    expect(related.body.data.past).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: publicEvent.id })]),
    );
    const relatedIds = [...related.body.data.active, ...related.body.data.past].map(
      (item: { id: string }) => item.id,
    );
    for (const hidden of [privateEvent, pending, ambiguous])
      expect(relatedIds).not.toContain(hidden.id);
    const catalog = await request(app)
      .get('/api/development/v1/collections/registrations')
      .set(student)
      .expect(200);
    expect(catalog.body.data.some((item: { id: string }) => item.id === privateEvent.id)).toBe(
      false,
    );
    await request(app)
      .get(`/api/development/v1/events/activities/${publicEvent.id}`)
      .set(student)
      .expect(200);
  });
  it('classifies an ended published event as past and keeps its registration closed', async () => {
    const { app, store } = await fixture();
    const event = await store.activities.create({
      title: 'Ended',
      description: '',
      contact: '',
      registrationDeadline: '2099-01-01T00:00:00.000Z',
      endsAt: '2000-01-01T00:00:00.000Z',
      capacity: null,
      sourceCommunityPostId: null,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      ownerUid: 'demo-rights-member',
      organizationId: 'rights_development_center',
      status: 'published',
      scope: { type: 'public', id: '*' },
    });
    const related = await request(app).get(activities).set(student).expect(200);
    expect(related.body.data.past.map((item: { id: string }) => item.id)).toContain(event.id);
    expect(related.body.data.active.map((item: { id: string }) => item.id)).not.toContain(event.id);
    await request(app)
      .get(`/api/development/v1/events/activities/${event.id}`)
      .set(student)
      .expect(200);
    await request(app)
      .post(`/api/development/v1/events/activities/${event.id}/registrations`)
      .set(student)
      .send({})
      .expect(409);
  });
});
