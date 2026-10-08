// Loopback-only demo: fictional accounts and in-memory certifications, no real API or database.
const { createScheduleSeriesPreview } = require('./preview-schedule-series');
const { createTeacherAccountsPreviewApi, DEMO_PASSWORD } = require('./preview-teacher-accounts');
const {
  normalizeCertification,
  serializeCertification,
  identityBadges,
} = require('../backend/user-certifications');

async function createIdentityUsabilityPreview() {
  const teacher = createTeacherAccountsPreviewApi();
  teacher.accounts.get(1).uid = 'u_preview01';
  const student = teacher.accounts.get(2);
  Object.assign(student, {
    uid: 'u_preview02',
    username: 'preview_student',
    fullName: '演示同学',
    role: 'student',
    studentId: '2021010001',
  });
  const requests = [];
  const approved = new Map();
  const notices = [];
  const result = (body, status = 200) => ({ body, status });
  const userFor = (headers) =>
    teacher.accounts.get(Number(/freebbs_demo_account=(\d+)/.exec(headers.cookie || '')?.[1] || 1));
  const certifications = (id) =>
    [...(approved.get(id)?.values() || [])].map((item) => {
      if (item.type !== 'teacher') return item;
      const verifiedName = teacher.accounts.get(id)?.fullName || '';
      return { ...item, verifiedName, label: verifiedName ? `${verifiedName} · 教师` : item.label };
    });
  const toRow = (value) => ({
    slot: value.slot,
    year: value.year,
    institution: value.institution,
    class_name: value.className,
    company_name: value.companyName,
    approved_at: new Date().toISOString(),
  });
  async function api(context) {
    const { route, method, body, headers, url } = context;
    const user = userFor(headers);
    if (!user) return result({ message: '演示账号不存在' }, 401);
    const adminRoute = route.startsWith('/api/admin/');
    if (adminRoute && !user.isAdmin) return result({ message: '需要管理员权限' }, 403);
    try {
      const publicProfile = /^\/api\/users\/([^/]+)\/public-profile$/.exec(route);
      if (publicProfile && method === 'GET') {
        const account = [...teacher.accounts.values()].find(
          (item) => item.uid === publicProfile[1],
        );
        if (!account) return result({ message: '演示账号不存在' }, 404);
        const approvedCertifications = certifications(account.id);
        return result({
          profile: {
            id: account.id,
            uid: account.uid,
            username: account.username,
            fullName: '',
            role: account.role,
            certifications: approvedCertifications,
            identityBadges: identityBadges(account.role, approvedCertifications, account.fullName),
            activity: { days: [] },
            collectibles: [],
          },
        });
      }
      if (route === '/api/admin/users' && method === 'GET')
        return result({
          users: [...teacher.accounts.values()].map((account) => ({
            ...account,
            certifications: certifications(account.id),
          })),
          permissionCatalog: { boards: [], courses: [] },
        });
      const accountUpdate = /^\/api\/admin\/users\/(\d+)(\/role)?$/.exec(route);
      if (accountUpdate && method === 'PATCH') {
        const target = teacher.accounts.get(Number(accountUpdate[1]));
        if (!target) return result({ message: '演示账号不存在' }, 404);
        if (!['student', 'ta', 'teacher', 'enterprise', 'admin'].includes(body.role))
          return result({ message: '身份不合法' }, 400);
        const wasEnterprise = target.role === 'enterprise';
        const enterprise = body.role === 'enterprise';
        const existingCompany = approved.get(target.id)?.get('company');
        const company = enterprise
          ? normalizeCertification({
              type: 'company',
              companyName:
                body.companyName === undefined ? existingCompany?.companyName : body.companyName,
            })
          : null;
        if (
          enterprise &&
          target.id === user.id &&
          (!wasEnterprise || company.companyName !== existingCompany?.companyName)
        )
          return result({ message: '不能为自己的账户授予或修改企业认证' }, 403);
        if (!accountUpdate[2] && !String(body.fullName || '').trim())
          return result({ message: '请输入姓名' }, 400);
        const replacesCompany =
          enterprise && (!wasEnterprise || company.companyName !== existingCompany?.companyName);
        if (replacesCompany) {
          if (!approved.has(target.id)) approved.set(target.id, new Map());
          approved.get(target.id).set('company', serializeCertification(toRow(company)));
        } else if (wasEnterprise && !enterprise) {
          approved.get(target.id)?.delete('company');
        }
        if (replacesCompany || (wasEnterprise && !enterprise))
          requests
            .filter(
              (request) =>
                request.userId === target.id &&
                request.slot === 'company' &&
                request.status === 'pending',
            )
            .forEach((request) => {
              request.status = 'rejected';
              request.reviewedAt = new Date().toISOString();
              request.reviewNote = '管理员已调整企业角色与认证，请核实后重新申请。';
            });
        if (!accountUpdate[2])
          Object.assign(target, {
            fullName: body.fullName.trim(),
            electrons: Number(body.electrons || 0),
            manetrons: Number(body.manetrons || 0),
            heat: Number(body.heat || 0),
            boardModeratorSlugs: body.boardModeratorSlugs || [],
            courseManagerSlugs: body.courseManagerSlugs || [],
          });
        Object.assign(target, {
          role: body.role,
          isAdmin: Boolean(body.isAdmin || body.role === 'admin'),
        });
        return result({ user: { ...target, certifications: certifications(target.id) } });
      }
      if (route === '/api/me/certifications' && method === 'GET') {
        const code = user.studentId?.slice(4, 6);
        const education = { '01': 'undergraduate', 21: 'master', 31: 'doctor' }[code];
        const suggestion =
          education || ['99', '96', '66'].includes(code)
            ? {
                type: education ? 'education' : 'teacher',
                education: education || null,
                year: Number(user.studentId.slice(0, 4)),
                institution: '清华大学电子系',
                className: '',
              }
            : null;
        return result({
          approved: certifications(user.id),
          requests: requests.filter((request) => request.userId === user.id).toReversed(),
          suggestion,
          studentId: user.studentId,
          fullName: user.fullName,
        });
      }
      if (route === '/api/me/certifications' && method === 'POST') {
        const value = normalizeCertification(body);
        if (
          requests.some(
            (request) =>
              request.userId === user.id &&
              request.slot === value.slot &&
              request.status === 'pending',
          )
        )
          return result({ message: '该身份已有待审核申请' }, 409);
        const request = {
          ...serializeCertification(toRow(value)),
          ...value,
          id: requests.length + 1,
          userId: user.id,
          userUid: user.uid,
          username: user.username,
          fullName: user.fullName,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          approvedAt: null,
          reviewNote: '',
        };
        requests.push(request);
        notices.push({
          id: notices.length + 1,
          userId: 1,
          type: 'announcement',
          title: '新的身份认证申请',
          body: `${user.username} 申请 ${request.label}`,
          link: '/adminusers#certifications',
          read: false,
          readAt: null,
          kind: 'certification',
          createdAt: new Date().toISOString(),
        });
        return result({ request, message: '演示认证申请已提交' }, 201);
      }
      if (route === '/api/admin/certifications' && method === 'GET') {
        const status = url.searchParams.get('status') || 'pending';
        const all = requests
          .filter((request) => status === 'all' || request.status === status)
          .toReversed();
        return result({ requests: all, total: all.length, page: 1, pageSize: 30 });
      }
      const review = /^\/api\/admin\/certifications\/(\d+)\/review$/.exec(route);
      if (review && method === 'POST') {
        const request = requests.find((item) => item.id === Number(review[1]));
        if (!request || request.status !== 'pending') return result({ message: '申请已处理' }, 409);
        if (request.userId === user.id)
          return result({ message: '请由另一位管理员审核本人认证' }, 403);
        if (!['approve', 'reject'].includes(body.action))
          return result({ message: '请选择审核结果' }, 400);
        if (body.action === 'approve' && body.identityConfirmed !== true)
          return result({ message: '请先核实身份' }, 400);
        request.status = body.action === 'approve' ? 'approved' : 'rejected';
        request.reviewNote = body.reviewNote || '';
        request.reviewedAt = new Date().toISOString();
        if (request.status === 'approved') {
          if (!approved.has(request.userId)) approved.set(request.userId, new Map());
          approved.get(request.userId).set(request.slot, serializeCertification(toRow(request)));
        }
        notices.push({
          id: notices.length + 1,
          userId: request.userId,
          type: 'announcement',
          title: '认证审核结果',
          body: `${request.label}：${request.status === 'approved' ? '已通过' : '未通过'}`,
          link: '/settings#certifications',
          read: false,
          readAt: null,
          kind: 'certification',
          createdAt: new Date().toISOString(),
        });
        return result({ request, message: '演示认证申请已处理' });
      }
      if (route === '/api/notifications/unread-count')
        return result({
          unreadCount: notices.filter((notice) => notice.userId === user.id && !notice.read).length,
        });
      if (route === '/api/notifications' && method === 'GET')
        return result({
          notifications: notices.filter((notice) => notice.userId === user.id).toReversed(),
          total: notices.filter((notice) => notice.userId === user.id).length,
          unreadCount: notices.filter((notice) => notice.userId === user.id && !notice.read).length,
          nextCursor: null,
        });
      const notification = /^\/api\/notifications\/(\d+)\/read$/.exec(route);
      if (notification || route === '/api/notifications/read-all') {
        notices
          .filter(
            (notice) =>
              notice.userId === user.id && (!notification || notice.id === Number(notification[1])),
          )
          .forEach((notice) => {
            notice.read = true;
            notice.readAt = new Date().toISOString();
          });
        return result({ message: '已读' });
      }
    } catch (error) {
      return result({ message: error.message }, error.status || 400);
    }
    const response = await teacher.handle(context);
    if (
      response?.body?.user &&
      route === '/api/admin/users' &&
      method === 'POST' &&
      body.role === 'enterprise'
    ) {
      const value = normalizeCertification({
        type: 'company',
        companyName: body.companyName || body.fullName,
      });
      approved.set(
        response.body.user.id,
        new Map([['company', serializeCertification(toRow(value))]]),
      );
    }
    if (response?.body?.user)
      response.body.user.certifications = certifications(response.body.user.id);
    return response;
  }
  const preview = await createScheduleSeriesPreview({
    extraApi: api,
    allowDemoAuthentication: true,
    extraPages: {
      '/adminusers': 'adminusers.html',
      '/login': 'login.html',
      '/remake': 'remake.html',
      '/register': 'register.html',
    },
    transformHtml(html) {
      const script = `<script>const demo = new URLSearchParams(location.search).get('demo');if (demo === 'student' || demo === 'admin') {document.cookie = 'freebbs_demo_account=' + (demo === 'admin' ? '1' : '2') + ';Path=/;SameSite=Strict';localStorage.removeItem('free_bbs_user');}</script>`;
      const notice = `<aside data-preview-notice style="margin:12px;padding:12px;border-radius:12px;background:#133c45;color:white;font:14px/1.6 system-ui"><strong>身份认证与界面优化 · 独立本地演示</strong><p>账号、认证和通知都是内存演示数据，未连接线上。<a href="/settings?demo=student" style="color:white">演示同学</a> · <a href="/adminusers?demo=admin" style="color:white">演示管理员</a> · <a href="/workbench" style="color:white">工作台</a> · <a href="/staff" style="color:white">工作人员</a>。演示密码：${DEMO_PASSWORD}</p></aside>`;
      return html
        .replace('</head>', `${script}</head>`)
        .replace(/<details data-preview-notice[\s\S]*?<\/details>/, notice);
    },
  });
  return { ...preview, teacher, requests, approved, notices };
}

if (require.main === module)
  createIdentityUsabilityPreview()
    .then(({ server }) => {
      server.listen(Number(process.env.IDENTITY_PREVIEW_PORT || 3157), '127.0.0.1', () => {
        console.log(
          `Independent identity demo: http://127.0.0.1:${server.address().port}/settings?demo=student`,
        );
      });
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { createIdentityUsabilityPreview };
