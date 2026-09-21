const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createBoneSales } = require('./economy-sales');
const { createMysqlEconomyStore, ensureShopPurchaseTables } = require('./economy-shop');
const { ensureProfileExtrasTables } = require('./profile-extras');
const { ensureWalletLedger } = require('./wallet-ledger');

test(
  'MySQL bone sales serialize inventory, replay receipts and commit ledger snapshots atomically',
  {
    skip: process.env.RUN_BONE_SALES_MYSQL !== '1',
    timeout: 30000,
  },
  async (t) => {
    const socketPath = process.env.BONE_SALES_MYSQL_SOCKET;
    assert.ok(socketPath?.startsWith('\\\\.\\pipe\\'), 'explicit disposable local pipe required');
    const mysql = require('mysql2/promise');
    const config = { socketPath, user: 'root', password: '' };
    const database = `bone_sales_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^bone_sales_test_[a-f0-9]{32}$/);
    const connection = await mysql.createConnection(config);
    let pool;
    let createdDatabase = false;
    t.after(async () => {
      try {
        if (pool) await pool.end();
        if (createdDatabase) await connection.query(`DROP DATABASE ${database}`);
      } finally {
        await connection.end();
      }
    });
    const [[server]] = await connection.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    createdDatabase = true;
    pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
    await pool.query(`CREATE TABLE users (
    id BIGINT PRIMARY KEY, electrons BIGINT NOT NULL, manetrons BIGINT NOT NULL, heat BIGINT NOT NULL
  ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE user_assets (
    user_id BIGINT NOT NULL, asset_key VARCHAR(64) NOT NULL, quantity BIGINT NOT NULL,
    metadata_json JSON NULL, PRIMARY KEY(user_id, asset_key)
  ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE economy_account_state (
    user_id BIGINT PRIMARY KEY, fed_until_ms BIGINT NOT NULL DEFAULT 0, luck_until_ms BIGINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`);
    await pool.query('INSERT INTO users VALUES (1, 100, 50, 7)');
    await pool.query(
      "INSERT INTO user_assets (user_id, asset_key, quantity) VALUES (1, 'ordinary_fishbone', 10), (1, 'golden_fishbone', 3)",
    );
    await ensureShopPurchaseTables(pool);
    await ensureProfileExtrasTables(pool);
    await ensureWalletLedger(pool);
    const store = createMysqlEconomyStore(pool);
    const sales = createBoneSales(store);
    const sell = (overrides = {}) =>
      sales.sell({
        userId: 1,
        itemKey: 'ordinary_fishbone',
        quantity: 1,
        requestKey: randomUUID(),
        ...overrides,
      });
    const requestKey = randomUUID();
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => sell({ requestKey, quantity: 4 })),
    );
    assert.equal(duplicates.filter((r) => !r.replayed).length, 1);
    const competing = await Promise.allSettled([sell({ quantity: 5 }), sell({ quantity: 5 })]);
    assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(competing.find((r) => r.status === 'rejected').reason.code, 'INSUFFICIENT_ASSETS');
    await sell({ itemKey: 'golden_fishbone', quantity: 2 });
    const [[account]] = await pool.query(
      'SELECT electrons, manetrons, heat FROM users WHERE id = 1',
    );
    assert.deepEqual([account.electrons, account.manetrons, account.heat], [100, 79, 7]);
    const [ledger] = await pool.query('SELECT * FROM wallet_ledger ORDER BY id');
    assert.equal(ledger.length, 3);
    assert.deepEqual(
      ledger.map((row) => [row.magnetic_before, row.magnetic_after]),
      [
        [50, 54],
        [54, 59],
        [59, 79],
      ],
    );
    assert.ok(
      ledger.every((row) => row.title === '鱼骨出售' && row.source_key.startsWith('bone-sale:')),
    );
    assert.match(ledger[2].reason, /黄金鱼骨 × 2/);

    // Inject a failure after the actual balance update and trigger, before the receipt commits.
    const failing = createBoneSales({
      transaction: (work) =>
        store.transaction((tx) =>
          work({
            ...tx,
            async record() {
              throw new Error('receipt unavailable');
            },
          }),
        ),
    });
    await assert.rejects(
      failing.sell({
        userId: 1,
        itemKey: 'golden_fishbone',
        quantity: 1,
        requestKey: randomUUID(),
      }),
      /receipt unavailable/,
    );
    const [[after]] = await pool.query(
      "SELECT manetrons, (SELECT quantity FROM user_assets WHERE user_id = 1 AND asset_key = 'golden_fishbone') AS bones, (SELECT COUNT(*) FROM wallet_ledger) AS entries, (SELECT COUNT(*) FROM shop_purchases) AS receipts FROM users WHERE id = 1",
    );
    assert.deepEqual([after.manetrons, after.bones, after.entries, after.receipts], [79, 1, 3, 3]);
  },
);
