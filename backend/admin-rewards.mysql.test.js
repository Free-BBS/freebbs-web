const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig } = require('./test-helpers/isolated-mysql');
const { createAdminRewardsService, ensureAdminRewardTables } = require('./admin-rewards');
const { createNotificationService } = require('./notifications');

test(
  'MySQL: additive rewards, concurrent retries, independent batches and atomic notification rollback',
  {
    skip: process.env.RUN_ADMIN_REWARDS_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('ADMIN_REWARDS_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    const [[server]] = await connection.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    const database = `admin_rewards_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^admin_rewards_test_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
    t.after(() => pool.end());
    await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY, username VARCHAR(120), full_name VARCHAR(120), student_id VARCHAR(64),
    electrons BIGINT NOT NULL DEFAULT 10, manetrons BIGINT NOT NULL DEFAULT 5, heat BIGINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`);
    await pool.query(
      "INSERT INTO users(id, username) VALUES(1,'admin'), (2,'reader2'), (3,'reader3')",
    );
    await ensureAdminRewardTables(pool);
    await ensureAdminRewardTables(pool);
    const notifications = createNotificationService({ pool });
    const service = createAdminRewardsService({ pool, notifications });
    const body = {
      requestId: randomUUID(),
      userIds: [2, 3],
      electric: 20,
      magnetic: 5,
      title: '优秀问题',
      reason: '谢谢认真反馈',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.grant({ id: 1 }, body)),
    );
    assert.equal(results.filter((item) => !item.replayed).length, 1);
    let [users] = await pool.query('SELECT * FROM users WHERE id > 1 ORDER BY id');
    assert.deepEqual(
      users.map((u) => [u.electrons, u.manetrons, u.heat]),
      [
        [30, 10, 0],
        [30, 10, 0],
      ],
    );
    const [[counts]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM admin_reward_entries) AS entries,
    (SELECT COUNT(*) FROM community_notifications) AS notifications,
    (SELECT COUNT(*) FROM notification_email_outbox) AS email`);
    assert.deepEqual([counts.entries, counts.notifications, counts.email], [2, 2, 0]);
    const [ledger] = await pool.query('SELECT * FROM wallet_ledger ORDER BY id');
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0].title, body.title);
    assert.equal(ledger[0].reason, body.reason);
    assert.equal(ledger[0].electric_after - ledger[0].electric_before, 20);
    await assert.rejects(service.grant({ id: 1 }, { ...body, electric: 50 }), { status: 409 });
    const failing = createAdminRewardsService({
      pool,
      notifications: {
        async notifyReward(data, transaction) {
          await notifications.notifyReward(data, transaction);
          throw new Error('notification failure');
        },
      },
    });
    const retryBody = { ...body, requestId: randomUUID() };
    await assert.rejects(failing.grant({ id: 1 }, retryBody), /notification failure/);
    const [[unchanged]] = await pool.query('SELECT COUNT(*) AS count FROM admin_reward_entries');
    assert.equal(unchanged.count, 2);
    const [[ledgerAfterFailure]] = await pool.query('SELECT COUNT(*) AS count FROM wallet_ledger');
    assert.equal(ledgerAfterFailure.count, 2);
    await service.grant({ id: 1 }, retryBody);
    await Promise.all(
      [0, 1].map(() =>
        service.grant(
          { id: 1 },
          { ...body, requestId: randomUUID(), userIds: [3, 2], electric: 1, magnetic: 0 },
        ),
      ),
    );
    [users] = await pool.query('SELECT * FROM users WHERE id > 1 ORDER BY id');
    assert.deepEqual(
      users.map((u) => [u.electrons, u.manetrons]),
      [
        [52, 15],
        [52, 15],
      ],
    );
    const [[before]] = await pool.query('SELECT COUNT(*) AS count FROM admin_reward_batches');
    await assert.rejects(
      service.grant({ id: 1 }, { ...body, requestId: randomUUID(), userIds: [2, 999] }),
      { status: 400 },
    );
    const [[after]] = await pool.query('SELECT COUNT(*) AS count FROM admin_reward_batches');
    assert.equal(after.count, before.count);
  },
);
