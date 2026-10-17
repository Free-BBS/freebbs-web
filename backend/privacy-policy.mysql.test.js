const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const {
  policy,
  ensurePrivacyPolicySchema,
  createPrivacyPolicyService,
} = require('./privacy-policy');

test(
  'isolated MySQL: privacy consent persists across restarts and concurrent confirmations without first-login bypass',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    t.after(() => admin.end());
    await assertIsolatedMysql(admin);
    const database = `privacy_consent_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^privacy_consent_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 4 });
    const restartedPool = mysql.createPool({ ...config, database, connectionLimit: 4 });
    t.after(() => pool.end());
    t.after(() => restartedPool.end());
    await pool.query('CREATE TABLE users (id BIGINT PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users VALUES (1),(2)');
    await ensurePrivacyPolicySchema(pool);
    await ensurePrivacyPolicySchema(restartedPool);
    const service = createPrivacyPolicyService({ pool });
    const restarted = createPrivacyPolicyService({ pool: restartedPool });
    const body = {
      privacyAccepted: true,
      privacyPolicyVersion: policy.version,
      privacyPolicyHash: policy.contentHash,
    };
    assert.equal((await service.confirmLogin(1, body)).requiresFullPolicy, true);
    await assert.rejects(service.requireAccepted(1), { code: 'privacy_policy_required' });
    const [empty] = await pool.query('SELECT * FROM privacy_policy_acceptances');
    assert.equal(empty.length, 0);
    await Promise.all(Array.from({ length: 8 }, () => service.accept(1, body)));
    const [first] = await pool.query('SELECT * FROM privacy_policy_acceptances');
    assert.equal(first.length, 1);
    assert.equal((await restarted.requireAccepted(1)).accepted, true);
    await restarted.confirmLogin(1, body);
    const [confirmed] = await pool.query('SELECT * FROM privacy_policy_acceptances');
    assert.equal(confirmed[0].accepted_at.getTime(), first[0].accepted_at.getTime());
    assert.ok(confirmed[0].last_confirmed_at >= first[0].last_confirmed_at);
    await assert.rejects(restarted.confirmLogin(1, {}), { code: 'privacy_policy_required' });
    assert.equal((await restarted.status(2)).accepted, false);
    await pool.execute(
      'UPDATE privacy_policy_acceptances SET content_sha256 = ? WHERE user_id = 1',
      ['0'.repeat(64)],
    );
    await assert.rejects(restarted.requireAccepted(1), { code: 'privacy_policy_required' });
    assert.equal((await restarted.confirmLogin(1, body)).requiresFullPolicy, true);
    await restarted.accept(1, body);
    await pool.execute('DELETE FROM users WHERE id = 1');
    const [removed] = await pool.query('SELECT * FROM privacy_policy_acceptances');
    assert.equal(removed.length, 0);
  },
);
