const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { ensureSchema, createDiscussionModeration } = require('./discussion-moderation');
const { createModerationAudit, ensureModerationAuditSchema } = require('./moderation-audit');
const { POLICY_VERSION } = require('./moderation-policy');
const { normalizePolicyDecision, buildPolicyEvidence } = require('./moderation-policy-decision');

test(
  'isolated MySQL: policy audit preserves authority, feedback, synthetic exports and expiry across restarts',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    await assertIsolatedMysql(connection);
    const database = `moderation_audit_test_${crypto.randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_audit_test_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 8 });
    const restartedPool = mysql.createPool({ ...config, database, connectionLimit: 8 });
    t.after(() => pool.end());
    t.after(() => restartedPool.end());
    await pool.query(`CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(64),
      is_admin TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB`);
    await pool.query(
      "INSERT INTO users (id,username,is_admin) VALUES (1,'reviewer',1),(2,'author',0),(3,'reader',0),(4,'second-reviewer',1)",
    );
    await ensureSchema(pool);
    await ensureModerationAuditSchema(pool);
    const service = createDiscussionModeration({
      pool,
      notifications: { notifyModeration: async () => {} },
    });
    const audit = createModerationAudit({ pool });
    const restarted = createModerationAudit({ pool: restartedPool });
    const label = () => ({
      decision: 'high_risk',
      categories: ['harassment'],
      ruleIds: ['HAR-001'],
      supportPriority: 'none',
    });
    const clearLabel = () => ({
      decision: 'no_risk_detected',
      categories: [],
      ruleIds: [],
      supportPriority: 'none',
    });
    const feedbackBody = (extra = {}) => ({
      ...label(),
      verdict: 'agree',
      note: '',
      requestId: crypto.randomUUID(),
      ...extra,
    });
    const caseBody = (extra = {}) => ({
      title: '虚构讨论测试',
      content: '每天到虚构人物的帖子里羞辱他，直到他退出活动。',
      expectedDecision: 'high_risk',
      categories: ['harassment'],
      ruleIds: ['HAR-001'],
      supportPriority: 'none',
      reason: '虚构围攻行为应命中骚扰规则。',
      syntheticConfirmed: true,
      requestId: crypto.randomUUID(),
      ...extra,
    });
    async function transact(callback) {
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const value = await callback(db);
        await db.commit();
        return value;
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    }
    async function submission() {
      const payload = {
        boardId: 1,
        title: 'PRIVATE_ORIGINAL_TITLE',
        content: 'PRIVATE_ORIGINAL_BODY：大家每天去他的帖子下羞辱他。',
        anonymous: false,
        loginRequired: true,
      };
      const created = await transact((db) =>
        service.submit(db, {
          kind: 'post',
          authorId: 2,
          requestId: crypto.randomUUID(),
          payload,
          attachmentIds: [],
        }),
      );
      const snapshot = await service.aiTestSnapshot({
        id: created.id,
        reviewerId: 1,
        expectedVersion: 1,
      });
      const input = {
        title: snapshot.title,
        content: snapshot.content,
        inputMode: 'redacted',
        redactionCounts: {},
        hasImages: false,
      };
      const assessment = {
        decision: 'high_risk',
        categories: ['harassment'],
        reason: '文本含针对性围攻指令。',
        supportPriority: 'none',
        uncertainties: [],
        ruleMatches: [
          {
            ruleId: 'HAR-001',
            evidence: { field: 'content', quote: '每天去他的帖子下羞辱他' },
            explanation: '作者鼓动持续骚扰。',
          },
        ],
      };
      const result = {
        version: snapshot.version,
        contentHash: snapshot.contentHash,
        inputMode: 'redacted',
        assessment,
        model: 'fixture-model',
        settingsRevision: 2,
        policyVersion: POLICY_VERSION,
        redactorVersion: 'fixture-redactor',
        elapsedMs: 10,
        imageCount: 0,
        policyDecision: normalizePolicyDecision(assessment),
        policyEvidence: buildPolicyEvidence(assessment),
        apiKey: 'PRIVATE_PROVIDER_SECRET',
        rawEnvelope: { reasoning: 'PRIVATE_REASONING' },
      };
      return { id: created.id, reviewerId: 1, snapshot, input, result, payload };
    }
    async function recorded() {
      const item = await submission();
      await audit.prepare(item);
      return { ...item, runId: await audit.record(item) };
    }
    const count = async (table, column, value) => {
      assert.ok(
        ['moderation_ai_runs', 'moderation_ai_feedback', 'moderation_regression_cases'].includes(
          table,
        ),
      );
      assert.ok(['id', 'run_id', 'submission_id'].includes(column));
      const [[row]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${column} = ?`,
        [value],
      );
      return Number(row.total);
    };

    await t.test(
      'migration is repeatable across pool restarts and installs actual foreign keys',
      async () => {
        await Promise.all([ensureModerationAuditSchema(pool), ensureModerationAuditSchema(pool)]);
        await ensureModerationAuditSchema(restartedPool);
        const [rows] = await pool.execute(
          `SELECT TABLE_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME IN ('moderation_ai_runs','moderation_ai_feedback','moderation_regression_cases')`,
          [database],
        );
        assert.equal(rows.length, 7);
        assert.equal(rows.filter((row) => row.DELETE_RULE === 'CASCADE').length, 4);
        assert.equal(rows.filter((row) => row.DELETE_RULE === 'SET NULL').length, 3);
      },
    );

    await t.test(
      'stored evidence survives a new audit service while excluding provider secrets and input bodies',
      async () => {
        const item = await recorded();
        const history = await restarted.history({ id: item.id, reviewerId: 4 });
        assert.equal(history.runs.length, 1);
        assert.equal(history.runs[0].id, item.runId);
        assert.equal(history.runs[0].policyVersion, POLICY_VERSION);
        assert.equal(history.runs[0].assessment.ruleMatches[0].ruleId, 'HAR-001');
        assert.equal(history.runs[0].policyEvidence[0].rule.id, 'HAR-001');
        assert.equal(history.runs[0].automaticPublication, false);
        assert.doesNotMatch(
          JSON.stringify(history),
          /PRIVATE_PROVIDER_SECRET|PRIVATE_REASONING|PRIVATE_ORIGINAL/,
        );
        const [[row]] = await pool.execute(
          `SELECT r.input_hash, r.expires_at = s.expires_at AS same_expiry,
        TIMESTAMPDIFF(SECOND,s.created_at,s.expires_at) AS lifetime FROM moderation_ai_runs r
        JOIN moderation_submissions s ON s.id = r.submission_id WHERE r.id = ?`,
          [item.runId],
        );
        assert.equal(
          row.input_hash,
          crypto.createHash('sha256').update(JSON.stringify(item.input)).digest('hex'),
        );
        assert.equal(Number(row.same_expiry), 1);
        assert.equal(Number(row.lifetime), 30 * 24 * 60 * 60);
        await assert.rejects(restarted.history({ id: item.id, reviewerId: 2 }), { status: 403 });
      },
    );

    await t.test(
      'late run writes reject changed version, hash, publication state and expired evidence',
      async () => {
        const changes = [
          ['version = version + 1', [], 409],
          ['content_hash = ?', ['f'.repeat(64)], 409],
          ["status = 'approved'", [], 409],
          ['expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND)', [], 410],
          ['evidence_purged_at = NOW(3), payload_json = NULL', [], 410],
        ];
        for (const [assignment, args, status] of changes) {
          const item = await submission();
          await audit.prepare(item);
          await pool.execute(`UPDATE moderation_submissions SET ${assignment} WHERE id = ?`, [
            ...args,
            item.id,
          ]);
          await assert.rejects(audit.record(item), { status });
          assert.equal(await count('moderation_ai_runs', 'submission_id', item.id), 0);
        }
      },
    );

    await t.test(
      'reviewer removal between preparation and completion blocks saving and reading',
      async () => {
        const item = await submission();
        await audit.prepare(item);
        await pool.execute('UPDATE moderation_reviewers SET active = 0 WHERE user_id = 1');
        try {
          await assert.rejects(audit.record(item), { status: 403 });
          await assert.rejects(audit.history({ id: item.id, reviewerId: 1 }), { status: 403 });
          await assert.rejects(audit.exportRegressions({ reviewerId: 1 }), { status: 403 });
          assert.equal(await count('moderation_ai_runs', 'submission_id', item.id), 0);
        } finally {
          await pool.execute('UPDATE moderation_reviewers SET active = 1 WHERE user_id = 1');
        }
      },
    );

    await t.test(
      'human publication decision does not erase audit history or prevent later feedback',
      async () => {
        const item = await recorded();
        await service.decide({
          id: item.id,
          reviewerId: 1,
          expectedVersion: 1,
          requestId: crypto.randomUUID(),
          decision: 'rejected',
          reason: '经人工确认不发布。',
        });
        await assert.rejects(audit.record(item), { status: 409 });
        await audit.feedback({ ...item, body: feedbackBody() });
        const history = await restarted.history({ id: item.id, reviewerId: 4 });
        assert.equal(history.runs[0].publicationDecision.status, 'rejected');
        assert.equal(history.runs[0].publicationDecision.reviewerId, '1');
        assert.equal(history.runs[0].feedback.verdict, 'agree');
        assert.equal(history.runs[0].feedback.policyVersion, POLICY_VERSION);
        assert.equal(await count('moderation_ai_runs', 'submission_id', item.id), 1);
      },
    );

    await t.test(
      'same-request concurrent feedback and regression retries create one row each',
      async () => {
        const item = await recorded();
        const feedback = feedbackBody();
        const outcomes = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            (index % 2 ? restarted : audit).feedback({ ...item, body: feedback }),
          ),
        );
        assert.equal(outcomes.filter((value) => !value.replayed).length, 1);
        assert.equal(new Set(outcomes.map((value) => value.id)).size, 1);
        assert.equal(await count('moderation_ai_feedback', 'run_id', item.runId), 1);
        await assert.rejects(audit.feedback({ ...item, body: { ...feedback, note: 'changed' } }), {
          status: 409,
        });
        const body = caseBody();
        const cases = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            (index % 2 ? restarted : audit).regression({ ...item, body }),
          ),
        );
        assert.equal(cases.filter((value) => !value.replayed).length, 1);
        assert.equal(new Set(cases.map((value) => value.id)).size, 1);
        assert.equal(await count('moderation_regression_cases', 'run_id', item.runId), 1);
        await assert.rejects(audit.regression({ ...item, body: { ...body, reason: 'changed' } }), {
          status: 409,
        });
      },
    );

    await t.test(
      'legacy or stale feedback cannot certify new current-policy regression cases and retries preserve history',
      async () => {
        const item = await recorded();
        const originalRequest = feedbackBody();
        const original = await audit.feedback({ ...item, body: originalRequest });
        const readFeedback = async () => {
          const [[row]] = await pool.execute(
            'SELECT feedback_json FROM moderation_ai_feedback WHERE id = ?',
            [original.id],
          );
          return typeof row.feedback_json === 'string'
            ? JSON.parse(row.feedback_json)
            : row.feedback_json;
        };
        assert.equal((await readFeedback()).policyVersion, POLICY_VERSION);
        await pool.execute(
          "UPDATE moderation_ai_feedback SET feedback_json = JSON_REMOVE(feedback_json, '$.policyVersion') WHERE id = ?",
          [original.id],
        );
        await assert.rejects(
          audit.regression({ ...item, body: caseBody() }),
          (error) => error.status === 409 && /重新保存人工复核/.test(error.message),
        );
        await pool.execute(
          "UPDATE moderation_ai_feedback SET feedback_json = JSON_SET(feedback_json, '$.policyVersion', ?) WHERE id = ?",
          ['previous-policy', original.id],
        );
        await assert.rejects(
          audit.regression({ ...item, body: caseBody() }),
          (error) => error.status === 409 && /重新保存人工复核/.test(error.message),
        );
        assert.deepEqual(await restarted.feedback({ ...item, body: originalRequest }), {
          id: original.id,
          replayed: true,
        });
        assert.equal((await readFeedback()).policyVersion, 'previous-policy');
        assert.equal(await count('moderation_ai_feedback', 'run_id', item.runId), 1);
        assert.equal(await count('moderation_regression_cases', 'run_id', item.runId), 0);
        const refreshed = await restarted.feedback({
          ...item,
          body: feedbackBody({ note: '按当前规则重新确认。' }),
        });
        const created = await audit.regression({ ...item, body: caseBody() });
        const [[link]] = await pool.execute(
          'SELECT feedback_id FROM moderation_regression_cases WHERE id = ?',
          [created.id],
        );
        assert.equal(String(link.feedback_id), refreshed.id);
        const history = await audit.history({ id: item.id, reviewerId: 1 });
        assert.equal(history.runs[0].feedback.policyVersion, POLICY_VERSION);
        assert.equal(history.runs[0].feedbackHistory[1].policyVersion, 'previous-policy');
      },
    );

    await t.test(
      'regressions require completed latest feedback and rewritten content, never a raw original copy',
      async () => {
        const item = await recorded();
        await assert.rejects(audit.regression({ ...item, body: caseBody() }), { status: 409 });
        await audit.feedback({
          ...item,
          body: feedbackBody({ verdict: 'escalate', note: '需进一步核查。' }),
        });
        await assert.rejects(audit.regression({ ...item, body: caseBody() }), { status: 409 });
        await audit.feedback({
          ...item,
          body: feedbackBody({
            verdict: 'correct',
            note: '根据额外上下文确认只是引用。',
            ...clearLabel(),
          }),
        });
        await assert.rejects(audit.regression({ ...item, body: caseBody() }), { status: 409 });
        const revised = caseBody({
          expectedDecision: 'no_risk_detected',
          categories: [],
          ruleIds: [],
          supportPriority: 'none',
        });
        await assert.rejects(
          audit.regression({ ...item, body: { ...revised, content: ` ${item.payload.content} ` } }),
          { status: 400 },
        );
        await assert.rejects(
          audit.regression({ ...item, body: { ...revised, syntheticConfirmed: false } }),
          { status: 400 },
        );
        const result = await audit.regression({ ...item, body: revised });
        const [[row]] = await pool.execute(
          `SELECT f.feedback_json FROM moderation_regression_cases c
        JOIN moderation_ai_feedback f ON f.id = c.feedback_id WHERE c.id = ?`,
          [result.id],
        );
        const feedback =
          typeof row.feedback_json === 'string' ? JSON.parse(row.feedback_json) : row.feedback_json;
        assert.equal(feedback.decision, 'no_risk_detected');
      },
    );

    await t.test(
      'exports contain only manually authored synthetic cases and omit actors, raw posts and audit internals',
      async () => {
        const output = await restarted.exportRegressions({ reviewerId: 4 });
        assert.ok(output.cases.length >= 2);
        assert.equal(output.format, 'freebbs-moderation-regression-v1');
        assert.doesNotMatch(
          JSON.stringify(output),
          /PRIVATE_ORIGINAL|PRIVATE_PROVIDER|PRIVATE_REASONING|reviewerId|authorId|submissionId|runId|feedback_id|input_hash|request_hash/,
        );
        output.cases.forEach((item) => {
          assert.equal(item.syntheticConfirmed, true);
          assert.equal(item.title, '虚构讨论测试');
          assert.equal(item.policyVersion, POLICY_VERSION);
        });
      },
    );

    await t.test(
      'expired evidence is immediately inaccessible before cleanup and purge cascades to feedback and cases',
      async () => {
        const item = await recorded();
        await audit.feedback({ ...item, body: feedbackBody() });
        const created = await audit.regression({ ...item, body: caseBody() });
        await pool.execute(
          'UPDATE moderation_submissions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [item.id],
        );
        await assert.rejects(audit.history({ id: item.id, reviewerId: 1 }), { status: 410 });
        await assert.rejects(audit.feedback({ ...item, body: feedbackBody() }), { status: 410 });
        await assert.rejects(audit.regression({ ...item, body: caseBody() }), { status: 410 });
        assert.equal(
          (await audit.exportRegressions({ reviewerId: 1 })).cases.some(
            (row) => row.id === created.id,
          ),
          false,
        );
        assert.equal(await count('moderation_ai_feedback', 'run_id', item.runId), 1);
        await pool.execute(
          'UPDATE moderation_ai_runs SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [item.runId],
        );
        await pool.execute(
          'UPDATE moderation_regression_cases SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [created.id],
        );
        assert.ok((await audit.purge()) >= 1);
        assert.equal(await count('moderation_ai_runs', 'id', item.runId), 0);
        assert.equal(await count('moderation_ai_feedback', 'run_id', item.runId), 0);
        assert.equal(await count('moderation_regression_cases', 'run_id', item.runId), 0);
        assert.equal(await audit.purge(), 0);
      },
    );

    await t.test(
      'parent deletion cascades all audit evidence while account deletion only removes actor links',
      async () => {
        const item = await submission();
        item.runId = await audit.record({ ...item, reviewerId: 4 });
        await audit.feedback({ ...item, reviewerId: 4, body: feedbackBody() });
        const created = await audit.regression({ ...item, reviewerId: 4, body: caseBody() });
        await pool.execute('DELETE FROM users WHERE id = 4');
        const [[run]] = await pool.execute(
          'SELECT reviewer_id FROM moderation_ai_runs WHERE id = ?',
          [item.runId],
        );
        const [[feedback]] = await pool.execute(
          'SELECT reviewer_id FROM moderation_ai_feedback WHERE run_id = ?',
          [item.runId],
        );
        const [[regression]] = await pool.execute(
          'SELECT reviewer_id FROM moderation_regression_cases WHERE id = ?',
          [created.id],
        );
        assert.equal(feedback.reviewer_id, null);
        assert.equal(regression.reviewer_id, null);
        assert.equal(run.reviewer_id, null);
        const history = await audit.history({ id: item.id, reviewerId: 1 });
        assert.equal(history.runs[0].feedback.reviewerId, null);
        await pool.execute('DELETE FROM moderation_submissions WHERE id = ?', [item.id]);
        assert.equal(await count('moderation_ai_runs', 'id', item.runId), 0);
        assert.equal(await count('moderation_ai_feedback', 'run_id', item.runId), 0);
        assert.equal(await count('moderation_regression_cases', 'run_id', item.runId), 0);
      },
    );
  },
);
