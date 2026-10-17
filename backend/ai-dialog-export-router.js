const fs = require('node:fs/promises');
const path = require('node:path');
const { buildAiDialogExport, buildAiDialogExportFileName } = require('./ai-dialog-export');

const MAX_USERS = 10;
const MAX_DIALOGS = 100;
const MAX_DAYS = 31;
const MAX_BYTES = 25 * 1024 * 1024;
const initialized = new WeakMap();

function exportError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeIds(value, maximum, label) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > maximum ||
    value.some((id) => !Number.isSafeInteger(id) || id < 1)
  ) {
    throw exportError(400, 'invalid_selection', `请明确选择${label}，最多 ${maximum} 项`);
  }
  if (new Set(value).size !== value.length) {
    throw exportError(400, 'invalid_selection', `${label}不能重复`);
  }
  return [...value].sort((a, b) => a - b);
}

function normalizeExportScope(body = {}, { requireDialogs = true } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw exportError(400, 'invalid_selection', '请选择导出范围');
  }
  const userIds = normalizeIds(body.userIds, MAX_USERS, '用户');
  const parseTime = (value) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    ) {
      throw exportError(400, 'invalid_range', '请填写完整的开始和结束时间');
    }
    const parsed = new Date(value);
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
    ) {
      throw exportError(400, 'invalid_range', '时间格式不正确');
    }
    return parsed;
  };
  const from = parseTime(body.from);
  const until = parseTime(body.until);
  if (until <= from || until - from > MAX_DAYS * 86400000) {
    throw exportError(400, 'invalid_range', `结束时间须晚于开始时间，每次范围最多 ${MAX_DAYS} 天`);
  }
  const scope = { userIds, from, until };
  if (requireDialogs) {
    scope.dialogIds = normalizeIds(body.dialogIds, MAX_DIALOGS, '会话');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      reason.length < 5 ||
      reason.length > 1000 ||
      [...reason].some((char) => char.codePointAt(0) < 32 && !['\t', '\r', '\n'].includes(char))
    ) {
      throw exportError(400, 'invalid_reason', '请填写 5 至 1000 字的具体调查原因');
    }
    scope.reason = reason;
  }
  return scope;
}

async function ensureAiDialogExportAudit(pool) {
  if (!initialized.has(pool)) {
    const ready = fs
      .readFile(
        path.join(__dirname, '../database/migrations/073_ai_dialog_export_audit.sql'),
        'utf8',
      )
      .then((sql) => pool.execute(sql))
      .catch((error) => {
        initialized.delete(pool);
        throw error;
      });
    initialized.set(pool, ready);
  }
  return initialized.get(pool);
}

const placeholders = (ids) => ids.map(() => '?').join(',');
// Match the existing mysql2 Date conversion used to read ai_dialogs DATETIME fields.
const rangeParams = (scope) => [...scope.userIds, scope.from, scope.until];
const whereScope = (scope) =>
  `user_id IN (${placeholders(scope.userIds)}) AND updated_at >= ? AND updated_at < ?`;

async function createScopedExport(pool, adminUser, scope, exportedAt = new Date()) {
  await ensureAiDialogExportAudit(pool);
  const [audit] = await pool.execute(
    `INSERT INTO ai_dialog_export_audit
      (actor_user_id, actor_username, reason, user_ids_json, dialog_ids_json, range_start, range_end)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      adminUser.id,
      adminUser.username,
      scope.reason,
      JSON.stringify(scope.userIds),
      JSON.stringify(scope.dialogIds),
      scope.from,
      scope.until,
    ],
  );
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [users] = await connection.execute(
      `SELECT id, uid, username, full_name, student_id, role FROM users WHERE id IN (${placeholders(scope.userIds)}) ORDER BY id`,
      scope.userIds,
    );
    if (users.length !== scope.userIds.length)
      throw exportError(409, 'selection_changed', '所选用户已变化，请重新选择');
    const filter = `${whereScope(scope)} AND id IN (${placeholders(scope.dialogIds)})`;
    const params = [...rangeParams(scope), ...scope.dialogIds];
    const [metadata] = await connection.execute(
      `SELECT id, OCTET_LENGTH(messages_json) AS content_bytes FROM ai_dialogs WHERE ${filter} ORDER BY id`,
      params,
    );
    if (metadata.length !== scope.dialogIds.length) {
      throw exportError(
        409,
        'selection_changed',
        '所选会话已变化、超出时间范围或不属于所选用户，请重新加载会话',
      );
    }
    if (metadata.reduce((sum, row) => sum + Number(row.content_bytes), 0) > MAX_BYTES) {
      throw exportError(413, 'export_too_large', '所选内容超过 25 MB，请减少会话数量');
    }
    const [dialogs] = await connection.execute(
      `SELECT id, did, user_id, title, messages_json, created_at, updated_at FROM ai_dialogs WHERE ${filter} ORDER BY user_id, created_at, id`,
      params,
    );
    const payload = buildAiDialogExport({ users, dialogs, exportedBy: adminUser, exportedAt });
    payload.schemaVersion = 2;
    payload.scope = {
      auditId: Number(audit.insertId),
      userIds: scope.userIds,
      dialogIds: scope.dialogIds,
      from: scope.from.toISOString(),
      until: scope.until.toISOString(),
      timeBasis: 'dialog_updated_at',
      wholeSelectedConversations: true,
      explanation:
        '时间按会话最后更新时间筛选（含开始、不含结束），导出所选会话的完整已保存内容；现有消息没有独立时间戳。',
    };
    const json = JSON.stringify(payload, null, 2);
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_BYTES)
      throw exportError(413, 'export_too_large', '导出文件超过 25 MB，请减少会话数量');
    const [updated] = await connection.execute(
      `UPDATE ai_dialog_export_audit SET status = 'generated', dialog_count = ?, message_count = ?, byte_count = ?, finished_at = NOW(3) WHERE id = ? AND status = 'started'`,
      [dialogs.length, payload.totals.messages, bytes, audit.insertId],
    );
    if (updated.affectedRows !== 1)
      throw exportError(503, 'audit_unavailable', '导出记录保存失败，请稍后重试');
    await connection.commit();
    return {
      json,
      auditId: Number(audit.insertId),
      fileName: buildAiDialogExportFileName(exportedAt),
    };
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
      connection.release();
      connection = null;
    }
    const failureCode = ['selection_changed', 'export_too_large', 'audit_unavailable'].includes(
      error.code,
    )
      ? error.code
      : 'export_failed';
    await pool
      .execute(
        `UPDATE ai_dialog_export_audit SET status = 'failed', failure_code = ?, finished_at = NOW(3) WHERE id = ? AND status = 'started'`,
        [failureCode, audit.insertId],
      )
      .catch(() => {});
    throw error;
  } finally {
    connection?.release();
  }
}

function mountAiDialogExportRoutes(app, { pool, requireAdmin, ensureAiDialogTables }) {
  const protect = (handler) => async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      const admin = await requireAdmin(request, response);
      if (!admin) return;
      await ensureAiDialogTables();
      await handler(request, response, admin);
    } catch (error) {
      response.status(error.status || 500).json({
        message: error.status ? error.message : '操作失败，未导出聊天记录，请稍后重试',
        code: error.status ? error.code : 'export_failed',
      });
    }
  };
  app.get(
    '/api/admin/ai-dialogs/export',
    protect(async (_request, response) => {
      response
        .status(405)
        .set('Allow', 'POST')
        .json({ message: '请在导出窗口选择用户、会话、时间并填写原因' });
    }),
  );
  app.post(
    '/api/admin/ai-dialogs/export-catalog',
    protect(async (request, response) => {
      const scope = normalizeExportScope(request.body, { requireDialogs: false });
      const [dialogs] = await pool.execute(
        `SELECT id, user_id, title, created_at, updated_at FROM ai_dialogs WHERE ${whereScope(scope)} ORDER BY updated_at DESC, id DESC LIMIT 501`,
        rangeParams(scope),
      );
      response.json({
        dialogs: dialogs.slice(0, 500),
        truncated: dialogs.length > 500,
        timeBasis: 'dialog_updated_at',
      });
    }),
  );
  app.post(
    '/api/admin/ai-dialogs/export',
    protect(async (request, response, admin) => {
      const scope = normalizeExportScope(request.body);
      const result = await createScopedExport(pool, admin, scope);
      response.set({
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Export-Audit-Id': String(result.auditId),
      });
      response.send(result.json);
    }),
  );
  app.get(
    '/api/admin/ai-dialogs/export-audit',
    protect(async (_request, response) => {
      await ensureAiDialogExportAudit(pool);
      const [records] = await pool.execute(
        `SELECT id, actor_user_id, actor_username, reason, user_ids_json, dialog_ids_json, range_start, range_end, time_basis, status, dialog_count, message_count, byte_count, failure_code, created_at, finished_at FROM ai_dialog_export_audit ORDER BY id DESC LIMIT 100`,
      );
      response.json({ records });
    }),
  );
}

module.exports = {
  normalizeExportScope,
  ensureAiDialogExportAudit,
  createScopedExport,
  mountAiDialogExportRoutes,
};
