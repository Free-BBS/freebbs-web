const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { awardMagnetic } = require('./economy-rewards');

// Explicitly targets a local disposable MySQL named pipe, never the application's DB config.
test(
  'REPEATABLE READ reward cap and deduplication use current data after an earlier snapshot',
  {
    skip: process.env.RUN_ECONOMY_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const socketPath = process.env.ECONOMY_MYSQL_SOCKET;
    assert.ok(
      socketPath && socketPath.startsWith('\\\\.\\pipe\\'),
      'a disposable local named pipe is required',
    );
    const mysql = require('mysql2/promise');
    const config = { socketPath, user: 'root', password: '' };
    const admin = await mysql.createConnection(config);
    t.after(() => admin.end());
    const [[server]] = await admin.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1, 'refuse a network-enabled database server');
    const database = `pr97_rewards_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^pr97_rewards_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE ${database}`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 4 });
    t.after(() => pool.end());
    await pool.query(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, manetrons INT NOT NULL DEFAULT 0) ENGINE=InnoDB',
    );
    await pool.query('CREATE TABLE discussion_post_likes (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    const schema = fs.readFileSync(
      require('node:path').join(__dirname, '../database/migrations/039_economy_policy.sql'),
      'utf8',
    );
    for (const sql of schema
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await pool.query(sql);
    await pool.query('INSERT INTO users(id) VALUES(1), (2)');
    const day = '2026-09-16';
    async function transaction(work) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const result = await work(c);
        await c.commit();
        return result;
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    }
    await transaction((c) => awardMagnetic(c, 1, 'seed', 2, day, 'community'));
    async function stalePair(userId, keys, requested, category) {
      const connections = await Promise.all([pool.getConnection(), pool.getConnection()]);
      try {
        for (const c of connections) {
          await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          await c.beginTransaction();
          // Formal interaction callers also read likes before locking the rewarded account.
          await c.query('SELECT id FROM discussion_post_likes');
        }
        return await Promise.all(
          connections.map(async (c, i) => {
            const amount = await awardMagnetic(c, userId, keys[i], requested, day, category);
            await c.commit();
            return amount;
          }),
        );
      } finally {
        for (const c of connections) {
          await c.rollback();
          c.release();
        }
      }
    }
    const awards = await stalePair(1, ['like:a', 'like:b'], 1, 'community');
    assert.deepEqual(awards.sort(), [0, 1]);
    const [[total]] = await pool.query(
      "SELECT SUM(amount) AS total FROM economy_rewards WHERE user_id=1 AND category='community'",
    );
    const [[wallet]] = await pool.query('SELECT manetrons FROM users WHERE id=1');
    assert.equal(Number(total.total), 3);
    assert.equal(wallet.manetrons, 3);
    const bonuses = await stalePair(2, ['featured:1', 'featured:1'], 5, 'bonus');
    assert.deepEqual(bonuses.sort(), [0, 5]);
    assert.equal(await transaction((c) => awardMagnetic(c, 1, 'featured:2', 5, day)), 5);
    assert.equal(
      await transaction((c) => awardMagnetic(c, 1, 'like:next', 1, '2026-09-17', 'community')),
      1,
    );
    // Test data stays confined to this newly named database in the disposable server.
  },
);
