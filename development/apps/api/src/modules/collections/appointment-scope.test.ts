import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  departmentById,
  type CollectionSchema,
  type DepartmentId,
  type RoleKey,
} from '@freebbs-development/contracts';
import {
  memberHeaders,
  scopedEditFixture,
  scopedMemberUid,
} from '../../core/authorization/scoped-edit-test-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const admin = { Authorization: 'Bearer demo-admin' };
const base = '/api/development/v1/collections';
const positions: Array<[RoleKey, DepartmentId]> = [
  ['counselor.practice', 'youth_league.practice'],
  ['counselor.student_development', 'youth_league.freshman'],
  ['counselor.innovation', 'science_association.software'],
];
async function fixture(department: DepartmentId) {
  const value = await scopedEditFixture();
  cleanups.push(value.cleanup);
  const schema: CollectionSchema = {
    title: 'Scoped appointment form',
    description: '',
    publisherDepartmentId: department,
    fields: [
      { id: 'note', kind: 'short_text', label: 'Note', helpText: '', options: [], rules: [] },
    ],
    formRules: [],
    outputs: [],
  };
  async function create(title: string) {
    const created = await request(value.app)
      .post(`${base}/forms`)
      .set(admin)
      .send({ title, schema: { ...schema, title } })
      .expect(201);
    await request(value.app)
      .post(`${base}/forms/${created.body.data.id}/publish`)
      .set(admin)
      .send({})
      .expect(200);
    return created.body.data.id as string;
  }
  const a = await create('Form A');
  const b = await create('Form B');
  return { ...value, schema, a, b };
}

describe('current collection appointment scope through normal APIs', () => {
  it.each(positions)(
    'retains department and parent organization appointments for %s',
    async (role, department) => {
      const { app, a, b, schema } = await fixture(department);
      for (const scope of [
        { type: 'department', id: department },
        { type: 'social_organization', id: departmentById(department)!.organizationId! },
      ]) {
        const assignment = await request(app)
          .post('/api/development/v1/admin/role-assignments')
          .set(admin)
          .send({ subjectUid: scopedMemberUid, roleKey: role, scope })
          .expect(201);
        for (const id of [a, b]) {
          await request(app).get(`${base}/forms/${id}/results`).set(memberHeaders).expect(200);
          await request(app)
            .put(`${base}/forms/${id}/draft`)
            .set(memberHeaders)
            .send({ schema })
            .expect(200);
        }
        await request(app)
          .delete(`/api/development/v1/admin/role-assignments/${assignment.body.data.id}`)
          .set(admin)
          .expect(200);
      }
    },
  );
  it.each(['expired', 'inactive assignment', 'inactive role', 'inactive subject'] as const)(
    'removes concrete form access for an %s appointment',
    async (state) => {
      const { app, store, a, schema } = await fixture('youth_league.practice');
      const assignment = await request(app)
        .post('/api/development/v1/admin/role-assignments')
        .set(admin)
        .send({
          subjectUid: scopedMemberUid,
          roleKey: 'counselor.practice',
          scope: { type: 'collection_form', id: a },
        })
        .expect(201);
      await request(app).get(`${base}/forms/${a}/results`).set(memberHeaders).expect(200);
      if (state === 'expired') {
        await store.roleAssignments.update(assignment.body.data.id, {
          expiresAt: '2000-01-01T00:00:00.000Z',
        });
      } else if (state === 'inactive assignment') {
        await store.roleAssignments.update(assignment.body.data.id, { status: 'inactive' });
      } else if (state === 'inactive role') {
        const definition = (await store.roles.list()).find(
          ({ key }) => key === 'counselor.practice',
        )!;
        await store.roles.update(definition.id, { status: 'inactive' });
      } else {
        const subject = (await store.subjects.list()).find(({ uid }) => uid === scopedMemberUid)!;
        await store.subjects.update(subject.id, { status: 'inactive' });
      }
      await request(app).get(`${base}/forms/${a}/results`).set(memberHeaders).expect(404);
      await request(app)
        .put(`${base}/forms/${a}/draft`)
        .set(memberHeaders)
        .send({ schema })
        .expect(404);
    },
  );
  it.each(positions)('keeps %s assigned to A inside A', async (role, department) => {
    const { app, a, b, schema } = await fixture(department);
    const assignment = await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(admin)
      .send({
        subjectUid: scopedMemberUid,
        roleKey: role,
        scope: { type: 'collection_form', id: a },
      })
      .expect(201);
    await request(app).get(`${base}/forms/${a}/results`).set(memberHeaders).expect(200);
    await request(app)
      .put(`${base}/forms/${a}/draft`)
      .set(memberHeaders)
      .send({ schema: { ...schema, title: 'A edited' } })
      .expect(200);
    await request(app).get(`${base}/forms/${b}/results`).set(memberHeaders).expect(404);
    await request(app).get(`${base}/forms/${b}/recipients`).set(memberHeaders).expect(404);
    await request(app)
      .put(`${base}/forms/${b}/draft`)
      .set(memberHeaders)
      .send({ schema: { ...schema, title: 'B must remain unchanged' } })
      .expect(404);
    await request(app).post(`${base}/forms/${b}/publish`).set(memberHeaders).send({}).expect(404);
    await request(app)
      .delete(`/api/development/v1/admin/role-assignments/${assignment.body.data.id}`)
      .set(admin)
      .expect(200);
    await request(app).get(`${base}/forms/${a}/results`).set(memberHeaders).expect(404);
    await request(app)
      .put(`${base}/forms/${a}/draft`)
      .set(memberHeaders)
      .send({ schema })
      .expect(404);
    await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(admin)
      .send({ subjectUid: scopedMemberUid, roleKey: role, scope: { type: 'public', id: '*' } })
      .expect(201);
    await request(app).get(`${base}/forms/${b}/results`).set(memberHeaders).expect(200);
    await request(app)
      .put(`${base}/forms/${b}/draft`)
      .set(memberHeaders)
      .send({ schema })
      .expect(200);
  });
  it('does not turn a form appointment into general publishing, collaboration, creation or template access', async () => {
    const { app, a, schema } = await fixture('youth_league.practice');
    await request(app)
      .post(`${base}/templates`)
      .set(admin)
      .send({ name: 'Private department template', schema })
      .expect(201);
    await request(app)
      .post('/api/development/v1/admin/role-assignments')
      .set(admin)
      .send({
        subjectUid: scopedMemberUid,
        roleKey: 'counselor.practice',
        scope: { type: 'collection_form', id: a },
      })
      .expect(201);
    const templates = await request(app).get(`${base}/templates`).set(memberHeaders).expect(200);
    expect(templates.body.data).toEqual([]);
    await request(app)
      .post(`${base}/forms`)
      .set(memberHeaders)
      .send({ title: 'Unauthorized new form', schema })
      .expect(403);
    await request(app)
      .post('/api/development/v1/publishing')
      .set(memberHeaders)
      .send({
        category: 'article',
        title: 'Unauthorized department article',
        departmentId: 'youth_league.practice',
      })
      .expect(403);
    await request(app)
      .post('/api/development/v1/collaboration')
      .set(memberHeaders)
      .send({
        title: 'Unauthorized department space',
        kind: 'shared_table',
        departmentId: 'youth_league.practice',
        audience: 'department',
        columns: [{ id: 'note', label: 'Note', kind: 'text' }],
      })
      .expect(403);
  });
});
