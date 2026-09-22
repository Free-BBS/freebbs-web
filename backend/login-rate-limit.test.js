const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createLoginRateLimiter, ensureLoginRateTable } = require('./login-rate-limit');

function createTestPool(clock) {
  const rows = new Map();
  return {
    rows,
    async query(sql) {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS auth_login_attempts/);
      return [{ affectedRows: 0 }];
    },
    async execute(sql, params) {
      if (sql.startsWith('DELETE FROM auth_login_attempts WHERE expires_at <')) {
        for (const [key, row] of rows) {
          if (row.expiresAt < clock() - 24 * 60 * 60 * 1000) rows.delete(key);
        }
        return [{ affectedRows: 0 }];
      }
      if (sql.startsWith('INSERT IGNORE')) {
        if (!rows.has(params[0])) rows.set(params[0], { attempts: 0, expiresAt: clock() });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE auth_login_attempts')) {
        const [windowSeconds, key, limit] = params;
        const row = rows.get(key);
        if (row.expiresAt <= clock()) {
          row.attempts = 1;
          row.expiresAt = clock() + windowSeconds * 1000;
          return [{ affectedRows: 1 }];
        }
        if (row.attempts >= limit) return [{ affectedRows: 0 }];
        row.attempts += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT GREATEST')) {
        const row = rows.get(params[0]);
        return [[{ retry_after_seconds: Math.ceil((row.expiresAt - clock()) / 1000) }]];
      }
      if (sql.startsWith('DELETE FROM auth_login_attempts')) {
        rows.delete(params[0]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('account quota unifies username, email and case aliases, then recovers after cooldown', async () => {
  let time = 0;
  const pool = createTestPool(() => time);
  const limiter = createLoginRateLimiter({ pool, accountAttempts: 2, ipAttempts: 10 });
  const user = { id: 7 };
  assert.equal((await limiter.consumeAccount(user, 'reader')).allowed, true);
  assert.equal((await limiter.consumeAccount(user, 'READER@example.test')).allowed, true);
  const blocked = await limiter.consumeAccount(user, 'reader@example.test');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 900);
  assert.equal((await limiter.consumeAccount({ id: 8 }, 'reader')).allowed, true);
  time = 900_001;
  assert.equal((await limiter.consumeAccount(user, 'reader')).allowed, true);
  await limiter.resetAccount(user);
  assert.equal((await limiter.consumeAccount(user, 'reader')).allowed, true);
  assert.equal((await limiter.consumeAccount(null, ' UNKNOWN ')).allowed, true);
  assert.equal((await limiter.consumeAccount(null, 'unknown')).allowed, true);
  assert.equal((await limiter.consumeAccount(null, 'Unknown')).allowed, false);
});

test('IP quota applies across accounts before lookup and uses the trusted request address', async () => {
  const pool = createTestPool(() => 0);
  const limiter = createLoginRateLimiter({ pool, ipAttempts: 2 });
  const request = { ip: '203.0.113.7', socket: { remoteAddress: '127.0.0.1' } };
  assert.equal((await limiter.consumeIp(request)).allowed, true);
  assert.equal((await limiter.consumeIp(request)).allowed, true);
  assert.equal((await limiter.consumeIp(request)).allowed, false);
  assert.equal(
    (await limiter.consumeIp({ ip: '203.0.113.8', socket: request.socket })).allowed,
    true,
  );
  assert.equal(
    (await limiter.consumeIp({ socket: { remoteAddress: '203.0.113.7' } })).allowed,
    false,
  );
});

test('concurrent account attempts cannot exceed their reserved slots', async () => {
  const pool = createTestPool(() => 0);
  const limiter = createLoginRateLimiter({ pool, accountAttempts: 2 });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => limiter.consumeAccount({ id: 10 }, 'reader')),
  );
  assert.equal(results.filter((result) => result.allowed).length, 2);
});

test('expired attempt rows are cleared without discarding active cooldowns', async () => {
  let time = 0;
  const pool = createTestPool(() => time);
  const limiter = createLoginRateLimiter({ pool, now: () => time });
  await limiter.consumeAccount(null, 'expired-name');
  assert.equal(pool.rows.size, 1);
  time = 2 * 24 * 60 * 60 * 1000;
  await limiter.consumeAccount(null, 'new-name');
  assert.equal(pool.rows.size, 1);
});

test(
  'isolated MySQL atomically limits accounts across limiter instances',
  { skip: process.env.RUN_LOGIN_RATE_MYSQL !== '1', timeout: 30000 },
  async (t) => {
    const { isolatedMysqlConfig } = require('./test-helpers/isolated-mysql');
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('LOGIN_RATE_MYSQL_SOCKET');
    const root = await mysql.createConnection(config);
    const database = `login_rate_test_${randomUUID().replaceAll('-', '')}`;
    let databaseCreated = false;
    let pool;
    let anotherPool;
    t.after(async () => {
      await pool?.end();
      await anotherPool?.end();
      if (databaseCreated) await root.query(`DROP DATABASE ${database}`);
      await root.end();
    });
    const [[server]] = await root.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    await root.query(`CREATE DATABASE ${database}`);
    databaseCreated = true;
    pool = mysql.createPool({ ...config, database });
    anotherPool = mysql.createPool({ ...config, database });
    await ensureLoginRateTable(pool);
    const first = createLoginRateLimiter({ pool, accountAttempts: 2, ipAttempts: 3 });
    const second = createLoginRateLimiter({ pool: anotherPool, accountAttempts: 2, ipAttempts: 3 });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).consumeAccount({ id: 12 }, 'reader'),
      ),
    );
    assert.equal(results.filter((result) => result.allowed).length, 2);
    const blocked = await first.consumeAccount({ id: 12 }, 'reader@example.test');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 900);
    await pool.execute(
      'UPDATE auth_login_attempts SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND',
    );
    assert.equal((await second.consumeAccount({ id: 12 }, 'reader')).allowed, true);
    await second.resetAccount({ id: 12 });
    assert.equal((await first.consumeAccount({ id: 12 }, 'reader')).allowed, true);
  },
);
