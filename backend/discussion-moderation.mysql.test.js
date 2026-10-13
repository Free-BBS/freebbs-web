const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isolatedMysqlConfig } = require('./test-helpers/isolated-mysql');
const { ensureSchema, createDiscussionModeration } = require('./discussion-moderation');
const { createModerationPublisher } = require('./moderation-publisher');

test(
  'isolated MySQL: moderation publication, retries, permissions, attachments and retention are atomic',
  {
    skip: process.env.RUN_MODERATION_MYSQL !== '1',
    timeout: 60000,
  },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const connection = await mysql.createConnection(config);
    t.after(() => connection.end());
    const [[server]] = await connection.query('SELECT @@skip_networking AS isolated');
    assert.equal(Number(server.isolated), 1);
    const database = `moderation_test_${crypto.randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_test_[a-f0-9]{32}$/);
    await connection.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 8 });
    t.after(() => pool.end());
    const privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-moderation-test-'));
    assert.equal(path.dirname(path.resolve(privateDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(privateDir).startsWith('freebbs-moderation-test-'));
    t.after(() => fs.rm(privateDir, { recursive: true, force: true }));
    await pool.query(`CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(64) NOT NULL,
    is_admin TINYINT NOT NULL DEFAULT 0, full_name VARCHAR(64), student_id VARCHAR(10)) ENGINE=InnoDB`);
    await pool.query(
      "INSERT INTO users(id,username,is_admin) VALUES (1,'admin',1),(2,'author',0),(3,'reader',0),(4,'reviewer',1)",
    );
    await pool.query(`CREATE TABLE community_notifications (id BIGINT PRIMARY KEY AUTO_INCREMENT,
    recipient_id BIGINT NOT NULL, actor_id BIGINT NULL, kind VARCHAR(24), title VARCHAR(160),
    body TEXT, link VARCHAR(500), event_key VARCHAR(190), read_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event (event_key,recipient_id))`);
    await pool.query(
      `CREATE TABLE discussion_boards (id BIGINT PRIMARY KEY, slug VARCHAR(64), is_active TINYINT DEFAULT 1)`,
    );
    await pool.query("INSERT INTO discussion_boards(id,slug) VALUES (1,'daily')");
    await pool.query(`CREATE TABLE discussion_posts (id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT,
    pid VARCHAR(32), board_id BIGINT, author_student_id VARCHAR(10), is_anonymous TINYINT DEFAULT 0,
    title VARCHAR(120), content_markdown TEXT, is_deleted TINYINT DEFAULT 0, is_hidden TINYINT DEFAULT 0,
    login_required TINYINT DEFAULT 1)`);
    await pool.query(`CREATE TABLE discussion_comments (id BIGINT PRIMARY KEY AUTO_INCREMENT,
    post_id BIGINT, parent_comment_id BIGINT, author_student_id VARCHAR(10),
    user_id BIGINT, content_markdown TEXT, is_deleted TINYINT DEFAULT 0)`);
    await ensureSchema(pool);

    async function transact(callback) {
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
    let failAfterPublication = false;
    const publicEvents = [];
    const realPublisher = createModerationPublisher({
      createPostPid: async () => `p_${crypto.randomBytes(12).toString('hex')}`,
      awardMagnetic: async () => 0,
      notifications: {
        notifyReply: async (event) => {
          publicEvents.push({ kind: 'reply', event });
        },
        notifyMentions: async (event) => {
          publicEvents.push({ kind: 'mention', event });
        },
      },
    });
    async function publishSubmission(db, submission) {
      const result = await realPublisher(db, submission);
      if (failAfterPublication) throw new Error('injected publication failure');
      return result;
    }
    const service = createDiscussionModeration({ pool, privateDir, publishSubmission });
    const input = (extra = {}) => ({
      kind: 'post',
      authorId: 2,
      requestId: crypto.randomUUID(),
      payload: {
        boardId: 1,
        title: '保密待审标题',
        content: '姓名：测试同学',
        anonymous: false,
        loginRequired: true,
      },
      attachmentIds: [],
      ...extra,
    });
    const submit = (body) => transact((db) => service.submit(db, body));
    const decision = (submission, extra = {}) => ({
      id: submission.id,
      reviewerId: 1,
      decision: 'approved',
      reason: '',
      expectedVersion: 1,
      requestId: crypto.randomUUID(),
      ...extra,
    });
    const count = async (table) =>
      Number((await pool.query(`SELECT COUNT(*) AS total FROM ${table}`))[0][0].total);
    async function image() {
      const id = crypto.randomUUID();
      const buffer = Buffer.from('private image fixture');
      await fs.writeFile(path.join(privateDir, `${id}.webp`), buffer);
      await service.registerAttachment({
        id,
        authorId: 2,
        fileName: `${id}.webp`,
        mimeType: 'image/webp',
        byteSize: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      });
      return id;
    }

    await t.test(
      'concurrent request retries create one pending case and no public content',
      async () => {
        const body = input();
        const results = await Promise.all(Array.from({ length: 4 }, () => submit(body)));
        assert.equal(new Set(results.map((result) => result.id)).size, 1);
        assert.equal(results.filter((result) => !result.replayed).length, 1);
        assert.equal(await count('moderation_submissions'), 1);
        assert.equal(await count('discussion_posts'), 0);
        assert.equal(await count('community_notifications'), 3);
        const [notices] = await pool.query('SELECT body,title FROM community_notifications');
        assert.doesNotMatch(JSON.stringify(notices), /保密待审标题|测试同学/);
        await assert.rejects(
          submit({ ...body, payload: { ...body.payload, content: '被替换的正文' } }),
          { status: 409 },
        );
        const request = decision(results[0]);
        const approvals = await Promise.all(
          Array.from({ length: 4 }, () => service.decide(request)),
        );
        assert.equal(approvals.filter((result) => !result.replayed).length, 1);
        assert.equal(await count('discussion_posts'), 1);
        await assert.rejects(service.decide({ ...request, reason: 'changed' }), { status: 409 });
      },
    );

    await t.test(
      'two reviewers cannot make different final decisions or publish twice',
      async () => {
        const submission = await submit(input());
        const results = await Promise.allSettled([
          service.decide(decision(submission)),
          service.decide(
            decision(submission, { reviewerId: 4, decision: 'rejected', reason: '不通过' }),
          ),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
      },
    );

    await t.test(
      'real publisher inserts comments only after approval and rechecks the parent post',
      async () => {
        const [[post]] = await pool.query('SELECT id FROM discussion_posts ORDER BY id LIMIT 1');
        const body = input({
          kind: 'comment',
          payload: {
            postId: post.id,
            parentCommentId: null,
            content: '待审核评论',
            mentionMax: false,
          },
        });
        const submission = await submit(body);
        assert.equal(await count('discussion_comments'), 0);
        assert.ok(!publicEvents.some((event) => event.kind === 'reply'));
        const approved = await service.decide(decision(submission));
        assert.equal(await count('discussion_comments'), 1);
        assert.match(approved.publishedUrl, /#comment-/);
        assert.ok(publicEvents.some((event) => event.kind === 'reply'));
        const second = await submit({ ...body, requestId: crypto.randomUUID() });
        await pool.execute('UPDATE discussion_posts SET is_hidden = 1 WHERE id = ?', [post.id]);
        await assert.rejects(service.decide(decision(second)), { status: 409 });
        assert.equal(await count('discussion_comments'), 1);
        await pool.execute('UPDATE discussion_posts SET is_hidden = 0 WHERE id = ?', [post.id]);
      },
    );

    await t.test('publication failure rolls back approval and notifications', async () => {
      const submission = await submit(input());
      const before = [await count('discussion_posts'), await count('community_notifications')];
      failAfterPublication = true;
      await assert.rejects(service.decide(decision(submission)), /injected publication failure/);
      failAfterPublication = false;
      assert.deepEqual(
        [await count('discussion_posts'), await count('community_notifications')],
        before,
      );
      assert.equal((await service.detail({ id: submission.id, userId: 2 })).status, 'pending');
    });

    await t.test(
      'notification failure also rolls back the already inserted public post and decision',
      async () => {
        const submission = await submit(input());
        const before = [await count('discussion_posts'), await count('community_notifications')];
        const failing = createDiscussionModeration({
          pool,
          publishSubmission,
          withDatabaseTransaction: (callback) =>
            transact((db) =>
              callback({
                execute: async (sql, args) => {
                  const result = await db.execute(sql, args);
                  if (sql.startsWith('UPDATE community_notifications'))
                    throw new Error('injected notification failure');
                  return result;
                },
              }),
            ),
        });
        await assert.rejects(failing.decide(decision(submission)), /injected notification failure/);
        assert.deepEqual(
          [await count('discussion_posts'), await count('community_notifications')],
          before,
        );
        assert.equal((await service.detail({ id: submission.id, userId: 2 })).status, 'pending');
      },
    );

    await t.test(
      'human approval updates the existing author notice without another unread reminder',
      async () => {
        for (const alreadyRead of [false, true]) {
          const submission = await submit(input());
          const key = `moderation-author:${submission.id}:pending`;
          if (alreadyRead)
            await pool.execute(
              'UPDATE community_notifications SET read_at = NOW() WHERE event_key = ?',
              [key],
            );
          const [[before]] = await pool.execute(
            'SELECT * FROM community_notifications WHERE event_key = ?',
            [key],
          );
          const result = await service.decide(decision(submission));
          const [[after]] = await pool.execute(
            'SELECT * FROM community_notifications WHERE event_key = ?',
            [key],
          );
          assert.equal(after.id, before.id);
          assert.deepEqual(after.read_at, before.read_at);
          assert.deepEqual(after.created_at, before.created_at);
          assert.equal(after.title, '内容已发布');
          assert.equal(after.link, result.publishedUrl);
          assert.equal(
            (
              await pool.execute(
                'SELECT id FROM community_notifications WHERE recipient_id = 2 AND event_key LIKE ?',
                [`moderation-author:${submission.id}:%`],
              )
            )[0].length,
            1,
          );
        }
        const missing = await submit(input());
        await pool.execute('DELETE FROM community_notifications WHERE event_key = ?', [
          `moderation-author:${missing.id}:pending`,
        ]);
        await service.decide(decision(missing));
        assert.equal(
          (
            await pool.execute('SELECT id FROM community_notifications WHERE event_key LIKE ?', [
              `moderation-author:${missing.id}:%`,
            ])
          )[0].length,
          0,
        );
      },
    );

    await t.test(
      'an author who is also a reviewer keeps separate author and reviewer notices',
      async () => {
        const submission = await submit(input({ authorId: 1 }));
        const keys = [
          `moderation:${submission.id}:pending`,
          `moderation-author:${submission.id}:pending`,
        ];
        const [before] = await pool.execute(
          'SELECT * FROM community_notifications WHERE recipient_id = 1 AND event_key IN (?, ?)',
          keys,
        );
        assert.equal(before.length, 2);
        await service.decide(decision(submission));
        const [after] = await pool.execute(
          'SELECT * FROM community_notifications WHERE recipient_id = 1 AND event_key IN (?, ?)',
          keys,
        );
        assert.equal(
          after.find((notice) => notice.event_key === keys[0]).title,
          '有新的讨论内容待审核',
        );
        assert.equal(after.find((notice) => notice.event_key === keys[1]).title, '内容已发布');
      },
    );

    await t.test(
      'reviewer removal is immediate and never reseeded on another pool startup',
      async () => {
        await service.setReviewer({ actorId: 1, userId: 4, active: false });
        const secondPool = mysql.createPool({ ...config, database, connectionLimit: 2 });
        try {
          await ensureSchema(secondPool);
        } finally {
          await secondPool.end();
        }
        assert.equal(await service.isReviewer(4), false);
        const submission = await submit(input());
        await assert.rejects(service.decide(decision(submission, { reviewerId: 4 })), {
          status: 403,
        });
        await assert.rejects(service.setReviewer({ actorId: 2, userId: 3, active: true }), {
          status: 403,
        });
        await service.setReviewer({ actorId: 1, userId: 4, active: true });
      },
    );

    await t.test(
      'a decision waiting behind a reviewer removal cannot publish with stale permission',
      async () => {
        const submission = await submit(input());
        const db = await pool.getConnection();
        try {
          await db.beginTransaction();
          await db.execute('UPDATE moderation_reviewers SET active = 0 WHERE user_id = 4');
          const attempted = service.decide(decision(submission, { reviewerId: 4 }));
          const checked = assert.rejects(attempted, { status: 403 });
          await db.commit();
          await checked;
          assert.equal((await service.detail({ id: submission.id, userId: 2 })).status, 'pending');
        } finally {
          await db.rollback();
          db.release();
        }
        await service.setReviewer({ actorId: 1, userId: 4, active: true });
      },
    );

    await t.test(
      'an empty reviewer registry stays empty and is visible to submission callers',
      async () => {
        await service.setReviewer({ actorId: 1, userId: 4, active: false });
        const empty = await service.setReviewer({ actorId: 1, userId: 1, active: false });
        assert.equal(empty.activeCount, 0);
        const submission = await submit(input());
        assert.equal(submission.status, 'pending');
        assert.equal(submission.reviewerCount, 0);
        await service.setReviewer({ actorId: 1, userId: 1, active: true });
        await service.setReviewer({ actorId: 1, userId: 4, active: true });
      },
    );

    await t.test('private images cannot be stolen or bound to two cases', async () => {
      const id = await image();
      const body = input({
        payload: { ...input().payload, content: `![图](/api/moderation/attachments/${id})` },
        attachmentIds: [id],
      });
      await assert.rejects(service.getAttachment({ id, userId: 3 }), { status: 404 });
      await assert.rejects(submit({ ...body, authorId: 3 }), { status: 409 });
      const submission = await submit(body);
      await assert.rejects(submit({ ...body, requestId: crypto.randomUUID() }), { status: 409 });
      await service.decide(decision(submission));
      assert.equal((await service.getAttachment({ id, userId: 3 })).access, 'published');
      const [[attachment]] = await pool.query('SELECT * FROM moderation_attachments WHERE id = ?', [
        id,
      ]);
      assert.equal(attachment.bound_content_hash, submission.contentHash);
    });

    await t.test(
      'expired raw evidence is inaccessible before cleanup and published image files survive',
      async () => {
        const staged = await image();
        const id = await image();
        const submission = await submit(
          input({
            payload: {
              ...input().payload,
              content: `![待审图片](/api/moderation/attachments/${id})`,
            },
            attachmentIds: [id],
          }),
        );
        await pool.execute(
          'UPDATE moderation_submissions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND)',
        );
        await pool.execute(
          'UPDATE moderation_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND)',
        );
        const before = await service.detail({ id: submission.id, userId: 2 });
        assert.equal(before.payload, null);
        await assert.rejects(service.decide(decision(submission)), { status: 409 });
        await assert.rejects(service.getAttachment({ id, userId: 1 }), { status: 404 });
        const cleanup = await service.expireAndPurge();
        assert.ok(cleanup.expired > 0);
        assert.equal(cleanup.filesPurged, 2);
        await assert.rejects(fs.stat(path.join(privateDir, `${staged}.webp`)), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(privateDir, `${id}.webp`)), { code: 'ENOENT' });
        const [approvedAttachments] = await pool.query(
          'SELECT file_name FROM moderation_attachments WHERE published_id IS NOT NULL',
        );
        assert.equal(approvedAttachments.length, 1);
        await fs.stat(path.join(privateDir, approvedAttachments[0].file_name));
        assert.equal(
          (
            await service.getAttachment({
              id: approvedAttachments[0].file_name.slice(0, -5),
              userId: 3,
            })
          ).access,
          'published',
        );
        const [cases] = await pool.query(
          'SELECT payload_json,decision_reason,evidence_purged_at FROM moderation_submissions',
        );
        assert.ok(
          cases.every(
            (item) =>
              item.payload_json === null &&
              item.decision_reason === null &&
              item.evidence_purged_at,
          ),
        );
        assert.equal((await service.expireAndPurge()).purged, 0);
      },
    );

    await t.test(
      'deleting an author keeps private evidence metadata until its scheduled purge',
      async () => {
        const id = await image();
        const submission = await submit(input());
        await pool.execute('DELETE FROM users WHERE id = 2');
        const [[attachment]] = await pool.execute(
          'SELECT author_id FROM moderation_attachments WHERE id = ?',
          [id],
        );
        assert.equal(attachment.author_id, null);
        await pool.execute(
          'UPDATE moderation_submissions SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [submission.id],
        );
        await pool.execute(
          'UPDATE moderation_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [id],
        );
        await service.expireAndPurge();
        await assert.rejects(fs.stat(path.join(privateDir, `${id}.webp`)), { code: 'ENOENT' });
      },
    );

    await t.test(
      'repository schema and migrations support real post/comment approval with notification foreign keys',
      async (schemaTest) => {
        const schemaDatabase = `moderation_schema_${crypto.randomUUID().replaceAll('-', '')}`;
        assert.match(schemaDatabase, /^moderation_schema_[a-f0-9]{32}$/);
        await connection.query(
          `CREATE DATABASE ${schemaDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
        );
        const bootstrap = await mysql.createConnection({
          ...config,
          database: schemaDatabase,
          multipleStatements: true,
        });
        try {
          const schemaSource = await fs.readFile(
            path.join(__dirname, '../database/schema.sql'),
            'utf8',
          );
          const seedSource = await fs.readFile(
            path.join(__dirname, '../database/seed.sql'),
            'utf8',
          );
          // Keep the repository's real table definitions and seed data unchanged;
          // only remove their fixed database selection inside this disposable server.
          const schemaSql = schemaSource.replace(
            /^CREATE DATABASE IF NOT EXISTS free_bbs\s+CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci;\s*USE free_bbs;\s*/,
            '',
          );
          const seedSql = seedSource.replace(/^USE free_bbs;\s*/, '');
          assert.notEqual(schemaSql, schemaSource, 'schema.sql database header must be recognized');
          assert.notEqual(seedSql, seedSource, 'seed.sql database header must be recognized');
          for (const sql of [schemaSql, seedSql]) {
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
          const [[selected]] = await bootstrap.query('SELECT DATABASE() AS database_name');
          assert.equal(selected.database_name, schemaDatabase);
        } finally {
          await bootstrap.end();
        }

        const schemaPool = mysql.createPool({
          ...config,
          database: schemaDatabase,
          connectionLimit: 1,
        });
        schemaTest.after(() => schemaPool.end());
        const [[session]] = await schemaPool.query(
          'SELECT @@SESSION.sql_mode AS sql_mode, @@SESSION.foreign_key_checks AS foreign_keys',
        );
        assert.match(session.sql_mode, /(?:STRICT_TRANS_TABLES|STRICT_ALL_TABLES)/);
        assert.equal(Number(session.foreign_keys), 1);
        const [[admin]] = await schemaPool.query(
          "SELECT id FROM users WHERE username = 'admin' AND is_admin = 1",
        );
        assert.ok(admin, 'the real seed must provide an administrator');
        const [createdAuthor] = await schemaPool.execute(
          `INSERT INTO users (username, full_name, student_id, email, password_hash, role)
           VALUES (?, ?, ?, ?, ?, 'student')`,
          [
            'schema_author',
            '合成测试作者',
            '2099000001',
            'schema-author@example.invalid',
            'test-only-unused-hash',
          ],
        );
        const authorId = createdAuthor.insertId;
        const [[board]] = await schemaPool.query(
          "SELECT id FROM discussion_boards WHERE slug = 'daily'",
        );
        await ensureSchema(schemaPool);
        const ordinaryEvents = [];
        const publisher = createModerationPublisher({
          createPostPid: async (db) => {
            const [[selected]] = await db.query('SELECT DATABASE() AS database_name');
            assert.equal(selected.database_name, schemaDatabase);
            return `p_${crypto.randomBytes(12).toString('hex')}`;
          },
          awardMagnetic: async (_db, userId) => {
            assert.equal(userId, authorId);
            return 0;
          },
          notifications: {
            notifyReply: async (event) => ordinaryEvents.push({ kind: 'reply', event }),
            notifyMentions: async (event) => ordinaryEvents.push({ kind: 'mention', event }),
          },
        });
        const schemaService = createDiscussionModeration({
          pool: schemaPool,
          publishSubmission: publisher,
        });
        assert.equal(await schemaService.isReviewer(admin.id), true);
        const submitToSchema = async (body) => {
          const db = await schemaPool.getConnection();
          try {
            await db.beginTransaction();
            const result = await schemaService.submit(db, body);
            await db.commit();
            return result;
          } catch (error) {
            await db.rollback();
            throw error;
          } finally {
            db.release();
          }
        };
        const approve = (submission) =>
          schemaService.decide({
            id: submission.id,
            reviewerId: admin.id,
            decision: 'approved',
            reason: '',
            expectedVersion: 1,
            requestId: crypto.randomUUID(),
          });
        const postSubmission = await submitToSchema({
          kind: 'post',
          authorId,
          requestId: crypto.randomUUID(),
          payload: {
            boardId: board.id,
            title: 'schema-private-title',
            content: 'schema-private-post-body',
            anonymous: false,
            loginRequired: true,
          },
          attachmentIds: [],
        });
        assert.equal((await schemaPool.query('SELECT id FROM discussion_posts'))[0].length, 0);
        const approvedPost = await approve(postSubmission);
        const [[storedPost]] = await schemaPool.execute(
          'SELECT * FROM discussion_posts WHERE id = ?',
          [approvedPost.publishedId],
        );
        assert.equal(storedPost.user_id, authorId);
        assert.equal(storedPost.author_student_id, '2099000001');
        assert.equal(storedPost.content_markdown, 'schema-private-post-body');
        assert.ok(storedPost.created_at instanceof Date);
        assert.equal(storedPost.login_required, 1);
        const commentSubmission = await submitToSchema({
          kind: 'comment',
          authorId,
          requestId: crypto.randomUUID(),
          payload: {
            postId: storedPost.id,
            parentCommentId: null,
            content: 'schema-private-comment-body',
          },
          attachmentIds: [],
        });
        assert.equal((await schemaPool.query('SELECT id FROM discussion_comments'))[0].length, 0);
        const approvedComment = await approve(commentSubmission);
        const [[storedComment]] = await schemaPool.execute(
          'SELECT * FROM discussion_comments WHERE id = ?',
          [approvedComment.publishedId],
        );
        assert.equal(storedComment.post_id, storedPost.id);
        assert.equal(storedComment.user_id, authorId);
        assert.equal(storedComment.author_student_id, '2099000001');
        assert.equal(storedComment.content_markdown, 'schema-private-comment-body');
        assert.ok(storedComment.created_at instanceof Date);
        assert.ok(ordinaryEvents.some((event) => event.kind === 'reply'));

        const [notices] = await schemaPool.query(
          "SELECT recipient_id,kind,title,body,event_key FROM community_notifications WHERE kind = 'moderation'",
        );
        assert.equal(notices.length, 4);
        for (const submission of [postSubmission, commentSubmission]) {
          assert.equal(
            notices.find((notice) => notice.event_key === `moderation:${submission.id}:pending`)
              ?.recipient_id,
            admin.id,
          );
          assert.equal(
            notices.find(
              (notice) => notice.event_key === `moderation-author:${submission.id}:pending`,
            )?.recipient_id,
            authorId,
          );
        }
        assert.doesNotMatch(JSON.stringify(notices), /schema-private-/);
        const [constraints] = await schemaPool.execute(
          `SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = ?`,
          [schemaDatabase],
        );
        for (const name of [
          'fk_moderation_author',
          'fk_moderation_decider',
          'fk_moderation_attachment_author',
          'fk_moderation_attachment_submission',
          'fk_discussion_posts_user',
          'fk_discussion_comments_post',
          'fk_notifications_recipient',
        ])
          assert.ok(
            constraints.some((constraint) => constraint.name === name),
            name,
          );
      },
    );
  },
);
