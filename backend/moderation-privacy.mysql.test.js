const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');

test(
  'isolated MySQL: local privacy previews enforce directory matching, authority and immutable evidence',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const privacy = require('./moderation-privacy');
    const builderCalls = [];
    const build = privacy.buildPrivacyPreview;
    t.mock.method(privacy, 'buildPrivacyPreview', (input) => {
      builderCalls.push(structuredClone(input));
      return build(input);
    });
    const { ensureSchema, createDiscussionModeration } = require('./discussion-moderation');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const adminConnection = await mysql.createConnection(config);
    t.after(() => adminConnection.end());
    await assertIsolatedMysql(adminConnection);
    const database = `moderation_privacy_${crypto.randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_privacy_[a-f0-9]{32}$/);
    await adminConnection.query(
      `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const bootstrap = await mysql.createConnection({
      ...config,
      database,
      multipleStatements: true,
    });
    try {
      const schemaSource = await fs.readFile(
        path.join(__dirname, '../database/schema.sql'),
        'utf8',
      );
      const seedSource = await fs.readFile(path.join(__dirname, '../database/seed.sql'), 'utf8');
      const schema = schemaSource.replace(
        /^CREATE DATABASE IF NOT EXISTS free_bbs\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*USE free_bbs;\s*/,
        '',
      );
      const seed = seedSource.replace(/^USE free_bbs;\s*/, '');
      assert.notEqual(schema, schemaSource);
      assert.notEqual(seed, seedSource);
      for (const sql of [schema, seed]) {
        assert.doesNotMatch(sql, /^\s*(?:USE|CREATE\s+DATABASE)\b/im);
        await bootstrap.query(sql);
      }
      for (const migration of [
        '003_create_discussion_tables.sql',
        '004_add_discussion_author_student_id.sql',
        '005_add_discussion_likes_comments.sql',
        '007_add_comment_replies.sql',
        '015_discussion_soft_delete.sql',
        '026_notifications.sql',
        '035_discussion_interactions.sql',
        '035_discussion_visibility.sql',
        '043_discussion_login_required.sql',
      ]) {
        const sql = await fs.readFile(
          path.join(__dirname, '../database/migrations', migration),
          'utf8',
        );
        assert.doesNotMatch(sql, /^\s*(?:USE|CREATE\s+DATABASE)\b/im, migration);
        await bootstrap.query(sql);
      }
      const [[selected]] = await bootstrap.query('SELECT DATABASE() AS name');
      assert.equal(selected.name, database);
    } finally {
      await bootstrap.end();
    }

    const pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
    t.after(() => pool.end());
    const [[settings]] = await pool.query(
      'SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.foreign_key_checks AS foreign_keys',
    );
    assert.match(settings.sql_mode, /STRICT_TRANS_TABLES|STRICT_ALL_TABLES/);
    assert.equal(Number(settings.foreign_keys), 1);
    const [[administrator]] = await pool.query(
      "SELECT id FROM users WHERE username = 'admin' AND is_admin = 1",
    );
    assert.ok(administrator);
    const [[board]] = await pool.query("SELECT id FROM discussion_boards WHERE slug = 'daily'");
    assert.ok(board);

    async function addUser(username, fullName, studentId = null, email = null) {
      const [result] = await pool.execute(
        `INSERT INTO users (username, full_name, student_id, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?, 'student')`,
        [username, fullName, studentId, email, 'synthetic-unused-password-hash'],
      );
      return result.insertId;
    }
    const authorId = await addUser(
      'privacy_author',
      '投稿作者',
      '2098000001',
      'author@example.invalid',
    );
    const reviewerId = await addUser('privacy_reviewer', '审核同学');
    const identities = [
      { full_name: '测试甲君', student_id: '2098000011', email: 'name@example.invalid' },
      { full_name: '学号命中用户', student_id: '2098000012', email: 'number@example.invalid' },
      { full_name: '邮箱命中用户', student_id: '2098000013', email: 'literal@example.invalid' },
      { full_name: "' OR 1=1 --", student_id: '2098000014', email: 'sql@example.invalid' },
      { full_name: '百分_%同学', student_id: '2098000015', email: 'percent@example.invalid' },
    ];
    for (const [index, identity] of identities.entries()) {
      await addUser(
        `privacy_match_${index}`,
        identity.full_name,
        identity.student_id,
        identity.email,
      );
    }
    await addUser(
      'privacy_unrelated',
      '未出现在稿件的人',
      '2098000020',
      'unrelated@example.invalid',
    );
    await addUser('privacy_not_wildcard', '百分甲乙同学');
    await addUser('privacy_empty', '');
    await ensureSchema(pool);

    const lookups = [];
    let onReviewerRead = null;
    const observedPool = {
      execute: pool.execute.bind(pool),
      query: pool.query.bind(pool),
      async getConnection() {
        const db = await pool.getConnection();
        return {
          beginTransaction: db.beginTransaction.bind(db),
          commit: db.commit.bind(db),
          rollback: db.rollback.bind(db),
          release: db.release.bind(db),
          query: db.query.bind(db),
          async execute(sql, values) {
            if (/FROM moderation_reviewers.*FOR SHARE/s.test(sql) && onReviewerRead) {
              onReviewerRead();
            }
            const result = await db.execute(sql, values);
            if (/SELECT full_name, student_id, email FROM users/.test(sql)) {
              lookups.push({
                sql,
                values: structuredClone(values),
                rows: structuredClone(result[0]),
              });
            }
            return result;
          },
        };
      },
    };
    let publications = 0;
    const service = createDiscussionModeration({
      pool: observedPool,
      publishSubmission: async () => {
        publications += 1;
        throw new Error('a privacy preview must never publish');
      },
    });
    await service.setReviewer({ actorId: administrator.id, userId: reviewerId, active: true });
    async function submit(content, title = '测试甲君 的留言') {
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        const result = await service.submit(db, {
          kind: 'post',
          authorId,
          requestId: crypto.randomUUID(),
          payload: { boardId: board.id, title, content, anonymous: false, loginRequired: true },
          attachmentIds: [],
        });
        await db.commit();
        return result;
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }
    }
    const preview = (submission, options = {}) =>
      service.previewPrivacy({ id: submission.id, reviewerId, expectedVersion: 1, ...options });
    async function snapshot() {
      const result = {};
      for (const table of [
        'moderation_submissions',
        'moderation_attachments',
        'community_notifications',
        'discussion_posts',
        'discussion_comments',
      ]) {
        const [rows] = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
        result[table] = rows;
      }
      return JSON.stringify(result);
    }

    await t.test(
      'real Chinese LOCATE uses bound parameters and passes only matching identities to the builder',
      async () => {
        const content =
          "测试甲君；学号 2098000012；邮箱 literal@example.invalid；' OR 1=1 --；百分_%同学；保密地点甲";
        const submission = await submit(content);
        const before = await snapshot();
        const result = await preview(submission, { extraTerms: ['保密地点甲'] });
        const lookup = lookups.at(-1);
        assert.equal(lookup.values.length, 3);
        assert.ok(lookup.values.every((value) => value.includes("' OR 1=1 --")));
        assert.doesNotMatch(lookup.sql, /测试甲君|literal@example|OR 1=1 --/);
        assert.equal(lookup.rows.length, identities.length);
        assert.deepEqual(
          lookup.rows
            .map((row) => ({ ...row }))
            .sort((a, b) => a.student_id.localeCompare(b.student_id)),
          identities,
        );
        assert.deepEqual(
          builderCalls.at(-1).identities,
          lookup.rows.map((row) => ({ ...row })),
        );
        assert.equal(result.submissionId, submission.id);
        assert.equal(result.contentHash, submission.contentHash);
        assert.equal(result.version, 1);
        assert.equal(result.mode, 'local_preview');
        assert.equal(result.externalReady, false);
        assert.equal(result.imagesProcessed, false);
        assert.match(result.title, /【姓名_\d+】/);
        assert.doesNotMatch(
          JSON.stringify(result),
          /测试甲君|2098000012|literal@example\.invalid|保密地点甲|未出现在稿件的人/,
        );
        assert.equal(
          await snapshot(),
          before,
          'preview must leave raw payload, notices and public tables unchanged',
        );
        assert.equal(publications, 0);
      },
    );

    await t.test(
      'normalized full-width, entity-encoded and zero-width identities are matched against real users',
      async () => {
        const submission = await submit(
          '测试\u200b甲君；２０９８００００１２；literal&#64;example.invalid',
          '隐私样例',
        );
        const result = await preview(submission);
        assert.deepEqual(
          new Set(lookups.at(-1).rows.map((row) => row.full_name)),
          new Set(identities.slice(0, 3).map((row) => row.full_name)),
        );
        assert.doesNotMatch(result.content, /测试|２０９８|2098000012|literal/);
        assert.equal(result.externalReady, false);
      },
    );

    await t.test(
      'author access, stale versions, final decisions and expired evidence fail before directory reads',
      async () => {
        const submission = await submit('测试甲君 的第二份正文');
        const beforeLookups = lookups.length;
        const beforeBuilds = builderCalls.length;
        await assert.rejects(preview(submission, { reviewerId: authorId }), { status: 403 });
        await assert.rejects(preview(submission, { expectedVersion: 2 }), { status: 409 });
        await service.decide({
          id: submission.id,
          reviewerId,
          decision: 'rejected',
          reason: '合成测试中的人工拒绝原因',
          expectedVersion: 1,
          requestId: crypto.randomUUID(),
        });
        await assert.rejects(preview(submission), { status: 409 });
        const expired = await submit('测试甲君 的过期正文');
        await pool.execute(
          'UPDATE moderation_submissions SET expires_at = NOW(3) - INTERVAL 1 SECOND WHERE id = ?',
          [expired.id],
        );
        await assert.rejects(preview(expired), { status: 409 });
        assert.equal(lookups.length, beforeLookups);
        assert.equal(builderCalls.length, beforeBuilds);
      },
    );

    await t.test(
      'a preview queued behind reviewer revocation cannot use the previous permission',
      async () => {
        const submission = await submit('测试甲君 的受保护正文');
        const blocker = await pool.getConnection();
        try {
          await blocker.beginTransaction();
          await blocker.execute('UPDATE moderation_reviewers SET active = 0 WHERE user_id = ?', [
            reviewerId,
          ]);
          let resolveStarted;
          const started = new Promise((resolve) => {
            resolveStarted = resolve;
          });
          onReviewerRead = resolveStarted;
          const before = builderCalls.length;
          const rejection = assert.rejects(preview(submission), { status: 403 });
          await started;
          await blocker.commit();
          await rejection;
          assert.equal(builderCalls.length, before);
          await assert.rejects(preview(submission), { status: 403 });
        } finally {
          onReviewerRead = null;
          await blocker.rollback();
          blocker.release();
          await service.setReviewer({
            actorId: administrator.id,
            userId: reviewerId,
            active: true,
          });
        }
      },
    );

    await t.test(
      'more than 500 actual directory hits fail closed without handing a partial directory to the builder',
      async () => {
        const parameters = [];
        for (let index = 0; index < 501; index += 1)
          parameters.push(
            `privacy_bulk_${index}`,
            '批量同名测试',
            'synthetic-unused-password-hash',
          );
        await pool.execute(
          `INSERT INTO users(username,full_name,password_hash) VALUES ${Array.from({ length: 501 }, () => '(?,?,?)').join(',')}`,
          parameters,
        );
        const submission = await submit('批量同名测试', '超出目录检查上限');
        const before = await snapshot();
        const beforeBuilds = builderCalls.length;
        await assert.rejects(
          preview(submission),
          (error) => error.status === 409 && /目录命中数量过多/.test(error.message),
        );
        assert.equal(lookups.at(-1).rows.length, 501);
        assert.equal(builderCalls.length, beforeBuilds);
        assert.equal(await snapshot(), before);
        assert.equal(publications, 0);
      },
    );
  },
);
