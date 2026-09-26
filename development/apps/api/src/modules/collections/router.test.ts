import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const member = { 'X-Demo-User': 'demo-rights-member' };
const admin = { 'X-Demo-User': 'demo-admin' };

function fixture() {
  const users = ['demo-student', 'demo-rights-member', 'demo-admin'];
  const store = createMemoryStore();
  return {
    store,
    app: createApp({ store, authMode: 'demo', authClient: new DemoAuthClient(users) }),
  };
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

describe('collections API', () => {
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
});
