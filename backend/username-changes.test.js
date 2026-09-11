const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const {
  changeUsername,
  getUsernameChangePolicy,
  createUsernameRouter,
} = require('./username-policy');

// Emulates only the required SQL contracts, with a user lock and rollback snapshot.
// Live MySQL calendar/locking verification remains a separate deployment check.
function store({ username = 'old_name', balance = 20, free = true } = {}) {
  const state = {
    user: { id: 7, username, full_name: '真实姓名', manetrons: balance },
    free,
    logs: [],
    events: [],
  };
  let tail = Promise.resolve();
  const pool = {
    async getConnection() {
      let unlock;
      let backup;
      return {
        async beginTransaction() {
          const previous = tail;
          tail = new Promise((resolve) => {
            unlock = resolve;
          });
          await previous;
          backup = structuredClone({ user: state.user, free: state.free, logs: state.logs });
          state.events.push('begin');
        },
        async execute(sql, args) {
          if (sql.startsWith('SELECT * FROM users')) {
            assert.match(sql, /FOR UPDATE/);
            assert.equal(args[0], 7);
            state.events.push('lock');
            return [[{ ...state.user }]];
          }
          if (sql.includes('MAX(changed_at)')) {
            assert.match(sql, /INTERVAL 3 MONTH/);
            assert.match(sql, /UTC_TIMESTAMP\(3\)/);
            assert.match(sql, /change_kind = 'free'/);
            return [
              [
                {
                  free_available: Number(state.free),
                  next_free_at: state.free ? null : '2026-12-11T00:00:00.000000Z',
                },
              ],
            ];
          }
          if (sql.startsWith('UPDATE users SET username')) {
            state.events.push('update');
            if (args[0] === 'taken_name')
              throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
            state.user.username = args[0];
            state.user.manetrons -= args[1];
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO username_change_log')) {
            if (state.failLog) throw new Error('log write failed');
            state.logs.push(args);
            if (args[3] === 'free') state.free = false;
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async commit() {
          state.events.push('commit');
        },
        async rollback() {
          Object.assign(state, backup);
          state.events.push('rollback');
        },
        release() {
          state.events.push('release');
          unlock();
        },
      };
    },
    async execute(sql, args) {
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      try {
        return await connection.execute(sql, args);
      } finally {
        connection.release();
      }
    },
  };
  const change = (data = {}) =>
    changeUsername({
      pool,
      userId: 7,
      username: 'new_name',
      expectedUsername: 'old_name',
      ...data,
    });
  return { state, pool, change };
}

test('first voluntary rename is free and logs the free period only after success', async () => {
  const f = store();
  const result = await f.change();
  assert.equal(result.charged, 0);
  assert.equal(result.policy.freeAvailable, false);
  assert.equal(f.state.user.manetrons, 20);
  assert.equal(f.state.logs[0][3], 'free');
  assert.equal(f.state.user.full_name, '真实姓名');
  assert.ok(f.state.events.indexOf('lock') < f.state.events.indexOf('update'));
});

test('paid rename requires explicit boolean consent and deducts exactly ten', async () => {
  const f = store({ free: false });
  for (const allowPaid of [undefined, false, 'true', 1]) {
    await assert.rejects(f.change({ allowPaid }), { code: 'payment_confirmation_required' });
    assert.equal(f.state.user.manetrons, 20);
  }
  const result = await f.change({ allowPaid: true });
  assert.equal(result.charged, 10);
  assert.equal(f.state.user.manetrons, 10);
  assert.equal(f.state.logs[0][3], 'paid');
  assert.equal(result.policy.nextFreeAt, '2026-12-11T00:00:00.000000Z');
});

test('free eligibility is preferred even if the client previously consented to payment', async () => {
  const f = store();
  assert.equal((await f.change({ allowPaid: true })).charged, 0);
});

test('balance nine blocks paid rename and balance ten reaches zero', async () => {
  const f = store({ free: false, balance: 9 });
  await assert.rejects(f.change({ allowPaid: true }), { code: 'insufficient_magnetic' });
  assert.equal(f.state.user.username, 'old_name');
  assert.equal(f.state.logs.length, 0);
  const exact = store({ free: false, balance: 10 });
  await exact.change({ allowPaid: true });
  assert.equal(exact.state.user.manetrons, 0);
});

test('duplicate names and log failures roll back both money and nickname', async () => {
  for (const free of [true, false]) {
    const f = store({ free });
    await assert.rejects(f.change({ username: 'taken_name', allowPaid: true }), {
      code: 'username_taken',
    });
    f.state.failLog = true;
    await assert.rejects(f.change({ allowPaid: true }), /log write failed/);
    assert.equal(f.state.user.username, 'old_name');
    assert.equal(f.state.user.manetrons, 20);
    assert.equal(f.state.free, free);
    assert.equal(f.state.logs.length, 0);
  }
});

test('same-name retries never charge twice or consume another free turn', async () => {
  const f = store({ free: false });
  const results = await Promise.all([f.change({ allowPaid: true }), f.change({ allowPaid: true })]);
  assert.deepEqual(
    results.map((result) => result.charged),
    [10, 0],
  );
  assert.equal(f.state.logs.length, 1);
});

test('two different concurrent names cannot both spend the same free turn', async () => {
  const f = store();
  const results = await Promise.allSettled([
    f.change(),
    f.change({ username: 'other_name', allowPaid: true }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.code, 'username_stale');
  assert.equal(f.state.logs.length, 1);
  assert.equal(f.state.user.manetrons, 20);
});

test('legacy mandatory repair is free and does not consume the voluntary allowance', async () => {
  const f = store({ username: '旧昵称', balance: 0 });
  await f.change({ expectedUsername: undefined });
  assert.equal(f.state.logs[0][3], 'required');
  assert.equal(f.state.free, true);
});

test('invalid names fail before opening a transaction', async () => {
  const f = store();
  for (const username of ['ab', '中文名字', 'bad name', 'abc\n', 'x'.repeat(65), null]) {
    await assert.rejects(f.change({ username }), { code: 'invalid_username' });
  }
  assert.equal(f.state.events.length, 0);
});

test('policy uses database calendar months and SQL timestamp boundary, not browser clock', async () => {
  const f = store({ free: false });
  const policy = await getUsernameChangePolicy(f.pool, f.state.user);
  assert.equal(policy.cost, 10);
  assert.ok(Number.isFinite(Date.parse(policy.nextFreeAt)));
});

test('HTTP router authenticates, protects user identity, returns fresh token and private policy', async (t) => {
  const f = store();
  const app = express();
  app.use(express.json());
  app.use(
    '/username',
    createUsernameRouter({
      pool: f.pool,
      requireAuth: async (request, response) => {
        if (request.headers.authorization !== 'Bearer local-test') {
          response.status(401).json({});
          return null;
        }
        return f.state.user;
      },
      toUserProfile: (user) => ({
        id: user.id,
        username: user.username,
        manetrons: user.manetrons,
      }),
      issueToken: (user) => `local-test-${user.username}`,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/username`;
  const headers = { Authorization: 'Bearer local-test', 'Content-Type': 'application/json' };
  assert.equal((await fetch(url)).status, 401);
  const get = await fetch(url, { headers });
  assert.equal(get.headers.get('cache-control'), 'no-store');
  assert.equal((await get.json()).policy.freeAvailable, true);
  const result = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      username: 'new_name',
      expectedUsername: 'old_name',
      userId: 999,
      pool: {},
      cost: -100,
    }),
  });
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.user.id, 7);
  assert.equal(payload.token, 'local-test-new_name');
  assert.equal(payload.charged, 0);
});

test('profile endpoint rejects forged name updates but preserves ordinary bio saving', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf("app.patch('/api/profile',");
  const end = source.indexOf("app.patch('/api/profile/password',", start);
  assert.ok(start > 0 && end > start);
  let handler;
  const writes = [];
  const user = { id: 7, full_name: '真实姓名' };
  vm.runInNewContext(source.slice(start, end), {
    app: {
      patch: (route, callback) => {
        handler = callback;
      },
    },
    requireAuth: async () => user,
    sanitizeWebsiteUrl: (value) => value || '',
    pool: { execute: async (...args) => writes.push(args) },
    createUniqueUserUid: async () => 'uid7',
    getUserById: async () => user,
    toUserProfile: (value) => value,
  });
  const response = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  await handler({ body: { fullName: '伪造姓名', bio: 'bio' } }, response);
  assert.equal(response.code, 403);
  assert.equal(writes.length, 0);
  await handler({ body: { bio: 'bio' } }, response);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0][0], /full_name\s*=/);
  assert.equal(writes[0][1][1], 'bio');
  const adminStart = source.indexOf("app.patch('/api/admin/users/:id',");
  const admin = source.slice(adminStart, source.indexOf('connection.commit()', adminStart));
  assert.match(admin, /await requireAdmin\(request, response\)/);
  assert.match(admin, /full_name = \?/);
});

test(
  'isolated MySQL validates migration, calendar boundaries and concurrent billing',
  {
    skip: process.env.RUN_USERNAME_INTEGRATION !== '1',
    timeout: 30000,
  },
  async (t) => {
    const mysql = require('mysql2/promise');
    const crypto = require('node:crypto');
    const { ensureUsernameChangeTables } = require('./username-policy');
    const database = `freebbs_username_test_${crypto.randomBytes(8).toString('hex')}`;
    // No application config is imported. This test requires an explicit opt-in test DB account.
    assert.ok(
      process.env.USERNAME_TEST_MYSQL_USER,
      'Set a disposable MySQL test account explicitly',
    );
    const options = {
      host: process.env.USERNAME_TEST_MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.USERNAME_TEST_MYSQL_PORT || 3306),
      user: process.env.USERNAME_TEST_MYSQL_USER,
      password: process.env.USERNAME_TEST_MYSQL_PASSWORD || '',
    };
    const admin = await mysql.createConnection(options);
    let pool;
    let created = false;
    t.after(async () => {
      if (pool) await pool.end();
      if (created) {
        assert.match(database, /^freebbs_username_test_[a-f0-9]{16}$/);
        await admin.query(`DROP DATABASE \`${database}\``);
      }
      await admin.end();
    });
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    created = true;
    pool = mysql.createPool({ ...options, database, connectionLimit: 4 });
    await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY, username VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(64) NOT NULL, manetrons BIGINT NOT NULL DEFAULT 20
  ) ENGINE=InnoDB`);
    const migration = fs.readFileSync(
      path.join(__dirname, '../database/migrations/034_username_changes.sql'),
      'utf8',
    );
    await pool.query(migration);
    await pool.query(migration);
    await ensureUsernameChangeTables(pool);
    await pool.execute(
      "INSERT INTO users (id, username, full_name) VALUES (7, 'old_name', 'Original'), (8, 'taken_name', 'Other')",
    );
    const change = (data = {}) =>
      changeUsername({
        pool,
        userId: 7,
        username: 'new_name',
        expectedUsername: 'old_name',
        ...data,
      });
    const concurrent = await Promise.allSettled([
      change(),
      change({ username: 'other_name', allowPaid: true }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      concurrent.find((result) => result.status === 'rejected').reason.code,
      'username_stale',
    );
    const [[saved]] = await pool.execute('SELECT * FROM users WHERE id = 7');
    assert.equal(saved.manetrons, 20);
    const before = await getUsernameChangePolicy(pool, saved);
    assert.equal(before.cost, 10);
    const paid = await change({
      username: 'paid_name',
      expectedUsername: saved.username,
      allowPaid: true,
    });
    assert.equal(paid.user.manetrons, 10);
    assert.equal(paid.policy.nextFreeAt, before.nextFreeAt);
    assert.equal(
      (await change({ username: 'paid_name', expectedUsername: saved.username, allowPaid: true }))
        .charged,
      0,
    );
    await assert.rejects(
      change({ username: 'taken_name', expectedUsername: 'paid_name', allowPaid: true }),
      { code: 'username_taken' },
    );
    const [[afterDuplicate]] = await pool.execute('SELECT * FROM users WHERE id = 7');
    assert.equal(afterDuplicate.manetrons, 10);
    assert.equal(afterDuplicate.username, 'paid_name');
    assert.equal(afterDuplicate.full_name, 'Original');
    for (const [date, expected] of [
      ['2026-01-31 12:00:00.000', '2026-04-30T12:00:00.000000Z'],
      ['2023-11-30 12:00:00.000', '2024-02-29T12:00:00.000000Z'],
    ]) {
      await pool.execute(
        "UPDATE username_change_log SET changed_at = ? WHERE user_id = 7 AND change_kind = 'free'",
        [date],
      );
      assert.equal((await getUsernameChangePolicy(pool, afterDuplicate)).nextFreeAt, expected);
    }
    await pool.execute(
      "UPDATE username_change_log SET changed_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 MONTH) - INTERVAL 1 DAY WHERE user_id = 7 AND change_kind = 'free'",
    );
    assert.equal((await getUsernameChangePolicy(pool, afterDuplicate)).freeAvailable, true);
    assert.equal(
      (await change({ username: 'next_free', expectedUsername: 'paid_name' })).charged,
      0,
    );
    const [[counts]] = await pool.execute(
      'SELECT COUNT(*) AS total, SUM(magnetic_cost) AS spent FROM username_change_log WHERE user_id = 7',
    );
    assert.equal(Number(counts.total), 3);
    assert.equal(Number(counts.spent), 10);
  },
);
