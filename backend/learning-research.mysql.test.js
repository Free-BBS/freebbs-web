const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mysql = require('mysql2/promise');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const {
  createMysqlResearchStore,
  ensureLearningResearchTables,
  validateFeedback,
  validateStudy,
  validateAttempt,
} = require('./learning-research');

const attempt = (phase, answer = 'a') =>
  validateAttempt({
    requestKey: crypto.randomUUID(),
    phase,
    answers: { [`${phase}_1`]: answer },
    assistance: 'none',
  });
const feedback = () =>
  validateFeedback({
    requestKey: crypto.randomUUID(),
    module: 'learning',
    purpose: 'understand',
    helpfulness: 3,
    barriers: ['content'],
    comment: 'Synthetic private feedback',
    consent: true,
  });
const definition = () =>
  validateStudy({
    requestKey: crypto.randomUUID(),
    title: 'Synthetic research',
    description: 'Isolated SQL regression',
    knowledgeTarget: 'Identify an operation',
    comparability: 'Same synthetic concept coverage',
    selectionNote: 'Voluntary test data, not causal evidence',
    questionVersion: 'test-v1',
    modules: ['learning'],
    minDelayedHours: 24,
    phases: Object.fromEntries(
      ['baseline', 'post', 'delayed', 'transfer'].map((phase) => [
        phase,
        [
          {
            id: `${phase}_1`,
            prompt: 'Choose A',
            correctOption: 'a',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        ],
      ]),
    ),
  });

test(
  'isolated MySQL: learning research migration, owner isolation and concurrent idempotent writes',
  {
    skip: !process.env.FREEBBS_TEST_MYSQL_SOCKET,
    timeout: 120000,
  },
  async (t) => {
    const options = isolatedMysqlConfig();
    const admin = await mysql.createConnection(options);
    await assertIsolatedMysql(admin);
    const database = `freebbs_research_test_${crypto.randomBytes(8).toString('hex')}`;
    assert.match(database, /^freebbs_research_test_[a-f0-9]{16}$/);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const pool = mysql.createPool({ ...options, database, connectionLimit: 8, timezone: '+08:00' });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    });
    await pool.query('CREATE TABLE users (id BIGINT NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await pool.query('INSERT INTO users (id) VALUES (1), (2), (3)');
    await ensureLearningResearchTables(pool);
    await ensureLearningResearchTables(pool);
    let now = new Date('2026-10-11T04:00:00Z');
    const store = createMysqlResearchStore(pool, { clock: () => now });
    const { study } = await store.addStudy(3, definition());
    const join = { requestKey: crypto.randomUUID(), goal: 'understand' };
    await store.join(1, study.id, join);

    // Queue both real transactions on an existing quota row before releasing it.
    // INSERT IGNORE used to grant both shared locks, followed by conflicting upgrades.
    async function concurrentWrites(writes) {
      const blocker = await pool.getConnection();
      await blocker.beginTransaction();
      await blocker.execute(
        'SELECT user_id FROM learning_research_limits WHERE user_id = 1 FOR UPDATE',
      );
      const settled = Promise.allSettled(writes.map((write) => write()));
      try {
        let waiting = 0;
        const deadline = Date.now() + 5000;
        while (waiting < writes.length && Date.now() < deadline) {
          const [[row]] = await admin.execute(
            `SELECT COUNT(*) AS total FROM performance_schema.data_lock_waits w
           JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
           AND l.ENGINE = w.ENGINE WHERE l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = 'learning_research_limits'`,
            [database],
          );
          waiting = Number(row.total);
          if (waiting < writes.length) await delay(10);
        }
        assert.ok(
          waiting >= writes.length,
          'both database writes must actually overlap at the quota lock',
        );
      } finally {
        await blocker.rollback();
        blocker.release();
        await settled;
      }
      const results = await settled;
      assert.deepEqual(
        results
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason.code),
        [],
      );
      return results.map((result) => result.value);
    }

    const baseline = attempt('baseline');
    await t.test(
      'same request key serializes into one attempt and one duplicate without extra quota',
      async () => {
        const results = await concurrentWrites([
          () => store.attempt(1, study.id, baseline),
          () => store.attempt(1, study.id, baseline),
        ]);
        assert.deepEqual(results.map((result) => result.duplicate).sort(), [false, true]);
        assert.equal(results[0].attempt.id, results[1].attempt.id);
        assert.equal(results[0].attempt.score, 1);
        assert.equal((await store.attempts(1)).length, 1);
        const [[limit]] = await pool.execute(
          'SELECT request_count FROM learning_research_limits WHERE user_id = 1',
        );
        assert.equal(limit.request_count, 2);
        await assert.rejects(
          store.attempt(1, study.id, { ...baseline, answers: { baseline_1: 'b' } }),
          { status: 409 },
        );
        assert.equal((await store.attempts(2)).length, 0);
        assert.equal((await store.enrollments(2)).length, 0);
      },
    );
    if (t.signal.aborted) return;

    await t.test(
      'ten distinct-key concurrent feedback pairs preserve both writes and quota counts',
      async () => {
        for (let pair = 0; pair < 10; pair += 1) {
          now = new Date(now.getTime() + 60001);
          const values = [feedback(), feedback()];
          const results = await concurrentWrites(
            values.map((value) => () => store.addFeedback(1, value)),
          );
          assert.ok(results.every((result) => result.duplicate === false));
          assert.notEqual(results[0].feedback.id, results[1].feedback.id);
          const [[limit]] = await pool.execute(
            'SELECT request_count FROM learning_research_limits WHERE user_id = 1',
          );
          assert.equal(limit.request_count, 2);
          assert.equal((await store.addFeedback(1, values[0])).duplicate, true);
        }
        assert.equal((await store.feedback(1)).length, 20);
        assert.equal((await store.feedback(2)).length, 0);
      },
    );

    await t.test(
      'server scoring, UTC delayed threshold, deletion receipts and retention remain intact',
      async () => {
        const post = await store.attempt(1, study.id, attempt('post', 'b'));
        assert.equal(post.attempt.score, 0);
        assert.equal(post.attempt.createdAt, now.toISOString());
        const delayed = attempt('delayed');
        await assert.rejects(store.attempt(1, study.id, delayed), { status: 409 });
        now = new Date(now.getTime() + 24 * 3600000);
        assert.equal((await store.attempt(1, study.id, delayed)).attempt.score, 1);
        await store.attempt(1, study.id, attempt('transfer'));
        const saved = (await store.feedback(1))[0];
        assert.equal(await store.removeFeedback(2, saved.id), false);
        assert.equal(await store.removeFeedback(1, saved.id), true);
        const [[receipt]] = await pool.execute(
          "SELECT result_json FROM learning_research_requests WHERE user_id = 1 AND JSON_EXTRACT(result_json, '$.removed') = true LIMIT 1",
        );
        assert.ok(receipt);
        assert.equal(await store.withdraw(2, study.id), false);
        assert.equal(await store.withdraw(1, study.id), true);
        assert.equal((await store.attempts(1)).length, 0);
        await assert.rejects(store.attempt(1, study.id, baseline), { status: 409 });
        now = new Date(now.getTime() + 181 * 86400000);
        await store.prune();
        assert.equal((await store.feedback(1)).length, 0);
        assert.equal((await store.studies()).length, 1);
        assert.equal(await store.registeredUserCount(), 3);
        const [[remaining]] = await pool.execute(
          'SELECT COUNT(*) AS total FROM learning_research_requests',
        );
        assert.equal(remaining.total, 0);
      },
    );
  },
);
