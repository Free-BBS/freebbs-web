const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { awardMagnetic } = require('./economy-rewards');
const { ensureWalletLedger } = require('./wallet-ledger');
const { createMysqlEconomyStore } = require('./economy-shop');
const {
  createProfileExtras,
  ensureProfileExtrasTables,
  mysqlProfileMethods,
} = require('./profile-extras');

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
      'CREATE TABLE users (id BIGINT PRIMARY KEY, electrons INT NOT NULL DEFAULT 0, manetrons INT NOT NULL DEFAULT 0, heat INT NOT NULL DEFAULT 0) ENGINE=InnoDB',
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
    await ensureWalletLedger(pool);
    await pool.query('INSERT INTO users(id) VALUES(1), (2), (3), (4)');
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
    const bonuses = await stalePair(2, ['featured-post:1', 'featured-post:1'], 5, 'bonus');
    assert.deepEqual(bonuses.sort(), [0, 5]);
    assert.equal(await transaction((c) => awardMagnetic(c, 1, 'featured-post:2', 5, day)), 5);
    assert.equal(
      await transaction((c) => awardMagnetic(c, 1, 'like:next', 1, '2026-09-17', 'community')),
      1,
    );
    const [rewardLedger] = await pool.query(
      'SELECT source_key, title, reason, magnetic_before, magnetic_after FROM wallet_ledger ORDER BY id',
    );
    assert.equal(
      rewardLedger.length,
      5,
      'deduplicated and capped zero rewards create no ledger entry',
    );
    for (const entry of rewardLedger) {
      assert.match(entry.source_key, /^reward:/);
      assert.ok(entry.title.trim());
      assert.ok(
        entry.reason.includes(
          `获得 ${Number(entry.magnetic_after) - Number(entry.magnetic_before)} 磁元`,
        ),
      );
    }
    assert.equal(rewardLedger.filter((entry) => entry.title === '精华帖子奖励').length, 2);

    await pool.query(
      'CREATE TABLE user_fortunes (user_id BIGINT NOT NULL, fortune_date VARCHAR(10) NOT NULL, score INT NOT NULL, PRIMARY KEY (user_id, fortune_date)) ENGINE=InnoDB',
    );
    await pool.query(
      'CREATE TABLE user_checkins (user_id BIGINT NOT NULL, checkin_date VARCHAR(10) NOT NULL, PRIMARY KEY (user_id, checkin_date)) ENGINE=InnoDB',
    );
    await pool.execute('INSERT INTO user_checkins VALUES (3, ?)', [day]);
    await pool.execute('INSERT INTO user_fortunes VALUES (3, ?, 30)', [day]);
    await transaction((c) => awardMagnetic(c, 3, `checkin:${day}`, 1, day, 'checkin'));
    for (let i = 0; i < 2; i += 1)
      await transaction(async (c) => {
        await c.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [3]);
        await mysqlProfileMethods(c).boostFortune(3, day);
      });
    const [bagLedger] = await pool.query(
      'SELECT source_key, title, reason FROM wallet_ledger WHERE user_id = 3 ORDER BY id',
    );
    assert.deepEqual(
      bagLedger.map((row) => row.source_key),
      [`reward:checkin:${day}`, `reward:luck:${day}`],
    );
    assert.equal(bagLedger[1].title, '签到运势奖励');
    assert.match(bagLedger[1].reason, /已签到且今日运势达到 70 分.*1 磁元/);

    await ensureProfileExtrasTables(pool);
    await pool.query(
      'CREATE TABLE user_assets (user_id BIGINT NOT NULL, asset_key VARCHAR(100) NOT NULL, quantity INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, asset_key)) ENGINE=InnoDB',
    );
    await pool.query("INSERT INTO user_assets VALUES (4, 'differential_converter', 2)");
    await pool.query('UPDATE users SET electrons = 20, manetrons = 20 WHERE id = 4');
    let failCreditAnnotation = true;
    const failingPool = {
      async getConnection() {
        const connection = await pool.getConnection();
        return new Proxy(connection, {
          get(target, property) {
            if (property === 'execute')
              return async (sql, values) => {
                if (
                  failCreditAnnotation &&
                  sql.startsWith('UPDATE wallet_ledger') &&
                  values[0].endsWith(':credit')
                )
                  throw new Error('injected converter credit annotation failure');
                return target.execute(sql, values);
              };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const profile = createProfileExtras(createMysqlEconomyStore(failingPool));
    const conversion = {
      userId: 4,
      action: 'convert',
      itemKey: 'electric_to_magnetic',
      requestKey: randomUUID(),
    };
    await assert.rejects(profile.act(conversion), /injected converter credit annotation/);
    const [[failedBalance]] = await pool.query(
      'SELECT electrons, manetrons, heat FROM users WHERE id = 4',
    );
    assert.deepEqual(failedBalance, { electrons: 20, manetrons: 20, heat: 0 });
    const [[failedInventory]] = await pool.query(
      "SELECT quantity FROM user_assets WHERE user_id = 4 AND asset_key = 'differential_converter'",
    );
    assert.equal(failedInventory.quantity, 2);
    const [[failedActions]] = await pool.query(
      'SELECT COUNT(*) AS total FROM user_profile_actions WHERE user_id = 4',
    );
    assert.equal(failedActions.total, 0);
    const [[failedLedger]] = await pool.query(
      'SELECT COUNT(*) AS total FROM wallet_ledger WHERE user_id = 4',
    );
    assert.equal(failedLedger.total, 1, 'only the original funding remains after rollback');
    failCreditAnnotation = false;
    await profile.act(conversion);
    assert.equal((await profile.act(conversion)).replayed, true);
    const [converterLedger] = await pool.query(
      'SELECT source_key, title, reason, electric_before, electric_after, magnetic_before, magnetic_after FROM wallet_ledger WHERE user_id = 4 ORDER BY id',
    );
    assert.equal(converterLedger.length, 3);
    assert.equal(
      converterLedger[0].source_key,
      null,
      'conversion never annotates historical funding',
    );
    assert.deepEqual(
      converterLedger.slice(1).map((entry) => entry.source_key),
      [`converter:${conversion.requestKey}:debit`, `converter:${conversion.requestKey}:credit`],
    );
    assert.ok(
      converterLedger
        .slice(1)
        .every(
          (entry) => entry.title === '微分器兑换' && entry.reason.includes('10 电元兑换为 10 磁元'),
        ),
    );
    assert.equal(
      Number(converterLedger[1].electric_after) - Number(converterLedger[1].electric_before),
      -10,
    );
    assert.equal(
      Number(converterLedger[2].magnetic_after) - Number(converterLedger[2].magnetic_before),
      10,
    );
    const [[convertedBalance]] = await pool.query(
      'SELECT electrons, manetrons, heat FROM users WHERE id = 4',
    );
    assert.deepEqual(convertedBalance, { electrons: 10, manetrons: 30, heat: 0 });
    // Test data stays confined to this newly named database in the disposable server.
  },
);
