const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');
const config = require('./config');

const SCHEMA = fs
  .readFileSync(path.join(__dirname, '../database/migrations/026_notifications.sql'), 'utf8')
  .split(';')
  .map((sql) => sql.trim())
  .filter(Boolean);
const ROLE_LABELS = { student: '学生', ta: '助教', teacher: '教师', admin: '管理员' };
const REACTION_LABELS = { smile: '点赞', light: '点亮', fireworks: '送上烟花' };
const schemaPromises = new WeakMap();

function ensureNotificationTables(pool) {
  if (!schemaPromises.has(pool)) {
    const pending = (async () => {
      for (const sql of SCHEMA) await pool.execute(sql);
    })().catch((error) => {
      schemaPromises.delete(pool);
      throw error;
    });
    schemaPromises.set(pool, pending);
  }
  return schemaPromises.get(pool);
}

function notificationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeNotificationLink(value) {
  const link = String(value || '').trim();
  if (!link) return '';
  if (
    link.length > 500 ||
    !link.startsWith('/') ||
    link.startsWith('//') ||
    link.includes('\\') ||
    [...link].some((character) => character.charCodeAt(0) <= 32)
  ) {
    throw notificationError('通知链接必须是站内路径，例如 /discussion');
  }
  const parsed = new URL(link, 'https://free-bbs.invalid');
  if (parsed.origin !== 'https://free-bbs.invalid') {
    throw notificationError('通知链接必须是站内路径');
  }
  return link;
}

function validatePublication(body = {}) {
  const title = String(body.title || '').trim();
  const content = String(body.body || '').trim();
  if (!title || title.length > 160 || !content || content.length > 5000) {
    throw notificationError('请填写标题（1–160 字）和正文（1–5000 字）');
  }
  const audience = body.audience || {};
  if (!['all', 'users', 'role', 'course'].includes(audience.type)) {
    throw notificationError('请选择有效的通知对象');
  }
  if (audience.type === 'role' && !Object.hasOwn(ROLE_LABELS, audience.role)) {
    throw notificationError('无效身份分组');
  }
  if (audience.type === 'course' && !positiveId(audience.courseId)) {
    throw notificationError('请选择课程管理组');
  }
  if (
    audience.type === 'users' &&
    (!Array.isArray(audience.userIds) ||
      !audience.userIds.length ||
      audience.userIds.length > 500 ||
      audience.userIds.some((id) => !positiveId(id)))
  ) {
    throw notificationError('请选择 1–500 位接收用户');
  }
  const requestId = body.requestId || crypto.randomUUID();
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(requestId)) {
    throw notificationError('无效通知请求标识');
  }
  return { title, body: content, link: normalizeNotificationLink(body.link), audience, requestId };
}

function parseNotificationWebUrl(publicWebUrl, nodeEnvironment) {
  try {
    const parsed = new URL(publicWebUrl);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const isLoopback =
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      /^127\.\d+\.\d+\.\d+$/.test(hostname) ||
      ['0.0.0.0', '[::]', '[::1]'].includes(hostname);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      (nodeEnvironment === 'production' && (parsed.protocol !== 'https:' || isLoopback))
    ) {
      throw new Error('Invalid public URL');
    }
    return parsed;
  } catch {
    const error = new Error('Notification PUBLIC_WEB_URL is invalid');
    error.code = 'public_web_url_invalid';
    throw error;
  }
}

function createNotificationEmailSender({
  mail = config.mail,
  publicWebUrl = config.publicWebUrl,
  nodeEnvironment = process.env.NODE_ENV,
} = {}) {
  let transporter;
  return async (item) => {
    // Validate at delivery so a configuration problem leaves notifications queued.
    const publicUrl = parseNotificationWebUrl(publicWebUrl, nodeEnvironment);
    if (!mail.host || !mail.user || !mail.pass || !mail.from) {
      const error = new Error('Notification SMTP is not configured');
      error.code = 'smtp_unconfigured';
      throw error;
    }
    if (!item.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) {
      const error = new Error('Notification recipient has no email');
      error.code = 'recipient_email_unavailable';
      throw error;
    }
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.port === 465,
        auth: { user: mail.user, pass: mail.pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
      });
    }
    const link = normalizeNotificationLink(item.link);
    const url = new URL(link || '/', publicUrl.origin).href;
    await transporter.sendMail({
      from: mail.from,
      to: item.email,
      subject: `FREE-BBS · ${item.title}`,
      text: `${item.title}\n\n${item.body}\n\n查看通知：${url}`,
      // Keep a stable Message-ID across retries. Delivery is at-least-once.
      messageId: `<notification-${item.notification_id}@${publicUrl.hostname}>`,
    });
  };
}

async function inTransaction(pool, suppliedConnection, callback) {
  if (suppliedConnection) return callback(suppliedConnection);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function resolveAudience(connection, audience) {
  let sql = 'SELECT id FROM users';
  let parameters = [];
  if (audience.type === 'users') {
    parameters = [...new Set(audience.userIds.map(Number))];
    sql += ` WHERE id IN (${parameters.map(() => '?').join(', ')})`;
  } else if (audience.type === 'role') {
    sql += audience.role === 'admin' ? ' WHERE is_admin = 1' : ' WHERE role = ?';
    parameters = audience.role === 'admin' ? [] : [audience.role];
  } else if (audience.type === 'course') {
    sql += ' WHERE id IN (SELECT user_id FROM course_material_managers WHERE course_id = ?)';
    parameters = [Number(audience.courseId)];
  }
  const [rows] = await connection.execute(sql, parameters);
  if (!rows.length) throw notificationError('所选分组没有可接收通知的用户');
  if (audience.type === 'users' && rows.length !== parameters.length) {
    throw notificationError('部分接收用户不存在，请刷新后重试');
  }
  return rows.map((row) => row.id);
}

async function insertNotifications(connection, recipients, notification) {
  let count = 0;
  for (const recipientId of new Set(recipients.map(Number).filter(positiveId))) {
    const [result] = await connection.execute(
      `INSERT INTO community_notifications (recipient_id, actor_id, kind, title, body, link, event_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        recipientId,
        notification.actorId || null,
        notification.kind,
        notification.title,
        notification.body,
        notification.link || '',
        notification.eventKey,
      ],
    );
    // INSERT IGNORE targets only the outbox primary key; both rows share the transaction.
    await connection.execute(
      'INSERT IGNORE INTO notification_email_outbox (notification_id) VALUES (?)',
      [result.insertId],
    );
    count += 1;
  }
  return count;
}

function createNotificationService({
  pool,
  publicWebUrl = config.publicWebUrl,
  sendEmail = createNotificationEmailSender({ publicWebUrl }),
  logger = console,
}) {
  let working = false;
  let timer = null;

  async function publish(actor, body) {
    const publication = validatePublication(body);
    return inTransaction(pool, null, async (connection) => {
      const recipients = await resolveAudience(connection, publication.audience);
      const recipientCount = await insertNotifications(connection, recipients, {
        ...publication,
        actorId: actor.id,
        kind: 'announcement',
        eventKey: `announcement:${actor.id}:${publication.requestId}`,
      });
      return { recipientCount, emailQueued: recipientCount };
    });
  }

  async function notifyReply(
    { actor, post, commentId, parentAuthorId, contentMarkdown },
    connection,
  ) {
    const recipients = [post.user_id, parentAuthorId]
      .filter(positiveId)
      .filter((id) => Number(id) !== Number(actor.id));
    if (!recipients.length) return 0;
    return inTransaction(pool, connection, (database) =>
      insertNotifications(database, recipients, {
        actorId: actor.id,
        kind: 'reply',
        title: `${actor.username || '用户'} 回复了你的讨论`.slice(0, 160),
        body: `《${post.title || '讨论'}》\n${String(contentMarkdown || '').slice(0, 1500)}`,
        link: `/discussion?post=${encodeURIComponent(post.pid || post.id)}#comment-${commentId}`,
        eventKey: `reply:${commentId}`,
      }),
    );
  }

  async function notifyReaction({ actor, post, reactionType, active }, connection) {
    if (!active || Number(actor.id) === Number(post.user_id)) return 0;
    if (!Object.hasOwn(REACTION_LABELS, reactionType)) return 0;
    return inTransaction(pool, connection, (database) =>
      insertNotifications(database, [post.user_id], {
        actorId: actor.id,
        kind: 'reaction',
        title: `${actor.username || '用户'} 为你的帖子${REACTION_LABELS[reactionType]}`.slice(
          0,
          160,
        ),
        body: `《${post.title || '讨论'}》收到了新的回应。`,
        link: `/discussion?post=${encodeURIComponent(post.pid || post.id)}`,
        eventKey: `reaction:${post.id}:${actor.id}:${reactionType}`,
      }),
    );
  }

  async function processOutbox() {
    if (working) return { processed: 0 };
    working = true;
    let processed = 0;
    try {
      const [rows] = await pool.execute(
        `SELECT notification_id FROM notification_email_outbox
         WHERE (status = 'pending' AND available_at <= NOW())
            OR (status = 'sending' AND lease_until < NOW())
         ORDER BY available_at, notification_id LIMIT 20`,
      );
      for (const row of rows) {
        const lease = crypto.randomUUID();
        const [claimed] = await pool.execute(
          `UPDATE notification_email_outbox SET status = 'sending', lease_token = ?,
             lease_until = DATE_ADD(NOW(), INTERVAL 5 MINUTE), attempts = attempts + 1
           WHERE notification_id = ? AND ((status = 'pending' AND available_at <= NOW())
              OR (status = 'sending' AND lease_until < NOW()))`,
          [lease, row.notification_id],
        );
        if (!claimed.affectedRows) continue;
        const [items] = await pool.execute(
          `SELECT o.notification_id, o.attempts, n.title, n.body, n.link, u.email
           FROM notification_email_outbox o JOIN community_notifications n ON n.id = o.notification_id
           JOIN users u ON u.id = n.recipient_id
           WHERE o.notification_id = ? AND o.lease_token = ?`,
          [row.notification_id, lease],
        );
        if (!items[0]) continue;
        try {
          await sendEmail(items[0]);
          await pool.execute(
            `UPDATE notification_email_outbox SET status = 'sent', sent_at = NOW(),
               lease_token = NULL, lease_until = NULL, last_error_code = NULL
             WHERE notification_id = ? AND lease_token = ?`,
            [row.notification_id, lease],
          );
        } catch (error) {
          // Persist only fixed diagnostic codes, never SMTP replies, email addresses or credentials.
          const errorCode = [
            'smtp_unconfigured',
            'recipient_email_unavailable',
            'public_web_url_invalid',
          ].includes(error.code)
            ? error.code
            : 'smtp_delivery_failed';
          const delay = Math.min(3600, 30 * 2 ** Math.min(Number(items[0].attempts), 7));
          await pool.execute(
            `UPDATE notification_email_outbox SET status = 'pending',
               available_at = DATE_ADD(NOW(), INTERVAL ? SECOND), last_error_code = ?,
               lease_token = NULL, lease_until = NULL
             WHERE notification_id = ? AND lease_token = ?`,
            [delay, errorCode, row.notification_id, lease],
          );
        }
        processed += 1;
      }
      return { processed };
    } finally {
      working = false;
    }
  }

  function startWorker() {
    if (!timer) {
      const tick = () =>
        processOutbox().catch(() => logger.error('Notification outbox unavailable'));
      timer = setInterval(tick, 15000);
      timer.unref?.();
      tick();
    }
    return () => {
      clearInterval(timer);
      timer = null;
    };
  }

  return { publish, notifyReply, notifyReaction, processOutbox, startWorker };
}

function createNotificationsRouter({ pool, requireAuth, requireAdmin, service }) {
  const router = express.Router();
  function route(handler, admin = false) {
    return async (request, response) => {
      try {
        const user = await (admin ? requireAdmin : requireAuth)(request, response);
        if (!user) return;
        await ensureNotificationTables(pool);
        await handler(request, response, user);
      } catch (error) {
        response.status(error.status || 500).json({
          message: error.status ? error.message : '通知服务暂时不可用，请稍后重试',
        });
      }
    };
  }

  router.get(
    '/notifications/unread-count',
    route(async (_request, response, user) => {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM community_notifications WHERE recipient_id = ? AND read_at IS NULL',
        [user.id],
      );
      response.json({ unreadCount: Number(rows[0].count) });
    }),
  );
  router.get(
    '/notifications',
    route(async (request, response, user) => {
      const before = positiveId(request.query.before);
      const limit = Math.min(50, positiveId(request.query.limit) || 20);
      const [rows] = await pool.execute(
        `SELECT id, kind, title, body, link, read_at, created_at FROM community_notifications
       WHERE recipient_id = ?${before ? ' AND id < ?' : ''} ORDER BY id DESC LIMIT ${limit + 1}`,
        before ? [user.id, before] : [user.id],
      );
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        id: String(row.id),
        kind: row.kind,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.read_at,
        createdAt: row.created_at,
      }));
      const [counts] = await pool.execute(
        'SELECT COUNT(*) AS count FROM community_notifications WHERE recipient_id = ? AND read_at IS NULL',
        [user.id],
      );
      response.json({
        notifications: items,
        unreadCount: Number(counts[0].count),
        nextCursor: hasMore ? items.at(-1).id : null,
      });
    }),
  );
  router.post(
    '/notifications/read-all',
    route(async (_request, response, user) => {
      await pool.execute(
        'UPDATE community_notifications SET read_at = NOW() WHERE recipient_id = ? AND read_at IS NULL',
        [user.id],
      );
      response.json({ ok: true });
    }),
  );
  router.post(
    '/notifications/:id/read',
    route(async (request, response, user) => {
      const id = positiveId(request.params.id);
      if (!id) throw notificationError('通知不存在', 404);
      const [result] = await pool.execute(
        'UPDATE community_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND recipient_id = ?',
        [id, user.id],
      );
      if (!result.affectedRows) throw notificationError('通知不存在', 404);
      response.json({ ok: true });
    }),
  );
  router.get(
    '/admin/notifications/audience',
    route(async (request, response) => {
      const query = String(request.query.q || '')
        .trim()
        .slice(0, 100);
      const [users] = await pool.execute(
        `SELECT id, username, full_name, student_id FROM users
       ${query ? 'WHERE LOCATE(?, username) > 0 OR LOCATE(?, full_name) > 0 OR LOCATE(?, student_id) > 0' : ''}
       ORDER BY username LIMIT 100`,
        query ? [query, query, query] : [],
      );
      const [courses] = await pool.execute(
        `SELECT c.id, c.name, COUNT(m.user_id) AS member_count FROM courses c
       LEFT JOIN course_material_managers m ON m.course_id = c.id
       GROUP BY c.id, c.name ORDER BY c.id`,
      );
      response.json({
        users: users.map((user) => ({
          id: String(user.id),
          username: user.username,
          fullName: user.full_name,
          studentId: user.student_id,
        })),
        roles: Object.entries(ROLE_LABELS).map(([id, name]) => ({ id, name })),
        courses: courses.map((course) => ({
          id: String(course.id),
          name: course.name,
          memberCount: Number(course.member_count),
        })),
      });
    }, true),
  );
  router.get(
    '/admin/notifications/delivery',
    route(async (_request, response) => {
      const [rows] = await pool.execute(
        `SELECT status, last_error_code, COUNT(*) AS count FROM notification_email_outbox
       GROUP BY status, last_error_code`,
      );
      response.json({
        delivery: rows.map((row) => ({
          status: row.status,
          errorCode: row.last_error_code || '',
          count: Number(row.count),
        })),
      });
    }, true),
  );
  router.post(
    '/admin/notifications',
    route(async (request, response, user) => {
      const result = await service.publish(user, request.body);
      response.status(201).json({ message: '通知已发布，邮件已加入发送队列', ...result });
    }, true),
  );
  return router;
}

module.exports = {
  ensureNotificationTables,
  createNotificationService,
  createNotificationsRouter,
  createNotificationEmailSender,
  normalizeNotificationLink,
  validatePublication,
};
