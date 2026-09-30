const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { ensureShopPurchaseTables } = require('./economy-shop');
const { ensureWalletLedger } = require('./wallet-ledger');
const { refundRanchBicyclePurchases } = require('./ranch-bicycle-refund');

test(
  'isolated MySQL: bicycle price refunds are atomic and once-only across server starts',
  {
    skip: process.env.RUN_BICYCLE_REFUND_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('BICYCLE_REFUND_MYSQL_SOCKET');
    const database = `bicycle_refund_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^bicycle_refund_test_[a-f0-9]{32}$/);
    const admin = await mysql.createConnection(config);
    let pool;
    let created = false;
    t.after(async () => {
      try {
        await pool?.end();
        if (created) await admin.query(`DROP DATABASE ${database}`);
      } finally {
        await admin.end();
      }
    });
    await assertIsolatedMysql(admin);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    created = true;
    pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
    await pool.query(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, electrons BIGINT NOT NULL, manetrons BIGINT NOT NULL, heat BIGINT NOT NULL) ENGINE=InnoDB',
    );
    await ensureShopPurchaseTables(pool);
    await pool.query(
      'INSERT INTO users VALUES (1,70,40,80), (2,70,40,80), (3,70,40,80), (4,70,40,80)',
    );
    await ensureWalletLedger(pool);
    const receipt = async (userId, amount, currency = 'magnetic') => {
      await pool.execute(
        `INSERT INTO shop_purchases (user_id, request_key, item_key, purchase_number, currency, amount, fingerprint, result_json)
      VALUES (?, ?, 'ranch_bicycle', 1, ?, ?, '{}', '{}')`,
        [userId, randomUUID(), currency, amount],
      );
    };
    await receipt(1, 30);
    await receipt(2, 20);
    await receipt(3, 30, 'electric');
    const results = await Promise.all(
      Array.from({ length: 4 }, () => refundRanchBicyclePurchases(pool)),
    );
    assert.equal(
      results.reduce((sum, result) => sum + result.refunded, 0),
      1,
    );
    const [users] = await pool.query('SELECT electrons, manetrons, heat FROM users ORDER BY id');
    assert.deepEqual(
      users.map((user) => [user.electrons, user.manetrons, user.heat]),
      [
        [70, 50, 80],
        [70, 40, 80],
        [70, 40, 80],
        [70, 40, 80],
      ],
    );
    const [refunds] = await pool.query('SELECT magnetic_amount FROM shop_price_refunds');
    assert.deepEqual(
      refunds.map((row) => row.magnetic_amount),
      [10],
    );
    const [ledger] = await pool.query('SELECT * FROM wallet_ledger');
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].magnetic_before, 40);
    assert.equal(ledger[0].magnetic_after, 50);
    assert.equal(ledger[0].title, '牧场自行车降价补差');
    assert.deepEqual(await refundRanchBicyclePurchases(pool), { refunded: 0, magnetic: 0 });
    // A missing wallet trigger must not commit an untracked credit or refund marker.
    await pool.query('DROP TRIGGER freebbs_wallet_after_update');
    await receipt(4, 30);
    await assert.rejects(refundRanchBicyclePurchases(pool), /Wallet ledger entry missing/);
    const [[uncredited]] = await pool.query('SELECT manetrons FROM users WHERE id = 4');
    assert.equal(uncredited.manetrons, 40);
    const [[markers]] = await pool.query('SELECT COUNT(*) AS count FROM shop_price_refunds');
    assert.equal(markers.count, 1);
  },
);
