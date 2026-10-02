// Loopback demonstration only. All credentials, codes and accounts are fictional.
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const { TOKEN } = require('./preview-economy');
const { isValidUsername } = require('../backend/username-policy');

const DEMO_CODE = '246810';
const DEMO_PASSWORD = 'Preview2026!';
function digest(password, salt) {
  return scryptSync(String(password), salt, 32);
}
function createTeacherAccountsPreviewApi() {
  const accounts = new Map();
  const passwords = new Map();
  const codes = new Map();
  const requests = new Map();
  function setPassword(id, password) {
    const salt = randomBytes(16).toString('hex');
    passwords.set(id, { salt, hash: digest(password, salt) });
  }
  function validPassword(id, password) {
    const record = passwords.get(id);
    return Boolean(record && timingSafeEqual(record.hash, digest(password, record.salt)));
  }
  function addAccount(values) {
    const id = accounts.size + 1;
    const user = {
      id,
      uid: `u_demo_teacher_${id}`,
      username: values.username,
      fullName: values.fullName,
      role: values.role || 'teacher',
      isAdmin: Boolean(values.isAdmin),
      studentId: values.studentId || null,
      email: values.email || null,
      emailVerified: false,
      electrons: 120,
      manetrons: 86,
      heat: 24,
      boardModeratorSlugs: [],
      courseManagerSlugs: [],
      createdAt: new Date().toISOString(),
    };
    accounts.set(id, user);
    setPassword(id, values.password || DEMO_PASSWORD);
    return user;
  }
  addAccount({ username: 'preview_admin', fullName: '演示管理员', isAdmin: true });
  addAccount({ username: 'preview_teacher', fullName: '演示教师' });
  const result = (body, status = 200, headers = {}) => ({ body, status, headers });
  const fail = (message, status = 400) => result({ message }, status);
  async function handle({ route, method, body = {}, headers = {}, user: baseUser }) {
    const cookie = /(?:^|;\s*)freebbs_demo_account=(\d+)/.exec(headers.cookie || '');
    const user = accounts.get(Number(cookie?.[1] || 1)) || accounts.get(1);
    const safeUser = () => ({ ...baseUser?.(), ...user });
    const admin = route.startsWith('/api/admin/');
    if (admin && !user.isAdmin) return fail('演示教师没有管理员权限', 403);
    if (route === '/api/auth/login' && method === 'POST') {
      const account = [...accounts.values()].find((item) =>
        [item.username, item.email].includes(body.identifier || body.username),
      );
      if (!account || !validPassword(account.id, body.password))
        return fail('演示账号或密码错误', 401);
      return result({ token: TOKEN, user: account }, 200, {
        'Set-Cookie': `freebbs_demo_account=${account.id}; Path=/; SameSite=Strict`,
      });
    }
    if (route === '/api/auth/login-challenge') return result({ required: false, challenge: null });
    if (route === '/api/auth/me' || (route === '/api/profile' && method === 'GET'))
      return result({ user: safeUser() });
    if (route === '/api/profile/identity' && method === 'GET')
      return result({
        email: user.email,
        emailVerified: user.emailVerified,
        studentId: user.studentId,
        studentRequest: requests.get(user.id) || null,
      });
    if (route === '/api/profile/email-code' && method === 'POST') {
      if (!validPassword(user.id, body.currentPassword)) return fail('当前密码错误', 403);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || '')) return fail('请输入有效邮箱');
      codes.set(user.id, {
        email: body.email.toLowerCase(),
        purpose: 'bind_email',
        expires: Date.now() + 600000,
      });
      return result({ message: `本地演示验证码：${DEMO_CODE}；未发送邮件` });
    }
    if (route === '/api/profile/email' && method === 'PATCH') {
      const code = codes.get(user.id);
      if (!validPassword(user.id, body.currentPassword)) return fail('当前密码错误', 403);
      if (
        !code ||
        code.purpose !== 'bind_email' ||
        code.expires < Date.now() ||
        code.email !== body.email?.toLowerCase() ||
        body.emailCode !== DEMO_CODE
      )
        return fail('演示验证码无效或过期');
      if (
        [...accounts.values()].some(
          (account) => account.id !== user.id && account.email === code.email,
        )
      )
        return fail('该邮箱已绑定其他演示账号', 409);
      Object.assign(user, { email: code.email, emailVerified: true });
      codes.delete(user.id);
      return result({ message: '演示邮箱已绑定', user: safeUser() });
    }
    if (route === '/api/profile/student-id' && method === 'POST') {
      if (!validPassword(user.id, body.currentPassword)) return fail('当前密码错误', 403);
      if (!/^20\d{8}$/.test(body.studentId || '')) return fail('请输入10位学号');
      requests.set(user.id, { studentId: body.studentId, status: 'pending' });
      return result({ message: '演示申请已提交，等待管理员核验' });
    }
    if (route === '/api/admin/student-id-requests' && method === 'GET')
      return result({
        requests: [...requests]
          .filter(([, request]) => request.status === 'pending')
          .map(([userId, request]) => ({
            ...request,
            userId,
            username: accounts.get(userId).username,
            fullName: accounts.get(userId).fullName,
          })),
      });
    const review = /^\/api\/admin\/student-id-requests\/(\d+)$/.exec(route);
    if (review && method === 'POST') {
      const id = Number(review[1]);
      const request = requests.get(id);
      if (!request || request.studentId !== body.studentId) return fail('申请已变化', 409);
      if (body.action === 'approve') {
        if (body.identityConfirmed !== true) return fail('请核验演示身份');
        if ([...accounts.values()].some((account) => account.studentId === body.studentId))
          return fail('学号已绑定', 409);
        accounts.get(id).studentId = body.studentId;
      }
      request.status = body.action === 'approve' ? 'approved' : 'rejected';
      return result({ message: '演示审核已保存' });
    }
    if (route === '/api/admin/users' && method === 'GET')
      return result({
        users: [...accounts.values()],
        permissionCatalog: { boards: [], courses: [] },
      });
    if (route === '/api/admin/users' && method === 'POST') {
      if (
        !isValidUsername(body.username) ||
        !body.fullName ||
        String(body.password || '').length < 6
      )
        return fail('请填写姓名、有效用户名和至少6位密码');
      if ([...accounts.values()].some((account) => account.username === body.username))
        return fail('用户名已存在', 409);
      if (body.role !== 'teacher' && (!body.studentId || !body.email))
        return fail('非教师账号仍需完整身份信息');
      const created = addAccount(body);
      return result({ message: '演示账号已创建', user: created });
    }
    const reset = /^\/api\/admin\/users\/(\d+)\/reset-password$/.exec(route);
    if (reset && method === 'POST') {
      const target = accounts.get(Number(reset[1]));
      if (!validPassword(user.id, body.currentPassword)) return fail('管理员当前密码错误', 403);
      if (!target || target.isAdmin || target.role !== 'teacher')
        return fail('仅可重置非管理员教师', 403);
      if (String(body.password || '').length < 6) return fail('密码至少6位');
      setPassword(target.id, body.password);
      return result({ message: '演示教师密码已重置', user: target });
    }
    if (route === '/api/profile/username') {
      const policy = {
        username: user.username,
        teacherFree: true,
        freeAvailable: true,
        cost: 0,
        balance: user.manetrons,
        nextFreeAt: null,
      };
      if (method === 'GET') return result({ username: user.username, policy });
      if (method === 'PATCH') {
        if (body.expectedUsername !== user.username) return fail('用户名已变化，请刷新后重试', 409);
        if (!isValidUsername(body.username)) return fail('用户名格式不正确');
        if (
          [...accounts.values()].some(
            (account) => account.id !== user.id && account.username === body.username,
          )
        )
          return fail('用户名已存在', 409);
        user.username = body.username;
        policy.username = user.username;
        return result({
          user: safeUser(),
          token: TOKEN,
          policy,
          charged: 0,
          message: '演示教师用户名已免费修改',
        });
      }
    }
    if (route === '/api/profile/password' && method === 'PATCH') {
      if (!validPassword(user.id, body.currentPassword)) return fail('当前密码错误', 403);
      if (String(body.newPassword || '').length < 6) return fail('密码至少6位');
      setPassword(user.id, body.newPassword);
      return result({ message: '演示密码已修改' });
    }
    if (
      ['/api/auth/send-reset-code', '/api/auth/reset-password'].includes(route) &&
      method === 'POST'
    ) {
      const target = [...accounts.values()].find(
        (account) =>
          account.emailVerified &&
          account.email === body.email?.toLowerCase() &&
          (body.identifier
            ? account.username === body.identifier
            : account.studentId === body.studentId),
      );
      if (route === '/api/auth/send-reset-code') {
        if (target)
          codes.set(target.id, {
            email: target.email,
            purpose: 'reset_password',
            expires: Date.now() + 600000,
          });
        return result({
          message: `本地演示：若身份与已验证邮箱匹配，可使用验证码 ${DEMO_CODE}；未发送邮件`,
        });
      }
      const code = target && codes.get(target.id);
      if (
        !code ||
        code.purpose !== 'reset_password' ||
        code.email !== target.email ||
        code.expires < Date.now() ||
        body.emailCode !== DEMO_CODE
      )
        return fail('演示身份、邮箱或验证码不匹配');
      if (String(body.password || '').length < 6) return fail('密码至少6位');
      setPassword(target.id, body.password);
      codes.delete(target.id);
      return result({ message: '演示密码已重设', user: target, token: TOKEN }, 200, {
        'Set-Cookie': `freebbs_demo_account=${target.id}; Path=/; SameSite=Strict`,
      });
    }
    if (route === '/api/profile' && method === 'PATCH') {
      Object.assign(user, { bio: body.bio || '', websiteUrl: body.websiteUrl || '' });
      return result({ message: '演示资料已保存', user: safeUser() });
    }
    if (route === '/api/profile/email-preferences')
      return result({
        preferences: {
          reply: true,
          reaction: true,
          commentLike: true,
          announcement: true,
          weeklyDigest: false,
          aiTask: true,
        },
      });
    if (route === '/api/admin/heat' || route === '/api/admin/courses')
      return result({ users: [], courses: [] });
    if (route === '/api/admin/registration-whitelist' && method === 'GET')
      return result({
        entries: [],
        total: 0,
        page: 1,
        pageSize: 20,
        stats: { total: 0, claimed: 0 },
      });
    return null;
  }
  return { handle, accounts, requests };
}
module.exports = { createTeacherAccountsPreviewApi, DEMO_CODE, DEMO_PASSWORD };
