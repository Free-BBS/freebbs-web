const assert = require('node:assert/strict');
const test = require('node:test');
const { randomBytes } = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const {
  progressionFor,
  readOverallLeaderboard,
  ensureCircuitChallengeTables,
  createCircuitChallengesRouter,
  readChallengeInput,
} = require('./circuit-challenges');
const { circuitChallengeCatalog } = require('./circuit-challenge-catalog');

test('progress preserves historical passes but only unlocks a contiguous sequence of active levels', () => {
  const levels = [1, 3, 4, 6].map((id) => ({ id, is_active: id !== 3 }));
  const before = progressionFor(levels, [{ challenge_id: 6 }]);
  assert.deepEqual(
    before.challenges.map(({ id, completed, locked }) => [id, completed, locked]),
    [
      [1, false, false],
      [4, false, true],
      [6, true, true],
    ],
  );
  assert.equal(before.progress.cleared, 0);
  const after = progressionFor(levels, [{ challenge_id: 1 }, { challenge_id: 6 }]);
  assert.equal(after.progress.nextChallengeId, 4);
  assert.equal(after.challenges[1].locked, false);
  assert.equal(after.progress.cleared, 1);
  assert.equal(
    progressionFor(
      levels,
      [1, 4, 6].map((id) => ({ challenge_id: id })),
    ).progress.nextChallengeId,
    null,
  );
});

test(
  'isolated MySQL: challenge progression gates direct requests and ranks contiguous current passes',
  { skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET, timeout: 30000 },
  async (t) => {
    const options = isolatedMysqlConfig();
    const admin = await mysql.createConnection(options);
    await assertIsolatedMysql(admin);
    const database = `challenge_progress_${randomBytes(6).toString('hex')}`;
    await admin.query(`CREATE DATABASE \`${database}\``);
    const pool = mysql.createPool({ ...options, database, connectionLimit: 5 });
    let server;
    t.after(async () => {
      if (server)
        await new Promise((resolve) => {
          server.close(resolve);
        });
      await pool.end();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    });
    await pool.query(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, uid VARCHAR(32), username VARCHAR(64))',
    );
    await pool.query(
      "INSERT INTO users VALUES (1,'u_reader','reader'),(2,'u_other','other'),(3,'u_legacy','legacy')",
    );
    const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
    await pool.query(schema.match(/CREATE TABLE IF NOT EXISTS user_assets \([\s\S]*?\);/)[0]);
    const notices = fs.readFileSync(
      path.join(__dirname, '../database/migrations/026_notifications.sql'),
      'utf8',
    );
    await pool.query(notices.split(';')[0]);
    await ensureCircuitChallengeTables(pool);
    const seed = circuitChallengeCatalog()[0];
    const data = readChallengeInput({
      title: seed.title,
      document: seed.document,
      tolerance: seed.tolerance,
      rewardElectric: 0,
    });
    for (let id = 1; id <= 3; id += 1) {
      await pool.execute(
        "INSERT INTO circuit_challenges (id,title,description,document_json,target_json,tolerance) VALUES (?,?,'',?,?,?)",
        [
          id,
          `Level ${id}`,
          JSON.stringify(data.document),
          JSON.stringify(data.target),
          data.tolerance,
        ],
      );
    }
    const app = express();
    app.use(express.json());
    app.use(
      '/challenges',
      createCircuitChallengesRouter({
        pool,
        requireAuth: async (request, response) => {
          const id = Number(request.headers.authorization);
          if (![1, 2, 3].includes(id)) {
            response.status(401).json({ message: 'login' });
            return null;
          }
          return { id, is_admin: id === 2 };
        },
      }),
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => {
      server.once('listening', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}/challenges`;
    const submit = (id, user = 1) =>
      fetch(`${base}/${id}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: String(user) },
        body: JSON.stringify({ document: data.document, revision: 1 }),
      });
    assert.equal((await fetch(`${base}/2`)).status, 403);
    assert.equal((await submit(3)).status, 403);
    assert.equal(
      (await submit(3, 2)).status,
      403,
      'administrator scored attempts still require prerequisites',
    );
    assert.equal((await submit(1)).status, 201);
    assert.equal((await submit(3)).status, 403);
    assert.equal((await submit(2)).status, 201);
    assert.equal((await submit(1, 2)).status, 201);
    // A historic skipped pass must not outrank a user who completed the sequence.
    await pool.execute(
      "INSERT INTO circuit_challenge_submissions (challenge_id,challenge_revision,user_id,component_count,error_score,document_json) VALUES (3,1,3,0,0,'{}')",
    );
    let board = await readOverallLeaderboard(pool, 1);
    assert.deepEqual(
      board.leaderboard.map((entry) => [entry.username, entry.cleared]),
      [
        ['reader', 2],
        ['other', 1],
      ],
    );
    assert.equal(board.me.rank, 1);
    const list = await (await fetch(base, { headers: { Authorization: '1' } })).json();
    assert.equal(list.progress.nextChallengeId, 3);
    assert.equal(list.challenges[0].completed, true);
    assert.equal(list.challenges[2].locked, false);
    assert.equal(
      (await fetch(`${base}/leaderboard`)).status,
      200,
      'overall path precedes the numeric detail route',
    );
    await pool.execute('UPDATE circuit_challenges SET revision = 2 WHERE id = 1');
    assert.equal(
      (await submit(3)).status,
      403,
      'outdated prerequisite no longer unlocks later levels',
    );
    board = await readOverallLeaderboard(pool, 1);
    assert.equal(board.leaderboard.length, 0);
    await pool.execute('UPDATE circuit_challenges SET is_active = 0 WHERE id = 1');
    board = await readOverallLeaderboard(pool, 1);
    assert.equal(board.me.cleared, 1, 'inactive levels are excluded from the sequence');

    const assetCount = async (user) => {
      const [[row]] = await pool.execute(
        "SELECT COUNT(*) AS count FROM user_assets WHERE user_id=? AND asset_key='plate_circuit_master'",
        [user],
      );
      return Number(row.count);
    };
    assert.equal(await assetCount(1), 0, 'partial current progress does not award');
    assert.deepEqual((await (await fetch(base)).json()).unlocked, [], 'anonymous never awards');

    // A failed notice rolls back both the final pass and collectible.
    await pool.query(
      "CREATE TRIGGER reject_test_achievement BEFORE INSERT ON community_notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='simulated notification failure'",
    );
    assert.equal((await submit(3)).status, 500);
    assert.equal(await assetCount(1), 0);
    const [[last]] = await pool.execute(
      'SELECT COUNT(*) AS count FROM circuit_challenge_submissions WHERE user_id=1 AND challenge_id=3',
    );
    assert.equal(Number(last.count), 0);
    await pool.query('DROP TRIGGER reject_test_achievement');
    const awards = await Promise.all([submit(3), submit(3)]);
    assert.ok(awards.every((response) => response.status === 201));
    const results = await Promise.all(awards.map((response) => response.json()));
    assert.deepEqual(
      results.flatMap((result) => result.unlocked),
      ['plate_circuit_master'],
    );
    assert.equal(await assetCount(1), 1);
    const [[notice]] = await pool.execute(
      'SELECT title,link,event_key FROM community_notifications WHERE recipient_id=1',
    );
    assert.equal(notice.title, '获得成就 · 电路达人');
    assert.equal(notice.link, '/profile?uid=u_reader#public-profile-wardrobe');
    assert.equal(notice.event_key, 'achievement:plate_circuit_master');

    // Historical valid passes reconcile on read, including two tabs opening together.
    await pool.execute(
      "INSERT INTO circuit_challenge_submissions (challenge_id,challenge_revision,user_id,component_count,error_score,document_json) VALUES (2,1,3,0,0,'{}')",
    );
    const backfills = await Promise.all(
      [1, 2].map(async () => (await fetch(base, { headers: { Authorization: '3' } })).json()),
    );
    assert.deepEqual(
      backfills.flatMap((result) => result.unlocked),
      ['plate_circuit_master'],
    );
    assert.equal(await assetCount(3), 1);
    assert.deepEqual(
      (await (await fetch(base, { headers: { Authorization: '3' } })).json()).unlocked,
      [],
    );

    // A later revision must not manufacture a first award or revoke an earned one.
    await pool.execute('UPDATE circuit_challenges SET revision=2 WHERE id=2');
    assert.equal(await assetCount(1), 1);
    assert.equal(await assetCount(3), 1);
    await pool.execute(
      "INSERT INTO circuit_challenge_submissions (challenge_id,challenge_revision,user_id,component_count,error_score,document_json) VALUES (2,1,2,0,0,'{}'),(3,1,2,0,0,'{}')",
    );
    assert.deepEqual(
      (await (await fetch(base, { headers: { Authorization: '2' } })).json()).unlocked,
      [],
    );
    assert.equal(await assetCount(2), 0, 'stale revisions do not satisfy the achievement');
    await pool.execute('UPDATE circuit_challenges SET is_active=0');
    assert.deepEqual(
      (await (await fetch(base, { headers: { Authorization: '2' } })).json()).unlocked,
      [],
    );
    const [[count]] = await pool.query('SELECT COUNT(*) AS count FROM community_notifications');
    assert.equal(Number(count.count), 2);
  },
);
