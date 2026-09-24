import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { DemoAuthClient } from '../auth/demo-auth-client.js';
import { createMemoryStore } from './memory-store.js';

const cases = [
  {
    path: '/knowledge/entries',
    base: { type: 'faq', title: 'Guide', body: 'Body' },
    fields: {
      category: 'campus',
      tags: ['October'],
      summary: 'Preview',
      maintainedAt: '2026-10-01T04:00:00.000Z',
      maintainerUid: 'demo-admin',
    },
    defaults: {
      category: 'general',
      tags: [],
      summary: '',
      maintainedAt: null,
      maintainerUid: null,
    },
    filter: { category: 'campus', tag: 'October' },
    bad: [
      { category: 'x'.repeat(81) },
      { tags: {} },
      { tags: [12] },
      { tags: [''] },
      { tags: ['x'.repeat(81)] },
      { tags: Array(21).fill('tag') },
      { summary: 'x'.repeat(501) },
      { maintainedAt: '2026-02-30T00:00:00Z' },
      { maintainedAt: 'invalid' },
      { maintainerUid: 'x'.repeat(129) },
    ],
  },
  {
    path: '/information/consultations',
    base: { title: 'Question', body: 'Body' },
    fields: { title: 'Updated question' },
    defaults: { dueAt: null },
    filter: {},
    bad: [
      { dueAt: '2026-10-01T04:00:00.000Z' },
      { dueAt: 'invalid' },
      { dueAt: '2026-02-30T00:00:00Z' },
    ],
  },
  {
    path: '/information/proposals',
    base: {
      title: 'Proposal',
      problemDescription: 'Problem',
      proposedSolution: 'Solution',
      category: 'campus',
    },
    fields: { dueAt: '2026-10-01T04:00:00.000Z' },
    defaults: { dueAt: null },
    filter: { category: 'campus' },
    bad: [{ dueAt: 'invalid' }],
  },
  {
    path: '/clubs',
    base: { name: 'Club', description: 'Description' },
    fields: { category: 'outdoors', contactName: 'Captain', publicContact: 'Campus desk' },
    defaults: { category: 'general', contactName: '', publicContact: '' },
    filter: { category: 'outdoors' },
    bad: [
      { category: 'x'.repeat(81) },
      { contactName: 'x'.repeat(129) },
      { publicContact: 'x'.repeat(501) },
    ],
  },
  {
    path: '/events/activities',
    base: { title: 'Event', description: 'Description' },
    fields: {
      registrationDeadline: '2026-10-01T04:00:00.000Z',
      capacity: 80,
      contact: 'Campus desk',
    },
    defaults: { registrationDeadline: null, capacity: null, contact: '' },
    filter: { standingActivity: 'false' },
    bad: [
      { registrationDeadline: 'invalid' },
      { registrationDeadline: '2026-02-30T00:00:00Z' },
      { capacity: 0 },
      { capacity: -1 },
      { capacity: 1.5 },
      { capacity: 2147483648 },
      { contact: 'x'.repeat(501) },
    ],
  },
  {
    path: '/sports/teams',
    base: { name: 'Team', description: 'Description' },
    fields: { season: '2026秋季', trainingSchedule: '周三 18:00' },
    defaults: { season: '', trainingSchedule: '' },
    filter: { season: '2026秋季' },
    bad: [{ season: 'x'.repeat(81) }, { trainingSchedule: 'x'.repeat(501) }],
  },
];
function fixture() {
  return createApp({
    store: createMemoryStore(),
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin']),
  });
}
const admin = { 'X-Demo-User': 'demo-admin' };
const prefix = '/api/development/v1';

describe('module readability API compatibility', () => {
  for (const testCase of cases) {
    it(`creates, patches and filters ${testCase.path} with defaults for old clients`, async () => {
      const app = fixture();
      const url = prefix + testCase.path;
      const legacy = await request(app).post(url).set(admin).send(testCase.base).expect(201);
      expect(legacy.body.data).toMatchObject(testCase.defaults);
      const created = await request(app)
        .post(url)
        .set(admin)
        .send({ ...testCase.base, ...testCase.fields })
        .expect(201);
      expect(created.body.data).toMatchObject(testCase.fields);
      const proposal = testCase.path.endsWith('/proposals');
      const patchUrl = proposal ? `${url}/${legacy.body.data.id}` : url;
      const patch = proposal ? testCase.fields : { id: legacy.body.data.id, ...testCase.fields };
      const updated = await request(app).patch(patchUrl).set(admin).send(patch).expect(200);
      expect(updated.body.data).toMatchObject(testCase.fields);
      if (!proposal)
        await request(app)
          .patch(patchUrl)
          .set(admin)
          .send({ ...patch, status: 'archived' })
          .expect(400);
      const filtered = await request(app).get(url).set(admin).query(testCase.filter).expect(200);
      expect(filtered.body.data.map((record: { id: string }) => record.id)).toContain(
        created.body.data.id,
      );
      for (const [key, value] of Object.entries(testCase.filter)) {
        const absent = await request(app)
          .get(url)
          .set(admin)
          .query({ [key]: key === 'standingActivity' ? 'true' : `${value}-missing` })
          .expect(200);
        expect(absent.body.data.map((record: { id: string }) => record.id)).not.toContain(
          created.body.data.id,
        );
      }
    });
    it(`rejects invalid new fields at ${testCase.path}`, async () => {
      const app = fixture();
      for (const bad of testCase.bad)
        await request(app)
          .post(prefix + testCase.path)
          .set(admin)
          .send({ ...testCase.base, ...bad })
          .expect(400);
    });
  }
  it('retains the existing proposal maintenance transition workflow', async () => {
    const app = fixture();
    const created = await request(app)
      .post(prefix + '/information/proposals')
      .set(admin)
      .send(cases[2]!.base)
      .expect(201);
    const updated = await request(app)
      .patch(`${prefix}/information/proposals/${created.body.data.id}`)
      .set(admin)
      .send({ status: 'reviewing', dueAt: null })
      .expect(200);
    expect(updated.body.data).toMatchObject({ status: 'reviewing', dueAt: null });
  });
});
