const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { canReadPost } = require('./discussion-visibility');
const { withSubmissionNotice } = require('./moderation-production');
const { buildPrivacyPreview, normalizePrivacyText } = require('./moderation-privacy');
const { sendModerationNotice, notifyAuthor } = require('./moderation-notifications');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const FILE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
const schemaPromises = new WeakMap();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function positiveId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)))
    throw fail('用户或内容编号无效。');
  if (!Number.isSafeInteger(Number(value))) throw fail('用户或内容编号无效。');
  return Number(value);
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('审核记录不存在。', 404);
  return value;
}

function requestKey(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw fail('请求编号无效。');
  return value;
}

function canonicalJson(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw fail('送审内容必须是有效的 JSON。');
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function normalizeSubmission({
  kind,
  authorId: rawAuthorId,
  payload,
  attachmentIds = [],
  requestId: rawRequestId,
}) {
  if (!['post', 'comment'].includes(kind)) throw fail('不支持的送审内容。');
  const authorId = positiveId(rawAuthorId);
  const requestId = requestKey(rawRequestId);
  if (!payload || Object.getPrototypeOf(payload) !== Object.prototype) throw fail('送审内容无效。');
  const payloadJson = canonicalJson(payload);
  if (Buffer.byteLength(payloadJson, 'utf8') > 128 * 1024) throw fail('送审内容过长。', 413);
  if (typeof payload.content !== 'string' || !payload.content.trim()) throw fail('内容不能为空。');
  if (kind === 'post') {
    positiveId(payload.boardId);
    if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 120)
      throw fail('帖子标题无效。');
    if (typeof payload.anonymous !== 'boolean' || typeof payload.loginRequired !== 'boolean')
      throw fail('帖子选项无效。');
  } else {
    positiveId(payload.postId);
    if (payload.parentCommentId != null) positiveId(payload.parentCommentId);
  }
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 12) throw fail('附件数量无效。');
  const ids = [...new Set(attachmentIds.map(uuid))].sort();
  // The attachment module validates every Markdown image destination, including reference syntax.
  const { validateModerationMarkdown } = require('./moderation-attachments');
  const referenced = [...new Set(validateModerationMarkdown(payload.content))].sort();
  if (canonicalJson(ids) !== canonicalJson(referenced)) throw fail('图片附件与正文不匹配。');
  return {
    kind,
    authorId,
    payload: JSON.parse(payloadJson),
    payloadJson,
    attachmentIds: ids,
    requestId,
    contentHash: fingerprint({ kind, payload: JSON.parse(payloadJson), attachmentIds: ids }),
  };
}

async function transaction(pool, callback) {
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

function ensureSchema(pool) {
  if (!schemaPromises.has(pool)) {
    const pending = (async () => {
      const sql = await fs.readFile(
        path.join(__dirname, '../database/migrations/067_discussion_moderation.sql'),
        'utf8',
      );
      for (const statement of sql
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean))
        await pool.execute(statement);
      await transaction(pool, async (connection) => {
        const [seed] = await connection.execute(
          "INSERT IGNORE INTO moderation_meta (setting_key, setting_value) VALUES ('reviewers_seeded', '1')",
        );
        if (seed.affectedRows) {
          await connection.execute(
            `INSERT INTO moderation_reviewers (user_id, active)
             SELECT id, 1 FROM users WHERE is_admin = 1
             ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
          );
        }
      });
    })().catch((error) => {
      schemaPromises.delete(pool);
      throw error;
    });
    schemaPromises.set(pool, pending);
  }
  return schemaPromises.get(pool);
}

function summary(row) {
  const payload = parseJson(row.payload_json, {});
  const expired = Boolean(Number(row.evidence_expired));
  return {
    id: row.id,
    kind: row.kind,
    title: expired ? '审核内容已到期' : payload.title || '评论',
    status: expired && row.status === 'pending' ? 'expired' : row.status,
    evidenceExpired: expired,
    withdrawn: row.status === 'rejected' && row.published_id != null,
    version: Number(row.version),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    author: {
      id: row.author_id == null ? null : String(row.author_id),
      username: row.username || '',
    },
    reason: expired ? '' : row.decision_reason || '',
    publishedId: row.published_id == null ? null : String(row.published_id),
    publishedUrl: row.published_url || '',
  };
}

function privateSubmission(row) {
  const value = summary(row);
  return {
    ...value,
    authorId: Number(row.author_id),
    payload: Number(row.evidence_expired) ? null : parseJson(row.payload_json),
    attachmentIds: Number(row.evidence_expired) ? [] : parseJson(row.attachment_ids_json, []),
    contentHash: row.content_hash,
    decidedBy: row.decided_by == null ? null : String(row.decided_by),
    decidedAt: row.decided_at,
  };
}

function attachmentMetadata(row, access = 'private') {
  return {
    id: row.id,
    authorId: Number(row.author_id),
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    submissionId: row.submission_id,
    publishedId: row.published_id == null ? null : String(row.published_id),
    expiresAt: row.expires_at,
    purgedAt: row.purged_at,
    access,
  };
}

function createDiscussionModeration({
  pool,
  withDatabaseTransaction,
  notifications,
  privateDir,
  publishSubmission,
  onPublished,
  automation,
  requiredNoticeVersion = null,
  logger = console,
}) {
  const transact = withDatabaseTransaction || ((callback) => transaction(pool, callback));
  const root = privateDir ? path.resolve(privateDir) : null;
  let orphanCursor = '';

  async function retryTransaction(callback) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await transact(callback);
      } catch (error) {
        if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code) || attempt === 2)
          throw error;
        await new Promise((resolve) => {
          setTimeout(resolve, 10 * (attempt + 1));
        });
      }
    }
    throw new Error('Transaction retry exhausted');
  }

  async function requireReviewer(executor, rawUserId, lock = false) {
    const userId = positiveId(rawUserId);
    const [rows] = await executor.execute(
      `SELECT user_id FROM moderation_reviewers WHERE user_id = ? AND active = 1${lock ? ' FOR SHARE' : ''}`,
      [userId],
    );
    if (!rows.length) throw fail('需要审核负责人权限。', 403);
  }

  async function requireAdministrator(executor, rawUserId, lock = false) {
    const userId = positiveId(rawUserId);
    const [rows] = await executor.execute(
      `SELECT id FROM users WHERE id = ? AND is_admin = 1${lock ? ' FOR UPDATE' : ''}`,
      [userId],
    );
    if (!rows.length) throw fail('需要管理员权限。', 403);
  }

  async function notifyReviewers(connection, recipients, id) {
    return sendModerationNotice(connection, notifications, {
      submissionId: id,
      status: 'pending',
      recipients,
      title: '有新的讨论内容待审核',
      body: '请打开审核工作台查看并处理。',
      link: `/moderation?id=${encodeURIComponent(id)}`,
      eventKey: `moderation:${id}:pending`,
    });
  }

  async function readRow(executor, id, lock = false) {
    const [rows] = await executor.execute(
      lock
        ? `SELECT s.*, (s.expires_at <= NOW(3)) AS evidence_expired
       FROM moderation_submissions s WHERE s.id = ? FOR UPDATE`
        : `SELECT s.*, u.username, (s.expires_at <= NOW(3)) AS evidence_expired
       FROM moderation_submissions s LEFT JOIN users u ON u.id = s.author_id
       WHERE s.id = ?`,
      [uuid(id)],
    );
    if (!rows[0]) throw fail('审核记录不存在。', 404);
    return rows[0];
  }

  async function submit(connection, input) {
    const value = normalizeSubmission(withSubmissionNotice(input, requiredNoticeVersion));
    const id = crypto.randomUUID();
    const [inserted] = await connection.execute(
      `INSERT INTO moderation_submissions
       (id, kind, author_id, request_id, payload_json, attachment_ids_json, content_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 30 DAY))
       ON DUPLICATE KEY UPDATE id = id`,
      [
        id,
        value.kind,
        value.authorId,
        value.requestId,
        value.payloadJson,
        JSON.stringify(value.attachmentIds),
        value.contentHash,
      ],
    );
    const [rows] = await connection.execute(
      `SELECT s.*, (s.expires_at <= NOW(3)) AS evidence_expired
       FROM moderation_submissions s
       WHERE s.author_id = ? AND s.request_id = ? FOR UPDATE`,
      [value.authorId, value.requestId],
    );
    const row = rows[0];
    if (!row || row.content_hash !== value.contentHash)
      throw fail('相同请求编号对应不同内容。', 409);
    if (row.id !== id) return { ...privateSubmission(row), replayed: true };
    // The INSERT serializes simultaneous retries before any attachment can be bound.
    if (!inserted.affectedRows) throw fail('无法创建审核记录。', 409);
    for (const attachmentId of value.attachmentIds) {
      const [attachments] = await connection.execute(
        `SELECT *, (expires_at <= NOW(3)) AS expired FROM moderation_attachments WHERE id = ? FOR UPDATE`,
        [attachmentId],
      );
      const attachment = attachments[0];
      if (
        !attachment ||
        Number(attachment.author_id) !== value.authorId ||
        attachment.submission_id ||
        attachment.published_id ||
        attachment.purged_at ||
        Number(attachment.expired)
      )
        throw fail('附件不存在、已使用或已过期。', 409);
      await connection.execute(
        `UPDATE moderation_attachments SET submission_id = ?, bound_content_hash = ?, expires_at = ? WHERE id = ?`,
        [id, value.contentHash, row.expires_at, attachmentId],
      );
    }
    // Enqueue in the submission transaction so a crash cannot lose a new job.
    // Existing submissions and idempotent replays are never backfilled.
    const queued = automation && (await automation.enqueue(connection, privateSubmission(row)));
    const [reviewers] = await connection.execute(
      'SELECT user_id FROM moderation_reviewers WHERE active = 1 ORDER BY user_id',
    );
    if (!queued) {
      await notifyReviewers(
        connection,
        reviewers.map((reviewer) => reviewer.user_id),
        id,
      );
      await notifyAuthor(connection, notifications, {
        id,
        authorId: row.author_id,
        status: 'pending',
      });
    }
    return {
      ...privateSubmission(row),
      replayed: false,
      reviewerCount: reviewers.length,
      processing: queued ? 'automatic' : 'review',
    };
  }

  async function decide({
    id,
    reviewerId: rawReviewerId,
    decision,
    reason: rawReason = '',
    requestId: rawRequestId,
    expectedVersion,
  }) {
    uuid(id);
    const reviewerId = positiveId(rawReviewerId);
    const requestId = requestKey(rawRequestId);
    if (!['approved', 'rejected'].includes(decision)) throw fail('审核决定无效。');
    if (typeof rawReason !== 'string' || rawReason.length > 1000) throw fail('审核说明过长。');
    const reason = rawReason.trim();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw fail('审核版本无效。');
    if (decision === 'rejected' && !reason) throw fail('请填写不通过的原因。');
    const decisionHash = fingerprint({ id, decision, reason, expectedVersion });
    const outcome = await retryTransaction(async (connection) => {
      // A concurrent removal needs an exclusive lock on this row and cannot invalidate an in-flight decision.
      await requireReviewer(connection, reviewerId, true);
      const row = await readRow(connection, id, true);
      if (row.decision_request_id === requestId && Number(row.decided_by) === reviewerId) {
        if (row.decision_hash !== decisionHash) throw fail('相同请求编号对应不同决定。', 409);
        return { ...privateSubmission(row), replayed: true };
      }
      if (row.status !== 'pending' || Number(row.version) !== expectedVersion)
        throw fail('记录已处理或版本已变化，请刷新后重试。', 409);
      if (Number(row.evidence_expired) || row.evidence_purged_at || !row.payload_json)
        throw fail('审核证据已过期，请让作者重新提交。', 409);
      const submission = privateSubmission(row);
      const [attachments] = await connection.execute(
        'SELECT * FROM moderation_attachments WHERE submission_id = ? ORDER BY id FOR UPDATE',
        [id],
      );
      if (
        attachments.length !== submission.attachmentIds.length ||
        attachments.some(
          (attachment) =>
            attachment.bound_content_hash !== row.content_hash ||
            attachment.purged_at ||
            Number(attachment.author_id) !== Number(row.author_id),
        )
      )
        throw fail('审核附件状态已变化。', 409);
      let published = {};
      if (decision === 'approved') {
        if (typeof publishSubmission !== 'function') throw fail('发布服务暂不可用。', 503);
        published = await publishSubmission(connection, submission);
        positiveId(published?.publishedId);
        if (
          published.publishedUrl &&
          (typeof published.publishedUrl !== 'string' ||
            !/^\/(?!\/)[^\r\n\\]*$/.test(published.publishedUrl) ||
            published.publishedUrl.length > 512)
        )
          throw fail('发布结果无效。', 500);
      }
      const [updated] = await connection.execute(
        `UPDATE moderation_submissions SET status = ?, version = version + 1, decided_by = ?,
         decided_at = NOW(3), decision_reason = ?, decision_request_id = ?, decision_hash = ?,
         published_id = ?, published_url = ? WHERE id = ? AND status = 'pending' AND version = ?
         AND expires_at > NOW(3)`,
        [
          decision,
          reviewerId,
          reason,
          requestId,
          decisionHash,
          published.publishedId || null,
          published.publishedUrl || null,
          id,
          expectedVersion,
        ],
      );
      if (!updated.affectedRows) throw fail('审核记录已过期或状态已变化，请刷新后重试。', 409);
      if (decision === 'approved') {
        await connection.execute(
          'UPDATE moderation_attachments SET published_id = ? WHERE submission_id = ?',
          [published.publishedId, id],
        );
      }
      await notifyAuthor(connection, notifications, {
        id,
        authorId: row.author_id,
        status: decision,
        publishedUrl: published.publishedUrl,
      });
      return { ...privateSubmission(await readRow(connection, id)), replayed: false };
    }).catch((error) => {
      if (error.code === 'ER_DUP_ENTRY') throw fail('请求编号已用于其他审核决定。', 409);
      throw error;
    });
    if (!outcome.replayed && outcome.status === 'approved' && onPublished) {
      // Publication already committed. A follow-up failure must not report an uncommitted decision.
      Promise.resolve()
        .then(() => onPublished(outcome))
        .catch(() => logger.error('Moderation follow-up failed'));
    }
    return outcome;
  }

  async function previewPrivacy({ id, reviewerId, expectedVersion, extraTerms = [] }) {
    let directoryLimitExceeded = false;
    try {
      uuid(id);
      positiveId(reviewerId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw fail('审核版本无效。');
      if (
        !Array.isArray(extraTerms) ||
        extraTerms.length > 50 ||
        extraTerms.some(
          (term) =>
            typeof term !== 'string' ||
            term.length > 1024 ||
            !normalizePrivacyText(term).trim() ||
            normalizePrivacyText(term).length > 128,
        )
      )
        throw fail('补充脱敏词格式无效。');

      // Keep the authority and immutable snapshot locked while the bounded local
      // preview is built. No provider, filesystem or settings access belongs here.
      return await transact(async (connection) => {
        await requireReviewer(connection, reviewerId, true);
        const row = await readRow(connection, id, true);
        const assertCurrent = (current) => {
          if (
            current.status !== 'pending' ||
            Number(current.version) !== expectedVersion ||
            Number(current.evidence_expired) ||
            current.evidence_purged_at ||
            !current.payload_json
          )
            throw fail('审核记录已处理、到期或版本已变化，请刷新后重试。', 409);
        };
        assertCurrent(row);
        const payload = parseJson(row.payload_json);
        if (
          !payload ||
          typeof payload.content !== 'string' ||
          (payload.title !== undefined && typeof payload.title !== 'string')
        )
          throw fail('审核记录暂不可用。', 503);
        const title = payload.title || '';
        const content = payload.content;
        const normalized = normalizePrivacyText(`${title}\n${content}`);
        // Fetch only directory entries mentioned in this server-owned snapshot.
        // This is a bounded candidate lookup, not a complete name recognizer.
        const [rows] = await connection.execute(
          `SELECT full_name, student_id, email FROM users
           WHERE (CHAR_LENGTH(TRIM(full_name)) > 0 AND LOCATE(full_name, ?) > 0)
              OR (CHAR_LENGTH(TRIM(student_id)) > 0 AND LOCATE(student_id, ?) > 0)
              OR (CHAR_LENGTH(TRIM(email)) > 0 AND LOCATE(email, ?) > 0)
           LIMIT 501`,
          [normalized, normalized, normalized],
        );
        if (rows.length > 500) {
          directoryLimitExceeded = true;
          throw fail('目录命中数量过多，本次无法完成本地检查。', 409);
        }
        const attachmentIds = parseJson(row.attachment_ids_json, []);
        if (!Array.isArray(attachmentIds)) throw fail('审核记录暂不可用。', 503);
        const result = buildPrivacyPreview({
          title,
          content,
          identities: rows.map((identity) => ({
            full_name: identity.full_name,
            student_id: identity.student_id,
            email: identity.email,
          })),
          extraTerms,
          attachmentCount: attachmentIds.length,
        });
        // NOW(3) is evaluated again: crossing the evidence deadline while doing
        // local work must not return a usable preview after expiry.
        assertCurrent(await readRow(connection, id, true));
        return {
          submissionId: row.id,
          version: Number(row.version),
          contentHash: row.content_hash,
          ...result,
        };
      });
    } catch (error) {
      const messages = {
        400: '本地脱敏预览参数无效，请检查版本和补充脱敏词。',
        403: '需要审核负责人权限。',
        404: '审核记录不存在。',
        409: directoryLimitExceeded
          ? '目录命中数量过多，本次无法完成本地检查。'
          : '审核记录已处理、到期或版本已变化，请刷新后重试。',
        413: '审核内容过长，无法生成本地脱敏预览。',
      };
      // Never reflect a database error, raw directory value or submitted text.
      const status = Object.prototype.hasOwnProperty.call(messages, error.status)
        ? error.status
        : 503;
      throw fail(messages[status] || '本地脱敏预览暂不可用，请稍后重试。', status);
    }
  }

  async function aiTestSnapshot({ id, reviewerId, expectedVersion }) {
    try {
      uuid(id);
      positiveId(reviewerId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        throw fail('审核版本无效。');
      return await transact(async (connection) => {
        await requireReviewer(connection, reviewerId, true);
        const row = await readRow(connection, id, true);
        if (
          row.status !== 'pending' ||
          Number(row.version) !== expectedVersion ||
          Number(row.evidence_expired) ||
          row.evidence_purged_at ||
          !row.payload_json
        )
          throw fail('提交已处理、到期或版本已变化，请刷新后重试。', 409);
        const payload = parseJson(row.payload_json);
        const attachments = parseJson(row.attachment_ids_json, []);
        if (
          !payload ||
          typeof payload.content !== 'string' ||
          (payload.title !== undefined && typeof payload.title !== 'string') ||
          !Array.isArray(attachments)
        )
          throw fail('稿件数据暂不可用。', 503);
        return {
          submissionId: row.id,
          version: Number(row.version),
          contentHash: row.content_hash,
          title: payload.title || '',
          content: payload.content,
          imageCount: attachments.length,
        };
      });
    } catch (error) {
      const messages = {
        400: '试审参数无效。',
        403: '需要审核负责人权限。',
        404: '审核记录不存在。',
        409: '提交已处理、到期或版本已变化，请刷新后重试。',
      };
      const status = Object.hasOwn(messages, error.status) ? error.status : 503;
      throw fail(messages[status] || '稿件暂不可用，请稍后重试。', status);
    }
  }

  async function listRows({ authorId, status, before, limit: requestedLimit }) {
    const limit = Math.min(
      100,
      Math.max(1, Number.isSafeInteger(Number(requestedLimit)) ? Number(requestedLimit) : 30),
    );
    const clauses = [];
    const args = [];
    if (authorId != null) {
      clauses.push('s.author_id = ?');
      args.push(positiveId(authorId));
    }
    if (status) {
      if (!['pending', 'approved', 'rejected', 'expired'].includes(status))
        throw fail('审核状态无效。');
      if (status === 'expired') {
        clauses.push("(s.status = 'expired' OR (s.status = 'pending' AND s.expires_at <= NOW(3)))");
      } else if (status === 'pending') {
        clauses.push("s.status = 'pending' AND s.expires_at > NOW(3)");
      } else {
        clauses.push('s.status = ?');
        args.push(status);
      }
    }
    if (before) {
      if (typeof before !== 'string' || before.length > 512) throw fail('分页参数无效。');
      const decoded = Buffer.from(String(before), 'base64url').toString('utf8');
      let cursor;
      try {
        cursor = JSON.parse(decoded);
      } catch {
        throw fail('分页参数无效。');
      }
      if (
        !cursor ||
        typeof cursor.time !== 'string' ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(cursor.time)
      )
        throw fail('分页参数无效。');
      uuid(cursor.id);
      clauses.push('(s.created_at < ? OR (s.created_at = ? AND s.id < ?))');
      args.push(cursor.time, cursor.time, cursor.id);
    }
    const [rows] = await pool.execute(
      `SELECT s.*, u.username, (s.expires_at <= NOW(3)) AS evidence_expired,
       DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursor_time
       FROM moderation_submissions s LEFT JOIN users u ON u.id = s.author_id
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY s.created_at DESC, s.id DESC LIMIT ${limit + 1}`,
      args,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      submissions: page.map(summary),
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                time: last.cursor_time.slice(0, 23),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }

  async function list({ reviewerId, status = 'pending', before = null, limit = 30 }) {
    await requireReviewer(pool, reviewerId);
    return listRows({ status, before, limit });
  }

  async function isReviewer(userId) {
    if (userId == null) return false;
    try {
      await requireReviewer(pool, userId);
      return true;
    } catch (error) {
      if (error.status === 403) return false;
      throw error;
    }
  }

  async function mine({ authorId, before = null, limit = 30 }) {
    return listRows({ authorId: positiveId(authorId), before, limit });
  }

  async function detail({ id, userId: rawUserId }) {
    const userId = positiveId(rawUserId);
    const row = await readRow(pool, id);
    if (Number(row.author_id) !== userId) await requireReviewer(pool, userId);
    const value = privateSubmission(row);
    value.attachments = value.attachmentIds.map((attachmentId) => ({
      id: attachmentId,
      url: `/api/moderation/attachments/${attachmentId}`,
      mimeType: 'image/webp',
    }));
    return value;
  }

  async function reviewerRows(executor) {
    const [rows] = await executor.execute(
      `SELECT u.id, u.username FROM moderation_reviewers r JOIN users u ON u.id = r.user_id
       WHERE r.active = 1 ORDER BY u.id`,
    );
    return rows.map((row) => ({ id: String(row.id), username: row.username }));
  }

  async function listReviewers({ actorId }) {
    await requireAdministrator(pool, actorId);
    return reviewerRows(pool);
  }

  async function setReviewer({ actorId, userId: rawUserId, active }) {
    const userId = positiveId(rawUserId);
    if (typeof active !== 'boolean') throw fail('负责人状态无效。');
    return retryTransaction(async (connection) => {
      await requireAdministrator(connection, actorId, true);
      const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR SHARE', [
        userId,
      ]);
      if (!users.length) throw fail('用户不存在。', 404);
      await connection.execute(
        `INSERT INTO moderation_reviewers (user_id, active, changed_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE active = VALUES(active), changed_by = VALUES(changed_by), updated_at = NOW()`,
        [userId, active ? 1 : 0, positiveId(actorId)],
      );
      const reviewers = await reviewerRows(connection);
      return { reviewers, activeCount: reviewers.length };
    });
  }

  async function searchReviewerCandidates({
    actorId,
    q: rawQuery = '',
    limit: requestedLimit = 20,
  }) {
    await requireAdministrator(pool, actorId);
    const limit = Math.min(
      50,
      Math.max(1, Number.isSafeInteger(Number(requestedLimit)) ? Number(requestedLimit) : 20),
    );
    const q = String(rawQuery).trim().slice(0, 64);
    const [rows] = await pool.execute(
      `SELECT id, username FROM users ${q ? 'WHERE LOCATE(?, username) > 0' : ''} ORDER BY username LIMIT ${limit}`,
      q ? [q] : [],
    );
    return rows.map((row) => ({ id: String(row.id), username: row.username }));
  }

  async function registerAttachment({
    id,
    authorId: rawAuthorId,
    fileName,
    mimeType,
    byteSize,
    sha256,
  }) {
    uuid(id);
    const authorId = positiveId(rawAuthorId);
    if (
      !FILE_NAME.test(fileName) ||
      fileName !== `${id}.webp` ||
      mimeType !== 'image/webp' ||
      !Number.isSafeInteger(byteSize) ||
      byteSize <= 0 ||
      byteSize > 20 * 1024 * 1024 ||
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw fail('图片附件信息无效。');
    await pool.execute(
      `INSERT INTO moderation_attachments (id, author_id, file_name, mime_type, byte_size, sha256, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 30 DAY))`,
      [id, authorId, fileName, mimeType, byteSize, sha256],
    );
    const [rows] = await pool.execute('SELECT * FROM moderation_attachments WHERE id = ?', [id]);
    return attachmentMetadata(rows[0]);
  }

  async function getAttachment({ id, userId: rawUserId = null }) {
    uuid(id);
    const userId = rawUserId == null ? null : positiveId(rawUserId);
    const [rows] = await pool.execute(
      `SELECT a.*, s.kind, (a.expires_at <= NOW(3)) AS expired
       FROM moderation_attachments a LEFT JOIN moderation_submissions s ON s.id = a.submission_id
       WHERE a.id = ?`,
      [id],
    );
    const row = rows[0];
    if (!row || row.purged_at) throw fail('图片不存在。', 404);
    if (row.published_id && row.submission_id) {
      const [posts] = await pool.execute(
        row.kind === 'post'
          ? 'SELECT id, user_id, is_deleted, is_hidden, login_required FROM discussion_posts WHERE id = ?'
          : `SELECT p.id, p.user_id, p.is_deleted, p.is_hidden, p.login_required
         FROM discussion_comments c JOIN discussion_posts p ON p.id = c.post_id
         WHERE c.id = ? AND c.is_deleted = 0`,
        [row.published_id],
      );
      if (canReadPost(posts[0], userId ? { id: positiveId(userId) } : null))
        return attachmentMetadata(row, 'published');
      throw fail('图片不存在。', 404);
    }
    if (!Number(row.expired) && userId != null) {
      if (Number(row.author_id) === userId) return attachmentMetadata(row);
      try {
        await requireReviewer(pool, userId);
        return attachmentMetadata(row);
      } catch (error) {
        if (error.status !== 403) throw error;
      }
    }
    throw fail('图片不存在。', 404);
  }

  async function expireAndPurge({ limit: requestedLimit = 100 } = {}) {
    const limit = Math.min(
      500,
      Math.max(1, Number.isSafeInteger(Number(requestedLimit)) ? Number(requestedLimit) : 100),
    );
    const [due] = await pool.execute(
      `SELECT id FROM moderation_submissions WHERE expires_at <= NOW(3) AND evidence_purged_at IS NULL
       ORDER BY expires_at, id LIMIT ${limit}`,
    );
    let purged = 0;
    let expired = 0;
    for (const item of due) {
      const changed = await transact(async (connection) => {
        const row = await readRow(connection, item.id, true);
        if (!Number(row.evidence_expired) || row.evidence_purged_at) return false;
        const wasPending = row.status === 'pending';
        await connection.execute(
          `UPDATE moderation_submissions SET payload_json = NULL, attachment_ids_json = NULL,
           decision_reason = NULL, evidence_purged_at = NOW(3),
           version = version + IF(status = 'pending', 1, 0),
           status = IF(status = 'pending', 'expired', status) WHERE id = ?`,
          [row.id],
        );
        if (wasPending && row.author_id != null)
          await notifyAuthor(connection, notifications, {
            id: row.id,
            authorId: row.author_id,
            status: 'expired',
          });
        return wasPending ? 'expired' : 'purged';
      });
      if (changed) purged += 1;
      if (changed === 'expired') expired += 1;
    }
    const [attachments] = await pool.execute(
      `SELECT id, file_name FROM moderation_attachments WHERE expires_at <= NOW(3)
       AND published_id IS NULL AND purged_at IS NULL ORDER BY expires_at, id LIMIT ${limit}`,
    );
    let filesPurged = 0;
    let filesDeferred = 0;
    for (const attachment of attachments) {
      if (!root || !FILE_NAME.test(attachment.file_name)) {
        filesDeferred += 1;
        continue;
      }
      // Expired files cannot be attached or read. Approval also checks the case expiry under lock.
      try {
        const target = path.resolve(root, attachment.file_name);
        if (path.dirname(target) !== root) throw new Error('Unsafe evidence path');
        const rootStat = await fs.lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
          throw new Error('Unsafe evidence directory');
        const removed = await transact(async (connection) => {
          const [locked] = await connection.execute(
            `SELECT id FROM moderation_attachments WHERE id = ? AND published_id IS NULL
             AND purged_at IS NULL AND expires_at <= NOW(3) FOR UPDATE`,
            [attachment.id],
          );
          if (!locked.length) return false;
          // Keep the row locked during this bounded local unlink so a concurrent approval cannot publish it.
          await fs.unlink(target).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          await connection.execute(
            'UPDATE moderation_attachments SET purged_at = NOW(3) WHERE id = ?',
            [attachment.id],
          );
          return true;
        });
        if (removed) filesPurged += 1;
      } catch {
        filesDeferred += 1;
      }
    }
    let orphansPurged = 0;
    if (root) {
      try {
        const rootStat = await fs.lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
          throw new Error('Unsafe evidence directory');
        const entries = (await fs.readdir(root, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name))
          .filter((entry) => entry.name > orphanCursor);
        let inspected = 0;
        let capped = false;
        for (const entry of entries) {
          if (!entry.isFile() || !FILE_NAME.test(entry.name)) continue;
          const target = path.resolve(root, entry.name);
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs > Date.now() - 30 * 86400000)
            continue;
          if (inspected >= limit) {
            capped = true;
            break;
          }
          inspected += 1;
          // A failed registration can leave an orphan. A database failure never permits its deletion.
          const [records] = await pool.execute(
            'SELECT id FROM moderation_attachments WHERE id = ? OR file_name = ? LIMIT 1',
            [entry.name.slice(0, -5), entry.name],
          );
          orphanCursor = entry.name;
          if (records.length) continue;
          await fs.unlink(target).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          orphansPurged += 1;
        }
        if (!capped) orphanCursor = '';
      } catch {
        filesDeferred += 1;
      }
    }
    return { purged, expired, filesPurged, filesDeferred, orphansPurged };
  }

  return {
    submit,
    decide,
    previewPrivacy,
    aiTestSnapshot,
    list,
    detail,
    mine,
    isReviewer,
    listReviewers,
    setReviewer,
    searchReviewerCandidates,
    registerAttachment,
    getAttachment,
    expireAndPurge,
  };
}

module.exports = { ensureSchema, createDiscussionModeration, normalizeSubmission, canonicalJson };
