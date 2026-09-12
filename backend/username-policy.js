const express = require('express');

const USERNAME_MESSAGE = '用户名须为 3 至 64 位英文字母、数字或下划线';
const RENAME_COST = 10;

async function ensureUsernameChangeTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS username_change_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    old_username VARCHAR(64) NOT NULL,
    new_username VARCHAR(64) NOT NULL,
    change_kind ENUM('free', 'paid', 'required') NOT NULL,
    magnetic_cost INT NOT NULL DEFAULT 0,
    changed_at DATETIME(3) NOT NULL,
    INDEX idx_username_changes_user_kind (user_id, change_kind, changed_at),
    CONSTRAINT fk_username_changes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}

async function getUsernameChangePolicy(connection, user) {
  // MySQL calendar arithmetic clamps month ends; UTC avoids browser/server timezone drift.
  const [[row]] = await connection.execute(
    `SELECT
       DATE_FORMAT(DATE_ADD(MAX(changed_at), INTERVAL 3 MONTH), '%Y-%m-%dT%H:%i:%s.%fZ') AS next_free_at,
       COALESCE(DATE_ADD(MAX(changed_at), INTERVAL 3 MONTH) <= UTC_TIMESTAMP(3), 1) AS free_available
     FROM username_change_log WHERE user_id = ? AND change_kind = 'free'`,
    [user.id],
  );
  const required = !isValidUsername(user.username);
  const freeAvailable = required || Boolean(Number(row.free_available));
  return {
    username: user.username,
    freeAvailable,
    required,
    nextFreeAt: row.next_free_at || null,
    cost: freeAvailable ? 0 : RENAME_COST,
    balance: Number(user.manetrons || 0),
  };
}

function usernameError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function changeUsername({ pool, userId, username, expectedUsername, allowPaid }) {
  if (!isValidUsername(username)) throw usernameError(400, 'invalid_username', USERNAME_MESSAGE);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // This lock serializes nickname changes with each other and with currency writes.
    const [[user]] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [
      userId,
    ]);
    if (!user) throw usernameError(401, 'user_missing', '用户不存在，请重新登录');
    const policy = await getUsernameChangePolicy(connection, user);
    if (user.username === username) {
      await connection.commit();
      return { user, policy, charged: 0, changed: false };
    }
    if (!policy.required && expectedUsername !== user.username) {
      throw usernameError(409, 'username_stale', '昵称已变化，请刷新改名信息后重试');
    }
    if (policy.cost && allowPaid !== true) {
      throw usernameError(
        409,
        'payment_confirmation_required',
        '本次改名需要 10 磁元，请确认后再提交',
      );
    }
    if (policy.cost && policy.balance < policy.cost) {
      throw usernameError(409, 'insufficient_magnetic', '磁元不足，本次改名需要 10 磁元');
    }
    await connection.execute(
      'UPDATE users SET username = ?, manetrons = manetrons - ? WHERE id = ?',
      [username, policy.cost, userId],
    );
    await connection.execute(
      `INSERT INTO username_change_log
       (user_id, old_username, new_username, change_kind, magnetic_cost, changed_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        userId,
        user.username,
        username,
        policy.required ? 'required' : policy.cost ? 'paid' : 'free',
        policy.cost,
      ],
    );
    const updated = { ...user, username, manetrons: policy.balance - policy.cost };
    const updatedPolicy = await getUsernameChangePolicy(connection, updated);
    await connection.commit();
    return { user: updated, policy: updatedPolicy, charged: policy.cost, changed: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      throw usernameError(409, 'username_taken', '该昵称已被使用，请换一个');
    }
    throw error;
  } finally {
    connection.release();
  }
}

function isValidUsername(value) {
  return (
    typeof value === 'string' &&
    value.length >= 3 &&
    value.length <= 64 &&
    !/[^A-Za-z0-9_]/.test(value)
  );
}

function enforceUsername(user, response) {
  if (isValidUsername(user.username)) return true;
  response.status(403).json({
    code: 'username_change_required',
    message: '请先修改用户名，仅可使用英文字母、数字和下划线',
    requiresUsernameChange: true,
  });
  return false;
}

function createUsernameRouter({ pool, requireAuth, toUserProfile, issueToken }) {
  const router = express.Router();
  router.get('/', async (request, response) => {
    try {
      const user = await requireAuth(request, response, { allowInvalidUsername: true });
      if (!user) return;
      response.set('Cache-Control', 'no-store');
      response.json({ policy: await getUsernameChangePolicy(pool, user) });
    } catch {
      response.status(500).json({ message: '无法读取改名信息，请稍后重试' });
    }
  });
  router.patch('/', async (request, response) => {
    try {
      const user = await requireAuth(request, response, { allowInvalidUsername: true });
      if (!user) return;
      const { username, expectedUsername, allowPaid } = request.body || {};
      const result = await changeUsername({
        pool,
        userId: user.id,
        username,
        expectedUsername,
        allowPaid,
      });
      const updated = toUserProfile(result.user);
      response.json({
        user: updated,
        token: issueToken(updated),
        policy: result.policy,
        charged: result.charged,
        message: !result.changed
          ? '昵称未变化，未扣费'
          : result.charged
            ? '昵称已更新，已支付 10 磁元'
            : '昵称已免费更新',
      });
    } catch (error) {
      if (error.status) {
        response.status(error.status).json({ message: error.message, code: error.code });
        return;
      }
      response.status(500).json({ message: '修改用户名失败，请稍后重试' });
    }
  });
  return router;
}

module.exports = {
  USERNAME_MESSAGE,
  isValidUsername,
  enforceUsername,
  createUsernameRouter,
  ensureUsernameChangeTables,
  getUsernameChangePolicy,
  changeUsername,
};
