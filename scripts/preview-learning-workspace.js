// Isolated local acceptance lab: real UI/router, memory records and explicitly simulated AI.
const express = require('express');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const syncFs = require('node:fs');
const crypto = require('node:crypto');
const { createLearningWorkspaceRouter } = require('../backend/learning-workspace');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');
const { createCourseRelationsMap } = require('./fixtures/course-relations-map');
const {
  createLearningAssessmentRouter,
  createMemoryAssessmentStore,
  stripAssessmentBlocks,
  getAssessmentDocumentVersion,
} = require('../backend/learning-assessment');
const {
  createLearningAnalyticsRouter,
  createMemoryAnalyticsStore,
  recordAssessmentEvent,
} = require('../backend/learning-analytics');
const {
  createLearningStarsRouter,
  createLearningStarService,
  createMemoryLearningStarStore,
} = require('../backend/learning-stars');
const { patchScript } = require('./preview-home');
const { preparePageShell } = require('../page-shell');
const { parse } = require('../docs/course-authoring/tools/整理知识点.cjs');
const { check } = require('../docs/course-authoring/tools/检查课程包.cjs');
const { loadCompanionContext, companionHint } = require('../backend/learning-companion');
const { promptHintFromPreference } = require('../public/learning-start');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const users = {
  student: {
    id: 1,
    uid: 'u_learning01',
    username: 'demo_student',
    fullName: '演示同学',
    role: 'student',
  },
  other: {
    id: 2,
    uid: 'u_learning02',
    username: 'another_student',
    fullName: '另一位同学',
    role: 'student',
  },
  manager: {
    id: 3,
    uid: 'u_learning03',
    username: 'course_teacher',
    fullName: '课程负责人',
    role: 'student',
  },
  admin: {
    id: 4,
    uid: 'u_learning04',
    username: 'demo_admin',
    fullName: '演示管理员',
    role: 'admin',
    isAdmin: true,
    is_admin: true,
  },
};
const course = { slug: 'signals', name: '信号与系统', boardSlug: 'signal', canEditMap: false };
const exampleRoot = path.join(root, 'docs/course-authoring/examples');
const sample = check(exampleRoot, { allowDemo: true });
const nodes = sample.nodes.map((item) => {
  const folder = item.id.endsWith('-00') ? '章节' : '知识点';
  const parsed = parse(
    syncFs.readFileSync(path.join(exampleRoot, folder, `${item.id}.md`), 'utf8'),
    { allowDemo: true },
  );
  return {
    ...parsed,
    markdown: parsed.sections.knowledgeMarkdown,
    hasDocument: true,
    chapterTitle: parsed.metadata['章节/单元'],
    position: sample.positions[item.id],
  };
});
const node = nodes.find((item) => item.id === 'SS-01-01');
const previewQuiz = {
  schemaVersion: 1,
  status: 'published',
  version: 'preview-1',
  source: '本地验收夹具，非正式课程题目',
  reviewedBy: '本地演示课程组',
  questions: [
    {
      id: 'SS-01-01-Q-preview',
      type: 'single_choice',
      prompt: '连续时间 LTI 系统的输出通常怎样表示？',
      options: [
        { id: 'A', text: '输入与冲激响应的卷积' },
        { id: 'B', text: '总是等于输入本身' },
      ],
      scoring: { method: 'exact', answer: 'A', maxScore: 1, passScore: 1 },
      explanation: '对线性时不变系统，y(t)=x(t)*h(t)。',
    },
    {
      id: 'SS-01-01-Q-explain',
      type: 'short_answer',
      prompt: '用自己的话解释卷积中的响应叠加。',
      scoring: {
        method: 'manual',
        rubric: '解释输入拆分、移位响应与线性叠加。',
        maxScore: 3,
        passScore: 2,
      },
      explanation: '课程组依据解题过程复核。',
    },
  ],
};
// Replace the authoring demo block in memory; a node can have only one scoring block.
// This does not modify the original Markdown example or publish a real course quiz.
node.sections.knowledgeMarkdown = `${stripAssessmentBlocks(node.sections.knowledgeMarkdown)}\n\n\`\`\`freebbs-quiz\n${JSON.stringify(previewQuiz, null, 2)}\n\`\`\`\n`;
node.markdown = node.sections.knowledgeMarkdown;
// Publish only the isolated demo copy, never the course group's draft file.
const layeredNode = nodes.find((item) => item.id === 'SS-02-01');
if (layeredNode) {
  layeredNode.sections.knowledgeMarkdown = layeredNode.sections.knowledgeMarkdown.replace(
    /(```freebbs-quiz\s*\n)([\s\S]*?)(\n```)/,
    (block, start, source, end) => {
      const quiz = JSON.parse(source);
      return `${start}${JSON.stringify(
        { ...quiz, status: 'published', reviewedBy: '本地演示复核（不是正式课程审核）' },
        null,
        2,
      )}${end}`;
    },
  );
  layeredNode.markdown = layeredNode.sections.knowledgeMarkdown;
}
const contexts = nodes.map((item) => ({
  slug: 'signals',
  course_id: 1,
  course_name: course.name,
  node_id: item.id,
  title: item.title,
  basic_info_markdown: item.sections.basicInfoMarkdown,
  applications_markdown: item.sections.applicationsMarkdown,
  knowledge_markdown: item.sections.knowledgeMarkdown,
  summary: item.summary,
  has_relations: sample.edges.some((edge) => edge.source === item.id || edge.target === item.id),
  document_markdown: item.markdown,
  is_active: 1,
}));
nodes.forEach((item) => {
  item.documentVersion = getAssessmentDocumentVersion(item.markdown);
});
function studentNode(item, isManager = false) {
  return {
    ...item,
    markdown: isManager ? item.markdown : stripAssessmentBlocks(item.markdown),
    sections: {
      ...item.sections,
      knowledgeMarkdown: isManager ? item.markdown : stripAssessmentBlocks(item.markdown),
    },
  };
}
function bootstrap() {
  window.FREEBBS_API_BASE = '/api';
  const params = new URLSearchParams(window.location.search);
  const identity = params.get('as') || 'student';
  if (identity === 'guest') localStorage.removeItem('free_bbs_auth_token');
  else localStorage.setItem('free_bbs_auth_token', `learning-preview-${identity}`);
  if (params.has('theme')) localStorage.setItem('free_bbs_theme_mode', params.get('theme'));
  else if (!localStorage.getItem('free_bbs_theme_mode'))
    localStorage.setItem('free_bbs_theme_mode', 'light');
}
// Shared by the learning and onboarding previews. These are the real routers
// with isolated, initially empty memory stores, not pre-painted UI responses.
function createLearningPreviewApi({
  contextRows = contexts,
  previewUsers = Object.values(users),
  managers = [{ userId: 3, courseId: 1 }],
  identity,
  saveUnavailable = () => false,
} = {}) {
  const app = express();
  const store = createMemoryLearningStore();
  store.context = async (slug, point) =>
    contextRows.find((item) => item.slug === slug && item.node_id === point) || null;
  const assessmentStore = createMemoryAssessmentStore({
    contexts: contextRows,
    managers,
  });
  const analyticsStore = createMemoryAnalyticsStore({
    contexts: contextRows,
    users: previewUsers,
    businessAttempts: assessmentStore.rows,
  });
  const starsStore = createMemoryLearningStarStore({ contexts: contextRows, assessmentStore });
  const starService = createLearningStarService({ store: starsStore });
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/learning', (req, res, next) =>
    saveUnavailable() && req.method !== 'GET'
      ? res.status(503).json({ message: '模拟保存失败' })
      : next(),
  );
  app.use(
    '/api/learning',
    createLearningWorkspaceRouter({
      store,
      requireAuth: async (req, res) => {
        const user = identity(req);
        if (!user) res.status(401).json({ message: '预览中请切换到演示同学' });
        return user;
      },
    }),
  );
  app.use(
    '/api/learning-assessments',
    createLearningAssessmentRouter({
      store: assessmentStore,
      onAssessmentEvent: async (event) => {
        await Promise.all([
          starService.recordAssessment(event),
          recordAssessmentEvent(analyticsStore, event),
        ]);
      },
      requireAuth: async (req, res) => {
        const user = identity(req);
        if (!user) res.status(401).json({ message: '请先登录' });
        return user;
      },
    }),
  );
  app.use(
    '/api/learning-analytics',
    createLearningAnalyticsRouter({
      store: analyticsStore,
      requireAuth: async (req, res) => {
        const user = identity(req);
        if (!user) res.status(401).json({ message: '请先登录' });
        return user;
      },
      requireAdmin: async (req, res) => {
        const user = identity(req);
        if (!user?.isAdmin) {
          res.status(user ? 403 : 401).json({ message: '仅管理员可查看' });
          return null;
        }
        return user;
      },
    }),
  );
  app.use(
    '/api/learning-stars',
    createLearningStarsRouter({
      service: starService,
      requireAuth: async (req, res) => {
        const user = identity(req);
        if (!user) res.status(401).json({ message: '请先登录' });
        return user;
      },
    }),
  );
  return { app, store, assessmentStore, analyticsStore, starsStore, starService };
}
function createLearningPreview({ mapNodes = nodes, mapEdges = sample.edges } = {}) {
  const app = express();
  const requests = [];
  let failSave = false;
  const identity = (req) =>
    users[String(req.headers.authorization || '').replace('Bearer learning-preview-', '')];
  const learningApi = createLearningPreviewApi({ identity, saveUnavailable: () => failSave });
  const { store, assessmentStore, analyticsStore, starsStore, starService } = learningApi;
  const server = http.createServer(app);
  app.use((req, res, next) => {
    const host = `127.0.0.1:${server.address()?.port}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    )
      return res.status(403).json({ message: 'Loopback preview only' });
    res.set('Cache-Control', 'no-store');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'; base-uri 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/auth/me', (req, res) =>
    identity(req)
      ? res.json({ user: identity(req) })
      : res.status(401).json({ message: '预览访客' }),
  );
  app.use(learningApi.app);
  app.get('/api/courses/signals/map', (req, res) =>
    res.json({
      course: { ...course, canEditMap: identity(req)?.id === 3 },
      nodes: mapNodes.map((item) => studentNode(item, identity(req)?.id === 3)),
      edges: mapEdges,
    }),
  );
  app.get('/api/courses/signals/map/nodes/:point', (req, res) => {
    const detail = mapNodes.find((item) => item.id === req.params.point);
    if (!detail) return res.status(404).json({ message: '本地预览知识点不存在' });
    return res.json({
      course: { ...course, canEditMap: identity(req)?.id === 3 },
      node: studentNode(detail, identity(req)?.id === 3),
    });
  });
  app.post('/api/ai/knowledge/chat', async (req, res) => {
    if (!identity(req)) return res.status(401).json({ message: '请先登录' });
    requests.push(req.body);
    if (String(req.body.question).includes('模拟失败'))
      return res.status(503).json({ message: '模拟 AI 不可用' });
    let trustedContext;
    try {
      trustedContext = await loadCompanionContext({
        store: assessmentStore,
        user: identity(req),
        rawContext: req.body.context,
      });
    } catch (error) {
      return res.status(error.status || 503).json({ message: error.message });
    }
    req.body.trustedCompanionContext = trustedContext;
    req.body.trustedCompanionHint = companionHint(trustedContext);
    const strategy = promptHintFromPreference(
      trustedContext.learningStartPreference,
      trustedContext.resources,
    );
    const concern = req.body.question.includes('下一步学习建议');
    const answer = concern
      ? `**本地演示建议（非真实 AI）**\n\n${req.body.history?.length ? '你刚才提到了卷积的理解问题。' : '目前还没有足够的对话，先给你一个起步办法。'}暂时没理解，不意味着你学不会；我们可以把目标缩小一点。\n\n1. 先画一个矩形脉冲，观察它经过系统后的变化。\n2. 回看“线性”的含义，只确认叠加这一步，不急着完成整段推导。\n3. 用自己的话解释一次“把每份响应加起来”，把仍然不清楚的地方记在复盘里。\n\n累了可以休息一下；也可以带着具体的一步，和同学或老师一起讨论。`
      : `**本地模拟回答（不是实时 AI）**\n\n${
          trustedContext.learningStartPreference?.level === 'new'
            ? '我们先从基本原理开始：单位冲激响应描述系统对一个单位脉冲的响应。对于零状态线性时不变系统，每一小份输入引起平移、缩放的响应；把这些响应累加，就得到卷积。先确认线性、时不变和零状态条件，再看正文示例。'
            : trustedContext.learningStartPreference?.goal === 'explore'
              ? '可以从模型边界探索：零状态、线性和时不变假设分别起什么作用？先对照官方正文，再尝试构造一个不满足条件的例子。没有验证的类比只作为待检验问题。'
              : '先核对当前题目的条件，再独立尝试。需要时可请求一个步骤提示，完成后对照解析和常见误区。'
        }\n\n当前页面与右侧 Max 使用同一套学习选择。${strategy ? '模拟服务已接收受控策略。' : '尚未提供确认后的起点。'}正式判分不由此回答决定。`;
    res.type('text/event-stream');
    res.end(`data: ${JSON.stringify({ delta: answer })}\n\n`);
  });
  app.get('/api/onboarding', (req, res) =>
    res.json({ version: req.query.version, status: 'skipped', seenAt: '2026-09-30T00:00:00Z' }),
  );
  app.get('/api/leaderboard/heat', (req, res) => res.json({ users: [] }));
  app.get('/api/courses', (req, res) => res.json({ courses: [course] }));
  app.get('/api/discussion/posts', (req, res) => res.json({ posts: [], nextCursor: null }));
  app.get('/api/discussion/boards', (req, res) =>
    res.json({ boards: [{ slug: 'signal', name: '信号与系统' }] }),
  );
  app.get('/api/fortune-config', (req, res) => res.json({ enabled: false }));
  app.get('/api/notifications', (req, res) => res.json({ items: [], unreadCount: 0 }));
  app.get('/api/users/:uid/public-profile', (req, res) => {
    const user = Object.values(users).find((item) => item.uid === req.params.uid);
    if (!user) return res.status(404).json({ message: '演示用户不存在' });
    return res.json({ profile: { ...user, postCount: 0, likeCount: 0, bio: '本地演示资料' } });
  });
  app.get('/api/admin/users', (req, res) =>
    identity(req)?.isAdmin
      ? res.json({ users: Object.values(users), permissions: {} })
      : res.status(403).json({ message: '仅管理员可查看' }),
  );
  app.use('/api', (req, res) => res.status(404).json({ message: '隔离预览未开放此接口' }));
  app.get('/__learning-bootstrap.js', (req, res) =>
    res.type('js').send(`(${bootstrap.toString()})();`),
  );
  app.get(['/', '/knowledge', '/course', '/profile', '/adminusers'], async (req, res) => {
    if (req.path === '/') return res.redirect('/course?course=signals');
    const file = {
      '/course': 'course.html',
      '/knowledge': 'knowledge.html',
      '/profile': 'profile.html',
      '/adminusers': 'adminusers.html',
    }[req.path];
    let html = preparePageShell(await fs.readFile(path.join(publicRoot, file), 'utf8'));
    html = html
      .replace(/<link\b[^>]*href=["']https?:[^>]*>/gi, '')
      .replace(
        '</head>',
        '<script src="/__learning-bootstrap.js"></script><link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"><link rel="stylesheet" href="/desktop-shell.css"><link rel="stylesheet" href="/personal-polish.css"></head>',
      )
      .replace(
        '</body>',
        '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script><script src="/desktop-shell.js" defer></script><details data-learning-preview style="margin:12px;padding:12px;background:#edf5f5;color:#173e46;font:14px/1.5 system-ui"><summary>本地学习区验收 · 模拟 AI、内存记录，不连接真实账号</summary><p><a href="/course?course=signals">章节目录</a> · <a href="/knowledge?course=signals&point=SS-01-00&view=reading">章网络图</a> · <a href="/knowledge?course=signals&point=SS-01-01&as=student">同学</a> · <a href="/knowledge?course=signals&point=SS-01-01&as=other&tool=notes">另一账号</a> · <a href="/knowledge?course=signals&point=SS-01-01&as=manager&tool=contribute">课程组</a> · <a href="/knowledge?course=signals&point=SS-01-01&as=guest">访客</a></p></details></body>',
      );
    if (mapNodes !== nodes)
      html = html.replace(
        '<summary>本地学习区验收',
        '<summary>本地关系图夹具 · Markdown不是正式教材 · 本地学习区验收',
      );
    res.type('html').send(html);
  });
  app.get(['/app.js', '/notifications.js', '/username-guard.js'], async (req, res) =>
    res
      .type('js')
      .send(
        patchScript(await fs.readFile(path.join(publicRoot, req.path.slice(1)), 'utf8'), req.path),
      ),
  );
  app.use(
    '/vendor',
    express.static(path.join(root, 'node_modules'), { index: false, dotfiles: 'deny' }),
  );
  app.use((req, res, next) =>
    /\.(?:css|js|woff2?|otf|ttf|svg|png|webp|ico)$/.test(req.path)
      ? next()
      : res.status(404).send('仅供知识点学习页预览'),
  );
  app.use(express.static(publicRoot, { index: false, dotfiles: 'deny' }));
  return {
    server,
    store,
    assessmentStore,
    analyticsStore,
    starsStore,
    starService,
    requests,
    setFailSave: (value) => {
      failSave = value;
    },
  };
}
// Seed only through the real, loopback-only submission/review routes. No UI stars are forged.
async function seedLearningEvidence(preview) {
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  async function call(identity, endpoint, method, body) {
    const response = await fetch(`${base}/api${endpoint}`, {
      method: method || 'GET',
      headers: {
        authorization: `Bearer learning-preview-${identity}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.message || `Preview fixture failed: ${response.status}`);
    return result;
  }
  for (const identity of ['student', 'other']) {
    await call(identity, '/learning-analytics/preferences', 'PUT', { enabled: true });
    for (const tool of ['content', 'feedback', 'continue'])
      await call(identity, '/learning-analytics/events', 'POST', {
        requestKey: crypto.randomUUID(),
        courseSlug: 'signals',
        nodeId: 'SS-01-01',
        type: 'navigation',
        metadata: {
          action: tool === 'content' ? 'visit' : 'tool_open',
          tool,
          sessionId: crypto.randomUUID(),
        },
      });
  }
  const endpoint = '/learning-assessments/signals/SS-01-01';
  const questions = (await call('student', `${endpoint}/questions`)).questions;
  const objective = questions.find((item) => item.type === 'single_choice');
  const subjective = questions.find((item) => item.type === 'short_answer');
  const submit = (identity, question, answer) =>
    call(identity, `${endpoint}/attempts`, 'POST', {
      questionId: question.id,
      answer,
      mode: 'selftest',
      requestKey: crypto.randomUUID(),
    });
  await submit('student', objective, 'B');
  await submit('student', objective, 'A');
  const first = await submit('student', subjective, '本地模拟：尚未说明响应叠加。');
  await call('manager', `${endpoint}/attempts/${first.attempt.id}/review`, 'POST', {
    score: 0,
    feedback: '本地模拟复核：补充输入拆分与线性叠加。',
  });
  const correction = await submit(
    'student',
    subjective,
    '本地模拟：将输入拆为移位脉冲，分别求响应，再利用线性叠加。',
  );
  await call('manager', `${endpoint}/attempts/${correction.attempt.id}/review`, 'POST', {
    score: 3,
    feedback: '本地模拟复核：已说明拆分、移位和叠加。',
  });
  await submit('other', objective, 'B');
  await submit('other', subjective, '本地模拟：等待课程组反馈。');
}
if (require.main === module) {
  const demo = process.env.LEARNING_PREVIEW_RELATIONS_DEMO === '1';
  const fixture = demo ? createCourseRelationsMap() : null;
  const preview = createLearningPreview(
    fixture ? { mapNodes: fixture.nodes, mapEdges: fixture.edges } : {},
  );
  const { server: previewServer } = preview;
  previewServer.on('error', (error) => {
    console.error(
      `预览未启动：${error.code || error.message}。端口被占用时可设置 LEARNING_PREVIEW_PORT=0 自动选择空闲端口。`,
    );
    process.exitCode = 1;
  });
  previewServer.listen(Number(process.env.LEARNING_PREVIEW_PORT || 3152), '127.0.0.1', async () => {
    try {
      if (process.env.LEARNING_PREVIEW_EVIDENCE_DEMO === '1') await seedLearningEvidence(preview);
      console.log(
        `Learning preview: http://127.0.0.1:${previewServer.address().port}/course?course=signals (simulated AI and memory records; no DB${demo ? '; local relations fixture, not formal course materials' : ''})`,
      );
      console.log(
        `Admin evidence: http://127.0.0.1:${previewServer.address().port}/adminusers?as=admin`,
      );
    } catch (error) {
      console.error('Learning preview fixture failed:', error.message);
      previewServer.close();
      process.exitCode = 1;
    }
  });
}
module.exports = { createLearningPreview, createLearningPreviewApi, seedLearningEvidence, users };
