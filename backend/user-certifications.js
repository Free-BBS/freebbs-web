const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const INSTITUTION = '清华大学电子系';
const EDUCATIONS = Object.freeze({ undergraduate: '本科', master: '硕士', doctor: '博士' });
const PAGE_SIZE = 30;

function certificationError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function text(value, maximum, label, required = false, minimum = 1) {
  if (value != null && typeof value !== 'string')
    throw certificationError(400, 'invalid_certification', `${label}格式错误`);
  const normalized = String(value || '').trim();
  const size = Array.from(normalized).length;
  if (
    (required && size < minimum) ||
    size > maximum ||
    Array.from(normalized).some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    throw certificationError(400, 'invalid_certification', `${label}长度或格式不符合要求`);
  return normalized;
}

function normalizeCertification(body = {}, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw certificationError(400, 'invalid_certification', '请填写有效认证资料');
  if (body.type === 'company') {
    return {
      slot: 'company',
      year: null,
      institution: null,
      className: '',
      companyName: text(body.companyName, 128, '企业名称', true, 2),
    };
  }
  const teacher = body.type === 'teacher';
  if (!teacher && (body.type !== 'education' || !Object.hasOwn(EDUCATIONS, body.education)))
    throw certificationError(
      400,
      'invalid_certification',
      '请选择本科、硕士、博士、教师或企业认证',
    );
  const year = teacher && (body.year == null || body.year === '') ? null : Number(body.year);
  if (
    year !== null &&
    (!/^\d{4}$/.test(String(body.year)) ||
      !Number.isInteger(year) ||
      year < 1900 ||
      year > new Date(now).getUTCFullYear() + 1)
  )
    throw certificationError(400, 'invalid_year', '请填写合理的四位入学年份');
  const institution = text(body.institution ?? INSTITUTION, 128, '学校院系', true);
  return {
    slot: teacher ? 'teacher' : body.education,
    year,
    institution,
    className: text(body.className, 64, '班级'),
    companyName: '',
  };
}

function certificationSuggestion(studentId) {
  if (!/^20\d{8}$/.test(String(studentId || ''))) return null;
  const code = studentId.slice(4, 6);
  const education = { '01': 'undergraduate', 21: 'master', 31: 'doctor' }[code];
  const teacher = ['99', '96', '66'].includes(code);
  if (!education && !teacher) return null;
  return {
    type: teacher ? 'teacher' : 'education',
    education: education || null,
    year: Number(studentId.slice(0, 4)),
    institution: INSTITUTION,
    className: '',
  };
}

function serializeCertification(row) {
  const company = row.slot === 'company';
  const teacher = row.slot === 'teacher';
  const verifiedName = teacher ? String(row.teacher_name || '').trim() : '';
  const teacherLabel = verifiedName ? `${verifiedName} · 教师` : `${row.institution} 教师`;
  return {
    type: company ? 'company' : teacher ? 'teacher' : 'education',
    education: company || teacher ? null : row.slot,
    year: row.year == null ? null : Number(row.year),
    institution: company ? null : row.institution,
    className: row.class_name || '',
    companyName: row.company_name || '',
    ...(teacher ? { verifiedName } : {}),
    label: company
      ? row.company_name
      : teacher
        ? teacherLabel
        : `${row.year} ${row.institution} ${EDUCATIONS[row.slot]}`,
    approvedAt: row.approved_at || null,
  };
}

function serializeRequest(row) {
  return {
    ...serializeCertification(row),
    id: Number(row.id),
    status: row.status,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || '',
  };
}

function identityBadges(role, certifications = [], fullName = '') {
  const order = ['teacher', 'company', 'doctor', 'master', 'undergraduate'];
  const verifiedName = String(fullName || '').trim();
  return [
    ...(role === 'teacher' && !certifications.some((item) => item.type === 'teacher')
      ? [{ type: 'teacher', label: verifiedName ? `${verifiedName} · 教师` : '教师' }]
      : []),
    ...[...certifications]
      .sort((a, b) => order.indexOf(a.education || a.type) - order.indexOf(b.education || b.type))
      .map((item) => ({
        type: item.type,
        education: item.education,
        label: item.label,
        className: item.className,
        ...(item.type === 'teacher' ? { institution: item.institution } : {}),
      })),
  ].slice(0, 4);
}

async function ensureUserCertificationTables(pool) {
  const [[column]] = await pool.execute(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
  );
  const statements = fs
    .readFileSync(
      path.join(__dirname, '../database/migrations/067_user_certifications.sql'),
      'utf8',
    )
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    if (statement.startsWith('ALTER TABLE') && column?.COLUMN_TYPE.includes("'enterprise'"))
      continue;
    await pool.query(statement);
  }
}

async function readApprovedCertifications(executor, userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const approved = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return approved;
  const [rows] = await executor.execute(
    `SELECT c.*, CASE WHEN c.slot = 'teacher' THEN u.full_name ELSE NULL END AS teacher_name FROM user_certifications c JOIN users u ON u.id = c.user_id WHERE c.user_id IN (${ids.map(() => '?').join(',')}) ORDER BY FIELD(c.slot, 'undergraduate', 'master', 'doctor', 'company')`,
    ids,
  );
  for (const row of rows) approved.get(Number(row.user_id))?.push(serializeCertification(row));
  return approved;
}

async function approveEnterpriseCertification(connection, { userId, adminId, companyName }) {
  const name = normalizeCertification({ type: 'company', companyName }).companyName;
  await connection.execute(
    `INSERT INTO user_certifications (user_id, slot, company_name, approved_by) VALUES (?, 'company', ?, ?)`,
    [userId, name, adminId],
  );
}

// The caller must hold the user's row lock in the role-change transaction. Application
// review takes the same lock before the request lock, so a superseded request cannot
// restore a company identity after this transaction removes or replaces it.
async function syncEnterpriseCertification(
  connection,
  { userId, adminId, previousRole, nextRole, companyName, now = Date.now },
) {
  const leavingEnterprise = previousRole === 'enterprise' && nextRole !== 'enterprise';
  if (!leavingEnterprise && nextRole !== 'enterprise') return;

  const [[approved]] = await connection.execute(
    "SELECT company_name FROM user_certifications WHERE user_id = ? AND slot = 'company' FOR UPDATE",
    [userId],
  );
  const providedName = companyName !== undefined;
  let name;
  if (nextRole === 'enterprise') {
    if (!providedName && !approved?.company_name)
      throw certificationError(400, 'company_name_required', '请填写企业名称后再设置为企业账户');
    name = normalizeCertification({
      type: 'company',
      companyName: providedName ? companyName : approved?.company_name,
    }).companyName;
    if (
      Number(userId) === Number(adminId) &&
      (previousRole !== 'enterprise' || name !== approved?.company_name)
    )
      throw certificationError(403, 'self_review_forbidden', '不能为自己的账户授予或修改企业认证');
    if (previousRole === 'enterprise' && name === approved?.company_name) return;
  }

  const [pending] = await connection.execute(
    "SELECT id FROM user_certification_requests WHERE user_id = ? AND slot = 'company' AND status = 'pending' ORDER BY id FOR UPDATE",
    [userId],
  );
  const reviewedAt = new Date(now());
  const reviewNote = leavingEnterprise
    ? '管理员已将账户调整为非企业角色，原企业认证与待审企业申请已撤销；如需认证，请重新提交。'
    : '管理员已在账户角色设置中确认企业身份，原待审企业申请已终止；如需更改，请重新提交。';
  for (const request of pending)
    await connection.execute(
      "UPDATE user_certification_requests SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ? AND status = 'pending'",
      [reviewedAt, adminId, reviewNote, request.id],
    );

  if (leavingEnterprise) {
    await connection.execute(
      "DELETE FROM user_certifications WHERE user_id = ? AND slot = 'company'",
      [userId],
    );
    return;
  }
  await connection.execute(
    `INSERT INTO user_certifications (user_id, slot, company_name, approved_at, approved_by, source_request_id) VALUES (?, 'company', ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE year = NULL, institution = NULL, class_name = NULL, company_name = VALUES(company_name), approved_at = VALUES(approved_at), approved_by = VALUES(approved_by), source_request_id = NULL`,
    [userId, name, reviewedAt, adminId],
  );
}

function createUserCertificationService({ pool, notifications, now = Date.now }) {
  async function transaction(work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      if (error.code === 'ER_DUP_ENTRY')
        throw certificationError(409, 'certification_conflict', '该阶段已有待审核申请，请等待审核');
      throw error;
    } finally {
      connection.release();
    }
  }

  async function read(userId) {
    const [[user]] = await pool.execute('SELECT student_id, full_name FROM users WHERE id = ?', [
      userId,
    ]);
    const approved = await readApprovedCertifications(pool, [userId]);
    const [requests] = await pool.execute(
      'SELECT * FROM user_certification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 20',
      [userId],
    );
    return {
      approved: approved.get(Number(userId)) || [],
      requests: requests.map(serializeRequest),
      studentId: user?.student_id || null,
      fullName: user?.full_name || '',
      suggestion: certificationSuggestion(user?.student_id),
    };
  }

  async function submit(userId, body) {
    const values = normalizeCertification(body, now());
    return transaction(async (connection) => {
      const [[user]] = await connection.execute(
        'SELECT id, username, full_name FROM users WHERE id = ? FOR UPDATE',
        [userId],
      );
      if (!user) throw certificationError(401, 'user_missing', '用户不存在，请重新登录');
      const [[pending]] = await connection.execute(
        "SELECT id FROM user_certification_requests WHERE user_id = ? AND slot = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [userId, values.slot],
      );
      if (pending)
        throw certificationError(409, 'certification_pending', '该阶段已有待审核申请，请等待审核');
      const [inserted] = await connection.execute(
        `INSERT INTO user_certification_requests (user_id, slot, year, institution, class_name, company_name, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          values.slot,
          values.year,
          values.institution,
          values.className || null,
          values.companyName || null,
          new Date(now()),
        ],
      );
      const [[request]] = await connection.execute(
        'SELECT * FROM user_certification_requests WHERE id = ?',
        [inserted.insertId],
      );
      const [admins] = await connection.execute(
        'SELECT id FROM users WHERE is_admin = 1 AND id <> ?',
        [userId],
      );
      await notifications.notifyCertification(
        {
          actor: user,
          recipients: admins.map((admin) => admin.id),
          title: '有新的身份认证申请',
          body: `${user.username} 提交了${values.slot === 'company' ? '企业' : values.slot === 'teacher' ? '教师' : EDUCATIONS[values.slot]}认证申请，请核实资料后审核。`,
          link: '/adminusers#certifications',
          eventKey: `certification-request:${inserted.insertId}`,
        },
        connection,
      );
      return serializeRequest(request);
    });
  }

  async function list(body = {}) {
    const status = body.status || 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status))
      throw certificationError(400, 'invalid_status', '无效申请状态');
    const page = body.page == null ? 1 : Number(body.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw certificationError(400, 'invalid_page', '无效页码');
    const where = status === 'all' ? '' : 'WHERE r.status = ?';
    const parameters = status === 'all' ? [] : [status];
    const [[count]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM user_certification_requests r ${where}`,
      parameters,
    );
    const [rows] = await pool.execute(
      `SELECT r.*, u.uid AS user_uid, u.username, u.full_name FROM user_certification_requests r JOIN users u ON u.id = r.user_id ${where} ORDER BY r.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      parameters,
    );
    const approved = await readApprovedCertifications(
      pool,
      rows.map((row) => row.user_id),
    );
    return {
      requests: rows.map((row) => ({
        ...serializeRequest(row),
        userId: Number(row.user_id),
        userUid: row.user_uid,
        username: row.username,
        fullName: row.full_name,
        currentApproved:
          approved
            .get(Number(row.user_id))
            ?.find((item) => (item.education || item.type) === row.slot) || null,
      })),
      total: Number(count.total),
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async function review(adminId, requestId, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw certificationError(400, 'invalid_review', '请填写审核操作');
    if (!Number.isSafeInteger(requestId) || requestId < 1)
      throw certificationError(400, 'invalid_request', '无效申请 ID');
    if (!['approve', 'reject'].includes(body.action))
      throw certificationError(400, 'invalid_action', '请选择通过或拒绝');
    if (body.action === 'approve' && body.identityConfirmed !== true)
      throw certificationError(400, 'identity_confirmation_required', '请先核实申请资料与真实身份');
    const note = text(body.reviewNote, 500, '审核备注');
    const [[locator]] = await pool.execute(
      'SELECT user_id FROM user_certification_requests WHERE id = ?',
      [requestId],
    );
    if (!locator) throw certificationError(404, 'request_missing', '申请不存在');
    const userId = Number(locator.user_id);
    if (Number(adminId) === userId)
      throw certificationError(403, 'self_review_forbidden', '不能审核自己的身份申请');
    return transaction(async (connection) => {
      const [users] = await connection.execute(
        'SELECT id, username, is_admin FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
        [adminId, userId],
      );
      const admin = users.find((user) => Number(user.id) === Number(adminId));
      if (!admin?.is_admin) throw certificationError(403, 'admin_required', '需要管理员权限');
      const [[request]] = await connection.execute(
        'SELECT * FROM user_certification_requests WHERE id = ? FOR UPDATE',
        [requestId],
      );
      if (!request || Number(request.user_id) !== userId || request.status !== 'pending')
        throw certificationError(409, 'request_not_pending', '该申请已处理，请刷新');
      const approved = body.action === 'approve';
      if (approved)
        await connection.execute(
          `INSERT INTO user_certifications (user_id, slot, year, institution, class_name, company_name, approved_at, approved_by, source_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE year = VALUES(year), institution = VALUES(institution), class_name = VALUES(class_name), company_name = VALUES(company_name), approved_at = VALUES(approved_at), approved_by = VALUES(approved_by), source_request_id = VALUES(source_request_id)`,
          [
            userId,
            request.slot,
            request.year,
            request.institution,
            request.class_name,
            request.company_name,
            new Date(now()),
            adminId,
            requestId,
          ],
        );
      await connection.execute(
        'UPDATE user_certification_requests SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?',
        [approved ? 'approved' : 'rejected', new Date(now()), adminId, note || null, requestId],
      );
      await notifications.notifyCertification(
        {
          actor: admin,
          recipients: [userId],
          title: approved ? '身份认证已通过' : '身份认证申请未通过',
          body: `${request.slot === 'company' ? '企业' : request.slot === 'teacher' ? '教师' : EDUCATIONS[request.slot]}认证申请${approved ? '已通过，可在个人页面查看。' : '未通过，请核实资料后重新申请。'}${note ? `\n审核备注：${note}` : ''}`,
          link: '/settings#certifications',
          eventKey: `certification-result:${requestId}`,
        },
        connection,
      );
      const [[reviewed]] = await connection.execute(
        'SELECT * FROM user_certification_requests WHERE id = ?',
        [requestId],
      );
      return serializeRequest(reviewed);
    });
  }

  async function decorate(rows) {
    const visible = rows.filter((row) => !row.is_anonymous && !row.is_deleted);
    const ids = [
      ...new Set(
        visible
          .map((row) => Number(row.user_id))
          .filter((id) => Number.isSafeInteger(id) && id > 0),
      ),
    ];
    if (!ids.length)
      return rows.map((row) => ({
        ...row,
        certifications: [],
        identityBadges: [],
        author_role: '',
      }));
    const approved = await readApprovedCertifications(pool, ids);
    const [users] = await pool.execute(
      `SELECT id, role, full_name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    const usersById = new Map(users.map((user) => [Number(user.id), user]));
    return rows.map((row) => {
      const hidden = row.is_anonymous || row.is_deleted;
      const certifications = hidden ? [] : approved.get(Number(row.user_id)) || [];
      const user = hidden ? null : usersById.get(Number(row.user_id));
      const role = user?.role || '';
      return {
        ...row,
        certifications,
        identityBadges: identityBadges(role, certifications, user?.full_name),
        author_role: role,
      };
    });
  }
  return { read, submit, list, review, decorate };
}

function createUserCertificationRouter({ service, requireAuth, requireAdmin }) {
  const router = express.Router();
  function route(method, url, guard, work) {
    router[method](url, async (request, response) => {
      response.set('Cache-Control', 'no-store');
      try {
        const user = await guard(request, response);
        if (user) await work(request, response, user);
      } catch (error) {
        response.status(error.status || 500).json({
          code: error.status ? error.code : 'certification_failed',
          message: error.status ? error.message : '认证操作失败，请稍后重试',
        });
      }
    });
  }
  route('get', '/me/certifications', requireAuth, async (_request, response, user) =>
    response.json(await service.read(user.id)),
  );
  route('post', '/me/certifications', requireAuth, async (request, response, user) =>
    response.status(201).json({
      request: await service.submit(user.id, request.body),
      message: '认证申请已提交，审核通过前不会显示为已认证',
    }),
  );
  route('get', '/admin/certifications', requireAdmin, async (request, response) =>
    response.json(await service.list(request.query)),
  );
  route('post', '/admin/certifications/:id/review', requireAdmin, async (request, response, user) =>
    response.json({
      request: await service.review(user.id, Number(request.params.id), request.body),
      message: '认证申请已处理',
    }),
  );
  return router;
}

module.exports = {
  INSTITUTION,
  EDUCATIONS,
  normalizeCertification,
  certificationSuggestion,
  serializeCertification,
  identityBadges,
  ensureUserCertificationTables,
  readApprovedCertifications,
  approveEnterpriseCertification,
  syncEnterpriseCertification,
  createUserCertificationService,
  createUserCertificationRouter,
};
