const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { hashPassword, verifyPasswordAsync } = require('./password');
const { isValidUsername, USERNAME_MESSAGE } = require('./username-policy');

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ATTEMPTS = 5;
const RESET_MESSAGE = '如果用户名与已验证邮箱匹配，验证码会发送到该邮箱，10 分钟内有效';

function accountError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!email || email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw accountError(400, 'invalid_email', '请输入有效邮箱地址，且长度不超过 128 个字符');
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 128) {
    throw accountError(400, 'invalid_password', '密码长度须为 6 至 128 位');
  }
  return value;
}

// Recovery must still find accounts created under the previous Chinese nickname policy.
// This only validates a lookup identifier; new usernames use isValidUsername instead.
function isRecoverableUsername(value) {
  return typeof value === 'string' && /^[\p{Script=Han}A-Za-z0-9_]{2,64}$/u.test(value);
}

function normalizeAdminAccount(body = {}) {
  const username = String(body.username || '').trim();
  const fullName = String(body.fullName || '').trim();
  const role = String(body.role || 'student').trim();
  const studentId = String(body.studentId || '').trim();
  const email = String(body.email || '').trim();
  if (!isValidUsername(username)) throw accountError(400, 'invalid_username', USERNAME_MESSAGE);
  if (!fullName || fullName.length > 64) {
    throw accountError(400, 'invalid_name', '请输入姓名，且长度不超过 64 个字符');
  }
  if (!['student', 'ta', 'teacher', 'admin', 'enterprise'].includes(role)) {
    throw accountError(400, 'invalid_role', '角色不合法');
  }
  if (
    (!studentId && !['teacher', 'enterprise'].includes(role)) ||
    (studentId && !/^20\d{8}$/.test(studentId))
  ) {
    throw accountError(
      400,
      'invalid_student_id',
      '学号必须是 20 开头的 10 位数字；教师和企业可暂不填写',
    );
  }
  if (!email && !['teacher', 'enterprise'].includes(role))
    throw accountError(400, 'invalid_email', '请输入有效邮箱地址');
  return {
    username,
    fullName,
    role,
    studentId: studentId || null,
    email: email ? normalizeEmail(email) : null,
    password: validatePassword(body.password),
    grade: ['teacher', 'enterprise'].includes(role) ? null : studentId.slice(0, 4),
    major: ['teacher', 'enterprise'].includes(role) ? null : '电子信息科学与技术',
  };
}

async function ensureTeacherAccountTables(pool) {
  const [[column]] = await pool.execute(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'student_id'`,
  );
  if (column?.IS_NULLABLE === 'NO') {
    await pool.query('ALTER TABLE users MODIFY student_id VARCHAR(10) NULL');
  }
  const schema = fs.readFileSync(
    path.join(__dirname, '../database/migrations/065_teacher_accounts.sql'),
    'utf8',
  );
  // The migration also works for an existing installation. Startup already handled its ALTER.
  for (const statement of schema
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (!statement.startsWith('ALTER TABLE')) await pool.query(statement);
  }
}

function createAccountIdentityService({ pool, sendCode, now = () => Date.now() }) {
  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (error.code === 'ER_DUP_ENTRY') {
        throw accountError(409, 'identity_taken', '该邮箱或学号已被其他账号绑定');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function lockUser(connection, userId) {
    const [[user]] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [
      userId,
    ]);
    if (!user) throw accountError(404, 'user_missing', '账号不存在');
    return user;
  }

  async function checkPassword(user, password) {
    if (
      typeof password !== 'string' ||
      password.length > 128 ||
      !(await verifyPasswordAsync(password, user.password_hash))
    ) {
      throw accountError(401, 'current_password_wrong', '当前密码错误');
    }
  }

  async function issueCode(connection, user, email, purpose) {
    const [recent] = await connection.execute(
      `SELECT created_at FROM account_identity_codes WHERE user_id = ? AND purpose = ?
       ORDER BY id DESC LIMIT 1`,
      [user.id, purpose],
    );
    if (recent[0] && now() - new Date(recent[0].created_at).getTime() < 60000) {
      throw accountError(429, 'code_rate_limited', '发送过于频繁，请等待 60 秒后重试');
    }
    const [[hour]] = await connection.execute(
      `SELECT COUNT(*) AS count FROM account_identity_codes
       WHERE (user_id = ? OR email = ?) AND created_at > ?`,
      [user.id, email, new Date(now() - 3600000)],
    );
    if (Number(hour.count) >= 10)
      throw accountError(429, 'code_rate_limited', '本小时验证码次数已达上限，请稍后重试');
    await connection.execute(
      `UPDATE account_identity_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
      [new Date(now()), user.id, purpose],
    );
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const [result] = await connection.execute(
      `INSERT INTO account_identity_codes (user_id, email, purpose, code_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, email, purpose, hashPassword(code), new Date(now() + CODE_TTL_MS), new Date(now())],
    );
    return { id: result.insertId, email, code, purpose };
  }

  async function deliver(issued) {
    try {
      await sendCode(issued.email, issued.code, issued.purpose);
    } catch {
      await pool.execute('UPDATE account_identity_codes SET used_at = ? WHERE id = ?', [
        new Date(now()),
        issued.id,
      ]);
      throw accountError(503, 'email_delivery_failed', '验证码发送失败，请稍后重试');
    }
  }

  async function consumeCode(connection, userId, email, purpose, supplied) {
    const [[code]] = await connection.execute(
      `SELECT * FROM account_identity_codes WHERE user_id = ? AND email = ? AND purpose = ?
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [userId, email, purpose],
    );
    if (
      !code ||
      code.used_at ||
      new Date(code.expires_at).getTime() <= now() ||
      code.attempts >= CODE_ATTEMPTS
    ) {
      return accountError(400, 'code_invalid', '验证码错误、已使用或已过期，请重新发送');
    }
    if (
      !/^\d{6}$/.test(String(supplied || '')) ||
      !(await verifyPasswordAsync(String(supplied), code.code_hash))
    ) {
      await connection.execute(
        'UPDATE account_identity_codes SET attempts = attempts + 1 WHERE id = ?',
        [code.id],
      );
      // Return rather than throw, so a rejected guess still consumes its attempt.
      return accountError(400, 'code_invalid', '验证码错误，请重新输入');
    }
    await connection.execute('UPDATE account_identity_codes SET used_at = ? WHERE id = ?', [
      new Date(now()),
      code.id,
    ]);
    return null;
  }

  async function read(userId) {
    const [[user]] = await pool.execute(
      'SELECT email, email_verified_at, student_id FROM users WHERE id = ?',
      [userId],
    );
    const [[request]] = await pool.execute(
      'SELECT student_id, status, requested_at, reviewed_at FROM account_student_requests WHERE user_id = ?',
      [userId],
    );
    return {
      email: user?.email || '',
      emailVerified: Boolean(user?.email_verified_at),
      studentId: user?.student_id || '',
      studentRequest: request ? { studentId: request.student_id, status: request.status } : null,
    };
  }

  async function sendBindingCode(userId, body = {}) {
    const email = normalizeEmail(body.email);
    const issued = await transaction(async (connection) => {
      const user = await lockUser(connection, userId);
      await checkPassword(user, body.currentPassword);
      const [[taken]] = await connection.execute(
        'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
        [email, userId],
      );
      if (taken) throw accountError(409, 'email_taken', '该邮箱已被其他账号绑定');
      return issueCode(connection, user, email, 'bind_email');
    });
    await deliver(issued);
  }

  async function bindEmail(userId, body = {}) {
    const email = normalizeEmail(body.email);
    const result = await transaction(async (connection) => {
      const user = await lockUser(connection, userId);
      await checkPassword(user, body.currentPassword);
      const error = await consumeCode(connection, userId, email, 'bind_email', body.emailCode);
      if (error) return { error };
      await connection.execute('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', [
        email,
        new Date(now()),
        userId,
      ]);
      // An earlier password-reset code cannot survive an email change.
      await connection.execute(
        'UPDATE account_identity_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
        [new Date(now()), userId],
      );
      return {};
    });
    if (result.error) throw result.error;
  }

  async function requestStudentId(userId, body = {}) {
    const studentId = String(body.studentId || '').trim();
    if (!/^20\d{8}$/.test(studentId))
      throw accountError(400, 'invalid_student_id', '学号须为 20 开头的 10 位数字');
    await transaction(async (connection) => {
      const user = await lockUser(connection, userId);
      await checkPassword(user, body.currentPassword);
      if (user.student_id === studentId)
        throw accountError(409, 'student_id_unchanged', '当前账号已绑定此学号');
      const [[taken]] = await connection.execute(
        'SELECT id FROM users WHERE student_id = ? AND id <> ? LIMIT 1',
        [studentId, userId],
      );
      if (taken) throw accountError(409, 'student_id_taken', '该学号已被其他账号绑定');
      await connection.execute(
        `INSERT INTO account_student_requests (user_id, student_id, status, requested_at)
         VALUES (?, ?, 'pending', ?) ON DUPLICATE KEY UPDATE student_id = VALUES(student_id),
         status = 'pending', requested_at = VALUES(requested_at), reviewed_at = NULL, reviewed_by = NULL`,
        [userId, studentId, new Date(now())],
      );
    });
  }

  async function pendingStudentRequests() {
    const [rows] = await pool.execute(
      `SELECT r.user_id, r.student_id, r.requested_at, u.username, u.full_name
       FROM account_student_requests r JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending' ORDER BY r.requested_at`,
    );
    return rows.map((row) => ({
      userId: row.user_id,
      studentId: row.student_id,
      username: row.username,
      fullName: row.full_name,
    }));
  }

  async function reviewStudentRequest(adminId, userId, body = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw accountError(400, 'invalid_user', '无效用户 ID');
    if (!['approve', 'reject'].includes(body.action))
      throw accountError(400, 'invalid_review', '请选择通过或拒绝');
    if (body.action === 'approve' && body.identityConfirmed !== true) {
      throw accountError(400, 'identity_confirmation_required', '请先核实真实姓名与学号归属');
    }
    if (adminId === userId)
      throw accountError(403, 'self_review_forbidden', '请由另一位管理员核实本人的学号');
    await transaction(async (connection) => {
      await lockUser(connection, userId);
      const [[request]] = await connection.execute(
        'SELECT * FROM account_student_requests WHERE user_id = ? FOR UPDATE',
        [userId],
      );
      if (!request || request.status !== 'pending')
        throw accountError(409, 'request_not_pending', '该申请已处理，请刷新');
      if (body.studentId !== request.student_id)
        throw accountError(409, 'request_changed', '申请学号已变化，请刷新后核实');
      if (body.action === 'approve')
        await connection.execute('UPDATE users SET student_id = ? WHERE id = ?', [
          request.student_id,
          userId,
        ]);
      await connection.execute(
        'UPDATE account_student_requests SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE user_id = ?',
        [body.action === 'approve' ? 'approved' : 'rejected', new Date(now()), adminId, userId],
      );
    });
  }

  async function sendResetCode(body = {}) {
    const email = normalizeEmail(body.email);
    const identifier = String(body.identifier || '').trim();
    if (!isRecoverableUsername(identifier))
      throw accountError(400, 'invalid_username', '请输入登录用户名');
    const [[match]] = await pool.execute(
      'SELECT id FROM users WHERE username = ? AND email = ? AND email_verified_at IS NOT NULL LIMIT 1',
      [identifier, email],
    );
    if (!match) return;
    const issued = await transaction(async (connection) => {
      const user = await lockUser(connection, match.id);
      if (
        user.username.toLowerCase() !== identifier.toLowerCase() ||
        String(user.email || '').toLowerCase() !== email ||
        !user.email_verified_at
      )
        return null;
      return issueCode(connection, user, email, 'reset_password');
    });
    if (issued) await deliver(issued);
  }

  async function resetPassword(body = {}) {
    const password = validatePassword(body.password);
    const email = normalizeEmail(body.email);
    const identifier = String(body.identifier || '').trim();
    if (!isRecoverableUsername(identifier))
      throw accountError(400, 'invalid_username', '请输入登录用户名');
    const [[match]] = await pool.execute(
      'SELECT id FROM users WHERE username = ? AND email = ? AND email_verified_at IS NOT NULL LIMIT 1',
      [identifier, email],
    );
    if (!match) throw accountError(400, 'code_invalid', '用户名、邮箱或验证码不匹配');
    const result = await transaction(async (connection) => {
      const user = await lockUser(connection, match.id);
      if (
        user.username.toLowerCase() !== identifier.toLowerCase() ||
        String(user.email || '').toLowerCase() !== email ||
        !user.email_verified_at
      )
        throw accountError(400, 'code_invalid', '用户名、邮箱或验证码不匹配');
      const error = await consumeCode(connection, user.id, email, 'reset_password', body.emailCode);
      if (error) return { error };
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
        hashPassword(password),
        user.id,
      ]);
      await connection.execute(
        'UPDATE account_identity_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
        [new Date(now()), user.id],
      );
      return { userId: user.id };
    });
    if (result.error) throw result.error;
    return result.userId;
  }

  async function adminResetPassword(adminId, userId, body = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw accountError(400, 'invalid_user', '无效用户 ID');
    const password = validatePassword(body.password);
    await transaction(async (connection) => {
      // Lock in ID order so two admins cannot deadlock while resetting different teachers.
      const [rows] = await connection.execute(
        'SELECT * FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
        [adminId, userId],
      );
      const admin = rows.find((row) => Number(row.id) === adminId);
      const user = rows.find((row) => Number(row.id) === userId);
      if (!admin?.is_admin) throw accountError(403, 'admin_required', '需要管理员权限');
      await checkPassword(admin, body.currentPassword);
      if (!user || !['teacher', 'enterprise'].includes(user.role) || user.is_admin)
        throw accountError(403, 'teacher_required', '仅可重置非管理员教师或企业账号');
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
        hashPassword(password),
        userId,
      ]);
      await connection.execute(
        'UPDATE account_identity_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
        [new Date(now()), userId],
      );
    });
  }

  return {
    read,
    sendBindingCode,
    bindEmail,
    requestStudentId,
    pendingStudentRequests,
    reviewStudentRequest,
    sendResetCode,
    resetPassword,
    adminResetPassword,
  };
}

function createTeacherAccountsRouter({
  service,
  requireAuth,
  requireAdmin,
  getUserById,
  toUserProfile,
  issueToken,
}) {
  const router = express.Router();
  function route(method, url, guard, work) {
    router[method](url, async (request, response) => {
      response.set('Cache-Control', 'no-store');
      try {
        const user = guard ? await guard(request, response) : null;
        if (guard && !user) return;
        await work(request, response, user);
      } catch (error) {
        response.status(error.status || 500).json({
          code: error.status ? error.code : 'account_update_failed',
          message: error.status ? error.message : '账号操作失败，请稍后重试',
        });
      }
    });
  }
  route('get', '/profile/identity', requireAuth, async (_request, response, user) =>
    response.json(await service.read(user.id)),
  );
  route('post', '/profile/email-code', requireAuth, async (request, response, user) => {
    await service.sendBindingCode(user.id, request.body);
    response.json({ message: '验证码已发送，10 分钟内有效' });
  });
  route('patch', '/profile/email', requireAuth, async (request, response, user) => {
    await service.bindEmail(user.id, request.body);
    response.json({ message: '邮箱已验证并绑定', user: toUserProfile(await getUserById(user.id)) });
  });
  route('post', '/profile/student-id', requireAuth, async (request, response, user) => {
    await service.requestStudentId(user.id, request.body);
    response.json({ message: '学号申请已提交，请联系管理员核实姓名与学号归属后完成绑定' });
  });
  route('get', '/admin/student-id-requests', requireAdmin, async (_request, response) =>
    response.json({ requests: await service.pendingStudentRequests() }),
  );
  route(
    'post',
    '/admin/student-id-requests/:id',
    requireAdmin,
    async (request, response, admin) => {
      await service.reviewStudentRequest(Number(admin.id), Number(request.params.id), request.body);
      response.json({ message: '申请已处理' });
    },
  );
  route(
    'post',
    '/admin/users/:id/reset-password',
    requireAdmin,
    async (request, response, admin) => {
      await service.adminResetPassword(Number(admin.id), Number(request.params.id), request.body);
      response.json({
        message: '教师密码已重置',
        user: toUserProfile(await getUserById(Number(request.params.id))),
      });
    },
  );
  // Keep legacy student-ID reset requests handled by the existing routes.
  for (const [url, work] of [
    [
      '/auth/send-reset-code',
      async (request, response) => {
        response.set('Cache-Control', 'no-store');
        await service.sendResetCode(request.body);
        response.json({ message: RESET_MESSAGE });
      },
    ],
    [
      '/auth/reset-password',
      async (request, response) => {
        const userId = await service.resetPassword(request.body);
        const user = toUserProfile(await getUserById(userId));
        response.json({ message: '密码已重设', user, token: issueToken(user) });
      },
    ],
  ]) {
    router.post(
      url,
      (request, _response, next) => {
        if (!Object.hasOwn(request.body || {}, 'identifier')) next('route');
        else next();
      },
      async (request, response) => {
        try {
          await work(request, response);
        } catch (error) {
          response.status(error.status || 500).json({
            message: error.status ? error.message : '账号操作失败，请稍后重试',
            code: error.status ? error.code : 'account_update_failed',
          });
        }
      },
    );
  }
  return router;
}

module.exports = {
  normalizeAdminAccount,
  ensureTeacherAccountTables,
  createAccountIdentityService,
  createTeacherAccountsRouter,
};
