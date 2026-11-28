const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const { createTrainingRouter } = require('./training');

test('小班辅导报名及批次管理', async (t) => {
  let batch;
  let application;
  const courses = [];
  const preferences = [];
  const notifications = [];
  const pool = {
    async execute(sql, args) {
      if (sql.includes('FROM training_user_access')) return [[]];
      if (sql.startsWith('INSERT INTO training_batches')) {
        const [slug, title, opensAt, closesAt] = args;
        batch = { id: 1, slug, title, opensAt, closesAt, publishedAt: null, visibility: null };
        return [{ insertId: batch.id }];
      }
      if (sql.startsWith('INSERT INTO training_courses')) {
        const [, title, titleKey, teacher] = args;
        assert.ok(!courses.some((course) => course.titleKey === titleKey));
        const offered = sql.includes('teacher, offered');
        const course = { id: courses.length + 1, title, titleKey, teacher, offered };
        courses.push(course);
        return [{ insertId: course.id }];
      }
      if (sql.includes('WHERE b.slug = ?')) {
        return [batch?.slug === args[0] ? [batch] : []];
      }
      if (sql.includes('ORDER BY b.opens_at DESC')) {
        assert.match(sql, /WHERE \(\? OR v\.visibility IS NULL OR v\.visibility = 'public'\)/);
        return [batch && (args[0] || batch.visibility !== 'hidden') ? [batch] : []];
      }
      if (sql.includes('FROM training_assignments a JOIN training_applications p')) return [[]];
      if (sql.includes('FROM training_courses c JOIN training_batches b')) {
        assert.match(sql, /v\.visibility = 'hidden'/);
        return [[]];
      }
      if (sql.startsWith('SELECT id, title, teacher FROM training_courses')) {
        return [
          courses
            .filter(({ offered }) => offered)
            .map(({ id, title, teacher }) => ({ id, title, teacher })),
        ];
      }
      if (sql.includes('FROM training_applications')) return [application ? [application] : []];
      if (sql.startsWith('SELECT id, title_key AS titleKey')) return [courses];
      if (sql.startsWith('INSERT INTO training_applications')) {
        application = { id: 1 };
        return [{ insertId: application.id }];
      }
      if (sql.startsWith('INSERT INTO training_preferences')) {
        const [, applicationId, courseId, rank] = args;
        assert.equal(applicationId, application.id);
        assert.ok(!preferences.some((preference) => preference.courseId === courseId));
        preferences.push({ courseId, rank });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE training_batches SET closes_at')) {
        batch.closesAt = args[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO training_batch_visibility')) {
        assert.equal(args[0], batch.id);
        batch.visibility = args[1];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM training_batches')) {
        assert.equal(args[0], batch.id);
        batch = null;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() {
      return {
        execute: pool.execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createTrainingRouter({
      pool,
      requireAuth: async (request) => ({
        id: Number(request.get('X-Test-User')),
        is_admin: request.get('X-Test-User') === '1',
        full_name: '测试讲师',
        student_id: '2026000000',
        email: null,
      }),
      notifications: {
        async notifyInApp(_db, recipients) {
          notifications.push(recipients);
        },
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  function requestApi(method, path, user, body) {
    return fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Test-User': user },
      body: JSON.stringify(body),
    });
  }
  const post = (...args) => requestApi('POST', ...args);

  const created = await post('/batches', '1', {
    title: '同名课堂测试',
    opensAt: Date.now() - 1000,
    closesAt: Date.now() + 60000,
    courses: [
      { title: '线性代数', teacher: '王老师', capacity: 1 },
      { title: '线性代数', teacher: '李老师', capacity: 1 },
    ],
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { slug } = await created.json();
  const publishedOptions = await fetch(`${origin}/batches/${slug}`, {
    headers: { 'X-Test-User': '2' },
  });
  assert.deepEqual((await publishedOptions.json()).courses, [
    { id: 1, title: '线性代数', teacher: '王老师' },
    { id: 2, title: '线性代数', teacher: '李老师' },
  ]);
  const request = {
    introduction: '测试报名',
    isLexue: false,
    signature: [
      [
        [0, 0],
        [30, 30],
      ],
    ],
    preferences: [2, 2, '线性代数', 1, '数字电路', '数字电路'],
  };
  const submitted = await post(`/batches/${slug}/applications`, '2', request);
  assert.equal(submitted.status, 201, await submitted.clone().text());
  assert.deepEqual(
    courses.map(({ title }) => title),
    ['线性代数', '线性代数', '数字电路'],
  );
  assert.deepEqual(preferences, [
    { courseId: 2, rank: 1 },
    { courseId: 1, rank: 2 },
    { courseId: 3, rank: 3 },
  ]);
  assert.deepEqual(notifications, [[2]]);
  assert.equal((await post(`/batches/${slug}/applications`, '2', request)).status, 409);

  await t.test('隐藏批次后只在管理端显示，且报名截止后才可公布', async () => {
    const endpoint = `/batches/${slug}`;
    const setVisibility = (visibility, user = '1') =>
      requestApi('PUT', `${endpoint}/visibility`, user, { visibility });
    assert.equal((await setVisibility('hidden', '2')).status, 403);
    const early = await setVisibility('public');
    assert.equal(early.status, 409);
    assert.equal((await early.json()).message, '报名截止后才可公布批次');
    assert.equal((await setVisibility('hidden')).status, 200);
    assert.equal((await requestApi('GET', endpoint, '2')).status, 404);
    assert.equal((await post(`${endpoint}/applications`, '2', request)).status, 404);
    assert.deepEqual((await (await requestApi('GET', '/', '2')).json()).batches, []);
    const managing = await (await requestApi('GET', '/?manage=1', '1')).json();
    assert.equal(managing.batches[0].visibility, 'hidden');
    assert.equal((await setVisibility('public')).status, 409);
    assert.equal((await post(`${endpoint}/close`, '1')).status, 200);
    assert.equal((await setVisibility('public')).status, 200);
    const visible = await (await requestApi('GET', '/', '2')).json();
    assert.equal(visible.batches[0].visibility, 'public');
    assert.equal(visible.batches[0].phase, 'closed');
    assert.equal((await requestApi('GET', endpoint, '2')).status, 200);
  });

  await t.test('删除批次需要管理权限，删除后报名和管理入口都不可用', async () => {
    const endpoint = `/batches/${slug}`;
    assert.equal((await requestApi('DELETE', endpoint, '2')).status, 403);
    assert.equal((await requestApi('DELETE', endpoint, '1')).status, 204);
    assert.equal((await requestApi('GET', endpoint, '2')).status, 404);
    assert.deepEqual((await (await requestApi('GET', '/?manage=1', '1')).json()).batches, []);
  });
});
