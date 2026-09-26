// Isolated visual/interaction preview. Only fake local accounts and in-memory actions.
const { createEconomyPreview } = require('./preview-economy');
const { preparePageShell } = require('../page-shell');

function createPersonalPreview() {
  const emailPreferences = {
    reply: true,
    reaction: true,
    commentLike: true,
    announcement: true,
    weeklyDigest: false,
    aiTask: true,
  };
  const dialogs = ['从直觉理解傅里叶变换', '电路里的负反馈为什么有用', '一起规划这周的学习'].map(
    (title, index) => ({
      did: `preview-dialog-${index + 1}`,
      title,
      updatedAt: '2026-09-26T04:00:00Z',
      messages: [
        { role: 'user', content: title },
        {
          role: 'assistant',
          content:
            '这是本地演示对话，不是真实 AI 的回答。\n\n可以从一个简单的例子出发，先观察现象，再试着解释背后的原理。你也可以用电路实验室来验证自己的想法。',
        },
      ],
    }),
  );
  return createEconomyPreview({
    allowVendor: true,
    accounts: [
      {
        id: 1,
        adopted: true,
        assets: {
          max_pet: 1,
          fish: 20,
          rubber_rod: 1,
          frame_orbit: 1,
          frame_aurora: 1,
          card_twilight: 1,
          card_blueprint: 1,
          plate_observer: 1,
        },
        woolReady: 2,
        woolStored: 1,
        electric: 40,
        magnetic: 30,
        heat: 13,
        fedUntilMs: Date.now() + 86400000,
      },
      {
        id: 2,
        adopted: true,
        assets: { max_pet: 1 },
        equipped: { card: 'card_twilight' },
        woolReady: 1,
      },
    ],
    previewNotice:
      '全站 UI 本地实验：对话、资料与资产均为演示数据；喂养和剪毛只操作内存，不连接真实账号、AI 或数据库',
    extraPages: {
      '/': 'index.html',
      '/about': 'about.html',
      '/staff': 'staff.html',
      '/laboratory': 'laboratory.html',
      '/code-lab': 'code-lab.html',
      '/pbl': 'pbl.html',
      '/creative-workshop': 'creative-workshop.html',
      '/tool-workshop': 'tool-workshop.html',
      '/aichat': 'aichat.html',
      '/development': 'development.html',
      '/surveys': 'surveys.html',
      '/circuits': 'circuit.html',
      '/circuit-challenge': 'circuit-challenge.html',
    },
    transformHtml: (html) =>
      preparePageShell(html)
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"><link rel="stylesheet" href="/desktop-shell.css"><link rel="stylesheet" href="/personal-polish.css"></head>',
        )
        .replace(
          '</body>',
          '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script><script src="/desktop-shell.js" defer></script></body>',
        )
        .replace('Max 新手导览实验 · 本地模拟 · 未发布', '个人空间与全站导航 · 本地模拟 · 未发布'),
    extraApi: async ({ route, method, body, user }) => {
      if (route === '/api/tools' && method === 'GET') return { body: { tools: [] } };
      if (route.startsWith('/api/tools'))
        return {
          status: 503,
          body: { message: '本地预览不生成或发布小工具，请在线上使用已开放的工坊' },
        };
      if (route === '/api/auth/me' || route === '/api/profile')
        return {
          body: {
            user: {
              ...user(),
              bio: '在探索中理解世界，在分享中遇见同路人\n本地演示资料，不对应真实账号',
              websiteUrl: '',
            },
          },
        };
      if (route === '/api/ai/models')
        return {
          body: {
            defaultModel: 'preview',
            models: [
              {
                id: 'preview',
                name: '本地展示 · 未连接 AI',
                label: '本地展示',
                vision: false,
                efforts: ['auto'],
                defaultEffort: 'auto',
              },
            ],
          },
        };
      if (route === '/api/ai/dialogs' && method === 'GET') return { body: { dialogs } };
      if (route.startsWith('/api/ai/dialogs/') && method === 'GET') {
        const dialog = dialogs.find((item) => item.did === route.split('/').pop());
        return dialog ? { body: { dialog } } : { status: 404, body: { message: '未找到演示对话' } };
      }
      if (route === '/api/ai/tasks/latest') return { body: { task: null } };
      if (route.startsWith('/api/ai/'))
        return { status: 503, body: { message: '本地视觉预览不调用真实 AI，可查看左侧演示对话' } };
      if (route === '/api/notifications/email-preferences') {
        if (method === 'PATCH') {
          if (
            Object.keys(body).some(
              (key) => !Object.hasOwn(emailPreferences, key) || typeof body[key] !== 'boolean',
            )
          )
            return { status: 400, body: { message: '无效的模拟通知偏好' } };
          Object.assign(emailPreferences, body);
        } else if (method !== 'GET')
          return { status: 405, body: { message: '仅支持读取与保存模拟偏好' } };
        return { body: { preferences: { ...emailPreferences } } };
      }
      if (route === '/api/leaderboard/heat') return { body: { users: [] } };
      return null;
    },
  });
}
if (require.main === module) {
  const { server } = createPersonalPreview();
  const port = Number(process.env.PERSONAL_PREVIEW_PORT || 3133);
  server.listen(port, '127.0.0.1', () =>
    console.log(`Personal UI preview: http://127.0.0.1:${port} (memory only)`),
  );
}
module.exports = { createPersonalPreview };
