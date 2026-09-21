const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { GUIDE_VERSION, LEGACY_GUIDE_VERSIONS } = require('./onboarding');
const { RELEASES } = require('../public/max-guide-releases');
const { ensureWalletLedger } = require('./wallet-ledger');
const {
  createMysqlOnboardingRewardStore,
  ensureOnboardingRewardTable,
} = require('./onboarding-reward');

test(
  'isolated MySQL: permanent concurrent claim, legacy eligibility, ledger trigger and transactional rollback',
  { skip: process.env.RUN_ONBOARDING_REWARD_MYSQL !== '1', timeout: 30000 },
  async (t) => {
    const socketPath = process.env.ONBOARDING_REWARD_MYSQL_SOCKET;
    const separator = String.fromCharCode(92);
    assert.equal(
      socketPath,
      [`${separator.repeat(2)}.`, 'pipe', 'freebbs-onboarding-reward-qa'].join(separator),
      'only the explicit disposable local named pipe may be used; never application DB config',
    );
    const mysql = require('mysql2/promise');
    const config = { socketPath, user: 'root', password: '' };
    const admin = await mysql.createConnection(config);
    t.after(() => admin.end());
    const [[server]] = await admin.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1, 'the QA server must disable network connections');
    const database = `onboarding_reward_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^onboarding_reward_test_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 8 });
    t.after(() => pool.end());
    await pool.query(`CREATE TABLE users (
      id BIGINT PRIMARY KEY, electrons BIGINT NOT NULL, manetrons BIGINT NOT NULL
    ) ENGINE=InnoDB`);
    await pool.query(
      'INSERT INTO users VALUES (1, 0, 0), (2, 150, 30), (3, 1, 3), (4, 0, 0), (5, 0, 0)',
    );
    await ensureOnboardingRewardTable(pool);
    const stamp = Date.now();
    for (const [id, version] of [
      [1, GUIDE_VERSION],
      [2, LEGACY_GUIDE_VERSIONS[0]],
      [3, RELEASES[0].id],
      [4, GUIDE_VERSION],
      [5, GUIDE_VERSION],
    ]) {
      await pool.execute(
        `INSERT INTO user_onboarding
        (user_id, guide_version, status, completed_tasks_json, seen_at_ms, completed_at_ms, updated_at_ms)
        VALUES (?, ?, 'completed', '[]', ?, ?, ?)`,
        [id, version, stamp, stamp, stamp],
      );
    }
    const store = createMysqlOnboardingRewardStore(pool);
    assert.equal((await store.read(2)).eligible, true);
    assert.equal((await store.read(3)).eligible, false);
    const [[empty]] = await pool.query('SELECT COUNT(*) AS count FROM onboarding_rewards');
    assert.equal(Number(empty.count), 0, 'GET never backfills rewards');
    const results = await Promise.all(Array.from({ length: 8 }, () => store.claim(1)));
    assert.equal(results.filter((result) => result.awarded).length, 1);
    assert.equal(new Set(results.map((result) => result.claimedAt)).size, 1);
    assert.equal((await store.claim(2)).awarded, true);
    await assert.rejects(store.claim(3), { status: 403 });
    await assert.rejects(store.claim(404), { status: 404 });
    await pool.query("UPDATE user_onboarding SET status = 'in_progress' WHERE user_id = 1");
    const restarted = createMysqlOnboardingRewardStore(pool);
    assert.equal((await restarted.claim(1)).awarded, false);
    const [users] = await pool.query(
      'SELECT id, electrons, manetrons FROM users WHERE id IN (1,2) ORDER BY id',
    );
    assert.deepEqual(
      users.map((user) => [Number(user.electrons), Number(user.manetrons)]),
      [
        [10, 10],
        [160, 40],
      ],
    );
    const [ledger] = await pool.query('SELECT * FROM wallet_ledger ORDER BY id');
    assert.equal(ledger.length, 2);
    for (const row of ledger) {
      assert.equal(row.source_key, 'onboarding-reward');
      assert.equal(row.title, '新手导引完成奖励');
      assert.match(row.reason, /10 电元和 10 磁元/);
      assert.equal(Number(row.electric_after) - Number(row.electric_before), 10);
      assert.equal(Number(row.magnetic_after) - Number(row.magnetic_before), 10);
    }

    // A receipt insert failure happens after the balance UPDATE and ledger annotation.
    await pool.query(`CREATE TRIGGER onboarding_qa_reject_receipt BEFORE INSERT ON onboarding_rewards
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA receipt failure'`);
    await assert.rejects(store.claim(5), /QA receipt failure/);
    const [[rolledBack]] = await pool.query(`SELECT u.electrons, u.manetrons,
      (SELECT COUNT(*) FROM onboarding_rewards WHERE user_id = 5) AS claims,
      (SELECT COUNT(*) FROM wallet_ledger WHERE user_id = 5) AS entries FROM users u WHERE id = 5`);
    assert.deepEqual(Object.values(rolledBack).map(Number), [0, 0, 0, 0]);
    await pool.query('DROP TRIGGER onboarding_qa_reject_receipt');
    assert.equal((await store.claim(5)).awarded, true);

    // Losing the trigger must never relabel a previous unannotated entry as this reward.
    await pool.query('UPDATE users SET electrons = electrons + 1 WHERE id = 4');
    await pool.query('DROP TRIGGER freebbs_wallet_after_update');
    await assert.rejects(store.claim(4), /Wallet ledger entry missing/);
    const [[account]] = await pool.query('SELECT electrons, manetrons FROM users WHERE id = 4');
    assert.deepEqual(Object.values(account).map(Number), [1, 0]);
    const [old] = await pool.query(
      'SELECT source_key, reason FROM wallet_ledger WHERE user_id = 4',
    );
    assert.deepEqual(old, [{ source_key: null, reason: null }]);
    const [[receipt]] = await pool.query(
      'SELECT COUNT(*) AS count FROM onboarding_rewards WHERE user_id = 4',
    );
    assert.equal(Number(receipt.count), 0);
    const repairedPool = mysql.createPool({ ...config, database });
    t.after(() => repairedPool.end());
    await ensureWalletLedger(repairedPool);
    assert.equal((await store.claim(4)).awarded, true);
  },
);
