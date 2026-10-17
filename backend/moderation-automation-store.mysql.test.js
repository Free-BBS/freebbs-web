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
      `CREATE TABLE community_notifications (id BIGINT AUTO_INCREMENT PRIMARY KEY, recipient_id BIGINT, actor_id BIGINT, kind VARCHAR(24), title VARCHAR(160), body TEXT, link VARCHAR(500), event_key VARCHAR(190), read_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_event (event_key,recipient_id)) ENGINE=InnoDB`,
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
    const imagePixels = new Map();
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
      readImages: async (rows) =>
        rows.map((item) => {
          const bytes = imagePixels.get(item.id);
          return {
            id: item.id,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            mimeType: item.mime_type,
            dataBase64: bytes.toString('base64'),
          };
        }),
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
        reviewTopics: { political: [], psychological: [] },
      },
      ...extra,
    });
    async function imageReady(count = 1, content = '图片记录了一次普通校园活动。') {
      const bytes = await require('sharp')({
        create: { width: 16, height: 16, channels: 3, background: '#eaf3ff' },
      })
        .webp()
        .toBuffer();
      const ids = [];
      for (let index = 0; index < count; index += 1) {
        const id = crypto.randomUUID();
        await service.registerAttachment({
          id,
          authorId: 2,
          fileName: `${id}.webp`,
          mimeType: 'image/webp',
          byteSize: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
        imagePixels.set(id, bytes);
        ids.push(id);
      }
      const body = input({ attachmentIds: ids });
      body.payload.content = `${content}\n${ids.map((id) => `![图片](/api/moderation/attachments/${id})`).join('\n')}`;
      const entry = await ready(body);
      return { ...entry, imageIds: entry.snapshot.images.map((image) => image.id) };
    }
    function imageAllow(entry) {
      const { buildAutomaticResult } = require('./moderation-automation-result');
      const { IMAGE_CONTRACT_VERSION } = require('./moderation-image-client');
      const base = allow(entry);
      const imageResults = [];
      for (let offset = 0; offset < entry.imageIds.length; offset += 3) {
        const attachmentIds = entry.imageIds.slice(offset, offset + 3);
        imageResults.push({
          attachmentIds,
          response: {
            assessment: structuredClone(base.assessment),
            imageObservations: attachmentIds.map((_id, index) => ({
              imageIndex: index + 1,
              text: '普通校园活动',
              description: '一张普通活动图片。',
            })),
            model: 'kimi-k2.6',
            settingsRevision: 1,
            policyVersion: POLICY_VERSION,
            imageContractVersion: IMAGE_CONTRACT_VERSION,
          },
        });
      }
      return buildAutomaticResult({
        textResult: {
          assessment: base.assessment,
          model: base.model,
          settingsRevision: base.settingsRevision,
          policyVersion: base.policyVersion,
        },
        imageResults,
        snapshot: entry.snapshot,
        elapsedMs: 180,
      });
    }
    async function reviewOne(entry) {
      return store.finish(entry.claimed, {
        assessment: null,
        manualReview: { required: true, validation: 'not_attempted' },
      });
    }

    await t.test(
      'paused submissions go directly to manual review and are never automatically backfilled',
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
          0,
        );
        assert.equal(await store.claim(), null);
        assert.deepEqual(await store.setPaused({ actorId: 1, paused: false }), {
          paused: false,
          revision: 2,
        });
        assert.equal(first.processing, 'review');
        assert.equal(await store.claim(), null);
        const [notices] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [`moderation-author:${first.id}:pending`],
        );
        assert.equal(notices.length, 1);
        await assert.rejects(store.get({ id: first.id, reviewerId: 2 }), { status: 403 });
        assert.equal(await store.get({ id: first.id, reviewerId: 3 }), null);
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
        assert.equal(notices.length, 3);
        assert.equal(
          notices.some((notice) => Number(notice.recipient_id) === 2),
          false,
        );
        assert.equal(
          (
            await pool.execute('SELECT id FROM community_notifications WHERE event_key = ?', [
              `moderation-author:${entry.submission.id}:pending`,
            ])
          )[0].length,
          0,
        );
        assert.doesNotMatch(JSON.stringify(notices), /自习室|插座|正常建议/);
        const detail = await store.get({ id: entry.submission.id, reviewerId: 3 });
        assert.equal(detail.canWithdraw, true);
      },
    );
    await t.test(
      'machine queue stays quiet and actual human referral notifies the author exactly once',
      async () => {
        const entry = await ready();
        const authorKey = `moderation-author:${entry.submission.id}:pending`;
        const initialKeys = [authorKey, `moderation:${entry.submission.id}:pending`];
        assert.equal(entry.submission.processing, 'automatic');
        assert.equal(
          (
            await pool.execute(
              'SELECT id FROM community_notifications WHERE event_key IN (?, ?)',
              initialKeys,
            )
          )[0].length,
          0,
        );
        assert.equal((await reviewOne(entry)).state, 'review');
        await reviewOne(entry);
        const [authorNotices] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [authorKey],
        );
        assert.equal(authorNotices.length, 1);
        assert.equal(Number(authorNotices[0].recipient_id), 2);
        assert.equal(authorNotices[0].title, '内容正在等待处理');
        assert.equal(authorNotices[0].link, `/moderation?mine=1&id=${entry.submission.id}`);
        const [reviewNotices] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [`moderation-auto:${entry.claimed.id}:review`],
        );
        assert.deepEqual(
          reviewNotices.map((notice) => Number(notice.recipient_id)).sort(),
          [1, 3, 4],
        );
        await pool.execute(
          'UPDATE community_notifications SET read_at = NOW() WHERE event_key = ?',
          [authorKey],
        );
        const [[before]] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [authorKey],
        );
        const published = await service.decide({
          id: entry.submission.id,
          reviewerId: 1,
          decision: 'approved',
          expectedVersion: 1,
          requestId: crypto.randomUUID(),
        });
        const [[after]] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [authorKey],
        );
        assert.equal(after.id, before.id);
        assert.deepEqual(after.read_at, before.read_at);
        assert.equal(after.title, '内容已发布');
        assert.equal(after.link, published.publishedUrl);
      },
    );
    await t.test(
      'reviewer authors still receive their duty notification on automatic publication',
      async () => {
        const entry = await ready(input({ authorId: 1 }));
        await store.finish(entry.claimed, allow(entry));
        const [notices] = await pool.execute(
          'SELECT * FROM community_notifications WHERE recipient_id = 1 AND (event_key LIKE ? OR event_key = ?)',
          [
            `moderation-author:${entry.submission.id}:%`,
            `moderation-auto:${entry.claimed.id}:published`,
          ],
        );
        assert.equal(notices.length, 1);
        assert.match(notices[0].title, /负责人复核/);
        assert.equal(notices[0].link, `/moderation?id=${entry.submission.id}`);
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
        const queued = await submit();
        await store.setPaused({ actorId: 1, paused: true });
        assert.equal((await job(queued.id)).state, 'queued');
        const [waiting] = await pool.execute(
          'SELECT * FROM community_notifications WHERE event_key = ?',
          [`moderation-author:${queued.id}:pending`],
        );
        assert.equal(waiting.length, 0);
        await store.setPaused({ actorId: 1, paused: true });
        assert.equal(
          (
            await pool.execute('SELECT id FROM community_notifications WHERE event_key = ?', [
              `moderation-author:${queued.id}:pending`,
            ])
          )[0].length,
          0,
        );
        await store.setPaused({ actorId: 1, paused: false });
        assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'review');
        const resumed = await store.claim();
        assert.equal(resumed.submissionId, queued.id);
        await store.finish(resumed, { assessment: null });
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
          reviewTopics: { political: [], psychological: [] },
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
          reviewTopics: { political: [], psychological: [] },
        };
        const outcome = await store.finish(care.claimed, allow(care, { assessment }));
        assert.equal(outcome.state, 'review');
        assert.equal(outcome.reasonCode, 'focus_requires_review');
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
      'safe complete image batches publish once, bind public attachments and create a separate reviewer queue',
      async () => {
        const entry = await imageReady(4);
        assert.equal(entry.snapshot.images.length, 4);
        assert.equal(entry.snapshot.counts.url, 0);
        assert.doesNotMatch(entry.snapshot.content, /\/api\/moderation\/attachments\//);
        assert.match(entry.snapshot.content, /本帖图片_1/);
        const storedInput = (await job(entry.submission.id)).input_meta_json;
        assert.equal(storedInput.images.length, 4);
        assert.equal(JSON.stringify(storedInput).includes('dataBase64'), false);
        const outcome = await store.finish(entry.claimed, imageAllow(entry));
        assert.equal(outcome.state, 'published');
        assert.equal(outcome.result.imagesReviewed, true);
        assert.equal(outcome.reasonCode, 'no_image_risk');
        assert.equal(JSON.stringify(outcome.result).includes('dataBase64'), false);
        const [attached] = await pool.execute(
          'SELECT published_id FROM moderation_attachments WHERE submission_id = ?',
          [entry.submission.id],
        );
        assert.ok(
          attached.every((item) => String(item.published_id) === outcome.submission.publishedId),
        );
        for (const id of entry.imageIds)
          assert.equal((await service.getAttachment({ id, userId: 3 })).access, 'published');
        const detail = await store.get({ id: entry.submission.id, reviewerId: 3 });
        assert.deepEqual(detail.imageReview, {
          required: true,
          state: 'pending',
          reviewedBy: null,
          reviewedAt: null,
          canConfirm: true,
        });
        assert.ok(
          (await store.listImageReviews({ reviewerId: 3 })).items.some(
            (item) => item.id === entry.submission.id,
          ),
        );
        await assert.rejects(store.listImageReviews({ reviewerId: 2 }), { status: 403 });
        const [notices] = await pool.execute(
          'SELECT title FROM community_notifications WHERE event_key = ?',
          [`moderation-auto:${entry.claimed.id}:published`],
        );
        assert.equal(notices.length, 3);
        assert.ok(
          notices.every((item) => item.title === '含图内容已自动发布，请负责人单独复核图片'),
        );
        assert.equal((await store.finish(entry.claimed, imageAllow(entry))).applied, false);
        assert.equal(
          Number(
            (
              await pool.execute(
                'SELECT COUNT(*) AS n FROM moderation_image_reviews WHERE job_id = ?',
                [entry.claimed.id],
              )
            )[0][0].n,
          ),
          1,
        );
        const request = {
          id: entry.submission.id,
          reviewerId: 3,
          expectedVersion: 2,
          requestId: crypto.randomUUID(),
        };
        await assert.rejects(store.confirmImageReview({ ...request, reviewerId: 2 }), {
          status: 403,
        });
        await assert.rejects(store.confirmImageReview({ ...request, expectedVersion: 1 }), {
          status: 409,
        });
        const confirmed = await store.confirmImageReview(request);
        assert.equal(confirmed.replayed, false);
        assert.equal(confirmed.imageReview.state, 'confirmed');
        assert.equal(confirmed.imageReview.reviewedBy, '3');
        assert.equal(confirmed.imageReview.canConfirm, false);
        assert.equal((await store.confirmImageReview(request)).replayed, true);
        await assert.rejects(
          store.confirmImageReview({ ...request, requestId: crypto.randomUUID() }),
          { status: 409 },
        );
        assert.equal(Number((await row(entry.submission.id)).version), 2);
        assert.equal(
          (await store.get({ id: entry.submission.id, reviewerId: 3 })).canWithdraw,
          true,
        );
        assert.equal(
          (await store.listImageReviews({ reviewerId: 3 })).items.some(
            (item) => item.id === entry.submission.id,
          ),
          false,
        );
        const [confirmedNotices] = await pool.execute(
          'SELECT recipient_id FROM community_notifications WHERE event_key = ?',
          [`moderation-auto:${entry.claimed.id}:published`],
        );
        assert.deepEqual(
          confirmedNotices.map((item) => Number(item.recipient_id)).sort(),
          [1, 3, 4],
        );
        await store.withdraw({
          ...request,
          requestId: crypto.randomUUID(),
          reason: '图片复核后撤回',
        });
        assert.equal(
          (await store.get({ id: entry.submission.id, reviewerId: 3 })).imageReview.state,
          'withdrawn',
        );
        await assert.rejects(store.confirmImageReview(request), { status: 409 });
        for (const id of entry.imageIds)
          await assert.rejects(service.getAttachment({ id, userId: 3 }), { status: 404 });
      },
    );
    await t.test(
      'image approval rejects missing coverage, wrong order, forged flags and mismatched metadata',
      async () => {
        for (const mutate of [
          (result) => {
            result.imageResults = [];
          },
          (result) => {
            result.imageResults[0].attachmentIds.reverse();
          },
          (result) => {
            result.imageResults[0].response.model = 'qwen3.6-27b';
          },
          (result) => {
            result.imageResults[0].response.settingsRevision = 2;
          },
          (result) => {
            result.inputHash = '0'.repeat(64);
          },
          (result) => {
            result.textResult = undefined;
          },
        ]) {
          const entry = await imageReady(2);
          const result = imageAllow(entry);
          mutate(result);
          result.imagesReviewed = true;
          result.policyDecision = { recommendedAction: 'allow' };
          assert.equal((await store.finish(entry.claimed, result)).state, 'review');
          assert.equal(
            (
              await pool.execute('SELECT job_id FROM moderation_image_reviews WHERE job_id = ?', [
                entry.claimed.id,
              ])
            )[0].length,
            0,
          );
          const [attachments] = await pool.execute(
            'SELECT published_id FROM moderation_attachments WHERE submission_id = ?',
            [entry.submission.id],
          );
          assert.ok(attachments.every((item) => item.published_id === null));
        }
      },
    );
    await t.test(
      'image bytes and all attachment metadata are rechecked immediately before publication',
      async () => {
        for (const mutate of [
          async (entry) => {
            imagePixels.set(entry.imageIds[0], Buffer.from('changed pixels'));
          },
          async (entry) =>
            pool.execute('UPDATE moderation_attachments SET sha256 = ? WHERE id = ?', [
              '0'.repeat(64),
              entry.imageIds[0],
            ]),
          async (entry) =>
            pool.execute('UPDATE moderation_attachments SET author_id = 3 WHERE id = ?', [
              entry.imageIds[0],
            ]),
          async (entry) =>
            pool.execute('UPDATE moderation_attachments SET bound_content_hash = ? WHERE id = ?', [
              '0'.repeat(64),
              entry.imageIds[0],
            ]),
          async (entry) =>
            pool.execute(
              'UPDATE moderation_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
              [entry.imageIds[0]],
            ),
          async (entry) =>
            pool.execute('UPDATE moderation_attachments SET purged_at = NOW(3) WHERE id = ?', [
              entry.imageIds[0],
            ]),
          async (entry) =>
            pool.execute(
              'UPDATE moderation_submissions SET attachment_ids_json = JSON_ARRAY() WHERE id = ?',
              [entry.submission.id],
            ),
        ]) {
          const entry = await imageReady();
          const result = imageAllow(entry);
          await mutate(entry);
          assert.equal((await store.finish(entry.claimed, result)).state, 'review');
        }
      },
    );
    await t.test(
      'image approval and its queue roll back together if the worker stops during notification',
      async () => {
        const entry = await imageReady();
        let applicable = true;
        const stopping = createModerationAutomationStore({
          ...options,
          notifications: {
            notifyModeration: async () => {
              applicable = false;
            },
          },
        });
        await assert.rejects(
          stopping.finish(entry.claimed, imageAllow(entry), { canApply: () => applicable }),
          { status: 409 },
        );
        assert.equal((await row(entry.submission.id)).status, 'pending');
        assert.equal(
          (
            await pool.execute('SELECT * FROM moderation_image_reviews WHERE job_id = ?', [
              entry.claimed.id,
            ])
          )[0].length,
          0,
        );
        assert.equal(
          (
            await pool.execute('SELECT published_id FROM moderation_attachments WHERE id = ?', [
              entry.imageIds[0],
            ])
          )[0][0].published_id,
          null,
        );
        await reviewOne(entry);
      },
    );
    await t.test(
      'confirmation request identity is unique and expiry removes pending image review work',
      async () => {
        const first = await imageReady();
        await store.finish(first.claimed, imageAllow(first));
        const second = await imageReady();
        await store.finish(second.claimed, imageAllow(second));
        const request = {
          id: first.submission.id,
          reviewerId: 3,
          expectedVersion: 2,
          requestId: crypto.randomUUID(),
        };
        await store.confirmImageReview(request);
        await assert.rejects(store.confirmImageReview({ ...request, id: second.submission.id }), {
          status: 409,
        });
        await pool.execute(
          'UPDATE moderation_auto_jobs SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [second.claimed.id],
        );
        assert.equal(
          (await store.get({ id: second.submission.id, reviewerId: 3 })).imageReview.canConfirm,
          false,
        );
        await assert.rejects(
          store.confirmImageReview({
            ...request,
            id: second.submission.id,
            requestId: crypto.randomUUID(),
          }),
          { status: 410 },
        );
        assert.equal(
          (await store.listImageReviews({ reviewerId: 3 })).items.some(
            (item) => item.id === second.submission.id,
          ),
          false,
        );
        await store.purge();
        assert.equal(
          (
            await pool.execute('SELECT * FROM moderation_image_reviews WHERE job_id = ?', [
              second.claimed.id,
            ])
          )[0].length,
          0,
        );
      },
    );
    await t.test(
      'verified attachment references do not hide external URLs or nearby personal names',
      async () => {
        const external = await imageReady(1, '活动详情见 https://example.org/activity 。');
        assert.ok(external.snapshot.counts.url > 0);
        assert.equal((await store.finish(external.claimed, imageAllow(external))).state, 'review');
        await pool.execute("UPDATE users SET full_name = '陈宇' WHERE id = 2");
        try {
          const personal = await imageReady(1, '我是陈宇，这是活动记录。');
          assert.ok(personal.snapshot.counts.name > 0);
          assert.equal(personal.snapshot.counts.url, 0);
          assert.doesNotMatch(personal.snapshot.content, /陈宇/);
          assert.equal(
            (await store.finish(personal.claimed, imageAllow(personal))).state,
            'review',
          );
        } finally {
          await pool.execute('UPDATE users SET full_name = NULL WHERE id = 2');
        }
      },
    );
    await t.test(
      'invalid model results preserve local focus and only sanitized reported review signals',
      async () => {
        for (const [content, focus, diagnostics] of [
          ['课程讨论涉及国家安全法。', 'political', undefined],
          ['我希望获得心理咨询方面的帮助。', 'psychological', undefined],
          [
            '普通测试文字。',
            'political',
            {
              reviewSignal: {
                version: 1,
                reportedCategories: ['political_compliance'],
                reportedRuleIds: [],
                reportedSupportPriority: 'none',
              },
            },
          ],
          [
            '普通测试文字。',
            'psychological',
            {
              reviewSignal: {
                version: 1,
                reportedCategories: [],
                reportedRuleIds: [],
                reportedSupportPriority: 'attention',
              },
            },
          ],
        ]) {
          const body = input();
          body.payload.content = content;
          const entry = await ready(body);
          const outcome = await store.finish(entry.claimed, {
            ...allow(entry),
            assessment: null,
            manualReview: {
              required: true,
              validation: 'failed',
              diagnostics: diagnostics
                ? {
                    version: 1,
                    contractVersion: 'freebbs-moderation-contract-2026-10-11-v2',
                    failureCode: 'category_rule_mismatch',
                    httpStatus: 200,
                    ...diagnostics,
                  }
                : undefined,
            },
          });
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.result.assessment, null);
          assert.equal(outcome.result.reviewFocus[focus], true);
          assert.equal(outcome.result.policyDecision.recommendedAction, 'hold');
          const [notices] = await pool.execute(
            'SELECT title FROM community_notifications WHERE event_key = ?',
            [`moderation-auto:${entry.claimed.id}:review`],
          );
          assert.ok(notices.every((item) => item.title.includes('重点复核')));
          assert.doesNotMatch(JSON.stringify(notices), /政治内容|心理关怀/);
        }
      },
    );
    await t.test(
      'political and psychological image or text focus cannot publish and has a distinct notice',
      async () => {
        for (const [content, focus] of [
          ['这是一段关于国家安全法的课程讨论。', 'political'],
          ['我希望获得心理咨询方面的帮助。', 'psychological'],
        ]) {
          const entry = await imageReady(1, content);
          const result = imageAllow(entry);
          result.reviewFocus = { political: false, psychological: false };
          result.policyDecision = { recommendedAction: 'allow' };
          const outcome = await store.finish(entry.claimed, result);
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.result.reviewFocus[focus], true);
          const [notices] = await pool.execute(
            'SELECT title FROM community_notifications WHERE event_key = ?',
            [`moderation-auto:${entry.claimed.id}:review`],
          );
          assert.ok(notices.every((item) => item.title.includes('重点复核')));
          assert.doesNotMatch(JSON.stringify(notices), /政治内容|心理关怀/);
        }
      },
    );
    await t.test(
      'political names remain a manual-review focus when directory privacy redaction removes them',
      async () => {
        // A synthetic directory collision verifies that redaction cannot erase the routing signal.
        await pool.execute("UPDATE users SET full_name = '习近平' WHERE id = 2");
        try {
          const body = input();
          body.payload.content = '课程材料提到了习近平，请问这本书可以在哪里借阅？';
          const entry = await ready(body);
          assert.ok(entry.snapshot.counts.name > 0);
          assert.doesNotMatch(entry.snapshot.content, /习近平/);
          assert.equal(entry.snapshot.reviewFocus.political, true);
          assert.equal(entry.snapshot.reviewFocus.psychological, false);
          const outcome = await store.finish(entry.claimed, {
            ...allow(entry),
            assessment: null,
            automationReason: 'focus_requires_review',
            manualReview: { required: true, validation: 'not_attempted' },
            reviewFocus: { political: false, psychological: false },
          });
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.reasonCode, 'focus_requires_review');
          assert.equal(outcome.result.reviewFocus.political, true);
          assert.equal(outcome.result.assessment, null);
          assert.equal(outcome.result.manualReview.validation, 'not_attempted');
          assert.equal(outcome.result.policyDecision.recommendedAction, 'hold');
          assert.equal(outcome.result.automaticPublication, false);
          assert.equal((await row(entry.submission.id)).status, 'pending');
          const [notices] = await pool.execute(
            'SELECT title, body FROM community_notifications WHERE event_key = ?',
            [`moderation-auto:${entry.claimed.id}:review`],
          );
          assert.equal(notices.length, 3);
          assert.ok(notices.every((item) => item.title.includes('重点复核')));
          assert.doesNotMatch(JSON.stringify(notices), /政治内容|心理关怀|习近平|借阅/);
          const [authorNotices] = await pool.execute(
            'SELECT title, body FROM community_notifications WHERE recipient_id = 2 AND event_key = ?',
            [`moderation-author:${entry.submission.id}:pending`],
          );
          assert.equal(authorNotices.length, 1);
          assert.doesNotMatch(JSON.stringify(authorNotices), /政治内容|心理关怀|习近平|借阅/);
        } finally {
          await pool.execute('UPDATE users SET full_name = NULL WHERE id = 2');
        }
      },
    );
    await t.test(
      'neutral coursework, quoted terms and negations still route by keyword without becoming violations',
      async () => {
        for (const [title, content, focus] of [
          ['政治制度课程资料', '请问课程教材在哪里可以借阅？', 'political'],
          ['读书笔记', '教材引用了“社会主义”这个词，想请教参考书目。', 'political'],
          ['教材交流', '这本心理健康教材讲解了情绪调节。', 'psychological'],
          ['阅读感想', '我没有持续焦虑，只是记录教材中的术语。', 'psychological'],
        ]) {
          const body = input();
          body.payload.title = title;
          body.payload.content = content;
          const entry = await ready(body);
          assert.equal(entry.snapshot.reviewFocus[focus], true);
          const forged = allow(entry, {
            reviewFocus: { political: false, psychological: false },
            policyDecision: { recommendedAction: 'allow', canAutomaticallyPublish: true },
          });
          const outcome = await store.finish(entry.claimed, forged);
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.reasonCode, 'focus_requires_review');
          assert.equal(outcome.result.reviewFocus[focus], true);
          assert.equal(outcome.result.assessment.decision, 'no_risk_detected');
          assert.deepEqual(outcome.result.assessment.categories, []);
          assert.deepEqual(outcome.result.assessment.ruleMatches, []);
          assert.equal(outcome.result.assessment.supportPriority, 'none');
          assert.equal(outcome.result.policyDecision.recommendedAction, 'hold');
          assert.equal(outcome.result.automaticPublication, false);
          const pending = await row(entry.submission.id);
          assert.equal(pending.status, 'pending');
          assert.equal(pending.published_id, null);
        }
      },
    );
    await t.test(
      'a local-only dual-focus result keeps both workbench topics and a generic prominent notice',
      async () => {
        const body = input();
        body.payload.content = '课程同时涉及政治制度与心理健康，请问如何寻找参考教材？';
        const entry = await ready(body);
        assert.equal(entry.snapshot.reviewFocus.political, true);
        assert.equal(entry.snapshot.reviewFocus.psychological, true);
        const outcome = await store.finish(entry.claimed, {
          assessment: null,
          automationReason: 'focus_requires_review',
          manualReview: { required: true, validation: 'not_attempted' },
          reviewFocus: { political: false, psychological: false },
        });
        assert.equal(outcome.state, 'review');
        assert.equal(outcome.reasonCode, 'focus_requires_review');
        assert.equal(outcome.result.reviewFocus.political, true);
        assert.equal(outcome.result.reviewFocus.psychological, true);
        assert.equal(outcome.result.assessment, null);
        assert.equal(outcome.result.manualReview.validation, 'not_attempted');
        assert.equal(outcome.result.policyDecision.recommendedAction, 'hold');
        assert.deepEqual(outcome.result.policyEvidence, []);
        const [notices] = await pool.execute(
          'SELECT title, body FROM community_notifications WHERE event_key = ?',
          [`moderation-auto:${entry.claimed.id}:review`],
        );
        assert.equal(notices.length, 3);
        assert.ok(notices.every((item) => item.title.includes('重点复核')));
        assert.doesNotMatch(JSON.stringify(notices), /政治内容|心理关怀|参考教材|课程同时/);
        assert.equal((await row(entry.submission.id)).published_id, null);
      },
    );
    await t.test(
      'comments use the same strict keyword hold while ordinary parent posts still publish',
      async () => {
        const post = await ready();
        const published = await store.finish(post.claimed, allow(post));
        assert.equal(published.state, 'published');
        const postId = Number(published.submission.publishedId);
        const [[before]] = await pool.execute(
          'SELECT COUNT(*) AS n FROM discussion_comments WHERE post_id = ?',
          [postId],
        );
        for (const [content, focus] of [
          ['评论只是引用“习近平”这一姓名，请负责人查看。', 'political'],
          ['这条评论讨论心理健康教材，与个人求助无关。', 'psychological'],
        ]) {
          const entry = await ready(input({ kind: 'comment', payload: { postId, content } }));
          assert.equal(entry.snapshot.reviewFocus[focus], true);
          const outcome = await store.finish(
            entry.claimed,
            allow(entry, { reviewFocus: { political: false, psychological: false } }),
          );
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.reasonCode, 'focus_requires_review');
          assert.deepEqual(outcome.result.assessment.categories, []);
          assert.equal(outcome.result.reviewFocus[focus], true);
          assert.equal((await row(entry.submission.id)).published_id, null);
        }
        const [[after]] = await pool.execute(
          'SELECT COUNT(*) AS n FROM discussion_comments WHERE post_id = ?',
          [postId],
        );
        assert.equal(Number(after.n), Number(before.n));
      },
    );
    await t.test(
      'semantic-only topics survive transactional rebuilding and require a distinct human notice',
      async () => {
        for (const [focus, content] of [
          ['political', '讨论这个国家的最高权力应如何交接及受到哪些制约。'],
          ['psychological', '这几个星期什么都提不起兴趣，想找人聊聊自己的处境。'],
        ]) {
          const body = input();
          body.payload.content = content;
          const entry = await ready(body);
          assert.equal(entry.snapshot.reviewFocus[focus], false);
          const result = allow(entry);
          result.assessment.reviewTopics[focus] = [
            {
              field: 'content',
              quote: entry.snapshot.content,
              reason: '存在相关语义，交负责人复核，不认定违规。',
            },
          ];
          result.reviewFocus = { political: false, psychological: false };
          const outcome = await store.finish(entry.claimed, result);
          assert.equal(outcome.state, 'review');
          assert.equal(outcome.result.reviewFocus[focus], true);
          assert.equal(outcome.result.assessment.supportPriority, 'none');
          assert.deepEqual(outcome.result.assessment.categories, []);
          assert.equal(
            outcome.result.assessment.reviewTopics[focus][0].quote,
            entry.snapshot.content,
          );
          assert.equal((await row(entry.submission.id)).published_id, null);
          const [notices] = await pool.query(
            'SELECT title,body FROM community_notifications WHERE link LIKE ?',
            [`%${entry.submission.id}%`],
          );
          assert.ok(notices.some((item) => item.title.includes('重点复核')));
          assert.doesNotMatch(JSON.stringify(notices), /政治内容|心理关怀|最高权力|提不起兴趣/);
        }
      },
    );
    await t.test(
      'missing or invented semantic evidence cannot publish through the legacy text result path',
      async () => {
        for (const malformed of [false, true]) {
          const entry = await ready();
          const result = allow(entry);
          if (malformed)
            result.assessment.reviewTopics.political.push({
              field: 'content',
              quote: '不存在的证据',
              reason: '测试',
            });
          else delete result.assessment.reviewTopics;
          const outcome = await store.finish(entry.claimed, result);
          assert.notEqual(outcome.state, 'published');
          assert.equal(outcome.result.manualReview.validation, 'failed');
          assert.equal((await row(entry.submission.id)).published_id, null);
        }
      },
    );
    await t.test(
      'legacy topic notices are scrubbed for live, expired and already-purged evidence without changing access or ordinary notices',
      async () => {
        const entries = [];
        for (const [label, content, lifetime] of [
          ['政治内容', '课程讨论政治制度。', 'live'],
          ['心理关怀', '想了解心理咨询服务。', 'expired'],
          ['政治内容／心理关怀', '课程讨论政治制度与心理健康。', 'purged'],
        ]) {
          const body = input();
          body.payload.content = content;
          const entry = await ready(body);
          assert.equal((await store.finish(entry.claimed, allow(entry))).state, 'review');
          const eventKey = `moderation-auto:${entry.claimed.id}:review`;
          await pool.execute(
            "UPDATE community_notifications SET title = ?, body = ?, read_at = '2026-10-01 12:00:00' WHERE event_key = ?",
            [`【${label}】须负责人重点复核`, `该内容触发${label}人工审核要求。`, eventKey],
          );
          const [before] = await pool.execute(
            'SELECT * FROM community_notifications WHERE event_key = ? ORDER BY recipient_id',
            [eventKey],
          );
          assert.deepEqual(
            before.map((item) => Number(item.recipient_id)),
            [1, 3, 4],
          );
          if (lifetime !== 'live') {
            await pool.execute(
              'UPDATE moderation_auto_jobs SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
              [entry.claimed.id],
            );
            if (lifetime === 'purged')
              await pool.execute(
                'UPDATE moderation_auto_jobs SET purged_at = NOW(3), result_json = NULL, input_meta_json = NULL WHERE id = ?',
                [entry.claimed.id],
              );
          }
          entries.push({ entry, eventKey, before, lifetime });
        }
        const controls = [
          ['announcement', `moderation-auto:${entries[0].entry.claimed.id}:review`],
          ['moderation', `moderation-auto:${entries[0].entry.claimed.id}:published`],
          ['moderation', `moderation-auto:${entries[0].entry.claimed.id}:review:extra`],
          ['moderation', 'moderation-auto:invalid:review'],
          ['moderation', `moderation-author:${crypto.randomUUID()}:pending`],
        ];
        for (const [kind, eventKey] of controls)
          await pool.execute(
            'INSERT INTO community_notifications (recipient_id, kind, title, body, link, event_key) VALUES (2, ?, ?, ?, ?, ?)',
            [kind, '【政治内容】须负责人重点复核', '普通通知对照', '/discussion', eventKey],
          );
        const [unrelatedBefore] = await pool.execute(
          'SELECT * FROM community_notifications WHERE recipient_id = 2 ORDER BY id',
        );
        enabled = false;
        try {
          await store.purge();
          for (const { entry, eventKey, before, lifetime } of entries) {
            const [after] = await pool.execute(
              'SELECT * FROM community_notifications WHERE event_key = ? AND kind = ? ORDER BY recipient_id',
              [eventKey, 'moderation'],
            );
            assert.deepEqual(
              after,
              before.map((item) => ({
                ...item,
                title: '讨论内容须负责人重点复核',
                body: '该内容需要专门人工审核，负责人通过前不发布。请到审核工作台查看具体提示。',
              })),
            );
            assert.doesNotMatch(JSON.stringify(after), /政治内容|心理关怀/);
            const details = await store.get({ id: entry.submission.id, reviewerId: 1 });
            if (lifetime === 'live') assert.equal(details.result.reviewFocus.political, true);
            else assert.equal(details.result, null);
            await assert.rejects(
              store.get({ id: entry.submission.id, reviewerId: 2 }),
              (error) => error.status === 403,
            );
          }
          const [unrelatedAfter] = await pool.execute(
            'SELECT * FROM community_notifications WHERE recipient_id = 2 ORDER BY id',
          );
          assert.deepEqual(unrelatedAfter, unrelatedBefore);
          const [once] = await pool.query('SELECT * FROM community_notifications ORDER BY id');
          await store.purge();
          assert.deepEqual(
            (await pool.query('SELECT * FROM community_notifications ORDER BY id'))[0],
            once,
          );
        } finally {
          enabled = true;
        }
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
