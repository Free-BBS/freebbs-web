const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const express = require('express');
const mysql = require('mysql2/promise');
const {
  ensureNotificationTables,
  createNotificationService,
  createNotificationsRouter,
  createNotificationEmailSender,
  normalizeNotificationLink,
  validatePublication,
} = require('./notifications');

function createDatabase() {
  let data = { notifications: [], outbox: [] };
  let snapshot;
  const users = [
    { id: 1, username: 'admin', full_name: '管理员', role: 'teacher', is_admin: 1 },
    { id: 2, username: 'author', full_name: '作者', role: 'student', is_admin: 0 },
    { id: 3, username: 'reply', full_name: '回复者', role: 'ta', is_admin: 0 },
  ];
  const calls = [];
  const pool = {
    users,
    calls,
    failOutbox: false,
    get data() {
      return data;
    },
    async getConnection() {
      return pool;
    },
    async beginTransaction() {
      calls.push('begin');
      snapshot = structuredClone(data);
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
      data = snapshot;
    },
    release() {
      calls.push('release');
    },
    async execute(rawSql, args = []) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      calls.push({ sql, args });
      if (sql.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }];
      if (sql.startsWith('SELECT id FROM users')) {
        let rows = users;
        if (sql.includes('course_material_managers'))
          rows = Number(args[0]) === 5 ? [users[2]] : [];
        else if (sql.includes('id IN')) rows = users.filter((user) => args.includes(user.id));
        else if (sql.includes('is_admin = 1')) rows = users.filter((user) => user.is_admin);
        else if (sql.includes('role = ?')) rows = users.filter((user) => user.role === args[0]);
        return [rows];
      }
      if (sql.startsWith('INSERT INTO community_notifications')) {
        const [recipient, actor, kind, title, body, link, eventKey] = args;
        let row = data.notifications.find(
          (item) => item.event_key === eventKey && item.recipient_id === recipient,
        );
        if (!row) {
          row = {
            id: data.notifications.length + 1,
            recipient_id: recipient,
            actor_id: actor,
            kind,
            title,
            body,
            link,
            event_key: eventKey,
            read_at: null,
            created_at: new Date(),
          };
          data.notifications.push(row);
        }
        return [{ insertId: row.id }];
      }
      if (sql.startsWith('INSERT IGNORE INTO notification_email_outbox')) {
        if (pool.failOutbox) throw new Error('simulated outbox failure');
        if (!data.outbox.some((item) => item.notification_id === args[0])) {
          data.outbox.push({
            notification_id: args[0],
            status: 'pending',
            attempts: 0,
            available_at: 0,
            lease_token: null,
            lease_until: null,
          });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT notification_id FROM notification_email_outbox')) {
        return [
          data.outbox.filter(
            (item) =>
              (item.status === 'pending' && item.available_at <= Date.now()) ||
              (item.status === 'sending' && item.lease_until < Date.now()),
          ),
        ];
      }
      if (sql.startsWith("UPDATE notification_email_outbox SET status = 'sending'")) {
        const row = data.outbox.find((item) => item.notification_id === args[1]);
        if (
          !row ||
          (row.status === 'sending' && row.lease_until >= Date.now()) ||
          row.status === 'sent'
        ) {
          return [{ affectedRows: 0 }];
        }
        [row.lease_token] = args;
        row.status = 'sending';
        row.attempts += 1;
        row.lease_until = Date.now() + 300000;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT o.notification_id')) {
        const row = data.outbox.find(
          (item) => item.notification_id === args[0] && item.lease_token === args[1],
        );
        const notification = data.notifications.find((item) => item.id === args[0]);
        return [row ? [{ ...notification, ...row, email: 'recipient@example.test' }] : []];
      }
      if (sql.startsWith("UPDATE notification_email_outbox SET status = 'sent'")) {
        const row = data.outbox.find(
          (item) => item.notification_id === args[0] && item.lease_token === args[1],
        );
        if (row) {
          row.status = 'sent';
          row.last_error_code = null;
          row.lease_token = null;
        }
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith("UPDATE notification_email_outbox SET status = 'pending'")) {
        const row = data.outbox.find(
          (item) => item.notification_id === args[2] && item.lease_token === args[3],
        );
        if (row) {
          row.status = 'pending';
          [, row.last_error_code] = args;
          row.available_at = Date.now() + args[0] * 1000;
          row.lease_token = null;
        }
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith('SELECT COUNT(*) AS count FROM community_notifications')) {
        return [
          [
            {
              count: data.notifications.filter(
                (row) => row.recipient_id === args[0] && !row.read_at,
              ).length,
            },
          ],
        ];
      }
      if (sql.startsWith('SELECT id, kind, title, body')) {
        const limit = Number(sql.match(/LIMIT (\d+)/)[1]);
        return [
          data.notifications
            .filter((row) => row.recipient_id === args[0] && (!args[1] || row.id < args[1]))
            .sort((a, b) => b.id - a.id)
            .slice(0, limit),
        ];
      }
      if (sql.startsWith('UPDATE community_notifications SET read_at = COALESCE')) {
        const row = data.notifications.find(
          (item) => item.id === args[0] && item.recipient_id === args[1],
        );
        if (row) row.read_at ||= new Date();
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith('UPDATE community_notifications SET read_at = NOW()')) {
        for (const row of data.notifications.filter((item) => item.recipient_id === args[0])) {
          row.read_at ||= new Date();
        }
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };
  return pool;
}

const post = { id: 8, pid: 'p_123456', user_id: 2, title: '系统问题' };
const actor = { id: 3, username: 'reply', full_name: '回复者' };
const publication = {
  title: '课程更新',
  body: '请查收新的课程内容',
  audience: { type: 'users', userIds: [2] },
};

test('publication rejects empty recipients, unknown groups and unsafe links', () => {
  for (const audience of [
    { type: 'users', userIds: [] },
    { type: 'role', role: 'arbitrary' },
    { type: 'course', courseId: 0 },
    { type: 'unknown' },
    { type: 'users', userIds: [2, 'bad'] },
  ]) {
    assert.throws(() => validatePublication({ ...publication, audience }));
  }
  for (const link of [
    // eslint-disable-next-line no-script-url -- exercise rejection of an executable link
    'javascript:alert(1)',
    '//evil.example',
    '/\\evil.example',
    '/\n/evil.example',
  ]) {
    assert.throws(() => normalizeNotificationLink(link));
  }
  assert.equal(normalizeNotificationLink('/discussion?post=p_123'), '/discussion?post=p_123');
});

test('replies deduplicate authors, skip self and persist inbox plus outbox in one transaction', async () => {
  const pool = createDatabase();
  const service = createNotificationService({
    pool,
    sendEmail: async () => assert.fail('No synchronous email'),
  });
  await service.notifyReply({
    actor,
    post,
    commentId: 10,
    parentAuthorId: 2,
    contentMarkdown: '回复',
  });
  assert.equal(pool.data.notifications.length, 1);
  assert.equal(pool.data.outbox.length, 1);
  assert.equal(pool.data.notifications[0].recipient_id, 2);
  assert.match(pool.data.notifications[0].title, /^reply /);
  assert.doesNotMatch(pool.data.notifications[0].title, /回复者/);
  assert.equal(pool.data.notifications[0].link, '/discussion?post=p_123456#comment-10');
  assert.deepEqual(
    pool.calls.filter((call) => typeof call === 'string'),
    ['begin', 'commit', 'release'],
  );
  await service.notifyReply({ actor: { id: 2 }, post, commentId: 11, parentAuthorId: 2 });
  assert.equal(pool.data.notifications.length, 1);
  await service.notifyReply({ actor, post, commentId: 12, parentAuthorId: 1 });
  assert.equal(pool.data.notifications.length, 3);
});

test('notifications join a supplied comment transaction and rollback when email enqueue fails', async () => {
  const pool = createDatabase();
  const service = createNotificationService({ pool });
  await pool.beginTransaction();
  await service.notifyReply({ actor, post, commentId: 10, parentAuthorId: 1 }, pool);
  assert.deepEqual(
    pool.calls.filter((call) => typeof call === 'string'),
    ['begin'],
  );
  await pool.rollback();
  assert.equal(pool.data.notifications.length, 0);
  assert.equal(pool.data.outbox.length, 0);
  pool.failOutbox = true;
  await assert.rejects(service.notifyReply({ actor, post, commentId: 11 }), /outbox failure/);
  assert.equal(pool.data.notifications.length, 0);
  assert.equal(pool.data.outbox.length, 0);
});

test('reaction cancellations, repeated toggles and self reactions do not create duplicate notifications', async () => {
  const pool = createDatabase();
  const service = createNotificationService({ pool });
  const event = { actor, post, reactionType: 'smile', active: true };
  await service.notifyReaction(event);
  await service.notifyReaction({ ...event, active: false });
  await service.notifyReaction(event);
  await service.notifyReaction({ ...event, actor: { id: 2 } });
  assert.equal(pool.data.notifications.length, 1);
  assert.equal(pool.data.outbox.length, 1);
  await service.notifyReaction({ ...event, reactionType: 'light' });
  await service.notifyReaction({ ...event, reactionType: 'fireworks' });
  assert.equal(pool.data.notifications.length, 3);
});

test('course notices target only the selected course managers and reject missing users atomically', async () => {
  const pool = createDatabase();
  const service = createNotificationService({ pool });
  const result = await service.publish(
    { id: 1 },
    { ...publication, audience: { type: 'course', courseId: 5 } },
  );
  assert.equal(result.recipientCount, 1);
  assert.equal(pool.data.notifications[0].recipient_id, 3);
  await assert.rejects(
    service.publish({ id: 1 }, { ...publication, audience: { type: 'users', userIds: [2, 404] } }),
    /不存在/,
  );
  assert.equal(pool.data.notifications.length, 1);
  await service.publish({ id: 1 }, { ...publication, audience: { type: 'role', role: 'admin' } });
  assert.equal(pool.data.notifications[1].recipient_id, 1);
});

test('a retried administrator publication is idempotent for each recipient', async () => {
  const pool = createDatabase();
  const service = createNotificationService({ pool });
  const request = {
    ...publication,
    requestId: 'reused-request-id-123',
    audience: { type: 'users', userIds: [2, 2, 3] },
  };
  await service.publish({ id: 1 }, request);
  await service.publish({ id: 1 }, request);
  assert.equal(pool.data.notifications.length, 2);
  assert.equal(pool.data.outbox.length, 2);
});

test('SMTP failures remain queued, redact private diagnostics, back off and recover on retry', async () => {
  const pool = createDatabase();
  let fail = true;
  let sends = 0;
  const service = createNotificationService({
    pool,
    sendEmail: async () => {
      sends += 1;
      if (fail) throw new Error('password=secret recipient=private@example.test');
    },
  });
  await service.publish({ id: 1 }, publication);
  await service.processOutbox();
  assert.equal(pool.data.outbox[0].status, 'pending');
  assert.equal(pool.data.outbox[0].last_error_code, 'smtp_delivery_failed');
  assert.ok(pool.data.outbox[0].available_at > Date.now());
  assert.equal(pool.data.notifications.length, 1);
  await service.processOutbox();
  assert.equal(sends, 1);
  fail = false;
  pool.data.outbox[0].available_at = 0;
  await service.processOutbox();
  assert.equal(pool.data.outbox[0].status, 'sent');
  assert.equal(pool.data.outbox[0].last_error_code, null);
  assert.equal(sends, 2);
});

test('an expired sending lease recovers after a worker crash without concurrent duplicate sends', async () => {
  const pool = createDatabase();
  let sends = 0;
  const sendEmail = async () => {
    sends += 1;
  };
  const service = createNotificationService({ pool, sendEmail });
  const second = createNotificationService({ pool, sendEmail });
  await service.publish({ id: 1 }, publication);
  pool.data.outbox[0].status = 'sending';
  pool.data.outbox[0].lease_until = 0;
  await Promise.all([service.processOutbox(), second.processOutbox()]);
  assert.equal(sends, 1);
  assert.equal(pool.data.outbox[0].status, 'sent');
});

test('unconfigured SMTP is an explicit retriable failure without attempting a real email', async () => {
  const send = createNotificationEmailSender({ mail: {} });
  await assert.rejects(send({ email: 'nobody@example.test' }), { code: 'smtp_unconfigured' });
});

async function startServer(t, pool) {
  const app = express();
  app.use(express.json());
  const requireAuth = async (request, response) => {
    const user = pool.users.find(
      (item) => `Bearer user-${item.id}` === request.headers.authorization,
    );
    if (!user) response.status(401).json({ message: '需要登录' });
    return user;
  };
  const requireAdmin = async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) return null;
    if (!user.is_admin) {
      response.status(403).json({ message: '需要管理员权限' });
      return null;
    }
    return user;
  };
  app.use(
    '/api',
    createNotificationsRouter({
      pool,
      requireAuth,
      requireAdmin,
      service: createNotificationService({
        pool,
        sendEmail: async () => assert.fail('No email during HTTP test'),
      }),
    }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return (path, { user = 2, ...options } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer user-${user}` },
    });
}

test('inbox/read/read-all are bound to the signed-in recipient and paginate consistently', async (t) => {
  const pool = createDatabase();
  const service = createNotificationService({ pool });
  await service.publish({ id: 1 }, { ...publication, audience: { type: 'all' } });
  await service.publish({ id: 1 }, publication);
  const request = await startServer(t, pool);
  const payload = await (await request('/notifications?limit=1')).json();
  assert.equal(payload.notifications.length, 1);
  assert.equal(payload.unreadCount, 2);
  assert.equal(payload.nextCursor, '4');
  const next = await (await request(`/notifications?before=${payload.nextCursor}`)).json();
  assert.deepEqual(
    next.notifications.map((item) => item.id),
    ['2'],
  );
  assert.equal((await request('/notifications/1/read', { method: 'POST' })).status, 404);
  assert.equal((await request('/notifications/2/read', { method: 'POST' })).status, 200);
  assert.equal((await request('/notifications/2/read', { method: 'POST' })).status, 200);
  await request('/notifications/read-all', { method: 'POST' });
  assert.equal((await (await request('/notifications/unread-count')).json()).unreadCount, 0);
  assert.equal(
    (await (await request('/notifications/unread-count', { user: 1 })).json()).unreadCount,
    1,
  );
  assert.equal((await request('/notifications', { user: 404 })).status, 401);
});

test('only administrators can publish or inspect audience and delivery state', async (t) => {
  const pool = createDatabase();
  const request = await startServer(t, pool);
  for (const path of ['/admin/notifications/audience', '/admin/notifications/delivery']) {
    assert.equal((await request(path)).status, 403);
  }
  assert.equal(
    (await request('/admin/notifications', { method: 'POST', body: JSON.stringify(publication) }))
      .status,
    403,
  );
  assert.equal(pool.data.notifications.length, 0);
  const result = await request('/admin/notifications', {
    user: 1,
    method: 'POST',
    body: JSON.stringify(publication),
  });
  assert.equal(result.status, 201);
  assert.equal((await result.json()).recipientCount, 1);
  assert.equal(pool.data.notifications[0].recipient_id, 2);
});

test(
  'MySQL: full existing schema coexists with inbox, deduplication, transactions and outbox retry',
  {
    skip: process.env.NOTIFICATIONS_MYSQL_TEST !== '1',
  },
  async (t) => {
    const database = `freebbs_notifications_test_${crypto.randomBytes(8).toString('hex')}`;
    const credentials = {
      host: process.env.NOTIFICATIONS_MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.NOTIFICATIONS_MYSQL_PORT || 3306),
      user: process.env.NOTIFICATIONS_MYSQL_USER || 'root',
      password: process.env.NOTIFICATIONS_MYSQL_PASSWORD || '',
    };
    const admin = await mysql.createConnection(credentials);
    let pool;
    t.after(async () => {
      if (pool) await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    });
    await admin.query(
      `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    pool = mysql.createPool({ ...credentials, database, multipleStatements: true });
    // Keep this test isolated: remove the schema's hard-coded production database directives.
    const schema = fs
      .readFileSync(nodePath.join(__dirname, '../database/schema.sql'), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS free_bbs[^;]*;/, '')
      .replace(/USE free_bbs;/, '');
    await pool.query(schema);
    await ensureNotificationTables(pool);
    await pool.execute(`INSERT INTO users (id, username, full_name, student_id, password_hash, role, is_admin, email)
    VALUES (1, 'admin', '管理员', '2026000001', 'unused', 'teacher', 1, 'admin@example.test'),
      (2, 'author', '作者', '2026000002', 'unused', 'student', 0, 'author@example.test'),
      (3, 'reply', '负责人', '2026000003', 'unused', 'ta', 0, 'reply@example.test')`);
    await pool.execute(
      "INSERT INTO courses (id, slug, name) VALUES (5, 'test-course', '测试课程')",
    );
    await pool.execute('INSERT INTO course_material_managers (course_id, user_id) VALUES (5, 3)');
    await pool.execute(`INSERT INTO notifications (public_id, recipient_user_id, category, title, status)
    VALUES ('existing-workbench-note', 2, 'course', '已有工作台通知', 'published')`);
    let fail = true;
    const delivered = [];
    const service = createNotificationService({
      pool,
      sendEmail: async (item) => {
        if (fail) {
          const error = new Error('not configured');
          error.code = 'smtp_unconfigured';
          throw error;
        }
        delivered.push(item.notification_id);
      },
    });
    const announcement = {
      ...publication,
      requestId: 'mysql-request-id-1234',
      audience: { type: 'course', courseId: 5 },
    };
    await service.publish({ id: 1 }, announcement);
    await service.publish({ id: 1 }, announcement);
    await service.notifyReaction({ actor, post, reactionType: 'smile', active: true });
    await service.notifyReaction({ actor, post, reactionType: 'smile', active: false });
    await service.notifyReaction({ actor, post, reactionType: 'smile', active: true });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await service.notifyReply({ actor, post, parentAuthorId: 1, commentId: 44 }, connection);
      await connection.rollback();
    } finally {
      connection.release();
    }
    const [rows] = await pool.execute(
      'SELECT recipient_id FROM community_notifications ORDER BY id',
    );
    assert.deepEqual(
      rows.map((row) => row.recipient_id),
      [3, 2],
    );
    const [old] = await pool.execute('SELECT public_id FROM notifications');
    assert.equal(old[0].public_id, 'existing-workbench-note');
    await service.processOutbox();
    const [pending] = await pool.execute(
      'SELECT status, last_error_code FROM notification_email_outbox',
    );
    assert.equal(pending.length, 2);
    assert.ok(
      pending.every(
        (row) => row.status === 'pending' && row.last_error_code === 'smtp_unconfigured',
      ),
    );
    fail = false;
    await pool.execute(
      'UPDATE notification_email_outbox SET available_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
    );
    await service.processOutbox();
    assert.equal(delivered.length, 2);
    const [sent] = await pool.execute(
      "SELECT COUNT(*) AS count FROM notification_email_outbox WHERE status = 'sent'",
    );
    assert.equal(sent[0].count, 2);
    const [foreignKeys] = await pool.execute(
      `SELECT REFERENCED_TABLE_NAME AS target FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notification_email_outbox' AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [database],
    );
    assert.equal(foreignKeys[0].target, 'community_notifications');
  },
);
