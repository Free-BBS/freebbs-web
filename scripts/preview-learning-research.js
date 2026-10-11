// Local-only integrated research lab. Synthetic identities, memory data and simulated AI.
const express = require('express');
const crypto = require('node:crypto');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const {
  createLearningPreviewApi,
  createSimulatedLearningChat,
} = require('./preview-learning-workspace');
const {
  createMemoryResearchStore,
  createLearningResearchRouter,
  validateStudy,
  validateFeedback,
} = require('../backend/learning-research');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { TOKEN } = require('./preview-economy');

const TOKENS = {
  student: TOKEN,
  other: 'research-preview-only-other',
  admin: 'research-preview-only-admin',
};
const USERS = {
  student: { id: 1, uid: 'u_preview01', username: 'NotingSr_preview', role: 'student' },
  other: { id: 2, uid: 'u_preview02', username: 'another_student', role: 'student' },
  admin: {
    id: 9,
    uid: 'u_research09',
    username: 'research_preview_admin',
    role: 'admin',
    isAdmin: true,
    is_admin: true,
  },
};
function definition() {
  const prompts = {
    baseline: ['线性时不变系统的零状态输出如何求得？', '卷积模型需要哪些条件？'],
    post: ['输入拆成微小片段后，如何组合每份响应？', '当前例子的卷积推导适用于什么情况？'],
    delayed: ['稍后再想一想，为什么各份响应可以相加？', '能否给任意非线性系统直接使用该卷积公式？'],
    transfer: [
      '将模型用于新的传感器响应时，应先核查什么？',
      '系统响应随时刻改变时，原来的固定卷积核是否仍适用？',
    ],
  };
  return validateStudy({
    requestKey: crypto.randomUUID(),
    title: '演示研究：卷积理解与应用（非正式题目）',
    description: '本地演示四阶段操作与统计；示例题未经正式效度验证，不代表真实教学成效。',
    knowledgeTarget: '解释响应叠加，并核查线性、时不变与零状态条件。',
    comparability: '前后与间隔阶段均覆盖叠加和适用条件；难度等价性仍需课程部审题与试测。',
    selectionNote: '演示为自愿参加的观察性研究，无随机对照，不能归因平台。',
    questionVersion: 'local-demo-v1',
    modules: ['learning', 'max'],
    minDelayedHours: 24,
    phases: Object.fromEntries(
      Object.entries(prompts).map(([phase, texts]) => [
        phase,
        texts.map((prompt, index) => ({
          id: `${phase}_${index + 1}`,
          prompt,
          options: [
            {
              id: 'a',
              label:
                index === 0
                  ? '依据 LTI 条件，将移位、缩放的响应叠加；新情境先核查模型条件'
                  : '只在满足模型条件时适用；条件变化需要重新建模',
            },
            { id: 'b', label: '不需要核查条件，所有系统都可以直接套用同一公式' },
          ],
          correctOption: 'a',
        })),
      ]),
    ),
  });
}

async function createResearchPreview({ seed = true } = {}) {
  const preview = createCompleteLearningPreview({
    extraPages: { '/adminusers': 'adminusers.html' },
    transformHtml(html) {
      return html
        .replace(
          `localStorage.setItem('free_bbs_auth_token','${TOKEN}');`,
          `const researchPreviewRole=new URLSearchParams(location.search).get('as')||localStorage.getItem('free_bbs_research_preview_role')||'student';localStorage.setItem('free_bbs_research_preview_role',researchPreviewRole);localStorage.setItem('free_bbs_auth_token',(${JSON.stringify(TOKENS)})[researchPreviewRole]||${JSON.stringify(TOKEN)});`,
        )
        .replace(
          '</body>',
          '<p style="margin:16px;font:14px/1.6 system-ui">平台研究预览：全部账号、统计与研究题均为假设演示数据，不代表真实用户或学习成效。Max 为模拟回答。<a href="/knowledge?course=signals&amp;point=SS-01-01&amp;view=reading&amp;as=student">同页 Max</a> · <a href="/profile?as=student#personal-platform-research">本人反馈与研究</a> · <a href="/adminusers?as=admin#admin-platform-research">战略部研究</a></p></body>',
        );
    },
  });
  let now = new Date();
  const identity = (req) =>
    USERS[
      Object.entries(TOKENS).find(
        ([, token]) => req.headers.authorization === `Bearer ${token}`,
      )?.[0]
    ];
  const auth = async (req, res) => {
    const user = identity(req);
    if (!user) res.status(401).json({ message: '预览身份未登录' });
    return user || null;
  };
  const requireAdmin = async (req, res) => {
    const user = await auth(req, res);
    if (user && !user.isAdmin) {
      res.status(403).json({ message: '仅管理员可查看' });
      return null;
    }
    return user;
  };
  const learning = createLearningPreviewApi({
    contextRows: preview.learning.analyticsStore.contexts,
    previewUsers: Object.values(USERS),
    managers: [],
    identity,
  });
  const syntheticUsers = Array.from({ length: 8 }, (_, i) => ({ id: i + 20 }));
  const researchStore = createMemoryResearchStore({
    users: [...Object.values(USERS), ...syntheticUsers],
    clock: () => new Date(now),
  });
  const study = (await researchStore.addStudy(9, definition())).study;
  if (seed) {
    const initial = now;
    now = new Date(initial.getTime() - 72 * 3600000);
    for (const [index, user] of syntheticUsers.entries()) {
      await researchStore.addFeedback(
        user.id,
        validateFeedback({
          requestKey: crypto.randomUUID(),
          module: ['learning', 'max', 'workbench', 'discussion'][index % 4],
          purpose: ['understand', 'practice', 'explore', 'plan'][index % 4],
          helpfulness: index % 5,
          barriers: [['navigation'], ['support'], ['technical'], ['none']][index % 4],
          outcomes: [['clarity'], ['independence'], ['exploration'], ['direction']][index % 4],
          comment: '合成演示反馈：不是真实使用数据',
          consent: true,
        }),
      );
      await researchStore.join(user.id, study.id, {
        requestKey: crypto.randomUUID(),
        consent: true,
        goal: 'understand',
      });
      await researchStore.attempt(user.id, study.id, {
        requestKey: crypto.randomUUID(),
        phase: 'baseline',
        answers: { baseline_1: index % 2 ? 'a' : 'b', baseline_2: 'b' },
        assistance: 'none',
      });
    }
    now = new Date(initial.getTime() - 48 * 3600000);
    for (const user of syntheticUsers.slice(0, 6))
      await researchStore.attempt(user.id, study.id, {
        requestKey: crypto.randomUUID(),
        phase: 'post',
        answers: { post_1: 'a', post_2: user.id % 2 ? 'a' : 'b' },
        assistance: user.id % 3 ? 'none' : 'max',
      });
    now = initial;
    for (const user of syntheticUsers.slice(0, 5)) {
      await researchStore.attempt(user.id, study.id, {
        requestKey: crypto.randomUUID(),
        phase: 'delayed',
        answers: { delayed_1: 'a', delayed_2: user.id % 2 ? 'a' : 'b' },
        assistance: 'none',
      });
      await researchStore.attempt(user.id, study.id, {
        requestKey: crypto.randomUUID(),
        phase: 'transfer',
        answers: { transfer_1: 'a', transfer_2: user.id % 2 ? 'a' : 'b' },
        assistance: 'none',
      });
    }
  }
  const requests = [];
  const faults = { feedbackUnavailable: false };
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/learning/research', (req, res, next) =>
    req.path === '/feedback' && req.method === 'POST' && faults.feedbackUnavailable
      ? res.status(503).json({ message: '预览模拟保存失败' })
      : next(),
  );
  app.use(
    '/api/learning/research',
    createLearningResearchRouter({ store: researchStore, requireAuth: auth, requireAdmin }),
  );
  app.post(
    '/api/ai/knowledge/chat',
    createSimulatedLearningChat({
      identity,
      assessmentStore: learning.assessmentStore,
      learningStore: learning.store,
      requests,
    }),
  );
  app.use(learning.app);
  const [original] = preview.server.listeners('request');
  preview.server.removeListener('request', original);
  preview.server.on('request', (req, res) => {
    const host = `127.0.0.1:${preview.server.address()?.port}`;
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      res.writeHead(403);
      return res.end('Loopback preview only');
    }
    const route = req.url.split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    if (/^\/api\/learning(?:[/-]|$)/.test(route) || route === '/api/ai/knowledge/chat')
      return app(req, res);
    const user = identity(req);
    const send = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (['/api/auth/me', '/api/profile'].includes(route))
      return user ? send({ user }) : send({ message: '请先登录' }, 401);
    if (route === '/api/admin/users')
      return user?.isAdmin
        ? send({ users: [], permissionCatalog: { boards: [], courses: [] } })
        : send({ message: '仅管理员可查看' }, 403);
    return original(req, res);
  });
  const portSelection = await listenAllowedLoopback(preview.server);
  return {
    ...preview,
    learning,
    researchStore,
    requests,
    faults,
    study,
    TOKENS,
    USERS,
    portSelection,
    base: `http://127.0.0.1:${portSelection.port}`,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
if (require.main === module)
  createResearchPreview()
    .then((preview) => {
      console.log(`本人预览：${preview.base}/profile?as=student#personal-platform-research`);
      console.log(
        `Max 预览：${preview.base}/knowledge?course=signals&point=SS-01-01&view=reading&as=student`,
      );
      console.log(`战略部预览：${preview.base}/adminusers?as=admin#admin-platform-research`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { createResearchPreview, definition, TOKENS, USERS };
