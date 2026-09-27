import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const member = { 'X-Demo-User': 'demo-rights-member' };
const admin = { 'X-Demo-User': 'demo-admin' };
const captain = { 'X-Demo-User': 'demo-captain' };

const uploadDirectories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    uploadDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function fixture(collectionsUploadDirectory?: string) {
  const users = ['demo-student', 'demo-rights-member', 'demo-admin', 'demo-captain'];
  const store = createMemoryStore();
  return {
    store,
    app: createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(users),
      ...(collectionsUploadDirectory ? { collectionsUploadDirectory } : {}),
    }),
  };
}

async function uploadDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'freebbs-collections-router-'));
  uploadDirectories.push(directory);
  return directory;
}

const schema = {
  title: '新生活动报名',
  description: '收集参与信息',
  fields: [
    {
      id: 'name-note',
      kind: 'short_text',
      label: '想说的话',
      helpText: '',
      options: [],
      rules: [{ id: 'required-note', kind: 'required', value: true }],
    },
  ],
  formRules: [{ id: 'attempt-once', kind: 'attempt_limit', value: 1 }],
  outputs: [{ id: 'excel-output', kind: 'excel', label: '报名表格', fileName: '报名结果.csv' }],
};

async function createPublishedForm(
  app: ReturnType<typeof createApp>,
  formSchema: typeof schema | Record<string, unknown> = schema,
) {
  const data = formSchema as typeof schema;
  const created = await request(app)
    .post('/api/development/v1/collections/forms')
    .set(member)
    .send({ title: data.title, description: data.description, schema: data })
    .expect(201);
  await request(app)
    .post(`/api/development/v1/collections/forms/${created.body.data.id}/publish`)
    .set(member)
    .send({})
    .expect(200);
  return created.body.data as { id: string };
}

describe('collections API', () => {
  it('authenticates asset uploads before parsing multipart bodies', async () => {
    const directory = await uploadDirectory();
    const { app } = fixture(directory);

    const response = await request(app)
      .post('/api/development/v1/collections/assets')
      .set('Content-Type', 'multipart/form-data')
      .send('missing multipart boundary')
      .expect(401);

    expect(response.body.data.error.code).toBe('missing_identity');
  });

  it('rejects a relative collection upload directory in production before parsing files', async () => {
    const store = createMemoryStore();
    const app = createApp({
      environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
      store,
      authMode: 'main',
      authClient: {
        introspect: async () => ({
          uid: 'u_student',
          displayName: 'Student',
          avatarUrl: null,
          baseRole: 'student' as const,
          roles: [],
          tags: [],
        }),
      },
      previewAllowedUids: ['u_student'],
      collectionsUploadDirectory: '.data/collection-uploads',
    });

    const response = await request(app)
      .post('/api/development/v1/collections/assets')
      .set('Authorization', 'Bearer valid')
      .set('Content-Type', 'multipart/form-data')
      .send('missing multipart boundary')
      .expect(503);

    expect(response.body.data.error.code).toBe('upload_not_configured');
  });

  it('shows creation only to social organization identities', async () => {
    const { app } = fixture();
    const ordinary = await request(app)
      .get('/api/development/v1/collections/dashboard')
      .set(student)
      .expect(200);
    const social = await request(app)
      .get('/api/development/v1/collections/dashboard')
      .set(member)
      .expect(200);
    expect(ordinary.body.data.canCreate).toBe(false);
    expect(social.body.data.canCreate).toBe(true);
  });

  it('creates, publishes and accepts a validated response', async () => {
    const { app } = fixture();
    await request(app)
      .post('/api/development/v1/collections/forms')
      .set(student)
      .send({ title: schema.title, description: schema.description, schema })
      .expect(403);

    const created = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({ title: schema.title, description: schema.description, schema })
      .expect(201);
    expect(created.body.data).toMatchObject({ title: schema.title, status: 'draft' });

    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/publish`)
      .set(member)
      .send({})
      .expect(200);

    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/responses`)
      .set(student)
      .send({ answers: {} })
      .expect(400);

    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '期待参加' } })
      .expect(201);

    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '重复提交' } })
      .expect(409);

    const mine = await request(app)
      .get('/api/development/v1/collections/mine')
      .set(student)
      .expect(200);
    expect(mine.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ formId: created.body.data.id, source: 'native_collection' }),
      ]),
    );

    const exported = await request(app)
      .get(`/api/development/v1/collections/forms/${created.body.data.id}/exports/excel-output`)
      .set(member)
      .expect(200);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.text).toContain('想说的话');
    expect(exported.text).toContain('期待参加');
  });

  it('applies readable title validation rules with specific feedback', async () => {
    const { app } = fixture();
    const guarded = {
      ...schema,
      fields: [
        {
          ...schema.fields[0],
          rules: [
            {
              id: 'title-check',
              kind: 'title_pattern',
              value: {
                mode: 'title_validation',
                minLength: 2,
                maxLength: 8,
                forbiddenCharacters: '<>',
                forbiddenWords: ['测试禁用词'],
                allowLineBreaks: false,
                trimWhitespace: true,
              },
            },
          ],
        },
      ],
    };
    const created = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({ title: guarded.title, description: guarded.description, schema: guarded })
      .expect(201);
    await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/publish`)
      .set(member)
      .send({})
      .expect(200);
    const rejected = await request(app)
      .post(`/api/development/v1/collections/forms/${created.body.data.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '含<符号' } })
      .expect(400);
    expect(rejected.body.data.error.message).toContain('不能包含字符');
  });

  it('keeps showcase likes idempotent', async () => {
    const { app } = fixture();
    const first = await request(app)
      .post('/api/development/v1/collections/showcase/showcase-volunteer/likes')
      .set(student)
      .send({})
      .expect(200);
    const second = await request(app)
      .post('/api/development/v1/collections/showcase/showcase-volunteer/likes')
      .set(student)
      .send({})
      .expect(200);
    expect(second.body.data.likeCount).toBe(first.body.data.likeCount);

    const removed = await request(app)
      .delete('/api/development/v1/collections/showcase/showcase-volunteer/likes')
      .set(student)
      .expect(200);
    expect(removed.body.data).toMatchObject({ liked: false, likeCount: 0 });
  });

  it('lets module-library managers create shared reusable modules', async () => {
    const { app } = fixture();
    const payload = {
      name: '视频作品信息',
      description: '收集作品简介和视频',
      defaultLabel: '请上传你的作品',
      fieldKind: 'video',
    };
    await request(app)
      .post('/api/development/v1/collections/module-definitions')
      .set(member)
      .send(payload)
      .expect(403);
    const created = await request(app)
      .post('/api/development/v1/collections/module-definitions')
      .set(admin)
      .send(payload)
      .expect(201);
    const listed = await request(app)
      .get('/api/development/v1/collections/module-definitions')
      .set(student)
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: created.body.data.id, name: '视频作品信息' }),
    ]);
  });

  it('infers a sole organization and rejects cross-organization form ownership', async () => {
    const { app } = fixture();
    await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({
        title: schema.title,
        description: schema.description,
        organizationId: 'arts_center',
        schema,
      })
      .expect(403);

    const inferred = await request(app)
      .post('/api/development/v1/collections/forms')
      .set(member)
      .send({ title: schema.title, description: schema.description, schema })
      .expect(201);
    expect(inferred.body.data.organizationId).toBe('rights_development_center');
  });

  it('rejects unknown fields and values that do not match their published field kinds', async () => {
    const { app } = fixture();
    const typedSchema = {
      ...schema,
      fields: [
        { ...schema.fields[0], rules: [] },
        {
          id: 'details',
          kind: 'long_text',
          label: '详细说明',
          helpText: '',
          options: [],
          rules: [],
        },
        {
          id: 'choices',
          kind: 'multiple_choice',
          label: '意向',
          helpText: '',
          options: ['A', 'B'],
          rules: [],
        },
        {
          id: 'meeting-time',
          kind: 'datetime',
          label: '时间',
          helpText: '',
          options: [],
          rules: [],
        },
      ],
    };
    const form = await createPublishedForm(app, typedSchema);
    const invalidAnswers = [
      { unknown: 'pollution' },
      { 'name-note': 42 },
      { details: ['not text'] },
      { choices: ['A', 'outside'] },
      { choices: ['A', 1] },
      { 'meeting-time': 'not-a-date' },
    ];
    for (const answers of invalidAnswers) {
      await request(app)
        .post(`/api/development/v1/collections/forms/${form.id}/responses`)
        .set(student)
        .send({ answers })
        .expect(400);
    }
  });

  it('enforces audience and schedule rules in discovery, detail and submission paths', async () => {
    const { app } = fixture();
    const restrictedSchema = {
      ...schema,
      formRules: [
        { id: 'audience-rights', kind: 'audience', value: ['rights_development_center'] },
        ...schema.formRules,
      ],
    };
    const restricted = await createPublishedForm(app, restrictedSchema);

    const catalog = await request(app)
      .get('/api/development/v1/collections/registrations')
      .set(student)
      .expect(200);
    expect(catalog.body.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: restricted.id })]),
    );
    await request(app)
      .get(`/api/development/v1/collections/forms/${restricted.id}`)
      .set(student)
      .expect(404);
    await request(app)
      .post(`/api/development/v1/collections/forms/${restricted.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '绕过受众限制' } })
      .expect(404);

    const futureStart = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const scheduledSchema = {
      ...schema,
      formRules: [
        { id: 'future-window', kind: 'schedule', value: { start: futureStart } },
        ...schema.formRules,
      ],
    };
    const scheduled = await createPublishedForm(app, scheduledSchema);
    const scheduledCatalog = await request(app)
      .get('/api/development/v1/collections/registrations')
      .set(student)
      .expect(200);
    expect(scheduledCatalog.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: scheduled.id, status: 'upcoming' })]),
    );
    await request(app)
      .post(`/api/development/v1/collections/forms/${scheduled.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '提前提交' } })
      .expect(409);
  });

  it('exports only the published version and neutralizes spreadsheet formulas', async () => {
    const { app } = fixture();
    const form = await createPublishedForm(app);
    await request(app)
      .post(`/api/development/v1/collections/forms/${form.id}/responses`)
      .set(student)
      .send({ answers: { 'name-note': '  =2+2' } })
      .expect(201);

    const draftSchema = {
      ...schema,
      fields: [{ ...schema.fields[0], label: '未发布的新问题' }],
    };
    await request(app)
      .put(`/api/development/v1/collections/forms/${form.id}/draft`)
      .set(member)
      .send({ schema: draftSchema })
      .expect(200);

    const exported = await request(app)
      .get(`/api/development/v1/collections/forms/${form.id}/exports/excel-output`)
      .set(member)
      .expect(200);
    expect(exported.text).toContain('想说的话');
    expect(exported.text).not.toContain('未发布的新问题');
    expect(exported.text).toContain(`"'  =2+2"`);
  });

  it('binds uploads to uploader, form and field and validates canonical metadata', async () => {
    const directory = await uploadDirectory();
    const { app } = fixture(directory);
    const uploadSchema = {
      ...schema,
      fields: [
        {
          id: 'poster',
          kind: 'image',
          label: '海报',
          helpText: '',
          options: [],
          rules: [{ id: 'poster-required', kind: 'required', value: true }],
        },
      ],
    };
    const form = await createPublishedForm(app, uploadSchema);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const uploaded = await request(app)
      .post('/api/development/v1/collections/assets')
      .set(student)
      .field('formId', form.id)
      .field('fieldId', 'poster')
      .attach('file', png, { filename: 'poster.png', contentType: 'image/png' })
      .expect(201);

    await request(app)
      .get(`/api/development/v1/collections/assets/${uploaded.body.data.id}`)
      .set(captain)
      .expect(404);
    await request(app)
      .get(`/api/development/v1/collections/assets/${uploaded.body.data.id}`)
      .set(student)
      .expect(200);

    await request(app)
      .post(`/api/development/v1/collections/forms/${form.id}/responses`)
      .set(student)
      .send({
        answers: {
          poster: { ...uploaded.body.data, name: 'tampered.png', sizeBytes: 1 },
        },
      })
      .expect(400);
    await request(app)
      .post(`/api/development/v1/collections/forms/${form.id}/responses`)
      .set(student)
      .send({ answers: { poster: uploaded.body.data } })
      .expect(201);
  });

  it('expires unattached uploads instead of retaining orphan files indefinitely', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T00:00:00.000Z'));
    const directory = await uploadDirectory();
    const { app } = fixture(directory);
    const uploadSchema = {
      ...schema,
      fields: [
        {
          id: 'poster',
          kind: 'image',
          label: '海报',
          helpText: '',
          options: [],
          rules: [],
        },
      ],
    };
    const form = await createPublishedForm(app, uploadSchema);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const stale = await request(app)
      .post('/api/development/v1/collections/assets')
      .set(student)
      .field('formId', form.id)
      .field('fieldId', 'poster')
      .attach('file', png, { filename: 'stale.png', contentType: 'image/png' })
      .expect(201);

    vi.setSystemTime(new Date('2026-09-28T00:00:00.000Z'));
    await request(app)
      .post('/api/development/v1/collections/assets')
      .set(student)
      .field('formId', form.id)
      .field('fieldId', 'poster')
      .attach('file', png, { filename: 'fresh.png', contentType: 'image/png' })
      .expect(201);
    await request(app)
      .get(`/api/development/v1/collections/assets/${stale.body.data.id}`)
      .set(student)
      .expect(404);
  });
});
