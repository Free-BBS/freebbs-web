const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const express = require('express');
const { normalizeAdminAccount, createTeacherAccountsRouter } = require('./teacher-accounts');

test('only admin-provisioned teacher identities allow missing student ID and email', () => {
  const body = {
    username: 'professor_one',
    fullName: '测试教师',
    password: 'initial-password',
    role: 'teacher',
  };
  const teacher = normalizeAdminAccount(body);
  assert.equal(teacher.studentId, null);
  assert.equal(teacher.email, null);
  assert.equal(teacher.grade, null);
  assert.equal(teacher.major, null);
  for (const role of ['student', 'ta', 'admin']) {
    assert.throws(() => normalizeAdminAccount({ ...body, role }), { code: 'invalid_student_id' });
  }
  assert.throws(() => normalizeAdminAccount({ ...body, studentId: '123456' }), {
    code: 'invalid_student_id',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, email: 'invalid' }), {
    code: 'invalid_email',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, role: 'superuser' }), {
    code: 'invalid_role',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, password: 'short' }), {
    code: 'invalid_password',
  });
  assert.throws(() => normalizeAdminAccount({ ...body, username: 'teacher@example.test' }), {
    code: 'invalid_username',
  });
  assert.equal(
    normalizeAdminAccount({ ...body, email: ' Teacher@Example.test ' }).email,
    'teacher@example.test',
  );
});

test('identity HTTP endpoints authenticate and administrator actions cannot be forged in the body', async (t) => {
  let calls = 0;
  const service = new Proxy(
    {},
    {
      get: () => async () => {
        calls += 1;
        return {};
      },
    },
  );
  const requireAuth = async (request, response) => {
    if (request.headers.authorization !== 'Bearer teacher') {
      response.status(401).json({ message: 'login required' });
      return null;
    }
    return { id: 2, role: 'teacher', is_admin: 0 };
  };
  const requireAdmin = async (request, response) => {
    const user = await requireAuth(request, response);
    if (user) response.status(403).json({ message: 'admin required' });
    return null;
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createTeacherAccountsRouter({ service, requireAuth, requireAdmin }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(`${base}/profile/identity`)).status, 401);
  for (const route of ['/admin/users/2/reset-password', '/admin/student-id-requests/2']) {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { Authorization: 'Bearer teacher', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', isAdmin: true, action: 'approve' }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
});
