const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { hashPassword } = require('./password');
const {
  createMobileSafetyRouter,
  ensureMobileSafetyTables,
  validateReport,
  positiveId,
} = require('./mobile-safety');

const passwordHash = hashPassword('test-password');
function database() {
  const calls = [];
  let requestedAt = null;
  const pool = {
    calls,
    duplicate: false,
    reportCount: 0,
    targetExists: true,
    failInsert: false,
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    getConnection: async () => pool,
    async execute(raw, args = []) {
      const sql = raw.replace(/\s+/g, ' ').trim();
      calls.push({ sql, args });
      if (sql.startsWith('CREATE TABLE')) return [{}];
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: args[0] }]];
      if (sql.startsWith('SELECT password_hash')) return [[{ password_hash: passwordHash }]];
      if (
        sql.startsWith('SELECT id FROM discussion_posts') ||
        sql.startsWith('SELECT c.id FROM discussion_comments')
      )
        return [pool.targetExists ? [{ id: 40 }] : []];
      if (sql.startsWith('SELECT id FROM mobile_content_reports'))
        return [pool.duplicate ? [{ id: 1 }] : []];
      if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: pool.reportCount }]];
      if (sql.startsWith('INSERT INTO mobile_content_reports')) {
        if (pool.failInsert) throw new Error('sensitive database error');
        return [{ insertId: 1 }];
      }
      if (sql.startsWith('INSERT IGNORE INTO mobile_account_deletion_requests')) {
        requestedAt ||= '2026-10-03T06:00:00.000Z';
        return [{}];
      }
      if (sql.startsWith('SELECT requested_at'))
        return [requestedAt ? [{ requested_at: requestedAt }] : []];
      if (sql.startsWith('SELECT u.id, u.username')) return [[{ id: 2, username: 'peer' }]];
      if (sql.startsWith('SELECT r.id') || sql.startsWith('SELECT d.user_id')) return [[]];
      if (sql.startsWith('UPDATE mobile_content_reports'))
        return [{ affectedRows: pool.updateRows ?? 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  return pool;
}
async function harness(t, pool = database()) {
  const app = express();
  app.use(express.json());
  async function auth(req, res) {
    if (!req.headers.authorization) {
      res.status(401).json({ message: 'unauthorized' });
      return null;
    }
    return { id: 1 };
  }
  async function admin(req, res) {
    if (req.headers.authorization !== 'Bearer admin') {
      res.status(403).json({ message: 'forbidden' });
      return null;
    }
    return { id: 99 };
  }
  app.use('/api', createMobileSafetyRouter({ pool, requireAuth: auth, requireAdmin: admin }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    pool,
    async request(path, method = 'GET', body = undefined, token = 'user') {
      const response = await fetch(url + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}
const report = {
  targetType: 'post',
  targetId: 'public-post',
  reason: 'privacy',
  detail: 'personal information',
};

test('report validation rejects unknown targets, SQL fragments, invalid reasons and oversized details', () => {
  assert.deepEqual(validateReport(report), report);
  for (const patch of [
    { targetType: 'user' },
    { targetId: "'; DROP TABLE users" },
    { targetType: 'comment', targetId: 'abc' },
    { reason: 'bad' },
    { detail: {} },
    { detail: 'x'.repeat(2001) },
  ])
    assert.throws(() => validateReport({ ...report, ...patch }));
  for (const id of [0, -1, 0.1, 'x', Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => positiveId(id));
});
test('startup creates all three additive tables from the migration', async () => {
  const pool = database();
  await ensureMobileSafetyTables(pool);
  assert.equal(pool.calls.length, 3);
  assert.ok(pool.calls.every((call) => call.sql.startsWith('CREATE TABLE IF NOT EXISTS')));
});
test('user endpoints require authentication and return no cacheable private response', async (t) => {
  const h = await harness(t);
  for (const path of ['/api/mobile/blocks', '/api/mobile/account-deletion']) {
    const result = await h.request(path, 'GET', undefined, null);
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal(h.pool.calls.length, 0);
});
test('blocks are scoped to the authenticated account, self blocking is rejected', async (t) => {
  const h = await harness(t);
  assert.equal((await h.request('/api/mobile/blocks', 'POST', { userId: 1 })).status, 400);
  assert.equal(
    (await h.request('/api/mobile/blocks', 'POST', { userId: 2, user_id: 900 })).status,
    200,
  );
  const insert = h.pool.calls.find((call) =>
    call.sql?.startsWith('INSERT IGNORE INTO mobile_user_blocks'),
  );
  assert.deepEqual(insert.args, [1, 2]);
  await h.request('/api/mobile/blocks/2', 'DELETE');
  assert.deepEqual(h.pool.calls.at(-1).args, [1, 2]);
});
test('reports resolve a public post identifier and queue its internal ID transactionally', async (t) => {
  const h = await harness(t);
  assert.equal((await h.request('/api/mobile/reports', 'POST', report)).status, 201);
  const insert = h.pool.calls.find((call) =>
    call.sql?.startsWith('INSERT INTO mobile_content_reports'),
  );
  assert.deepEqual(insert.args, [1, 'post', '40', 'privacy', 'personal information']);
  assert.ok(h.pool.calls.includes('commit'));
  assert.equal(h.pool.calls.at(-1), 'release');
});
test('missing targets do not create a report', async (t) => {
  const h = await harness(t);
  h.pool.targetExists = false;
  assert.equal((await h.request('/api/mobile/reports', 'POST', report)).status, 404);
  assert.ok(!h.pool.calls.includes('begin'));
});
test('duplicate pending reports do not create another row', async (t) => {
  const h = await harness(t);
  h.pool.duplicate = true;
  assert.equal((await h.request('/api/mobile/reports', 'POST', report)).status, 201);
  assert.ok(
    !h.pool.calls.some((call) => call.sql?.startsWith('INSERT INTO mobile_content_reports')),
  );
});
test('rate limits roll back the transaction', async (t) => {
  const h = await harness(t);
  h.pool.reportCount = 20;
  assert.equal((await h.request('/api/mobile/reports', 'POST', report)).status, 429);
  assert.ok(h.pool.calls.includes('rollback'));
  assert.equal(h.pool.calls.at(-1), 'release');
});
test('insert failures roll back and never expose database details', async (t) => {
  const h = await harness(t);
  h.pool.failInsert = true;
  const result = await h.request('/api/mobile/reports', 'POST', report);
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.body).includes('sensitive'));
  assert.ok(h.pool.calls.includes('rollback'));
});
test('deletion requires an explicit confirmation and valid password', async (t) => {
  const h = await harness(t);
  assert.equal(
    (await h.request('/api/mobile/account-deletion', 'POST', { password: 'test-password' })).status,
    400,
  );
  assert.equal(
    (
      await h.request('/api/mobile/account-deletion', 'POST', {
        password: 'wrong',
        confirm: 'DELETE',
      })
    ).status,
    403,
  );
  assert.ok(
    !h.pool.calls.some((call) => call.sql?.startsWith('INSERT IGNORE INTO mobile_account')),
  );
});
test('deletion is idempotent and reported as pending, never as completed', async (t) => {
  const h = await harness(t);
  const initial = await h.request('/api/mobile/account-deletion');
  assert.equal(initial.body.status, 'none');
  const body = { password: 'test-password', confirm: 'DELETE' };
  const first = await h.request('/api/mobile/account-deletion', 'POST', body);
  const second = await h.request('/api/mobile/account-deletion', 'POST', body);
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'pending');
  assert.deepEqual(first.body, second.body);
  assert.ok(!h.pool.calls.some((call) => call.sql?.startsWith('DELETE FROM users')));
});
test('admin queues and resolution require administrator privileges', async (t) => {
  const h = await harness(t);
  for (const path of ['/api/admin/mobile/reports', '/api/admin/mobile/account-deletions']) {
    assert.equal((await h.request(path)).status, 403);
    assert.equal((await h.request(path, 'GET', undefined, 'admin')).status, 200);
  }
  assert.equal(
    (
      await h.request('/api/admin/mobile/reports/1', 'PATCH', {
        status: 'resolved',
        resolution: 'reviewed',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.request(
        '/api/admin/mobile/reports/1',
        'PATCH',
        { status: 'resolved', resolution: '' },
        'admin',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await h.request(
        '/api/admin/mobile/reports/1',
        'PATCH',
        { status: 'resolved', resolution: 'removed content' },
        'admin',
      )
    ).status,
    200,
  );
  h.pool.updateRows = 0;
  assert.equal(
    (
      await h.request(
        '/api/admin/mobile/reports/1',
        'PATCH',
        { status: 'resolved', resolution: 'reviewed' },
        'admin',
      )
    ).status,
    409,
  );
});
