const crypto = require('crypto');
const express = require('express');
const { probePrimaryTsinghuaPortals } = require('./portal-boundary-probe');
const { probePublicNoticeSource } = require('./public-source-probe');
const { getLearnConnectorCapabilities } = require('./tsinghua-learn-connector');

const NOTIFICATION_CATEGORIES = new Set([
  'course',
  'organization',
  'personal',
  'system',
  'activity',
]);
const NOTIFICATION_IMPORTANCE = new Set(['normal', 'important', 'urgent']);
const IMPORTANT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const IMPORTANT_STATUSES = new Set(['draft', 'confirmed', 'completed', 'cancelled']);
const SCHEDULE_STATUSES = new Set(['draft', 'confirmed', 'cancelled']);
const SOURCE_TYPES = new Set([
  'manual',
  'notification',
  'agent',
  'info',
  'network_classroom',
  'email',
  'system',
  'import',
]);
const MAX_RANGE_DAYS = 93;
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

function generatePublicId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function normalizeText(value, maxLength, { required = false } = {}) {
  const normalized = String(value ?? '').trim();

  if ((required && !normalized) || normalized.length > maxLength) {
    return null;
  }

  return normalized;
}

function normalizeSourceType(value, fallback = 'manual') {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase();
  return SOURCE_TYPES.has(normalized) ? normalized : null;
}

function parseDateValue(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    return required ? null : undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNotification(row) {
  return {
    publicId: row.public_id,
    category: row.category,
    sourceType: row.source_type,
    title: row.title,
    body: row.body || '',
    actionUrl: row.action_url || '',
    importance: row.importance,
    deadlineAt: toIsoString(row.deadline_at),
    publishedAt: toIsoString(row.published_at),
    readAt: toIsoString(row.read_at),
    favoritedAt: toIsoString(row.favorited_at),
  };
}

function toImportantItem(row) {
  return {
    publicId: row.public_id,
    title: row.title,
    description: row.description || '',
    dueAt: toIsoString(row.due_at),
    priority: row.priority,
    status: row.status,
    sourceType: row.source_type,
    userConfirmedAt: toIsoString(row.user_confirmed_at),
    userOverriddenAt: toIsoString(row.user_overridden_at),
  };
}

function toScheduleItem(row) {
  return {
    publicId: row.public_id,
    title: row.title,
    description: row.description || '',
    startAt: toIsoString(row.start_at),
    endAt: toIsoString(row.end_at),
    allDay: Boolean(row.all_day),
    timezone: row.timezone || SHANGHAI_TIME_ZONE,
    status: row.status,
    sourceType: row.source_type,
    version: Number(row.version || 1),
    userConfirmedAt: toIsoString(row.user_confirmed_at),
    userOverriddenAt: toIsoString(row.user_overridden_at),
  };
}

function getDefaultWeekRange(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SHANGHAI_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  const shanghaiMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day) - 8 * 60 * 60 * 1000;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const start = new Date(shanghaiMidnightUtc - daysSinceMonday * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

function parseRange(query) {
  if (!query.from && !query.to) {
    return getDefaultWeekRange();
  }

  const start = parseDateValue(query.from, { required: true });
  const end = parseDateValue(query.to, { required: true });

  if (!start || !end || end <= start) {
    return null;
  }

  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return null;
  }

  return { start, end };
}

async function ensureWorkbenchTables(pool) {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      recipient_user_id BIGINT NULL,
      publisher_user_id BIGINT NULL,
      category VARCHAR(32) NOT NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_reference VARCHAR(128) NULL,
      title VARCHAR(200) NOT NULL,
      body MEDIUMTEXT NULL,
      action_url VARCHAR(512) NULL,
      importance ENUM('normal', 'important', 'urgent') NOT NULL DEFAULT 'normal',
      status ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'draft',
      deadline_at DATETIME NULL,
      published_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_notifications_recipient_user
        FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_publisher_user
        FOREIGN KEY (publisher_user_id) REFERENCES users (id) ON DELETE SET NULL,
      INDEX idx_notifications_recipient_status_published
        (recipient_user_id, status, published_at DESC),
      INDEX idx_notifications_category_status_published
        (category, status, published_at DESC),
      INDEX idx_notifications_source (source_type, source_reference),
      INDEX idx_notifications_status_deadline (status, deadline_at),
      INDEX idx_notifications_publisher (publisher_user_id),
      INDEX idx_notifications_deleted_at (deleted_at)
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS user_notification_states (
      notification_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      read_at DATETIME NULL,
      favorited_at DATETIME NULL,
      dismissed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (notification_id, user_id),
      CONSTRAINT fk_user_notification_states_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_notification_states_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      INDEX idx_user_notification_states_user_read (user_id, read_at, notification_id),
      INDEX idx_user_notification_states_user_favorite (user_id, favorited_at),
      INDEX idx_user_notification_states_user_dismissed (user_id, dismissed_at)
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS important_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      user_id BIGINT NOT NULL,
      notification_id BIGINT NULL,
      created_by_user_id BIGINT NULL,
      dedupe_key VARCHAR(128) NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_reference VARCHAR(128) NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      due_at DATETIME NULL,
      priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
      status ENUM('draft', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
      user_confirmed_at DATETIME NULL,
      user_overridden_at DATETIME NULL,
      completed_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_important_items_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_important_items_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE SET NULL,
      CONSTRAINT fk_important_items_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
      UNIQUE KEY uq_important_items_user_notification (user_id, notification_id),
      UNIQUE KEY uq_important_items_user_dedupe (user_id, dedupe_key),
      INDEX idx_important_items_user_status_due (user_id, status, due_at),
      INDEX idx_important_items_source (source_type, source_reference),
      INDEX idx_important_items_notification (notification_id),
      INDEX idx_important_items_created_by (created_by_user_id),
      INDEX idx_important_items_deleted_at (deleted_at)
    )`,
  );
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS schedule_items (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      user_id BIGINT NOT NULL,
      important_item_id BIGINT NULL,
      created_by_user_id BIGINT NULL,
      dedupe_key VARCHAR(128) NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_reference VARCHAR(128) NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      start_at DATETIME NOT NULL,
      end_at DATETIME NOT NULL,
      all_day TINYINT(1) NOT NULL DEFAULT 0,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
      status ENUM('draft', 'confirmed', 'cancelled') NOT NULL DEFAULT 'draft',
      user_confirmed_at DATETIME NULL,
      user_overridden_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      deleted_at DATETIME NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_schedule_items_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_schedule_items_important_item
        FOREIGN KEY (important_item_id) REFERENCES important_items (id) ON DELETE SET NULL,
      CONSTRAINT fk_schedule_items_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
      UNIQUE KEY uq_schedule_items_user_dedupe (user_id, dedupe_key),
      INDEX idx_schedule_items_user_status_start (user_id, status, start_at),
      INDEX idx_schedule_items_user_window (user_id, start_at, end_at),
      INDEX idx_schedule_items_source (source_type, source_reference),
      INDEX idx_schedule_items_important_item (important_item_id),
      INDEX idx_schedule_items_created_by (created_by_user_id),
      INDEX idx_schedule_items_deleted_at (deleted_at)
    )`,
  );
}

function normalizeActionUrl(value) {
  const normalized = normalizeText(value, 512);

  if (normalized === null || !normalized) {
    return normalized;
  }

  try {
    const localOrigin = 'https://free-bbs.local';
    const url = new URL(normalized, localOrigin);

    if (url.username || url.password) {
      return null;
    }
    if (url.origin === localOrigin) {
      return normalized.startsWith('/') && !normalized.startsWith('//') ? normalized : null;
    }
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function resolveNotificationStateTime(currentValue, body, field, now) {
  if (!Object.hasOwn(body, field)) {
    return currentValue || null;
  }
  return body[field] ? now : null;
}

function sendWorkbenchError(response, error, message) {
  console.error(message, error?.code || error?.name || 'unknown error');
  response.status(500).json({ message });
}

function createWorkbenchRouter({ pool, requireAuth }) {
  const router = express.Router();

  router.get('/connectors/public-notices/probe', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) {
      return;
    }

    try {
      const probe = await probePublicNoticeSource();
      response.json({ probe });
    } catch (error) {
      console.error('公开通知源验证失败', error?.code || error?.name || 'unknown error');
      response.status(502).json({
        message: error?.message || '公开通知源验证失败',
        code: error?.code || 'public_source_probe_failed',
      });
    }
  });
  router.get('/connectors/primary-portals/probe', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) {
      return;
    }

    const portals = await probePrimaryTsinghuaPortals();
    response.json({ portals });
  });
  router.get('/connectors/tsinghua-learn/capabilities', async (request, response) => {
    const user = await requireAuth(request, response);
    if (!user) {
      return;
    }

    response.json({ connector: getLearnConnectorCapabilities() });
  });

  router.get('/summary', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const range = parseRange(request.query);
      if (!range) {
        response.status(400).json({ message: '请提供有效且不超过 93 天的时间范围' });
        return;
      }

      const [importantRows] = await pool.execute(
        `SELECT public_id, title, description, due_at, priority, status, source_type,
                user_confirmed_at, user_overridden_at
         FROM important_items
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND status = 'confirmed'
           AND (due_at IS NULL OR due_at < ?)
         ORDER BY due_at IS NULL ASC, due_at ASC,
                  FIELD(priority, 'urgent', 'high', 'normal', 'low') ASC
         LIMIT 4`,
        [user.id, range.end],
      );
      const [notificationRows] = await pool.execute(
        `SELECT n.public_id, n.category, n.source_type, n.title, n.body, n.action_url,
                n.importance, n.deadline_at, n.published_at, s.read_at, s.favorited_at
         FROM notifications n
         LEFT JOIN user_notification_states s
           ON s.notification_id = n.id AND s.user_id = ?
         WHERE (n.recipient_user_id = ? OR n.recipient_user_id IS NULL)
           AND n.status = 'published'
           AND n.deleted_at IS NULL
           AND s.dismissed_at IS NULL
         ORDER BY FIELD(n.importance, 'urgent', 'important', 'normal') ASC,
                  s.read_at IS NULL DESC, n.published_at DESC
         LIMIT 4`,
        [user.id, user.id],
      );
      const [scheduleRows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND status = 'confirmed'
           AND start_at < ?
           AND end_at > ?
         ORDER BY start_at ASC, end_at ASC
         LIMIT 4`,
        [user.id, range.end, range.start],
      );

      response.json({
        importantItems: importantRows.map(toImportantItem),
        notifications: notificationRows.map(toNotification),
        scheduleItems: scheduleRows.map(toScheduleItem),
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          timeZone: SHANGHAI_TIME_ZONE,
        },
      });
    } catch (error) {
      sendWorkbenchError(response, error, '读取个人工作台失败');
    }
  });

  router.get('/notifications', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const category = String(request.query.category || '').trim();
      if (category && !NOTIFICATION_CATEGORIES.has(category)) {
        response.status(400).json({ message: '通知分类无效' });
        return;
      }

      const limit = Math.min(50, Math.max(1, Number.parseInt(request.query.limit, 10) || 20));
      const conditions = [
        '(n.recipient_user_id = ? OR n.recipient_user_id IS NULL)',
        "n.status = 'published'",
        'n.deleted_at IS NULL',
        's.dismissed_at IS NULL',
      ];
      const parameters = [user.id, user.id];

      if (category) {
        conditions.push('n.category = ?');
        parameters.push(category);
      }
      if (String(request.query.unread || '').toLowerCase() === 'true') {
        conditions.push('s.read_at IS NULL');
      }
      if (String(request.query.favorite || '').toLowerCase() === 'true') {
        conditions.push('s.favorited_at IS NOT NULL');
      }

      const [rows] = await pool.execute(
        `SELECT n.public_id, n.category, n.source_type, n.title, n.body, n.action_url,
                n.importance, n.deadline_at, n.published_at, s.read_at, s.favorited_at
         FROM notifications n
         LEFT JOIN user_notification_states s
           ON s.notification_id = n.id AND s.user_id = ?
         WHERE ${conditions.join(' AND ')}
         ORDER BY FIELD(n.importance, 'urgent', 'important', 'normal') ASC,
                  s.read_at IS NULL DESC, n.published_at DESC
         LIMIT ${limit}`,
        parameters,
      );
      response.json({ notifications: rows.map(toNotification) });
    } catch (error) {
      sendWorkbenchError(response, error, '读取通知失败');
    }
  });

  router.post('/notifications', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }
      if (!user.is_admin) {
        response.status(403).json({ message: '需要管理员权限' });
        return;
      }

      const body = request.body || {};
      const title = normalizeText(body.title, 200, { required: true });
      const content = normalizeText(body.body, 20000);
      const actionUrl = normalizeActionUrl(body.actionUrl);
      const category = String(body.category || '').trim();
      const importance = String(body.importance || 'normal').trim();
      const sourceType = normalizeSourceType(body.sourceType, 'manual');
      const sourceReference = normalizeText(body.sourceReference, 128);
      const deadlineAt = parseDateValue(body.deadlineAt);
      const publishedAt = body.publishedAt
        ? parseDateValue(body.publishedAt, { required: true })
        : new Date();
      const recipientUserId =
        body.recipientUserId === undefined || body.recipientUserId === null
          ? null
          : Number(body.recipientUserId);

      if (
        !title ||
        content === null ||
        actionUrl === null ||
        !NOTIFICATION_CATEGORIES.has(category) ||
        !NOTIFICATION_IMPORTANCE.has(importance) ||
        !sourceType ||
        sourceReference === null ||
        deadlineAt === null ||
        !publishedAt ||
        (recipientUserId !== null &&
          (!Number.isSafeInteger(recipientUserId) || recipientUserId <= 0))
      ) {
        response.status(400).json({ message: '通知字段无效' });
        return;
      }

      if (recipientUserId !== null) {
        const [recipientRows] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [
          recipientUserId,
        ]);
        if (!recipientRows[0]) {
          response.status(400).json({ message: '通知接收用户不存在' });
          return;
        }
      }

      const publicId = generatePublicId('wn');
      await pool.execute(
        `INSERT INTO notifications (
          public_id, recipient_user_id, publisher_user_id, category, source_type,
          source_reference, title, body, action_url, importance, status,
          deadline_at, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, 'published', ?, ?)`,
        [
          publicId,
          recipientUserId,
          user.id,
          category,
          sourceType,
          sourceReference || null,
          title,
          content || '',
          actionUrl || '',
          importance,
          deadlineAt || null,
          publishedAt,
        ],
      );
      const [rows] = await pool.execute(
        `SELECT public_id, category, source_type, title, body, action_url,
                importance, deadline_at, published_at
         FROM notifications WHERE public_id = ? LIMIT 1`,
        [publicId],
      );
      response.status(201).json({ notification: toNotification(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '发布通知失败');
    }
  });

  router.patch('/notifications/:publicId/state', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const publicId = normalizeText(request.params.publicId, 36, { required: true });
      const body = request.body || {};
      const fields = ['read', 'favorited', 'dismissed'];
      const suppliedFields = fields.filter((field) => Object.hasOwn(body, field));

      if (
        !publicId ||
        !suppliedFields.length ||
        suppliedFields.some((field) => typeof body[field] !== 'boolean')
      ) {
        response.status(400).json({ message: '请提供有效的通知状态' });
        return;
      }

      const [notificationRows] = await pool.execute(
        `SELECT id
         FROM notifications
         WHERE public_id = ?
           AND (recipient_user_id = ? OR recipient_user_id IS NULL)
           AND status = 'published'
           AND deleted_at IS NULL
         LIMIT 1`,
        [publicId, user.id],
      );
      const notification = notificationRows[0];
      if (!notification) {
        response.status(404).json({ message: '通知不存在' });
        return;
      }

      const [stateRows] = await pool.execute(
        `SELECT read_at, favorited_at, dismissed_at
         FROM user_notification_states
         WHERE notification_id = ? AND user_id = ?
         LIMIT 1`,
        [notification.id, user.id],
      );
      const current = stateRows[0] || {};
      const now = new Date();
      const readAt = resolveNotificationStateTime(current.read_at, body, 'read', now);
      const favoritedAt = resolveNotificationStateTime(
        current.favorited_at,
        body,
        'favorited',
        now,
      );
      const dismissedAt = resolveNotificationStateTime(
        current.dismissed_at,
        body,
        'dismissed',
        now,
      );

      await pool.execute(
        `INSERT INTO user_notification_states (
          notification_id, user_id, read_at, favorited_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          read_at = VALUES(read_at),
          favorited_at = VALUES(favorited_at),
          dismissed_at = VALUES(dismissed_at)`,
        [notification.id, user.id, readAt, favoritedAt, dismissedAt],
      );
      response.json({
        state: {
          readAt: toIsoString(readAt),
          favoritedAt: toIsoString(favoritedAt),
          dismissedAt: toIsoString(dismissedAt),
        },
      });
    } catch (error) {
      sendWorkbenchError(response, error, '更新通知状态失败');
    }
  });

  router.get('/important-items', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const includeClosed = String(request.query.includeClosed || '').toLowerCase() === 'true';
      const [rows] = await pool.execute(
        `SELECT public_id, title, description, due_at, priority, status, source_type,
                user_confirmed_at, user_overridden_at
         FROM important_items
         WHERE user_id = ?
           AND deleted_at IS NULL
           ${includeClosed ? '' : "AND status IN ('draft', 'confirmed')"}
         ORDER BY FIELD(status, 'confirmed', 'draft', 'completed', 'cancelled') ASC,
                  due_at IS NULL ASC, due_at ASC
         LIMIT 100`,
        [user.id],
      );
      response.json({ importantItems: rows.map(toImportantItem) });
    } catch (error) {
      sendWorkbenchError(response, error, '读取重要事项失败');
    }
  });

  router.post('/important-items', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const body = request.body || {};
      const title = normalizeText(body.title, 200, { required: true });
      const description = normalizeText(body.description, 4000);
      const dueAt = parseDateValue(body.dueAt);
      const priority = String(body.priority || 'normal').trim();

      if (!title || description === null || dueAt === null || !IMPORTANT_PRIORITIES.has(priority)) {
        response.status(400).json({ message: '事项字段无效' });
        return;
      }

      const publicId = generatePublicId('wi');
      await pool.execute(
        `INSERT INTO important_items (
          public_id, user_id, created_by_user_id, source_type, title, description,
          due_at, priority, status, user_confirmed_at
        ) VALUES (?, ?, ?, 'manual', ?, NULLIF(?, ''), ?, ?, 'confirmed', CURRENT_TIMESTAMP)`,
        [publicId, user.id, user.id, title, description || '', dueAt || null, priority],
      );
      const [rows] = await pool.execute(
        `SELECT public_id, title, description, due_at, priority, status, source_type,
                user_confirmed_at, user_overridden_at
         FROM important_items
         WHERE public_id = ? AND user_id = ? LIMIT 1`,
        [publicId, user.id],
      );
      response.status(201).json({ importantItem: toImportantItem(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '创建重要事项失败');
    }
  });

  router.patch('/important-items/:publicId', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const publicId = normalizeText(request.params.publicId, 36, { required: true });
      const body = request.body || {};
      const updates = [];
      const parameters = [];

      if (Object.hasOwn(body, 'title')) {
        const title = normalizeText(body.title, 200, { required: true });
        if (!title) {
          response.status(400).json({ message: '事项标题无效' });
          return;
        }
        updates.push('title = ?');
        parameters.push(title);
      }
      if (Object.hasOwn(body, 'description')) {
        const description = normalizeText(body.description, 4000);
        if (description === null) {
          response.status(400).json({ message: '事项说明无效' });
          return;
        }
        updates.push("description = NULLIF(?, '')");
        parameters.push(description);
      }
      if (Object.hasOwn(body, 'dueAt')) {
        const dueAt = body.dueAt ? parseDateValue(body.dueAt, { required: true }) : null;
        if (body.dueAt && !dueAt) {
          response.status(400).json({ message: '截止时间无效' });
          return;
        }
        updates.push('due_at = ?');
        parameters.push(dueAt);
      }
      if (Object.hasOwn(body, 'priority')) {
        const priority = String(body.priority || '').trim();
        if (!IMPORTANT_PRIORITIES.has(priority)) {
          response.status(400).json({ message: '事项优先级无效' });
          return;
        }
        updates.push('priority = ?');
        parameters.push(priority);
      }
      if (Object.hasOwn(body, 'status')) {
        const status = String(body.status || '').trim();
        if (!IMPORTANT_STATUSES.has(status)) {
          response.status(400).json({ message: '事项状态无效' });
          return;
        }
        updates.push('status = ?');
        parameters.push(status);
        if (status === 'confirmed') {
          updates.push(
            'user_confirmed_at = CURRENT_TIMESTAMP',
            'completed_at = NULL',
            'cancelled_at = NULL',
          );
        }
        if (status === 'draft') {
          updates.push('completed_at = NULL', 'cancelled_at = NULL');
        }
        if (status === 'completed') {
          updates.push('completed_at = CURRENT_TIMESTAMP', 'cancelled_at = NULL');
        }
        if (status === 'cancelled') {
          updates.push('cancelled_at = CURRENT_TIMESTAMP');
        }
      }

      if (!publicId || !updates.length) {
        response.status(400).json({ message: '没有可更新的事项字段' });
        return;
      }

      updates.push('user_overridden_at = CURRENT_TIMESTAMP');
      parameters.push(publicId, user.id);
      const [result] = await pool.execute(
        `UPDATE important_items
         SET ${updates.join(', ')}
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
        parameters,
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '事项不存在' });
        return;
      }

      const [rows] = await pool.execute(
        `SELECT public_id, title, description, due_at, priority, status, source_type,
                user_confirmed_at, user_overridden_at
         FROM important_items
         WHERE public_id = ? AND user_id = ? LIMIT 1`,
        [publicId, user.id],
      );
      response.json({ importantItem: toImportantItem(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '更新重要事项失败');
    }
  });

  router.delete('/important-items/:publicId', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const [result] = await pool.execute(
        `UPDATE important_items
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
             deleted_at = CURRENT_TIMESTAMP,
             user_overridden_at = CURRENT_TIMESTAMP
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
        [request.params.publicId, user.id],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '事项不存在' });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      sendWorkbenchError(response, error, '删除重要事项失败');
    }
  });

  router.get('/schedule-items', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const range = parseRange(request.query);
      const status = String(request.query.status || '').trim();
      if (!range || (status && !SCHEDULE_STATUSES.has(status))) {
        response.status(400).json({ message: '日程筛选条件无效' });
        return;
      }

      const parameters = [user.id, range.end, range.start];
      const statusCondition = status ? 'AND status = ?' : "AND status IN ('draft', 'confirmed')";
      if (status) {
        parameters.push(status);
      }

      const [rows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND start_at < ?
           AND end_at > ?
           ${statusCondition}
         ORDER BY start_at ASC, end_at ASC
         LIMIT 200`,
        parameters,
      );
      response.json({
        scheduleItems: rows.map(toScheduleItem),
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          timeZone: SHANGHAI_TIME_ZONE,
        },
      });
    } catch (error) {
      sendWorkbenchError(response, error, '读取日程失败');
    }
  });

  router.get('/schedule-items/conflicts', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const startAt = parseDateValue(request.query.startAt, { required: true });
      const endAt = parseDateValue(request.query.endAt, { required: true });
      const excludePublicId = normalizeText(request.query.excludePublicId, 36);

      if (!startAt || !endAt || endAt <= startAt || excludePublicId === null) {
        response.status(400).json({ message: '请提供有效的日程时间范围' });
        return;
      }

      const parameters = [user.id, endAt, startAt];
      const excludeCondition = excludePublicId ? 'AND public_id <> ?' : '';
      if (excludePublicId) {
        parameters.push(excludePublicId);
      }

      const [rows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND status = 'confirmed'
           AND start_at < ?
           AND end_at > ?
           ${excludeCondition}
         ORDER BY start_at ASC`,
        parameters,
      );
      response.json({ conflicts: rows.map(toScheduleItem) });
    } catch (error) {
      sendWorkbenchError(response, error, '检查日程冲突失败');
    }
  });

  router.post('/schedule-items', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const body = request.body || {};
      const title = normalizeText(body.title, 200, { required: true });
      const description = normalizeText(body.description, 4000);
      const startAt = parseDateValue(body.startAt, { required: true });
      const endAt = parseDateValue(body.endAt, { required: true });
      const timezone = normalizeText(body.timezone || SHANGHAI_TIME_ZONE, 64, {
        required: true,
      });

      if (
        !title ||
        description === null ||
        !startAt ||
        !endAt ||
        endAt <= startAt ||
        !timezone ||
        !isValidTimeZone(timezone) ||
        (Object.hasOwn(body, 'allDay') && typeof body.allDay !== 'boolean')
      ) {
        response.status(400).json({ message: '日程字段或时间范围无效' });
        return;
      }

      const publicId = generatePublicId('ws');
      await pool.execute(
        `INSERT INTO schedule_items (
          public_id, user_id, created_by_user_id, source_type, title, description,
          start_at, end_at, all_day, timezone, status, user_confirmed_at
        ) VALUES (
          ?, ?, ?, 'manual', ?, NULLIF(?, ''), ?, ?, ?, ?, 'confirmed', CURRENT_TIMESTAMP
        )`,
        [
          publicId,
          user.id,
          user.id,
          title,
          description || '',
          startAt,
          endAt,
          body.allDay ? 1 : 0,
          timezone,
        ],
      );
      const [rows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE public_id = ? AND user_id = ? LIMIT 1`,
        [publicId, user.id],
      );
      response.status(201).json({ scheduleItem: toScheduleItem(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '创建日程失败');
    }
  });

  router.patch('/schedule-items/:publicId', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const publicId = normalizeText(request.params.publicId, 36, { required: true });
      if (!publicId) {
        response.status(400).json({ message: '日程标识无效' });
        return;
      }

      const [existingRows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [publicId, user.id],
      );
      const existing = existingRows[0];
      if (!existing) {
        response.status(404).json({ message: '日程不存在' });
        return;
      }

      const body = request.body || {};
      const updates = [];
      const parameters = [];
      let nextStartAt =
        existing.start_at instanceof Date ? existing.start_at : new Date(existing.start_at);
      let nextEndAt = existing.end_at instanceof Date ? existing.end_at : new Date(existing.end_at);

      if (Object.hasOwn(body, 'title')) {
        const title = normalizeText(body.title, 200, { required: true });
        if (!title) {
          response.status(400).json({ message: '日程标题无效' });
          return;
        }
        updates.push('title = ?');
        parameters.push(title);
      }
      if (Object.hasOwn(body, 'description')) {
        const description = normalizeText(body.description, 4000);
        if (description === null) {
          response.status(400).json({ message: '日程说明无效' });
          return;
        }
        updates.push("description = NULLIF(?, '')");
        parameters.push(description);
      }
      if (Object.hasOwn(body, 'startAt')) {
        nextStartAt = parseDateValue(body.startAt, { required: true });
        if (!nextStartAt) {
          response.status(400).json({ message: '开始时间无效' });
          return;
        }
        updates.push('start_at = ?');
        parameters.push(nextStartAt);
      }
      if (Object.hasOwn(body, 'endAt')) {
        nextEndAt = parseDateValue(body.endAt, { required: true });
        if (!nextEndAt) {
          response.status(400).json({ message: '结束时间无效' });
          return;
        }
        updates.push('end_at = ?');
        parameters.push(nextEndAt);
      }
      if (nextEndAt <= nextStartAt) {
        response.status(400).json({ message: '结束时间必须晚于开始时间' });
        return;
      }
      if (Object.hasOwn(body, 'allDay')) {
        if (typeof body.allDay !== 'boolean') {
          response.status(400).json({ message: '全天标记无效' });
          return;
        }
        updates.push('all_day = ?');
        parameters.push(body.allDay ? 1 : 0);
      }
      if (Object.hasOwn(body, 'timezone')) {
        const timezone = normalizeText(body.timezone, 64, { required: true });
        if (!timezone || !isValidTimeZone(timezone)) {
          response.status(400).json({ message: '时区无效' });
          return;
        }
        updates.push('timezone = ?');
        parameters.push(timezone);
      }
      if (Object.hasOwn(body, 'status')) {
        const status = String(body.status || '').trim();
        if (!SCHEDULE_STATUSES.has(status)) {
          response.status(400).json({ message: '日程状态无效' });
          return;
        }
        updates.push('status = ?');
        parameters.push(status);
        if (status === 'confirmed') {
          updates.push('user_confirmed_at = CURRENT_TIMESTAMP', 'cancelled_at = NULL');
        }
        if (status === 'draft') {
          updates.push('cancelled_at = NULL');
        }
        if (status === 'cancelled') {
          updates.push('cancelled_at = CURRENT_TIMESTAMP');
        }
      }

      if (!updates.length) {
        response.status(400).json({ message: '没有可更新的日程字段' });
        return;
      }

      updates.push('user_overridden_at = CURRENT_TIMESTAMP', 'version = version + 1');
      parameters.push(publicId, user.id);
      let versionCondition = '';
      if (Object.hasOwn(body, 'version')) {
        const version = Number(body.version);
        if (!Number.isSafeInteger(version) || version < 1) {
          response.status(400).json({ message: '日程版本号无效' });
          return;
        }
        versionCondition = 'AND version = ?';
        parameters.push(version);
      }

      const [result] = await pool.execute(
        `UPDATE schedule_items
         SET ${updates.join(', ')}
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL
         ${versionCondition}`,
        parameters,
      );
      if (!result.affectedRows) {
        response.status(Object.hasOwn(body, 'version') ? 409 : 404).json({
          message: Object.hasOwn(body, 'version') ? '日程已被更新，请刷新后重试' : '日程不存在',
        });
        return;
      }

      const [rows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE public_id = ? AND user_id = ? LIMIT 1`,
        [publicId, user.id],
      );
      response.json({ scheduleItem: toScheduleItem(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '更新日程失败');
    }
  });

  router.post('/schedule-items/:publicId/confirm', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const [result] = await pool.execute(
        `UPDATE schedule_items
         SET status = 'confirmed',
             user_confirmed_at = CURRENT_TIMESTAMP,
             version = version + 1
         WHERE public_id = ?
           AND user_id = ?
           AND deleted_at IS NULL
           AND status = 'draft'`,
        [request.params.publicId, user.id],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '待确认的日程草稿不存在' });
        return;
      }

      const [rows] = await pool.execute(
        `SELECT public_id, title, description, start_at, end_at, all_day, timezone,
                status, source_type, version, user_confirmed_at, user_overridden_at
         FROM schedule_items
         WHERE public_id = ? AND user_id = ? LIMIT 1`,
        [request.params.publicId, user.id],
      );
      response.json({ scheduleItem: toScheduleItem(rows[0]) });
    } catch (error) {
      sendWorkbenchError(response, error, '确认日程草稿失败');
    }
  });

  router.delete('/schedule-items/:publicId', async (request, response) => {
    try {
      const user = await requireAuth(request, response);
      if (!user) {
        return;
      }

      const [result] = await pool.execute(
        `UPDATE schedule_items
         SET status = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
             deleted_at = CURRENT_TIMESTAMP,
             user_overridden_at = CURRENT_TIMESTAMP,
             version = version + 1
         WHERE public_id = ? AND user_id = ? AND deleted_at IS NULL`,
        [request.params.publicId, user.id],
      );
      if (!result.affectedRows) {
        response.status(404).json({ message: '日程不存在' });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      sendWorkbenchError(response, error, '删除日程失败');
    }
  });

  return router;
}

module.exports = {
  createWorkbenchRouter,
  ensureWorkbenchTables,
  generatePublicId,
  getDefaultWeekRange,
  normalizeText,
  parseDateValue,
  parseRange,
  toImportantItem,
  toNotification,
  toScheduleItem,
};
