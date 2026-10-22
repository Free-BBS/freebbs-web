// Isolated loopback lab: fictional teacher accounts, in-memory relations and public demo materials.
const express = require('express');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createTeacherAccountsPreviewApi } = require('./preview-teacher-accounts');
const { TOKEN } = require('./preview-economy');
const { patchScript } = require('./preview-home');
const { preparePageShell } = require('../page-shell');
const { createTeacherParticipationRouter } = require('../backend/teacher-participation');
const { policy } = require('../backend/privacy-policy');
const { automaticCertifications } = require('../backend/user-certifications');
const {
  createLearningPreviewApi,
  createLearningFixture,
  studentNode,
} = require('./preview-learning-workspace');

function createAboutTeachersPreview() {
  const app = express();
  const server = http.createServer(app);
  const teacher = createTeacherAccountsPreviewApi();
  teacher.accounts.set(3, {
    ...teacher.accounts.get(2),
    id: 3,
    uid: 'u_preview_unverified',
    username: 'preview_unverified',
    fullName: '演示未认证账号',
    role: 'student',
    studentId: null,
  });
  for (const [id, kind, studentId] of [
    [4, 'student', '2026010101'],
    [5, 'graduate', '2026210001'],
    [6, 'doctor', '2025310001'],
  ]) {
    const account = teacher.addAccount({
      ...teacher.accounts.get(3),
      id,
      uid: `u_preview_${kind}`,
      username: `preview_${kind}`,
      fullName:
        kind === 'doctor' ? '演示博士同学' : kind === 'graduate' ? '演示研究生' : '演示本科同学',
      studentId,
    });
    if (account.id !== id) throw new Error('Unexpected fictional preview account order');
  }
  teacher.emailSuggestions.set(4, 'preview-only-student@tsinghua.edu.cn');
  const fixture = createLearningFixture();
  const assignments = new Map([[2, ['signals', 'circuits', 'math']]]);
  const writes = [];
  const certificationRequests = [];
  const courses = [
    { slug: 'signals', name: '信号与系统', code: 'SS' },
    { slug: 'circuits', name: '电路原理', code: 'EC' },
    { slug: 'math', name: '高等微积分', code: 'CAL' },
  ];
  const identity = (req) =>
    req.headers.authorization === `Bearer ${TOKEN}`
      ? teacher.accounts.get(
          Number(/freebbs_demo_account=(\d+)/.exec(req.headers.cookie || '')?.[1]),
        ) || null
      : null;
  const requireAuth = async (req, res) => {
    const user = identity(req);
    if (!user) res.status(401).json({ message: '本地演示请先登录' });
    return user;
  };
  const requireAdmin = async (req, res) => {
    const user = await requireAuth(req, res);
    if (user && !user.isAdmin) {
      res.status(403).json({ message: '仅演示管理员可设置' });
      return null;
    }
    return user;
  };
  app.use((req, res, next) => {
    const origin = `http://127.0.0.1:${server.address()?.port}`;
    if (
      req.headers.host !== origin.slice(7) ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return res.status(403).json({ message: 'Loopback preview only' });
    res.set('Cache-Control', 'no-store');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    return next();
  });
  app.use(express.json({ limit: '32kb' }));
  const learning = createLearningPreviewApi({
    contextRows: fixture.contextRows,
    previewUsers: [...teacher.accounts.values()],
    managers: [],
    identity,
  });
  // This lab's account 3 is unverified, not the manager used by older shared fixtures.
  learning.store.canReview = async (user) => Boolean(user.isAdmin || user.is_admin);
  const baseFeedback = [
    {
      id: 1,
      courseSlug: 'signals',
      courseName: '信号与系统',
      pointId: 'SS-01-01',
      pointTitle: fixture.nodes.find((node) => node.id === 'SS-01-01').title,
      title: '本地演示：补充卷积变量解释',
      content: '建议给积分变量与时间变量增加一个对照示例。',
      excerpt: '此处为本地演示原文摘录。',
      category: 'improvement',
      status: 'handled',
      response: '演示回复：谢谢提醒，课程组会补充变量示意。',
      updatedAt: '2026-10-22T01:00:00Z',
      documentVersion: 'preview-only',
    },
  ];
  app.use(
    '/api',
    createTeacherParticipationRouter({
      requireAuth,
      requireAdmin,
      store: {
        async workspace(id) {
          const user = teacher.accounts.get(id);
          const eligible = user?.role === 'teacher';
          return {
            eligible,
            identity: { role: user?.role, certified: eligible, fullName: user?.fullName },
            courses: eligible
              ? courses
                  .filter((course) => (assignments.get(id) || []).includes(course.slug))
                  .map((course) => ({ ...course, canEditMaterials: false }))
              : [],
            feedback: eligible
              ? [
                  ...(id === 2 ? baseFeedback : []),
                  ...learning.store.rows
                    .filter((row) => row.user === id && row.kind === 'contribution')
                    .map((row) => ({
                      ...row,
                      courseSlug: 'signals',
                      courseName: '信号与系统',
                      pointId: row.point,
                      pointTitle: row.point,
                    })),
                ]
              : [],
          };
        },
        async adminRead(_admin, id) {
          return {
            eligible: teacher.accounts.get(id)?.role === 'teacher',
            courses,
            courseSlugs: assignments.get(id) || [],
          };
        },
        async replace(admin, id, slugs) {
          if (teacher.accounts.get(id)?.role !== 'teacher' && slugs.length)
            throw Object.assign(new Error('请先核实教师身份'), { status: 409 });
          if (slugs.some((slug) => !courses.some((course) => course.slug === slug)))
            throw Object.assign(new Error('课程不存在'), { status: 400 });
          assignments.set(id, slugs);
          writes.push({ admin, id, slugs });
          return { courseSlugs: slugs };
        },
      },
    }),
  );
  app.get('/api/auth/me', (req, res) =>
    identity(req)
      ? res.json({ user: identity(req) })
      : res.status(401).json({ message: '演示访客' }),
  );
  app.get('/api/privacy-policy', (_req, res) => res.json(policy));
  // Fictional preview accounts have already read the current policy, not real acceptances.
  app.get('/api/privacy-policy/status', async (req, res) => {
    if (await requireAuth(req, res))
      res.json({
        version: policy.version,
        contentHash: policy.contentHash,
        accepted: true,
        requiresFullPolicy: false,
        acceptedAt: '2026-10-22T01:00:00Z',
      });
  });
  app.get('/api/me/certifications', (req, res) => {
    const user = identity(req);
    if (!user) return res.status(401).json({ message: '请登录' });
    const automatic = automaticCertifications({
      role: user.role,
      full_name: user.fullName,
      student_id: user.studentId,
    });
    return res.json({
      fullName: user.fullName,
      automatic,
      managedSlots: automatic.map((item) => item.education || item.type),
      approved:
        user.role === 'teacher'
          ? [
              {
                type: 'teacher',
                verifiedName: user.fullName,
                institution: '清华大学电子系',
                status: 'approved',
              },
            ]
          : [],
      requests: certificationRequests.filter((row) => row.userId === user.id),
      suggestion: null,
    });
  });
  app.post('/api/me/certifications', async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const managed = automaticCertifications({
      role: user.role,
      full_name: user.fullName,
      student_id: user.studentId,
    });
    const slot = req.body.type === 'education' ? req.body.education : req.body.type;
    if (managed.some((item) => (item.education || item.type) === slot))
      return res.status(409).json({
        code: 'automatic_identity_managed',
        message: '此身份已由账号绑定信息识别，无需重复申请。',
      });
    certificationRequests.push({
      ...req.body,
      userId: user.id,
      id: certificationRequests.length + 1,
      status: 'pending',
    });
    res.json({ message: '本地演示申请已提交，未发送邮件。' });
  });
  app.get('/api/admin/certifications', async (req, res) => {
    if (await requireAdmin(req, res))
      res.json({ requests: [], total: 0, page: 1, pageSize: 30, pendingCount: 0 });
  });
  app.use(learning.app);
  app.get('/api/courses', (_req, res) => res.json({ courses }));
  app.get('/api/courses/:slug/map', (req, res) =>
    res.json({
      course: { ...fixture.course, slug: req.params.slug, canEditMap: false },
      nodes: fixture.nodes.map((node) => studentNode(node)),
      edges: fixture.edges,
    }),
  );
  app.get('/api/courses/:slug/map/nodes/:point', (req, res) => {
    const node = fixture.nodes.find((item) => item.id === req.params.point);
    if (!node) return res.status(404).json({ message: '演示知识点不存在' });
    return res.json({ course: { ...fixture.course, canEditMap: false }, node: studentNode(node) });
  });
  app.get('/api/course-upload/public/courses/:slug/files', (_req, res) => res.json({ files: [] }));
  app.get('/api/notifications', (_req, res) =>
    res.json({ notifications: [], items: [], unreadCount: 0 }),
  );
  app.get('/api/notifications/unread-count', (_req, res) => res.json({ unreadCount: 0 }));
  app.get('/api/onboarding', (req, res) =>
    res.json({
      version: req.query.version,
      status: 'skipped',
      seenAt: '2026-10-22T01:00:00Z',
      step: 0,
      completedTasks: [],
    }),
  );
  app.get('/api/fortune-config', (_req, res) => res.json({ enabled: false }));
  app.get('/api/admin/registration-whitelist', (_req, res) =>
    res.json({ entries: [], total: 0, page: 1, pageSize: 20, stats: { total: 0, claimed: 0 } }),
  );
  app.get('/api/leaderboard/heat', (_req, res) => res.json({ users: [] }));
  app.get('/api/discussion/boards', (_req, res) => res.json({ boards: [] }));
  app.get('/api/discussion/posts', (_req, res) => res.json({ posts: [], nextCursor: null }));
  app.use('/api', async (req, res) => {
    const route = `/api${req.path}`;
    if (!route.startsWith('/api/auth/') && !identity(req))
      return res.status(401).json({ message: '本地演示请登录' });
    const result = await teacher.handle({
      route,
      method: req.method,
      body: req.body,
      headers: req.headers,
      user: () => identity(req),
    });
    if (!result)
      return res.status(404).json({ message: '本地预览未开放此接口，未连接真实系统或 AI' });
    Object.entries(result.headers || {}).forEach(([key, value]) => res.set(key, value));
    return res.status(result.status || 200).json(result.body);
  });
  const root = path.resolve(__dirname, '../public');
  const pages = {
    '/': 'index.html',
    '/about': 'about.html',
    '/teachers': 'teachers.html',
    '/adminusers': 'adminusers.html',
    '/settings': 'settings.html',
    '/staff': 'staff.html',
    '/world': 'world.html',
    '/course': 'course.html',
    '/knowledge': 'knowledge.html',
    '/login': 'login.html',
    '/guide': 'guide.html',
    '/development': 'development.html',
    '/laboratory': 'laboratory.html',
    '/discussion': 'discussion.html',
    '/privacy': 'privacy.html',
  };
  app.get(Object.keys(pages), async (req, res) => {
    let html = preparePageShell(await fs.readFile(path.join(root, pages[req.path]), 'utf8'));
    const bootstrap = `<script>window.FREEBBS_API_BASE='/api';const demo=new URLSearchParams(location.search).get('as');const demoId={admin:1,teacher:2,unverified:3,student:4,graduate:5,doctor:6}[demo];if(demo==='guest'){document.cookie='freebbs_demo_account=;Path=/;Max-Age=0';localStorage.removeItem('free_bbs_auth_token');localStorage.removeItem('free_bbs_user');}else if(demoId){document.cookie='freebbs_demo_account='+demoId+';Path=/;SameSite=Strict';localStorage.setItem('free_bbs_auth_token','${TOKEN}');localStorage.removeItem('free_bbs_user');}if(!localStorage.getItem('free_bbs_theme_mode'))localStorage.setItem('free_bbs_theme_mode','light');</script>`;
    const notice =
      '<details data-about-teachers-preview style="margin:12px;padding:12px;background:#143d45;color:white"><summary>关于平台与教师参与 · 本地演示，未发布</summary><p>所有账号、课程关系和意见均为内存演示，未连接生产、数据库或真实 AI。</p><p>邮箱建议、验证码与绑定均为本地模拟，不修改真实白名单，不发送邮件。</p><p><a style="color:white" href="/about?as=guest">关于平台（访客）</a> · <a style="color:white" href="/teachers?as=teacher">教师</a> · <a style="color:white" href="/teachers?as=unverified">未认证</a> · <a style="color:white" href="/adminusers?as=admin">管理员</a></p></details>';
    html = html
      .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, '')
      .replace(
        '</head>',
        '<link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"><link rel="stylesheet" href="/desktop-shell.css"><link rel="stylesheet" href="/personal-polish.css"></head>',
      )
      .replace(
        '</body>',
        '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script><script src="/desktop-shell.js" defer></script></body>',
      )
      .replace('</head>', `${bootstrap}</head>`)
      .replace('</body>', `${notice}</body>`);
    res.type('html').send(html);
  });
  app.get(['/app.js', '/notifications.js', '/username-guard.js'], async (req, res) =>
    res
      .type('js')
      .send(patchScript(await fs.readFile(path.join(root, req.path.slice(1)), 'utf8'), req.path)),
  );
  app.use(
    '/vendor',
    express.static(path.resolve(__dirname, '../node_modules'), { index: false, dotfiles: 'deny' }),
  );
  app.use((req, res, next) =>
    /\.(?:css|js|woff2?|otf|ttf|svg|png|webp|ico)$/.test(req.path)
      ? next()
      : res.status(404).send('本地教师体验预览未开放此页面'),
  );
  app.use(express.static(root, { index: false, dotfiles: 'deny' }));
  return { server, teacher, assignments, writes, certificationRequests };
}
if (require.main === module) {
  const preview = createAboutTeachersPreview();
  preview.server.listen(Number(process.env.ABOUT_TEACHERS_PREVIEW_PORT || 3191), '127.0.0.1', () =>
    console.log(
      `Local about/teacher preview: http://127.0.0.1:${preview.server.address().port}/about?as=guest`,
    ),
  );
}
module.exports = { createAboutTeachersPreview };
