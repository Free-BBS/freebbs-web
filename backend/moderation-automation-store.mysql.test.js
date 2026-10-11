const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isolatedMysqlConfig } = require('./test-helpers/isolated-mysql');
const { ensureSchema, createDiscussionModeration } = require('./discussion-moderation');
const { createModerationPublisher } = require('./moderation-publisher');
const { createModerationAutomationStore } = require('./moderation-automation-store');
const { POLICY_VERSION } = require('./moderation-policy');

test(
  'isolated MySQL: automatic moderation leases, publication, pause and withdrawal are atomic',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    assert.equal(
      Number((await connection.query('SELECT @@skip_networking AS isolated'))[0][0].isolated),
      1,
    );
    const database = `moderation_test_${crypto.randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_test_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 10 });
    t.after(() => pool.end());
    await pool.query(
      `CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(64), is_admin TINYINT DEFAULT 0, full_name VARCHAR(64), student_id VARCHAR(10), email VARCHAR(200)) ENGINE=InnoDB`,
    );
    await pool.query(
      "INSERT INTO users (id,username,is_admin) VALUES (1,'admin',1),(2,'author',0),(3,'reviewer',0),(4,'admin2',1)",
    );
    await pool.query(
      `CREATE TABLE community_notifications (id BIGINT AUTO_INCREMENT PRIMARY KEY, recipient_id BIGINT, actor_id BIGINT, kind VARCHAR(24), title VARCHAR(160), body TEXT, link VARCHAR(500), event_key VARCHAR(190), UNIQUE KEY uq_event (event_key,recipient_id)) ENGINE=InnoDB`,
    );
    await pool.query(
      'CREATE TABLE discussion_boards (id BIGINT PRIMARY KEY, slug VARCHAR(64), is_active TINYINT DEFAULT 1) ENGINE=InnoDB',
    );
    await pool.query("INSERT INTO discussion_boards(id,slug) VALUES (1,'daily')");
    await pool.query(
      `CREATE TABLE discussion_posts (id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, pid VARCHAR(32), board_id BIGINT, author_student_id VARCHAR(10), is_anonymous TINYINT DEFAULT 0, title VARCHAR(120), content_markdown TEXT, is_deleted TINYINT DEFAULT 0, is_hidden TINYINT DEFAULT 0, login_required TINYINT DEFAULT 1, deleted_at DATETIME, deleted_by BIGINT, is_pinned TINYINT DEFAULT 0, pinned_at DATETIME, pinned_by BIGINT, is_featured TINYINT DEFAULT 0, featured_at DATETIME, featured_by BIGINT) ENGINE=InnoDB`,
    );
    await pool.query(
      `CREATE TABLE discussion_comments (id BIGINT AUTO_INCREMENT PRIMARY KEY, post_id BIGINT, parent_comment_id BIGINT, author_student_id VARCHAR(10), user_id BIGINT, content_markdown TEXT, is_deleted TINYINT DEFAULT 0, deleted_at DATETIME, deleted_by BIGINT, is_featured TINYINT DEFAULT 0, featured_at DATETIME, featured_by BIGINT) ENGINE=InnoDB`,
    );
    await ensureSchema(pool);
    await pool.execute('INSERT INTO moderation_reviewers (user_id, active) VALUES (3, 1)');
    async function transaction(callback) {
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const result = await callback(db);
        await db.commit();
        return result;
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    }
    let enabled = true;
    let throwAfterPublish = false;
    let publishedCount = 0;
    const realPublisher = createModerationPublisher({
      createPostPid: async () => `p_${crypto.randomBytes(12).toString('hex')}`,
      awardMagnetic: async () => 0,
      notifications: { notifyReply: async () => {}, notifyMentions: async () => {} },
    });
    async function publishSubmission(db, submission) {
      const result = await realPublisher(db, submission);
      if (throwAfterPublish) throw new Error('injected publication rollback');
      return result;
    }
    const options = {
      pool,
      publishSubmission,
      isEnabled: () => enabled,
      onPublished: async () => {
        publishedCount += 1;
      },
    };
    const store = createModerationAutomationStore(options);
    await store.ensureSchema();
    const service = createDiscussionModeration({ pool, publishSubmission, automation: store });
    const row = async (id) =>
      (await pool.execute('SELECT * FROM moderation_submissions WHERE id = ?', [id]))[0][0];
    const job = async (id) =>
      (
        await pool.execute('SELECT * FROM moderation_auto_jobs WHERE submission_id = ?', [id])
      )[0][0];
    const input = (overrides = {}) => ({
      kind: 'post',
      authorId: 2,
      requestId: crypto.randomUUID(),
      payload: {
        boardId: 1,
        title: '测试标题',
        content: '建议自习室增加插座，方便大家使用电脑。',
        anonymous: false,
        loginRequired: true,
      },
      attachmentIds: [],
      ...overrides,
    });
    async function submit(body = input()) {
      return transaction((db) => service.submit(db, body));
    }
    async function ready(body) {
      const submission = await submit(body);
      const claimed = await store.claim();
      assert.equal(claimed.submissionId, submission.id);
      const snapshot = await store.prepare(claimed);
      return { submission, claimed, snapshot };
    }
    const allow = ({ snapshot }, extra = {}) => ({
      model: 'qwen3.6-27b',
      settingsRevision: 1,
      policyVersion: POLICY_VERSION,
      inputHash: snapshot.inputHash,
      elapsedMs: 123,
      assessment: {
        decision: 'no_risk_detected',
        categories: [],
        reason: '正常建议，没有禁止内容。',
        ruleMatches: [],
        uncertainties: [],
        supportPriority: 'none',
        supportReason: '',
      },
      ...extra,
    });
    async function reviewOne(entry) {
      return store.finish(entry.claimed, {
        assessment: null,
        manualReview: { required: true, validation: 'not_attempted' },
      });
    }

    await t.test(
      'control starts paused, only administrators resume, submissions still queue and retries do not duplicate',
      async () => {
        assert.deepEqual(await store.control(), { paused: true, revision: 1 });
        await assert.rejects(store.setPaused({ actorId: 2, paused: false }), { status: 403 });
        const body = input();
        const first = await submit(body);
        const second = await submit(body);
        assert.equal(first.id, second.id);
        assert.equal(second.replayed, true);
        assert.equal(
          Number((await pool.query('SELECT COUNT(*) AS n FROM moderation_auto_jobs'))[0][0].n),
          1,
        );
        assert.equal(await store.claim(), null);
        assert.deepEqual(await store.setPaused({ actorId: 1, paused: false }), {
          paused: false,
          revision: 2,
        });
        const claimed = await store.claim();
        await store.prepare(claimed);
        await store.finish(claimed, { assessment: null });
        await assert.rejects(store.get({ id: first.id, reviewerId: 2 }), { status: 403 });
        assert.equal((await store.get({ id: first.id, reviewerId: 3 })).state, 'review');
      },
    );
    await t.test(
      'new submission hook rolls back the draft, queue and notices together on failure',
      async () => {
        const counts = async () =>
          Promise.all(
            ['moderation_submissions', 'moderation_auto_jobs', 'community_notifications'].map(
              async (table) =>
                Number((await pool.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),
            ),
          );
        const before = await counts();
        const failingService = createDiscussionModeration({
          pool,
          publishSubmission,
          automation: {
            enqueue: async (db, submission) => {
              await store.enqueue(db, submission);
              throw new Error('injected enqueue rollback');
            },
          },
        });
        await assert.rejects(
          transaction((db) => failingService.submit(db, input())),
          /injected enqueue rollback/,
        );
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      'a disabled feature never enqueues old drafts when subsequently enabled',
      async () => {
        enabled = false;
        const submission = await submit();
        enabled = true;
        assert.equal(await job(submission.id), undefined);
        assert.equal(await store.claim(), null);
      },
    );
    await t.test('two workers cannot claim the same or different tasks concurrently', async () => {
      const a = await submit();
      const b = await submit();
      const other = createModerationAutomationStore(options);
      const claims = await Promise.all([store.claim(), other.claim()]);
      assert.equal(claims.filter(Boolean).length, 1);
      await store.finish(claims.find(Boolean), { assessment: null });
      const remaining = await other.claim();
      assert.ok([a.id, b.id].includes(remaining.submissionId));
      await other.finish(remaining, { assessment: null });
    });
    await t.test(
      'a lease expiring during local preparation never produces a provider-ready snapshot',
      async () => {
        const submission = await submit();
        const claimed = await store.claim();
        const crossingStore = createModerationAutomationStore({
          ...options,
          withDatabaseTransaction: (callback) =>
            transaction((db) =>
              callback({
                execute: async (sql, args) => {
                  const result = await db.execute(sql, args);
                  if (sql.startsWith('SELECT full_name, student_id, email'))
                    await db.execute(
                      'UPDATE moderation_auto_jobs SET lease_until = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
                      [claimed.id],
                    );
                  return result;
                },
              }),
            ),
        });
        assert.equal(await crossingStore.prepare(claimed), null);
        const held = await job(submission.id);
        assert.equal(held.state, 'review');
        assert.equal(held.reason_code, 'lease_expired');
        assert.equal(held.input_meta_json, null);
        assert.equal(Number(held.attempts), 1);
        assert.equal(await store.claim(), null);
      },
    );
    await t.test(
      'automatic publication has no human actor, fixed private notifications and is exactly once',
      async () => {
        const entry = await ready();
        const outcome = await store.finish(entry.claimed, allow(entry));
        assert.equal(outcome.state, 'published');
        assert.equal(outcome.submission.version, 2);
        assert.equal(outcome.submission.decidedBy, null);
        assert.equal((await row(entry.submission.id)).status, 'approved');
        const before = publishedCount;
        const replay = await store.finish(entry.claimed, allow(entry));
        assert.equal(replay.applied, false);
        assert.equal(publishedCount, before);
        const [notices] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [`moderation-auto:${entry.claimed.id}:published`],
        );
        assert.equal(notices.length, 4);
        assert.doesNotMatch(JSON.stringify(notices), /自习室|插座|正常建议/);
        const detail = await store.get({ id: entry.submission.id, reviewerId: 3 });
        assert.equal(detail.canWithdraw, true);
      },
    );
    await t.test(
      'privacy redaction and unreviewed attachments cannot be bypassed by an allow result',
      async () => {
        const body = input();
        body.payload.content = '我是李星云，2025010000，紫荆一号楼629A，大家来找我玩！';
        const entry = await ready(body);
        assert.ok(entry.snapshot.counts.studentId > 0);
        assert.ok(entry.snapshot.counts.address > 0);
        assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'review');
        const plain = await ready();
        await pool.execute(
          'UPDATE moderation_submissions SET attachment_ids_json = ? WHERE id = ?',
          [JSON.stringify([crypto.randomUUID()]), plain.submission.id],
        );
        assert.equal((await store.finish(plain.claimed, allow(plain))).state, 'review');
      },
    );
    await t.test(
      'model metadata, returned action, evidence and local input binding cannot fabricate approval',
      async () => {
        for (const mutate of [
          (value) => ({ ...value, inputHash: '0'.repeat(64) }),
          (value) => ({ ...value, model: 'glm-5.1' }),
          (value) => ({ ...value, policyVersion: 'old' }),
          (value) => ({ ...value, assessment: { ...value.assessment, unknown: 'untrusted' } }),
          (value) => ({
            ...value,
            assessment: {
              ...value.assessment,
              decision: 'needs_review',
              uncertainties: ['有待核实内容。'],
            },
            policyDecision: { recommendedAction: 'allow' },
          }),
        ]) {
          const entry = await ready();
          const result = await store.finish(entry.claimed, mutate(allow(entry)));
          assert.equal(result.state, 'review');
        }
        const entry = await ready();
        await pool.execute("UPDATE users SET full_name = '自习室' WHERE id = 2");
        assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'review');
        await pool.execute('UPDATE users SET full_name = NULL WHERE id = 2');
      },
    );
    await t.test(
      'pause and resume invalidates older in-flight generation; stopped and disabled workers also hold',
      async () => {
        const entry = await ready();
        await store.setPaused({ actorId: 1, paused: true });
        await store.setPaused({ actorId: 1, paused: false });
        assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'review');
        const stopped = await ready();
        assert.equal(
          (await store.finish(stopped.claimed, allow(stopped), { canApply: () => false })).state,
          'review',
        );
        const disabled = await ready();
        enabled = false;
        assert.equal((await store.finish(disabled.claimed, allow(disabled))).state, 'review');
        enabled = true;
      },
    );
    await t.test(
      'reviewer removal before completion blocks publication and notifies the author',
      async () => {
        const entry = await ready();
        await pool.execute('UPDATE moderation_reviewers SET active = 0');
        const result = await store.finish(entry.claimed, allow(entry));
        assert.equal(result.state, 'review');
        assert.equal(result.reasonCode, 'no_reviewers');
        await pool.execute('UPDATE moderation_reviewers SET active = 1');
      },
    );
    await t.test(
      'clear prohibition temporarily blocks without taking a final human decision; care remains separate',
      async () => {
        const body = input();
        body.payload.content = '那个同学就是废物，大家每天去辱骂他。';
        const blocked = await ready(body);
        const blockedAssessment = {
          decision: 'high_risk',
          categories: ['harassment'],
          reason: '明确针对具体同学人格羞辱并号召持续骚扰。',
          ruleMatches: [
            {
              ruleId: '骚扰-001',
              evidence: { field: 'content', quote: '大家每天去辱骂他' },
              explanation: '原文明确号召他人持续骚扰。',
            },
          ],
          uncertainties: [],
          supportPriority: 'none',
          supportReason: '',
        };
        assert.equal(
          (await store.finish(blocked.claimed, allow(blocked, { assessment: blockedAssessment })))
            .state,
          'blocked',
        );
        assert.equal((await row(blocked.submission.id)).status, 'pending');
        const help = input();
        help.payload.content = '最近很绝望，感觉难以独自应对，我想找人聊聊。';
        const care = await ready(help);
        const assessment = {
          decision: 'no_risk_detected',
          categories: [],
          reason: '求助本身不违规。',
          ruleMatches: [
            {
              ruleId: '关怀-001',
              evidence: { field: 'content', quote: '最近很绝望' },
              explanation: '明显痛苦，没有近期实施自伤的证据。',
            },
          ],
          uncertainties: [],
          supportPriority: 'attention',
          supportReason: '需要支持性人工关注。',
        };
        const outcome = await store.finish(care.claimed, allow(care, { assessment }));
        assert.equal(outcome.state, 'review');
        assert.equal(outcome.reasonCode, 'support_requires_review');
        assert.deepEqual(outcome.result.assessment.categories, []);
      },
    );
    await t.test(
      'failed result preserves only safe diagnostics and unverified known hints',
      async () => {
        const entry = await ready();
        const result = await store.finish(entry.claimed, {
          ...allow(entry),
          assessment: null,
          rawBody: '不应持久化的供应商原始正文',
          manualReview: {
            required: true,
            validation: 'failed',
            diagnostics: {
              version: 1,
              contractVersion: 'freebbs-moderation-contract-2026-10-11-v2',
              failureCode: 'category_rule_mismatch',
              httpStatus: 200,
              reviewSignal: {
                version: 1,
                reportedDecision: 'high_risk',
                reportedCategories: ['harassment'],
                reportedRuleIds: ['骚扰-001'],
                reportedSupportPriority: 'none',
                reason: '不应保存的未校验理由',
              },
            },
          },
        });
        assert.equal(result.state, 'review');
        assert.equal(result.result.assessment, null);
        assert.deepEqual(result.result.manualReview.diagnostics.reviewSignal, {
          version: 1,
          reportedDecision: 'high_risk',
          reportedCategories: ['harassment'],
          reportedRuleIds: ['骚扰-001'],
          reportedSupportPriority: 'none',
        });
        assert.doesNotMatch(JSON.stringify(result.result), /不应持久化|不应保存/);
        const stored = await job(entry.submission.id);
        assert.doesNotMatch(JSON.stringify(stored.result_json), /不应持久化|不应保存/);
      },
    );
    await t.test('human decision wins over late automatic response', async () => {
      const entry = await ready();
      await service.decide({
        id: entry.submission.id,
        reviewerId: 1,
        decision: 'rejected',
        reason: '人工判断',
        expectedVersion: 1,
        requestId: crypto.randomUUID(),
      });
      assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'cancelled');
      assert.equal((await row(entry.submission.id)).decision_reason, '人工判断');
    });
    await t.test(
      'restart recovery retains manual review without reissuing charged calls',
      async () => {
        const entry = await ready();
        await pool.execute(
          'UPDATE moderation_auto_jobs SET lease_until = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [entry.claimed.id],
        );
        const restarted = createModerationAutomationStore(options);
        assert.equal(await restarted.recover(), 1);
        assert.equal(await restarted.recover(), 0);
        assert.equal((await job(entry.submission.id)).state, 'review');
        assert.equal(Number((await job(entry.submission.id)).attempts), 1);
        assert.equal(await restarted.claim(), null);
        assert.equal((await restarted.finish(entry.claimed, allow(entry))).applied, false);
      },
    );
    await t.test(
      'publisher failure rolls back content, approval and notifications together',
      async () => {
        const entry = await ready();
        const before = Number(
          (await pool.query('SELECT COUNT(*) AS n FROM discussion_posts'))[0][0].n,
        );
        throwAfterPublish = true;
        await assert.rejects(
          store.finish(entry.claimed, allow(entry)),
          /injected publication rollback/,
        );
        throwAfterPublish = false;
        assert.equal(
          Number((await pool.query('SELECT COUNT(*) AS n FROM discussion_posts'))[0][0].n),
          before,
        );
        assert.equal((await row(entry.submission.id)).status, 'pending');
        assert.equal((await job(entry.submission.id)).state, 'running');
        await reviewOne(entry);
      },
    );
    await t.test(
      'a worker stop during notification rolls back the in-flight publication',
      async () => {
        const entry = await ready();
        let applicable = true;
        const stoppingStore = createModerationAutomationStore({
          ...options,
          notifications: {
            notifyModeration: async () => {
              applicable = false;
            },
          },
        });
        const before = Number(
          (await pool.query('SELECT COUNT(*) AS n FROM discussion_posts'))[0][0].n,
        );
        await assert.rejects(
          stoppingStore.finish(entry.claimed, allow(entry), { canApply: () => applicable }),
          { status: 409 },
        );
        assert.equal(
          Number((await pool.query('SELECT COUNT(*) AS n FROM discussion_posts'))[0][0].n),
          before,
        );
        assert.equal((await row(entry.submission.id)).status, 'pending');
        await reviewOne(entry);
      },
    );
    await t.test(
      'withdrawal requires a current reviewer and version, is idempotent, and redacts mention/reply notices',
      async () => {
        const entry = await ready();
        const result = await store.finish(entry.claimed, allow(entry));
        const request = {
          id: entry.submission.id,
          reviewerId: 3,
          expectedVersion: 2,
          reason: '私有撤回原因不得进入公开通知',
          requestId: crypto.randomUUID(),
        };
        await assert.rejects(store.withdraw({ ...request, reviewerId: 2 }), { status: 403 });
        await assert.rejects(store.withdraw({ ...request, expectedVersion: 1 }), { status: 409 });
        const id = Number(result.submission.publishedId);
        const [[post]] = await pool.execute('SELECT * FROM discussion_posts WHERE id = ?', [id]);
        await pool.execute('UPDATE discussion_posts SET is_hidden = 1 WHERE id = ?', [id]);
        await pool.execute(
          "INSERT INTO discussion_comments (post_id,user_id,content_markdown) VALUES (?,2,'已存在的回复')",
          [id],
        );
        for (const kind of ['reply', 'mention', 'reaction', 'comment_like'])
          await pool.execute(
            'INSERT INTO community_notifications (recipient_id,kind,title,body,link,event_key) VALUES (1,?,?,?,?,?)',
            [
              kind,
              '旧的公开标题',
              '需要清理的旧正文',
              `/discussion?post=${post.pid}#comment-1`,
              crypto.randomUUID(),
            ],
          );
        const withdrawn = await store.withdraw(request);
        assert.equal(withdrawn.status, 'rejected');
        assert.equal(withdrawn.version, 3);
        assert.equal(withdrawn.publishedUrl, '');
        assert.equal((await store.withdraw(request)).replayed, true);
        await assert.rejects(store.withdraw({ ...request, reason: '不同原因' }), { status: 409 });
        assert.equal(
          Number(
            (await pool.execute('SELECT is_deleted FROM discussion_posts WHERE id = ?', [id]))[0][0]
              .is_deleted,
          ),
          1,
        );
        assert.equal(
          Number(
            (
              await pool.execute(
                'SELECT COUNT(*) AS n FROM discussion_comments c JOIN discussion_posts p ON p.id = c.post_id WHERE p.id = ? AND p.is_deleted = 0',
                [id],
              )
            )[0][0].n,
          ),
          0,
        );
        const [notices] = await pool.query('SELECT title,body,link FROM community_notifications');
        assert.doesNotMatch(JSON.stringify(notices), /需要清理的旧正文|私有撤回原因/);
        assert.equal(
          (await store.get({ id: entry.submission.id, reviewerId: 1 })).withdrawal.reason,
          request.reason,
        );
      },
    );
    await t.test(
      'automatic comment withdrawal hides only its content and scrubs its notification',
      async () => {
        const post = await ready();
        const published = await store.finish(post.claimed, allow(post));
        const comment = await ready(
          input({
            kind: 'comment',
            payload: {
              postId: Number(published.submission.publishedId),
              content: '感谢反馈，建议很好。',
            },
          }),
        );
        const approved = await store.finish(comment.claimed, allow(comment));
        await pool.execute(
          'INSERT INTO community_notifications (recipient_id,kind,title,body,link,event_key) VALUES (1,?,?,?,?,?)',
          [
            'mention',
            '旧评论标题',
            '旧评论敏感正文',
            approved.submission.publishedUrl,
            crypto.randomUUID(),
          ],
        );
        await store.withdraw({
          id: comment.submission.id,
          reviewerId: 3,
          expectedVersion: 2,
          reason: '复核后撤回',
          requestId: crypto.randomUUID(),
        });
        assert.equal(
          Number(
            (
              await pool.execute('SELECT is_deleted FROM discussion_comments WHERE id = ?', [
                approved.submission.publishedId,
              ])
            )[0][0].is_deleted,
          ),
          1,
        );
        const [notices] = await pool.query('SELECT body FROM community_notifications');
        assert.doesNotMatch(JSON.stringify(notices), /旧评论敏感正文/);
      },
    );
    await t.test(
      'expired records never publish and details are purged even while disabled',
      async () => {
        const entry = await ready();
        await pool.execute(
          'UPDATE moderation_submissions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [entry.submission.id],
        );
        assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'cancelled');
        const reviewed = await ready();
        await reviewOne(reviewed);
        await pool.execute(
          'UPDATE moderation_auto_jobs SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE submission_id IN (?,?)',
          [entry.submission.id, reviewed.submission.id],
        );
        enabled = false;
        assert.equal(await store.purge(), 2);
        enabled = true;
        const cleaned = await job(reviewed.submission.id);
        assert.equal(cleaned.result_json, null);
        assert.equal(cleaned.input_meta_json, null);
        assert.ok(cleaned.purged_at);
        assert.equal((await store.get({ id: reviewed.submission.id, reviewerId: 1 })).result, null);
      },
    );
  },
);
