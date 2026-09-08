const express = require('express');

const USERNAME_MESSAGE = '用户名须为 3 至 64 位英文字母、数字或下划线';

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

function createUsernameRouter({ pool, requireAuth, getUserById, toUserProfile, issueToken }) {
  const router = express.Router();
  router.patch('/', async (request, response) => {
    try {
      const user = await requireAuth(request, response, { allowInvalidUsername: true });
      if (!user) return;
      const { username } = request.body;
      if (!isValidUsername(username)) {
        response.status(400).json({ message: USERNAME_MESSAGE });
        return;
      }
      await pool.execute('UPDATE users SET username = ? WHERE id = ?', [username, user.id]);
      const updated = toUserProfile(await getUserById(user.id));
      response.json({ user: updated, token: issueToken(updated), message: '用户名已更新' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        response.status(409).json({ message: '该用户名已被使用，请换一个' });
        return;
      }
      response.status(500).json({ message: '修改用户名失败，请稍后重试' });
    }
  });
  return router;
}

module.exports = { USERNAME_MESSAGE, isValidUsername, enforceUsername, createUsernameRouter };
