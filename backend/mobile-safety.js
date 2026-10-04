const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { verifyPassword } = require('./password');

const REASONS = new Set(['abuse', 'inappropriate', 'spam', 'privacy', 'other']);
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function positiveId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail(400, '无效用户或记录编号');
  return number;
}
function validateReport(body = {}) {
  if (!['post', 'comment'].includes(body.targetType)) fail(400, '无效举报类型');
  const targetId = String(body.targetId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(targetId)) fail(400, '无效内容编号');
  if (body.targetType === 'comment') positiveId(targetId);
  if (!REASONS.has(body.reason)) fail(400, '请选择举报原因');
  if (body.detail != null && typeof body.detail !== 'string') fail(400, '补充说明必须是文本');
  const detail = (body.detail || '').trim();
  if (detail.length > 2000) fail(400, '补充说明不能超过 2000 个字符');
  return { targetType: body.targetType, targetId, reason: body.reason, detail };
}
async function ensureMobileSafetyTables(pool) {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/032_mobile_safety.sql'),
    'utf8',
  );
  for (const statement of sql
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    await pool.execute(statement);
  }
}
function createMobileSafetyRouter({ pool, requireAuth, requireAdmin }) {
  const router = express.Router();
  const route =
    (handler, admin = false) =>
    async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      try {
        const user = admin
          ? await requireAdmin(request, response)
          : await requireAuth(request, response, { allowInvalidUsername: true });
        if (!user) return;
        await handler(request, response, user);
      } catch (error) {
        response.status(error.status || 500).json({
          message: error.status ? error.message : '暂时无法处理，请稍后重试',
        });
      }
    };
  router.get(
    '/mobile/blocks',
    route(async (_request, response, user) => {
      const [rows] = await pool.execute(
        `SELECT u.id, u.username FROM mobile_user_blocks b JOIN users u ON u.id = b.blocked_user_id
       WHERE b.user_id = ? ORDER BY b.created_at DESC`,
        [user.id],
      );
      response.json({
        blocks: rows.map((row) => ({ id: Number(row.id), username: row.username })),
      });
    }),
  );
  router.post(
    '/mobile/blocks',
    route(async (request, response, user) => {
      const id = positiveId(request.body.userId);
      if (id === Number(user.id)) fail(400, '不能屏蔽自己');
      const [rows] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) fail(404, '用户不存在');
      await pool.execute(
        'INSERT IGNORE INTO mobile_user_blocks (user_id, blocked_user_id) VALUES (?, ?)',
        [user.id, id],
      );
      response.json({ ok: true });
    }),
  );
  router.delete(
    '/mobile/blocks/:id',
    route(async (request, response, user) => {
      await pool.execute(
        'DELETE FROM mobile_user_blocks WHERE user_id = ? AND blocked_user_id = ?',
        [user.id, positiveId(request.params.id)],
      );
      response.json({ ok: true });
    }),
  );
  router.post(
    '/mobile/reports',
    route(async (request, response, user) => {
      const report = validateReport(request.body);
      const [targets] =
        report.targetType === 'post'
          ? await pool.execute(
              'SELECT id FROM discussion_posts WHERE (pid = ? OR CAST(id AS CHAR) = ?) AND is_deleted = 0 LIMIT 1',
              [report.targetId, report.targetId],
            )
          : await pool.execute(
              `SELECT c.id FROM discussion_comments c JOIN discussion_posts p ON p.id = c.post_id
          WHERE c.id = ? AND p.is_deleted = 0 LIMIT 1`,
              [report.targetId],
            );
      if (!targets[0]) fail(404, '内容不存在');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Serialize submissions per account, including simultaneous retries.
        await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
        const [duplicate] = await connection.execute(
          `SELECT id FROM mobile_content_reports WHERE reporter_id = ?
        AND target_type = ? AND target_id = ? AND status = 'pending' LIMIT 1`,
          [user.id, report.targetType, String(targets[0].id)],
        );
        if (!duplicate[0]) {
          const [[count]] = await connection.execute(
            `SELECT COUNT(*) AS total FROM mobile_content_reports
          WHERE reporter_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
            [user.id],
          );
          if (Number(count.total) >= 20) fail(429, '举报过于频繁，请稍后再试');
          await connection.execute(
            `INSERT INTO mobile_content_reports
          (reporter_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)`,
            [user.id, report.targetType, String(targets[0].id), report.reason, report.detail],
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      response.status(201).json({ ok: true, message: '举报已提交' });
    }),
  );
  router.get(
    '/mobile/account-deletion',
    route(async (_request, response, user) => {
      const [rows] = await pool.execute(
        'SELECT requested_at FROM mobile_account_deletion_requests WHERE user_id = ?',
        [user.id],
      );
      response.json({
        status: rows[0] ? 'pending' : 'none',
        requestedAt: rows[0]?.requested_at || null,
      });
    }),
  );
  router.post(
    '/mobile/account-deletion',
    route(async (request, response, user) => {
      if (request.body.confirm !== 'DELETE') fail(400, '请确认账号删除申请');
      const { password } = request.body;
      if (typeof password !== 'string' || !password || password.length > 1024)
        fail(400, '请输入当前密码');
      const [rows] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [
        user.id,
      ]);
      if (!rows[0] || !verifyPassword(password, rows[0].password_hash)) fail(403, '当前密码错误');
      // Only enqueue. Never represent a pending request as a completed deletion.
      await pool.execute(
        'INSERT IGNORE INTO mobile_account_deletion_requests (user_id) VALUES (?)',
        [user.id],
      );
      const [requests] = await pool.execute(
        'SELECT requested_at FROM mobile_account_deletion_requests WHERE user_id = ?',
        [user.id],
      );
      response.status(202).json({ status: 'pending', requestedAt: requests[0].requested_at });
    }),
  );
  router.get(
    '/admin/mobile/reports',
    route(async (request, response) => {
      const status = request.query.status || 'pending';
      if (!['pending', 'resolved', 'dismissed'].includes(status)) fail(400, '无效状态');
      const before = request.query.before ? positiveId(request.query.before) : null;
      const [rows] = await pool.execute(
        `SELECT r.id, r.target_type AS targetType, r.target_id AS targetId,
      r.reason, r.detail, r.status, r.resolution, r.created_at AS createdAt, u.username AS reporter
      FROM mobile_content_reports r LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.status = ?${before ? ' AND r.id < ?' : ''} ORDER BY r.id DESC LIMIT 51`,
        before ? [status, before] : [status],
      );
      response.json({
        reports: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      });
    }, true),
  );
  router.patch(
    '/admin/mobile/reports/:id',
    route(async (request, response, user) => {
      if (!['resolved', 'dismissed'].includes(request.body.status)) fail(400, '请选择处理结果');
      if (
        typeof request.body.resolution !== 'string' ||
        !request.body.resolution.trim() ||
        request.body.resolution.length > 2000
      )
        fail(400, '请填写处理说明（不超过 2000 个字符）');
      const [result] = await pool.execute(
        `UPDATE mobile_content_reports SET status = ?, resolution = ?,
      reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'`,
        [
          request.body.status,
          request.body.resolution.trim(),
          user.id,
          positiveId(request.params.id),
        ],
      );
      if (!result.affectedRows) fail(409, '举报不存在或已经处理');
      response.json({ ok: true });
    }, true),
  );
  router.get(
    '/admin/mobile/account-deletions',
    route(async (request, response) => {
      const after = request.query.after ? positiveId(request.query.after) : 0;
      const [rows] = await pool.execute(
        `SELECT d.user_id AS userId, u.username, d.requested_at AS requestedAt
      FROM mobile_account_deletion_requests d JOIN users u ON u.id = d.user_id
      WHERE d.user_id > ? ORDER BY d.user_id ASC LIMIT 51`,
        [after],
      );
      response.json({
        requests: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].userId : null,
      });
    }, true),
  );
  return router;
}
module.exports = { createMobileSafetyRouter, ensureMobileSafetyTables, validateReport, positiveId };
