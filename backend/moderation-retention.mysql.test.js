const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isolatedMysqlConfig, assertIsolatedMysql } = require('./test-helpers/isolated-mysql');
const { ensureSchema, createDiscussionModeration } = require('./discussion-moderation');
const { ensureModerationAuditSchema, createModerationAudit } = require('./moderation-audit');
const {
  ensureModerationAutomationSchema,
  createModerationAutomationStore,
} = require('./moderation-automation-store');
const { ensureModerationRetention } = require('./moderation-retention');

test(
  'isolated MySQL: ninety-day moderation retention upgrades only live evidence atomically',
  { skip: process.env.RUN_MODERATION_MYSQL !== '1', timeout: 60000 },
  async (t) => {
    const mysql = require('mysql2/promise');
    const config = isolatedMysqlConfig('MODERATION_MYSQL_SOCKET');
    const admin = await mysql.createConnection(config);
    t.after(() => admin.end());
    await assertIsolatedMysql(admin);
    const database = `moderation_retention_${randomUUID().replaceAll('-', '')}`;
    assert.match(database, /^moderation_retention_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    const pool = mysql.createPool({ ...config, database, connectionLimit: 4 });
    t.after(() => pool.end());
    await pool.execute(
      'CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(64), is_admin TINYINT) ENGINE=InnoDB',
    );
    await pool.execute("INSERT INTO users VALUES (1, 'reviewer', 1), (2, 'author', 0)");
    await pool.execute(
      'CREATE TABLE community_notifications (id BIGINT AUTO_INCREMENT PRIMARY KEY, recipient_id BIGINT, actor_id BIGINT, kind VARCHAR(24), title VARCHAR(160), body TEXT, link VARCHAR(500), event_key VARCHAR(190), read_at DATETIME NULL) ENGINE=InnoDB',
    );
    await ensureSchema(pool);
    await ensureModerationAuditSchema(pool);
    await ensureModerationAutomationSchema(pool);
    const notifications = { notifyModeration: async () => {} };
    const service = createDiscussionModeration({ pool, notifications });
    const store = createModerationAutomationStore({ pool, notifications });
    const audit = createModerationAudit({ pool });

    async function graph({
      status = 'pending',
      expired = false,
      purged = false,
      childExpired = false,
      jobPurged = false,
    } = {}) {
      const id = randomUUID();
      const attachment = randomUUID();
      const run = randomUUID();
      const job = randomUUID();
      const regression = randomUUID();
      const created = expired ? 40 : 20;
      const daysLeft = expired ? -10 : 10;
      await pool.execute(
        `INSERT INTO moderation_submissions (id,kind,author_id,request_id,payload_json,attachment_ids_json,content_hash,status,created_at,expires_at,evidence_purged_at,published_id,published_url)
         VALUES (?, 'post', 2, ?, ?, ?, ?, ?, DATE_SUB(NOW(3), INTERVAL ? DAY), DATE_ADD(NOW(3), INTERVAL ? DAY), IF(?, NOW(3), NULL), ?, ?)`,
        [
          id,
          randomUUID(),
          purged ? null : JSON.stringify({ title: '合成留存样例', content: '普通建议' }),
          JSON.stringify([attachment]),
          'a'.repeat(64),
          status,
          created,
          daysLeft,
          purged,
          status === 'approved' ? 123 : null,
          status === 'approved' ? '/discussion/post/123' : null,
        ],
      );
      const childLeft = childExpired ? -1 : daysLeft;
      await pool.execute(
        `INSERT INTO moderation_attachments (id,author_id,file_name,mime_type,byte_size,sha256,submission_id,bound_content_hash,published_id,created_at,expires_at,purged_at)
         SELECT ?, 2, ?, 'image/webp', 12, ?, id, content_hash, published_id, DATE_SUB(created_at, INTERVAL 2 DAY), DATE_ADD(NOW(3), INTERVAL ? DAY), IF(?, NOW(3), NULL) FROM moderation_submissions WHERE id = ?`,
        [attachment, `${attachment}.webp`, 'b'.repeat(64), childLeft, purged, id],
      );
      await pool.execute(
        `INSERT INTO moderation_ai_runs (id,submission_id,reviewer_id,submission_version,content_hash,input_hash,result_json,created_at,expires_at)
         VALUES (?, ?, 1, 1, ?, ?, '{}', DATE_SUB(NOW(3), INTERVAL 5 DAY), DATE_ADD(NOW(3), INTERVAL ? DAY))`,
        [run, id, 'a'.repeat(64), 'b'.repeat(64), childLeft],
      );
      const [feedback] = await pool.execute(
        "INSERT INTO moderation_ai_feedback (run_id,reviewer_id,request_id,request_hash,feedback_json) VALUES (?, 1, ?, ?, '{}')",
        [run, randomUUID(), 'c'.repeat(64)],
      );
      await pool.execute(
        `INSERT INTO moderation_regression_cases (id,run_id,feedback_id,reviewer_id,request_id,request_hash,case_json,expires_at)
         VALUES (?, ?, ?, 1, ?, ?, '{}', DATE_ADD(NOW(3), INTERVAL ? DAY))`,
        [regression, run, feedback.insertId, randomUUID(), 'c'.repeat(64), childLeft],
      );
      await pool.execute(
        `INSERT INTO moderation_auto_jobs (id,submission_id,submission_version,content_hash,state,result_json,created_at,expires_at,purged_at)
         VALUES (?, ?, 1, ?, ?, ?, DATE_SUB(NOW(3), INTERVAL 5 DAY), DATE_ADD(NOW(3), INTERVAL ? DAY), IF(?, NOW(3), NULL))`,
        [
          job,
          id,
          'a'.repeat(64),
          status === 'approved' ? 'published' : 'review',
          jobPurged ? null : '{}',
          childLeft,
          jobPurged,
        ],
      );
      await pool.execute(
        `INSERT INTO moderation_image_reviews (job_id,submission_id,published_version,expires_at) VALUES (?, ?, 2, DATE_ADD(NOW(3), INTERVAL ? DAY))`,
        [job, id, childLeft],
      );
      return { id, attachment, run, job, regression };
    }
    async function orphan({ expired = false, detached = false } = {}) {
      const id = randomUUID();
      await pool.execute(
        `INSERT INTO moderation_attachments (id,author_id,file_name,mime_type,byte_size,sha256,bound_content_hash,created_at,expires_at)
         VALUES (?, 2, ?, 'image/webp', 12, ?, ?, DATE_SUB(NOW(3), INTERVAL 20 DAY), DATE_ADD(NOW(3), INTERVAL ? DAY))`,
        [id, `${id}.webp`, 'a'.repeat(64), detached ? 'b'.repeat(64) : null, expired ? -1 : 10],
      );
      return id;
    }
    async function snapshot() {
      const tables = [
        'moderation_submissions',
        'moderation_attachments',
        'moderation_ai_runs',
        'moderation_regression_cases',
        'moderation_auto_jobs',
        'moderation_image_reviews',
      ];
      return Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [
            table,
            (
              await pool.query(
                `SELECT * FROM ${table} ORDER BY ${table === 'moderation_image_reviews' ? 'job_id' : 'id'}`,
              )
            )[0],
          ]),
        ),
      );
    }
    const active = await graph();
    const approved = await graph({ status: 'approved' });
    const rejected = await graph({ status: 'rejected' });
    const expired = await graph({ expired: true });
    const purged = await graph({ purged: true });
    const markedExpired = await graph({ status: 'expired' });
    const expiredChildren = await graph({ childExpired: true });
    const purgedJob = await graph({ jobPurged: true });
    const unbound = await orphan();
    const unboundExpired = await orphan({ expired: true });
    const detached = await orphan({ detached: true });
    const before = await snapshot();

    const interruptedPool = {
      async getConnection() {
        const db = await pool.getConnection();
        return {
          async query(sql) {
            if (sql.startsWith('UPDATE moderation_ai_runs'))
              throw new Error('injected interruption after child updates');
            return db.query(sql);
          },
          rollback: () => db.rollback(),
          release: () => db.release(),
        };
      },
    };
    await assert.rejects(ensureModerationRetention(interruptedPool), /injected interruption/);
    assert.deepEqual(
      await snapshot(),
      before,
      'failed migration rolls back all child deadline changes',
    );

    await ensureModerationRetention(pool);
    const after = await snapshot();
    for (const item of [active, approved, rejected]) {
      const submission = after.moderation_submissions.find((row) => row.id === item.id);
      assert.equal(submission.expires_at - submission.created_at, 90 * 86400000);
      for (const [table, key] of [
        ['moderation_attachments', 'attachment'],
        ['moderation_ai_runs', 'run'],
        ['moderation_regression_cases', 'regression'],
        ['moderation_auto_jobs', 'job'],
        ['moderation_image_reviews', 'job'],
      ]) {
        const child = after[table].find((row) => (row.id || row.job_id) === item[key]);
        assert.equal(
          +child.expires_at,
          +submission.expires_at,
          `${table} follows original submission creation`,
        );
      }
      assert.equal(
        submission.status,
        before.moderation_submissions.find((row) => row.id === item.id).status,
      );
    }
    for (const item of [expired, purged, markedExpired]) {
      for (const table of Object.keys(before)) {
        const belongs = (row) =>
          row.id === item.id || row.submission_id === item.id || row.run_id === item.run;
        assert.deepEqual(
          after[table].filter(belongs),
          before[table].filter(belongs),
          `${table} never revives expired/purged evidence`,
        );
      }
    }
    for (const table of [
      'moderation_attachments',
      'moderation_ai_runs',
      'moderation_regression_cases',
      'moderation_auto_jobs',
      'moderation_image_reviews',
    ]) {
      const belongs = (row) =>
        row.submission_id === expiredChildren.id || row.run_id === expiredChildren.run;
      assert.deepEqual(
        after[table].filter(belongs),
        before[table].filter(belongs),
        `${table} keeps already expired children inaccessible`,
      );
    }
    for (const table of ['moderation_auto_jobs', 'moderation_image_reviews']) {
      const belongs = (row) => row.submission_id === purgedJob.id;
      assert.deepEqual(after[table].filter(belongs), before[table].filter(belongs));
    }
    const unboundRow = after.moderation_attachments.find((row) => row.id === unbound);
    assert.equal(unboundRow.expires_at - unboundRow.created_at, 90 * 86400000);
    for (const id of [unboundExpired, detached])
      assert.deepEqual(
        after.moderation_attachments.find((row) => row.id === id),
        before.moderation_attachments.find((row) => row.id === id),
      );

    let expiredImagePublications = 0;
    const manualService = createDiscussionModeration({
      pool,
      notifications,
      publishSubmission: async () => {
        expiredImagePublications += 1;
        return { publishedId: 999, publishedUrl: '/discussion/post/999' };
      },
    });
    await assert.rejects(
      manualService.decide({
        id: expiredChildren.id,
        reviewerId: 1,
        decision: 'approved',
        requestId: randomUUID(),
        expectedVersion: 1,
      }),
      { status: 409 },
    );
    assert.equal(
      expiredImagePublications,
      0,
      'manual approval cannot revive an expired image after extending its parent',
    );

    await pool.execute(
      'CREATE TABLE retention_test_publications (id INT PRIMARY KEY) ENGINE=InnoDB',
    );
    const boundaryService = createDiscussionModeration({
      pool,
      notifications,
      publishSubmission: async (db) => {
        await db.execute('INSERT INTO retention_test_publications (id) VALUES (999)');
        await db.execute(
          'UPDATE moderation_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?',
          [active.attachment],
        );
        return { publishedId: 999, publishedUrl: '/discussion/post/999' };
      },
    });
    await assert.rejects(
      boundaryService.decide({
        id: active.id,
        reviewerId: 1,
        decision: 'approved',
        requestId: randomUUID(),
        expectedVersion: 1,
      }),
      { status: 409 },
    );
    assert.equal(
      (await pool.execute('SELECT id FROM retention_test_publications'))[0].length,
      0,
      'an image expiring during publication rolls back the publication',
    );
    assert.deepEqual(
      await snapshot(),
      after,
      'the failed publication preserves the submission and attachment state',
    );

    const restarted = mysql.createPool({ ...config, database });
    try {
      await ensureModerationRetention(restarted);
      assert.deepEqual(
        await snapshot(),
        after,
        'restarting does not slide the deadline or change evidence',
      );
    } finally {
      await restarted.end();
    }

    const attachmentId = randomUUID();
    await service.registerAttachment({
      id: attachmentId,
      authorId: 2,
      fileName: `${attachmentId}.webp`,
      mimeType: 'image/webp',
      byteSize: 12,
      sha256: 'b'.repeat(64),
    });
    const [[newAttachment]] = await pool.execute(
      'SELECT * FROM moderation_attachments WHERE id = ?',
      [attachmentId],
    );
    assert.equal(newAttachment.expires_at - newAttachment.created_at, 90 * 86400000);
    const db = await pool.getConnection();
    let submitted;
    try {
      await db.beginTransaction();
      submitted = await service.submit(db, {
        kind: 'post',
        authorId: 2,
        requestId: randomUUID(),
        payload: {
          boardId: 1,
          title: '新内容',
          content: '普通内容',
          anonymous: false,
          loginRequired: true,
        },
        attachmentIds: [],
      });
      await db.commit();
    } finally {
      db.release();
    }
    const [[newSubmission]] = await pool.execute(
      'SELECT * FROM moderation_submissions WHERE id = ?',
      [submitted.id],
    );
    assert.equal(newSubmission.expires_at - newSubmission.created_at, 90 * 86400000);

    await audit.purge();
    await store.purge();
    await service.expireAndPurge();
    const [[retained]] = await pool.execute(
      'SELECT payload_json, expires_at, published_id, published_url FROM moderation_submissions WHERE id = ?',
      [approved.id],
    );
    assert.ok(retained.payload_json);
    assert.equal(retained.published_id, 123);
    assert.equal(retained.published_url, '/discussion/post/123');
    assert.equal(
      (await pool.execute('SELECT id FROM moderation_ai_runs WHERE id = ?', [active.run]))[0]
        .length,
      1,
    );
    assert.equal(
      (await pool.execute('SELECT id FROM moderation_ai_runs WHERE id = ?', [expired.run]))[0]
        .length,
      0,
    );
    assert.equal(
      (
        await pool.execute('SELECT id FROM moderation_ai_feedback WHERE run_id = ?', [expired.run])
      )[0].length,
      0,
    );
    assert.equal(
      (
        await pool.execute('SELECT id FROM moderation_regression_cases WHERE run_id = ?', [
          expired.run,
        ])
      )[0].length,
      0,
    );
    assert.equal(
      (
        await pool.execute('SELECT job_id FROM moderation_image_reviews WHERE job_id = ?', [
          expired.job,
        ])
      )[0].length,
      0,
    );
  },
);
