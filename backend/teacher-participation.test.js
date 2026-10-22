const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const http = require('node:http');
const {
  ensureTeacherParticipationTables,
  createTeacherParticipationRouter,
  createMysqlTeacherParticipationStore,
  normalizeTeachingCourses,
  isVerifiedTeacher,
} = require('./teacher-participation');
const { listenAllowedLoopback } = require('../scripts/fixtures/allowed-loopback');

function fakeDatabase() {
  const state = {
    users: [
      { id: 1, role: 'admin', full_name: '管理员', is_admin: 1 },
      { id: 2, role: 'teacher', full_name: '任课教师', is_admin: 0 },
      { id: 3, role: 'student', full_name: '已认证教师', is_admin: 0 },
      { id: 4, role: 'student', full_name: '普通同学', is_admin: 0 },
    ],
    certified: new Set([3]),
    courses: [
      { id: 10, slug: 'signals', name: '信号与系统', code: 'SS', is_active: 1 },
      { id: 11, slug: 'circuits', name: '电路', code: 'EC', is_active: 1 },
      { id: 12, slug: 'retired', name: '已停用课程', code: 'OLD', is_active: 0 },
    ],
    assignments: [
      { course_id: 10, user_id: 2, assigned_by: 1 },
      { course_id: 11, user_id: 3, assigned_by: 1 },
    ],
    managers: new Set(),
    feedback: [],
    queries: [],
    commits: 0,
    rollbacks: 0,
    releases: 0,
    failInsert: false,
    failRead: false,
  };
  let snapshot;
  const executor = {
    async execute(rawSql, values = []) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      assert.equal((sql.match(/\?/g) || []).length, values.length, 'all SQL values are bound');
      state.queries.push({ sql, values });
      if (state.failRead && sql.startsWith('SELECT'))
        throw Object.assign(new Error('private database detail'), { code: 'DB_TEST_FAILURE' });
      if (sql.startsWith('SELECT id, role, full_name, is_admin FROM users')) {
        return [state.users.filter((user) => values.includes(user.id))];
      }
      if (sql.startsWith('SELECT slot FROM user_certifications')) {
        assert.match(sql, /user_id = \? AND slot = 'teacher'/);
        return [state.certified.has(values[0]) ? [{ slot: 'teacher' }] : []];
      }
      if (sql.startsWith('SELECT slug, name, code FROM courses')) {
        assert.match(sql, /WHERE is_active = 1/);
        return [state.courses.filter((course) => course.is_active)];
      }
      if (sql.startsWith('SELECT id, slug FROM courses')) {
        assert.match(sql, /is_active = 1 AND slug IN \(.+\) ORDER BY id FOR UPDATE/);
        return [state.courses.filter((course) => course.is_active && values.includes(course.slug))];
      }
      if (sql.startsWith('SELECT c.slug, c.name, c.code,')) {
        assert.match(sql, /course_material_managers/);
        assert.match(sql, /WHERE t.user_id = \? AND c.is_active = 1/);
        const [admin, managerId, userId] = values;
        return [
          state.assignments
            .filter((item) => item.user_id === userId)
            .map((item) => state.courses.find((course) => course.id === item.course_id))
            .filter((course) => course.is_active)
            .map((course) => ({
              ...course,
              can_edit_materials: Number(
                Boolean(admin || state.managers.has(`${course.id}:${managerId}`)),
              ),
            })),
        ];
      }
      if (sql.startsWith('SELECT c.slug FROM course_teaching_memberships')) {
        assert.match(sql, /WHERE t.user_id = \?/);
        return [
          state.assignments
            .filter((item) => item.user_id === values[0])
            .map((item) => state.courses.find((course) => course.id === item.course_id)),
        ];
      }
      if (sql.startsWith('SELECT e.id, c.slug AS course_slug')) {
        assert.match(sql, /WHERE e.user_id = \? AND e.kind = 'contribution' AND c.is_active = 1/);
        assert.match(sql, /ORDER BY e.id DESC LIMIT 20$/);
        return [
          state.feedback
            .filter((item) => item.user_id === values[0] && item.kind === 'contribution')
            .filter(
              (item) => state.courses.find((course) => course.id === item.course_id)?.is_active,
            )
            .sort((a, b) => b.id - a.id)
            .slice(0, 20)
            .map((item) => {
              const course = state.courses.find((candidate) => candidate.id === item.course_id);
              return { ...item, course_slug: course.slug, course_name: course.name };
            }),
        ];
      }
      if (sql === 'DELETE FROM course_teaching_memberships WHERE user_id = ?') {
        state.assignments = state.assignments.filter((item) => item.user_id !== values[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO course_teaching_memberships')) {
        if (state.failInsert) throw new Error('injected insert failure');
        state.assignments.push({
          course_id: values[0],
          user_id: values[1],
          assigned_by: values[2],
          assigned_at: values[3],
        });
        return [{ affectedRows: 1 }];
      }
      assert.fail(`Unexpected query: ${sql}`);
    },
    async beginTransaction() {
      snapshot = state.assignments.map((item) => ({ ...item }));
    },
    async commit() {
      state.commits += 1;
    },
    async rollback() {
      state.assignments = snapshot;
      state.rollbacks += 1;
    },
    release() {
      state.releases += 1;
    },
  };
  return {
    state,
    pool: { execute: executor.execute, getConnection: async () => executor },
  };
}

async function fixture(t) {
  const { state, pool } = fakeDatabase();
  const loggedErrors = [];
  const tokens = {
    admin: { id: 1, is_admin: 1 },
    teacher: { id: 2, role: 'teacher' },
    certified: { id: 3, role: 'student' },
    student: { id: 4, role: 'student' },
    'forged-teacher': { id: 4, role: 'teacher', certifications: [{ type: 'teacher' }] },
    'stale-admin': { id: 4, is_admin: 1 },
  };
  async function requireAuth(req, res) {
    const user = tokens[req.headers.authorization?.replace('Bearer ', '')];
    if (!user) {
      res.status(401).json({ message: '请先登录' });
      return null;
    }
    return user;
  }
  async function requireAdmin(req, res) {
    const user = await requireAuth(req, res);
    if (user && !user.is_admin) {
      res.status(403).json({ message: '需要管理员权限' });
      return null;
    }
    return user;
  }
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createTeacherParticipationRouter({
      pool,
      requireAuth,
      requireAdmin,
      logger: { error: (...args) => loggedErrors.push(args) },
    }),
  );
  const server = http.createServer(app);
  await listenAllowedLoopback(server);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(
    url = '/teacher/workspace',
    token = 'teacher',
    method = 'GET',
    body = undefined,
  ) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  return { state, pool, call, loggedErrors };
}

test('teaching course validation requires explicit verification and bounded canonical slugs', () => {
  assert.deepEqual(
    normalizeTeachingCourses({
      courseSlugs: [' Signals ', 'signals', 'circuits'],
      identityConfirmed: true,
    }),
    ['signals', 'circuits'],
  );
  assert.deepEqual(normalizeTeachingCourses({ courseSlugs: [], identityConfirmed: true }), []);
  for (const identityConfirmed of [false, undefined, 1, 'true'])
    assert.throws(() => normalizeTeachingCourses({ courseSlugs: [], identityConfirmed }), {
      code: 'identity_confirmation_required',
    });
  for (const courseSlugs of [
    undefined,
    'signals',
    [null],
    [''],
    ['bad/slug'],
    ['x'.repeat(121)],
    Array(21).fill('signals'),
  ])
    assert.throws(() => normalizeTeachingCourses({ courseSlugs, identityConfirmed: true }), {
      code: 'invalid_teaching_courses',
    });
  for (const body of [null, [], 'signals'])
    assert.throws(() => normalizeTeachingCourses(body), { code: 'invalid_teaching_courses' });
  assert.equal(isVerifiedTeacher({ role: 'teacher' }, false), true);
  assert.equal(isVerifiedTeacher({ role: 'student' }, true), true);
  assert.equal(isVerifiedTeacher({ role: 'admin' }, false), false);
  assert.equal(isVerifiedTeacher({ role: 'student' }, 'false'), false);
});

test('workspace authenticates and never trusts a client-side teacher role or certification', async (t) => {
  const { call, state } = await fixture(t);
  assert.equal((await call('/teacher/workspace', '')).status, 401);
  for (const token of ['student', 'forged-teacher']) {
    const result = await call('/teacher/workspace?userId=2', token);
    assert.equal(result.status, 200);
    assert.equal(result.data.eligible, false);
    assert.equal(result.data.identity.role, 'student');
    assert.equal(result.data.identity.certified, false);
    assert.deepEqual(result.data.courses, []);
    assert.deepEqual(result.data.feedback, []);
    assert.match(result.headers.get('cache-control'), /private, no-store/);
  }
  assert.equal(
    state.queries.some(({ sql }) => /FROM learning_entries/.test(sql)),
    false,
  );
});

test('admin-provisioned and approved teachers receive only their own assigned courses without edit grants', async (t) => {
  const { call, state } = await fixture(t);
  const teacher = (await call()).data;
  assert.equal(teacher.eligible, true);
  assert.equal(teacher.identity.certified, false);
  assert.deepEqual(teacher.courses, [
    { slug: 'signals', name: '信号与系统', code: 'SS', canEditMaterials: false },
  ]);
  const certified = (await call('/teacher/workspace', 'certified')).data;
  assert.equal(certified.eligible, true);
  assert.equal(certified.identity.role, 'student');
  assert.equal(certified.identity.certified, true);
  assert.equal(certified.courses[0].slug, 'circuits');
  assert.equal(state.users.find((user) => user.id === 3).role, 'student');
  assert.equal(state.managers.size, 0);
  state.managers.add('10:2');
  assert.equal((await call()).data.courses[0].canEditMaterials, true);
});

test('identity revocation takes effect on the next read, even when old teaching assignments remain', async (t) => {
  const { call, state } = await fixture(t);
  assert.equal((await call()).data.eligible, true);
  state.users.find((user) => user.id === 2).role = 'student';
  const revokedRole = (await call()).data;
  assert.equal(revokedRole.eligible, false);
  assert.deepEqual(revokedRole.courses, []);
  assert.equal(
    state.assignments.some((item) => item.user_id === 2),
    true,
  );
  state.certified.delete(3);
  assert.equal((await call('/teacher/workspace', 'certified')).data.eligible, false);
});

test('workspace hides inactive courses and limits feedback to 20 owned contributions', async (t) => {
  const { call, state } = await fixture(t);
  state.assignments.push({ course_id: 12, user_id: 2 });
  const own = (id, changes = {}) => ({
    id,
    user_id: 2,
    course_id: 10,
    node_id: 'SS-01-01',
    point_title: '卷积',
    title: `正文意见 ${id}`,
    content: '建议补充变量代换的说明',
    excerpt: '变量代换',
    category: 'improvement',
    status: 'pending',
    review_response: null,
    document_version: 'a'.repeat(64),
    updated_at: '2026-10-22T00:00:00.000Z',
    kind: 'contribution',
    ...changes,
  });
  state.feedback = [
    ...Array.from({ length: 25 }, (_, index) => own(index + 1)),
    own(100, { user_id: 4, content: 'OTHER_PERSON_PRIVATE' }),
    own(101, { kind: 'note', content: 'OWN_PRIVATE_NOTE' }),
    own(102, { kind: 'reflection', content: 'OWN_PRIVATE_REFLECTION' }),
    own(103, { course_id: 12, content: 'INACTIVE_COURSE' }),
  ];
  const result = (await call()).data;
  assert.equal(result.courses.length, 1);
  assert.equal(result.feedback.length, 20);
  assert.equal(result.feedback[0].id, '25');
  assert.equal(result.feedback.at(-1).id, '6');
  assert.equal(result.feedback[0].courseSlug, 'signals');
  assert.equal(result.feedback[0].pointId, 'SS-01-01');
  assert.equal(result.feedback[0].response, '');
  const feedbackRead = state.queries.find(({ sql }) => sql.startsWith('SELECT e.id'));
  assert.match(feedbackRead.sql, /n\.course_id = e\.course_id/);
  assert.match(feedbackRead.sql, /CAST\(n\.node_id AS BINARY\) = CAST\(e\.node_id AS BINARY\)/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /OTHER_PERSON_PRIVATE|OWN_PRIVATE|INACTIVE_COURSE|reviewed_by|email|student_id/,
  );
});

test('administrator catalog is separate from course editing permissions and bounded by active courses', async (t) => {
  const { call } = await fixture(t);
  const path = '/admin/users/2/teaching-courses';
  assert.equal((await call(path, '')).status, 401);
  assert.equal((await call(path, 'teacher')).status, 403);
  assert.equal((await call(path, 'stale-admin')).status, 403);
  const result = await call(path, 'admin');
  assert.equal(result.status, 200);
  assert.equal(result.data.eligible, true);
  assert.deepEqual(result.data.courseSlugs, ['signals']);
  assert.deepEqual(
    result.data.courses.map((course) => course.slug),
    ['signals', 'circuits'],
  );
  assert.doesNotMatch(JSON.stringify(result.data), /canEdit|student_id|email|full_name/);
  for (const id of ['0', '-1', 'abc', '1.2', '9007199254740992'])
    assert.equal((await call(`/admin/users/${id}/teaching-courses`, 'admin')).status, 400);
  assert.equal((await call('/admin/users/99/teaching-courses', 'admin')).status, 404);
});

test('only administrators can associate courses and actor IDs cannot be supplied in the body', async (t) => {
  const { call, state } = await fixture(t);
  const body = {
    courseSlugs: ['circuits'],
    identityConfirmed: true,
    adminId: 1,
    userId: 3,
    is_admin: true,
  };
  const result = await call('/admin/users/2/teaching-courses', 'teacher', 'PUT', body);
  assert.equal(result.status, 403);
  assert.equal(state.commits, 0);
  assert.equal((await call('/admin/users/2/teaching-courses', 'admin', 'PUT', body)).status, 200);
  assert.deepEqual(
    state.assignments.filter((item) => item.user_id === 2).map((item) => item.course_id),
    [11],
  );
  assert.equal(state.assignments.find((item) => item.user_id === 2).assigned_by, 1);
  assert.deepEqual(
    state.assignments.filter((item) => item.user_id === 3).map((item) => item.course_id),
    [11],
  );
  assert.equal(state.managers.size, 0);
  assert.equal(
    state.queries.some(({ sql }) => /^(INSERT|UPDATE|DELETE).*course_material_managers/.test(sql)),
    false,
  );
  assert.equal(
    state.queries.some(({ sql }) =>
      /^(INSERT|UPDATE|DELETE).*(users|user_certifications|learning_entries)/.test(sql),
    ),
    false,
  );
});

test('updates recheck teacher and administrator identities under transaction locks', async (t) => {
  const { call, state } = await fixture(t);
  const body = { courseSlugs: ['signals'], identityConfirmed: true };
  assert.equal((await call('/admin/users/3/teaching-courses', 'admin', 'PUT', body)).status, 200);
  assert.equal(state.users.find((user) => user.id === 3).role, 'student');
  state.certified.delete(3);
  assert.equal((await call('/admin/users/3/teaching-courses', 'admin', 'PUT', body)).status, 409);
  assert.match(
    state.queries.find(({ sql }) => /WHERE id IN/.test(sql)).sql,
    /ORDER BY id FOR UPDATE$/,
  );
  assert.equal(
    state.queries.some(({ sql }) => /user_certifications.*FOR UPDATE$/.test(sql)),
    true,
  );
  assert.equal(
    (await call('/admin/users/2/teaching-courses', 'stale-admin', 'PUT', body)).status,
    403,
  );
  state.users.find((user) => user.id === 1).is_admin = 0;
  assert.equal((await call('/admin/users/2/teaching-courses', 'admin', 'PUT', body)).status, 403);
});

test('administrators may clear obsolete assignments after teacher eligibility has been revoked', async (t) => {
  const { call, state } = await fixture(t);
  state.users.find((user) => user.id === 2).role = 'student';
  const before = (await call('/admin/users/2/teaching-courses', 'admin')).data;
  assert.equal(before.eligible, false);
  assert.deepEqual(before.courseSlugs, ['signals']);
  assert.equal(
    (
      await call('/admin/users/2/teaching-courses', 'admin', 'PUT', {
        courseSlugs: [],
        identityConfirmed: true,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    state.assignments.filter((item) => item.user_id === 2),
    [],
  );
});

test('invalid or inactive courses fail atomically, and unexpected database errors do not disclose details', async (t) => {
  const { call, state, loggedErrors } = await fixture(t);
  const path = '/admin/users/2/teaching-courses';
  for (const courseSlugs of [['missing'], ['signals', 'retired']]) {
    const result = await call(path, 'admin', 'PUT', { courseSlugs, identityConfirmed: true });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'course_unavailable');
    assert.deepEqual(
      state.assignments.filter((item) => item.user_id === 2).map((item) => item.course_id),
      [10],
    );
  }
  state.failInsert = true;
  const failed = await call(path, 'admin', 'PUT', {
    courseSlugs: ['circuits'],
    identityConfirmed: true,
  });
  assert.equal(failed.status, 503);
  assert.equal(failed.data.code, 'teacher_participation_unavailable');
  assert.doesNotMatch(JSON.stringify(failed.data), /injected|SQL|private database/);
  assert.deepEqual(
    state.assignments.filter((item) => item.user_id === 2).map((item) => item.course_id),
    [10],
  );
  assert.equal(state.rollbacks, 3);
  assert.equal(state.releases, 3);
  assert.equal(loggedErrors.length, 1);
  state.failRead = true;
  assert.equal((await call()).status, 503);
});

test('failed confirmation does not start a mutation and new assignments never grant course edit powers', async (t) => {
  const { call, state } = await fixture(t);
  assert.equal(
    (
      await call('/admin/users/2/teaching-courses', 'admin', 'PUT', {
        courseSlugs: ['circuits'],
        identityConfirmed: false,
      })
    ).status,
    400,
  );
  assert.equal(state.queries.length, 0);
  assert.equal(state.releases, 0);
  assert.equal(
    (
      await call('/admin/users/2/teaching-courses', 'admin', 'PUT', {
        courseSlugs: ['signals', 'circuits'],
        identityConfirmed: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call()).data.courses.every((course) => course.canEditMaterials === false),
    true,
  );
  assert.equal(state.managers.size, 0);
});

test('schema initialization creates only display-only teaching associations and is safe to repeat', async () => {
  const queries = [];
  const pool = { query: async (sql) => queries.push(sql) };
  await ensureTeacherParticipationTables(pool);
  await ensureTeacherParticipationTables(pool);
  assert.equal(queries.length, 2);
  assert.equal(queries[0], queries[1]);
  assert.match(queries[0], /^CREATE TABLE IF NOT EXISTS course_teaching_memberships/);
  assert.match(queries[0], /PRIMARY KEY \(course_id, user_id\)/);
  assert.match(queries[0], /assigned_by BIGINT NULL/);
  assert.match(queries[0], /REFERENCES courses\(id\) ON DELETE CASCADE/);
  assert.match(queries[0], /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(queries[0], /REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(
    queries[0],
    /ALTER TABLE|course_material_managers|INSERT INTO|UPDATE |DELETE FROM/,
  );
});

test('MySQL replacement binds canonical IDs and the verified actor in its assignment audit', async () => {
  const { pool, state } = fakeDatabase();
  const at = Date.parse('2026-10-22T01:02:03.000Z');
  const store = createMysqlTeacherParticipationStore(pool, { now: () => at });
  const result = await store.replace(1, 2, ['circuits']);
  assert.deepEqual(result, { courseSlugs: ['circuits'] });
  const write = state.queries.find(({ sql }) => sql.startsWith('INSERT'));
  assert.deepEqual(write.values, [11, 2, 1, new Date(at)]);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  assert.equal(state.releases, 1);
});
