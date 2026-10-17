import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  memberHeaders,
  scopedEditFixture,
  scopedMemberUid,
} from '../../core/authorization/scoped-edit-test-fixture.js';
import type { CollectionSchema } from '@freebbs-development/contracts';

const base = '/api/development/v1/collections';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
async function fixture(
  organizationId: 'sports_center' | 'arts_center' | null,
  publisherDepartmentId?: CollectionSchema['publisherDepartmentId'],
) {
  const value = await scopedEditFixture();
  cleanups.push(value.cleanup);
  await value.assign('department.sports_member');
  const schema: CollectionSchema = {
    title: 'Scoped owner form',
    description: '',
    fields: [
      { id: 'note', kind: 'short_text', label: 'Note', helpText: '', options: [], rules: [] },
    ],
    formRules: [],
    outputs: [],
    ...(publisherDepartmentId ? { publisherDepartmentId } : {}),
  };
  const form = await value.store.collectionForms.create({
    title: schema.title,
    description: '',
    coverUrl: null,
    organizationId,
    currentDraftVersionId: null,
    publishedVersionId: null,
    opensAt: null,
    closesAt: null,
    capacity: null,
    status: 'draft',
    ownerUid: scopedMemberUid,
    scope: { type: 'public', id: '*' },
  });
  const version = await value.store.collectionVersions.create({
    formId: form.id,
    version: 1,
    schema,
    publishedAt: null,
    status: 'draft',
    ownerUid: scopedMemberUid,
    scope: { type: 'collection_form', id: form.id },
  });
  await value.store.collectionForms.update(form.id, { currentDraftVersionId: version.id });
  return { ...value, form, version, schema };
}

describe('current publisher scope on collection management', () => {
  it.each([
    { organization: 'arts_center' as const, department: undefined },
    { organization: null, department: 'student_union.arts_center' as const },
    { organization: 'sports_center' as const, department: 'student_union.arts_center' as const },
  ])(
    'rejects former owners across every private route for $organization/$department',
    async ({ organization, department }) => {
      const { app, form, schema } = await fixture(organization, department);
      const mine = await request(app).get(`${base}/forms`).set(memberHeaders).expect(200);
      expect(mine.body.data.some((item: { id: string }) => item.id === form.id)).toBe(false);
      await request(app).get(`${base}/forms/${form.id}`).set(memberHeaders).expect(404);
      await request(app).get(`${base}/forms/${form.id}/results`).set(memberHeaders).expect(404);
      await request(app).get(`${base}/forms/${form.id}/recipients`).set(memberHeaders).expect(404);
      await request(app)
        .put(`${base}/forms/${form.id}/draft`)
        .set(memberHeaders)
        .send({ schema: { ...schema, publisherDepartmentId: undefined } })
        .expect(404);
      await request(app)
        .post(`${base}/forms/${form.id}/publish`)
        .set(memberHeaders)
        .send({})
        .expect(404);
    },
  );
  it.each([
    { organization: 'sports_center' as const, department: 'student_union.sports_center' as const },
    { organization: null, department: undefined },
  ])(
    'preserves same-department and legacy personal owner access for $organization',
    async ({ organization, department }) => {
      const { app, form, schema } = await fixture(organization, department);
      await request(app).get(`${base}/forms/${form.id}`).set(memberHeaders).expect(200);
      await request(app)
        .put(`${base}/forms/${form.id}/draft`)
        .set(memberHeaders)
        .send({ schema })
        .expect(200);
      await request(app)
        .post(`${base}/forms/${form.id}/publish`)
        .set(memberHeaders)
        .send({})
        .expect(200);
    },
  );
  it('preserves the stored publisher when an owner saves a schema without publisher fields', async () => {
    const { app, store, form, schema } = await fixture(
      'sports_center',
      'student_union.sports_center',
    );
    const { publisherDepartmentId: _department, ...withoutPublisher } = schema;
    void _department;
    await request(app)
      .put(`${base}/forms/${form.id}/draft`)
      .set(memberHeaders)
      .send({ schema: withoutPublisher })
      .expect(200);
    const saved = await store.collectionForms.get(form.id);
    expect(
      (await store.collectionVersions.get(saved!.currentDraftVersionId!))!.schema
        .publisherDepartmentId,
    ).toBe('student_union.sports_center');
  });
  it('requires permission at both persisted and requested publishers during a move', async () => {
    const { app, form, schema } = await fixture('sports_center', 'student_union.sports_center');
    await request(app)
      .put(`${base}/forms/${form.id}/draft`)
      .set(memberHeaders)
      .send({
        organizationId: 'arts_center',
        schema: { ...schema, publisherDepartmentId: 'student_union.arts_center' },
      })
      .expect(403);
  });
  it('does not expose another current member private drafts', async () => {
    const { app, store, form } = await fixture('sports_center', 'student_union.sports_center');
    await store.collectionForms.update(form.id, { ownerUid: 'another-sports-member' });
    await request(app).get(`${base}/forms/${form.id}`).set(memberHeaders).expect(404);
    await request(app).get(`${base}/forms/${form.id}/results`).set(memberHeaders).expect(404);
  });
  it('does not use stale ownership to bypass the published audience', async () => {
    const { app, store, form, version, schema } = await fixture(
      'arts_center',
      'student_union.arts_center',
    );
    await store.collectionVersions.update(version.id, {
      publishedAt: new Date().toISOString(),
      status: 'published',
      schema: {
        ...schema,
        formRules: [{ id: 'audience', kind: 'audience', value: 'arts_center' }],
      },
    });
    await store.collectionForms.update(form.id, {
      status: 'published',
      publishedVersionId: version.id,
    });
    await request(app).get(`${base}/forms/${form.id}`).set(memberHeaders).expect(404);
    const catalog = await request(app).get(`${base}/registrations`).set(memberHeaders).expect(200);
    expect(catalog.body.data.some((item: { id: string }) => item.id === form.id)).toBe(false);
  });
  it('retains global business admin management across organization scopes', async () => {
    const { app, assign, form, schema } = await fixture('arts_center', 'student_union.arts_center');
    await assign('platform.admin');
    await request(app).get(`${base}/forms/${form.id}`).set(memberHeaders).expect(200);
    await request(app)
      .put(`${base}/forms/${form.id}/draft`)
      .set(memberHeaders)
      .send({ schema })
      .expect(200);
    await request(app)
      .post(`${base}/forms/${form.id}/publish`)
      .set(memberHeaders)
      .send({})
      .expect(200);
  });
});
