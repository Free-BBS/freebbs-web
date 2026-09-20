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
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const schemaPromises = new WeakMap();

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getWeeklyDigestWindow(now = new Date()) {
  const shanghai = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const weekday = shanghai.getUTCDay();
  const hour = shanghai.getUTCHours();
  if (weekday !== 1 || hour < 8) return null;
  const currentMondayUtc =
    Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()) -
    SHANGHAI_OFFSET_MS;
  const start = new Date(currentMondayUtc - WEEK_MS);
  const end = new Date(currentMondayUtc);
  const localStart = new Date(start.getTime() + SHANGHAI_OFFSET_MS);
  const weekKey = [
    localStart.getUTCFullYear(),
    String(localStart.getUTCMonth() + 1).padStart(2, '0'),
    String(localStart.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return { weekKey, start, end };
}

function weeklyDigestBody(posts) {
  const intro = '过去一周，大家在这些讨论里留下了最多回应。';
  return [
    intro,
    ...posts.map(
      (post, index) =>
        `${index + 1}. ${String(post.title || '未命名讨论').replaceAll('\n', ' ')}\n${post.board_name || '讨论区'} · ${Number(post.comment_count || 0)} 条评论 · ${Number(post.reaction_count || 0)} 次互动\n/discussion?post=${encodeURIComponent(post.pid || post.id)}`,
    ),
  ].join('\n\n');
}

function parseWeeklyDigestBody(body) {
  const [intro = '', ...blocks] = String(body || '').split(/\n\n+/);
  const posts = blocks
    .map((block) => {
      const [heading = '', meta = '', link = ''] = block.split('\n');
      const title = heading.replace(/^\d+\.\s*/, '').trim();
      try {
        return title ? { title, meta: meta.trim(), link: normalizeNotificationLink(link) } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { intro, posts };
}

function renderNotificationEmail(item, publicUrl) {
  const link = normalizeNotificationLink(item.link);
  const url = new URL(link || '/', publicUrl.origin).href;
  const title = escapeEmailHtml(item.title);
  const body = String(item.body || '');
  const isWeekly = item.kind === 'weekly_digest';
  const weekly = isWeekly ? parseWeeklyDigestBody(body) : null;
  const content = isWeekly
    ? `<p style="margin:0 0 22px;color:#506268;line-height:1.75">${escapeEmailHtml(weekly.intro)}</p>${weekly.posts
        .map((post) => {
          const postUrl = new URL(post.link, publicUrl.origin).href;
          return `<a href="${escapeEmailHtml(postUrl)}" style="display:block;margin:0 0 12px;padding:18px 20px;border:1px solid #dce5e7;border-radius:14px;color:#071317;text-decoration:none;background:#ffffff"><strong style="display:block;margin-bottom:7px;font-size:16px;line-height:1.45">${escapeEmailHtml(post.title)}</strong><span style="color:#6a7b80;font-size:13px">${escapeEmailHtml(post.meta)}</span></a>`;
        })
        .join('')}`
    : `<div style="padding:20px;border:1px solid #dce5e7;border-radius:14px;background:#ffffff;color:#36484e;line-height:1.75">${body
        .split('\n')
        .map((line) => escapeEmailHtml(line) || '&nbsp;')
        .join('<br>')}</div>`;
  const label = isWeekly ? '每周热帖' : '站内通知';
  const action = isWeekly ? '查看全部讨论' : '查看通知';
  const html = `<!doctype html><html><body style="margin:0;background:#edf2f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#071317"><div style="display:none;max-height:0;overflow:hidden">${title}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:36px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:auto"><tr><td style="padding:0 4px 20px"><div style="font-size:13px;font-weight:700;letter-spacing:.12em;color:#075d68">FREE-BBS · ${label}</div></td></tr><tr><td style="padding:32px;border-radius:20px;background:#f9fbfb;border:1px solid #dce5e7"><h1 style="margin:0 0 22px;font-size:26px;line-height:1.3;letter-spacing:-.02em">${title}</h1>${content}<a href="${escapeEmailHtml(url)}" style="display:inline-block;margin-top:22px;padding:12px 18px;border-radius:10px;background:#075d68;color:#fff;text-decoration:none;font-weight:700">${action} →</a></td></tr><tr><td style="padding:20px 4px;color:#7a8b90;font-size:12px;line-height:1.7">这封邮件由 FREE-BBS 自动发送。你也可以直接登录网站，在通知中心查看内容。</td></tr></table></td></tr></table></body></html>`;
  return {
    html,
    text: `${item.title}\n\n${body}\n\n${action}：${url}`,
    url,
  };
}

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
    const rendered = renderNotificationEmail(item, publicUrl);
    await transporter.sendMail({
      from: mail.from,
      to: item.email,
      subject: `FREE-BBS · ${item.title}`,
      text: rendered.text,
      html: rendered.html,
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
    if (notification.email !== false) {
      await connection.execute(
        'INSERT IGNORE INTO notification_email_outbox (notification_id) VALUES (?)',
        [result.insertId],
      );
    }
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
  let weeklyTimer = null;
  let weeklyWorking = false;

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

  async function notifyCommentReaction({ actor, post, comment, active }, connection) {
    if (!active || Number(actor.id) === Number(comment.user_id)) return 0;
    return inTransaction(pool, connection, (database) =>
      insertNotifications(database, [comment.user_id], {
        actorId: actor.id,
        kind: 'comment_like',
        title: `${actor.username || '用户'} 点赞了你的评论`.slice(0, 160),
        body: `《${post.title || '讨论'}》\n${String(comment.content_markdown || '').slice(0, 1500)}`,
        link: `/discussion?post=${encodeURIComponent(post.pid || post.id)}#comment-${comment.id}`,
        eventKey: `comment-like:${comment.id}:${actor.id}`,
      }),
    );
  }

  async function notifyReward(
    { actor, batchId, recipients, title, reason, electric, magnetic },
    connection,
  ) {
    const amounts = [electric ? `${electric} 电元` : '', magnetic ? `${magnetic} 磁元` : '']
      .filter(Boolean)
      .join(' + ');
    return inTransaction(pool, connection, (database) =>
      insertNotifications(database, recipients, {
        actorId: actor.id,
        kind: 'reward',
        title: `奖励到账：${title}`,
        body: `你获得了 ${amounts}。\n奖励原因：${reason}\n感谢你的参与和贡献！可在仓库账本查看本次奖励。`,
        link: '/inventory#wallet-ledger',
        eventKey: `admin-reward:${batchId}`,
        email: false,
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
          `SELECT o.notification_id, o.attempts, n.kind, n.title, n.body, n.link, u.email
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

  async function queueWeeklyDigest(now = new Date()) {
    const window = getWeeklyDigestWindow(now);
    if (!window || weeklyWorking) return { queued: 0, skipped: true };
    weeklyWorking = true;
    try {
      const [posts] = await pool.execute(
        `SELECT p.id, p.pid, p.title, b.name AS board_name,
                COALESCE(c.comment_count, 0) AS comment_count,
                COALESCE(l.reaction_count, 0) AS reaction_count
         FROM discussion_posts p
         INNER JOIN discussion_boards b ON b.id = p.board_id AND b.is_active = 1
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS comment_count FROM discussion_comments
           WHERE is_deleted = 0 AND created_at >= ? AND created_at < ? GROUP BY post_id
         ) c ON c.post_id = p.id
         LEFT JOIN (
           SELECT post_id, COUNT(*) AS reaction_count FROM discussion_post_likes
           WHERE created_at >= ? AND created_at < ? GROUP BY post_id
         ) l ON l.post_id = p.id
         WHERE p.is_deleted = 0 AND p.is_hidden = 0
           AND (p.created_at >= ? AND p.created_at < ?
                OR COALESCE(c.comment_count, 0) > 0 OR COALESCE(l.reaction_count, 0) > 0)
         ORDER BY (COALESCE(c.comment_count, 0) * 3 + COALESCE(l.reaction_count, 0)) DESC,
                  p.is_featured DESC, p.created_at DESC, p.id DESC
         LIMIT 5`,
        [window.start, window.end, window.start, window.end, window.start, window.end],
      );
      if (!posts.length) return { queued: 0, skipped: true };
      const [recipients] = await pool.execute(
        `SELECT id FROM users
         WHERE email IS NOT NULL AND email <> '' AND email_verified_at IS NOT NULL`,
      );
      if (!recipients.length) return { queued: 0, skipped: true };
      const body = weeklyDigestBody(posts);
      const startLabel = window.start.toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
      });
      const endLabel = new Date(window.end.getTime() - 1).toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
      });
      const queued = await inTransaction(pool, null, (connection) =>
        insertNotifications(
          connection,
          recipients.map((recipient) => recipient.id),
          {
            actorId: null,
            kind: 'weekly_digest',
            title: `上周热帖 · ${startLabel}–${endLabel}`,
            body,
            link: '/discussion?sort=hot',
            eventKey: `weekly-digest:${window.weekKey}`,
          },
        ),
      );
      return { queued, skipped: false, weekKey: window.weekKey };
    } finally {
      weeklyWorking = false;
    }
  }

  function startWeeklyDigestWorker() {
    if (!weeklyTimer) {
      const tick = () =>
        queueWeeklyDigest().catch(() => logger.error('Weekly digest scheduler unavailable'));
      weeklyTimer = setInterval(tick, 15 * 60 * 1000);
      weeklyTimer.unref?.();
      tick();
    }
    return () => {
      clearInterval(weeklyTimer);
      weeklyTimer = null;
    };
  }

  return {
    publish,
    notifyReply,
    notifyReaction,
    notifyCommentReaction,
    notifyReward,
    processOutbox,
    startWorker,
    queueWeeklyDigest,
    startWeeklyDigestWorker,
  };
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
  getWeeklyDigestWindow,
  weeklyDigestBody,
  parseWeeklyDigestBody,
  renderNotificationEmail,
};
