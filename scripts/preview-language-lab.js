// Real isolated runtime, fake local account and in-memory snapshots/posts. No production DB.
const express = require('express');
const { createEconomyPreview, TOKEN } = require('./preview-economy');
const { preparePageShell } = require('../page-shell');
const { createLanguageLabRouter } = require('../backend/language-lab');
const { getDiscussionPreview } = require('../backend/discussion-preview');

function createLabPreview({
  runtimeUrl = process.env.LANGUAGE_LAB_URL || 'http://127.0.0.1:18010',
} = {}) {
  const rows = new Map();
  const posts = [];
  const preview = createEconomyPreview({
    allowVendor: true,
    extraPages: {
      '/code-lab': 'code-lab.html',
      '/laboratory': 'laboratory.html',
      '/publish': 'publish.html',
    },
    previewNotice: '代码实验室联调：使用隔离容器执行，账号、帖子和实验快照仅保存在本地内存。',
    transformHtml: (html) =>
      preparePageShell(html)
        .replace(
          '</head>',
          '<link rel="stylesheet" href="/site-search.css"><link rel="stylesheet" href="/mobile-shell.css"><link rel="stylesheet" href="/desktop-elegant.css"><link rel="stylesheet" href="/page-transitions.css"><link rel="stylesheet" href="/desktop-shell.css"><link rel="stylesheet" href="/personal-polish.css"></head>',
        )
        .replace(
          '</body>',
          '<script src="/site-search.js" defer></script><script src="/mobile-shell.js" defer></script><script src="/page-transitions.js" defer></script><script src="/desktop-shell.js" defer></script></body>',
        ),
    extraApi: async ({ route, method, body }) => {
      if (route === '/api/discussion/posts' && method === 'POST') {
        const post = {
          id: `p_lab${posts.length}`,
          title: body.title,
          content: body.contentMarkdown,
          contentMarkdown: body.contentMarkdown,
          board: { slug: 'daily', name: '日常' },
          boardSlug: 'daily',
          author: { uid: 'u_preview01', username: '本地测试用户' },
          preview: getDiscussionPreview(
            body.contentMarkdown,
            `http://127.0.0.1:${preview.server.address().port}`,
          ),
          createdAt: new Date().toISOString(),
          canEdit: true,
        };
        posts.unshift(post);
        return { body: { post } };
      }
      if (route.startsWith('/api/discussion/posts/p_lab'))
        return { body: { post: posts[0], comments: [] } };
      if (route === '/api/discussion/posts' && method === 'GET' && posts.length)
        return { body: { posts, hasMore: false } };
      return null;
    },
  });
  const original = preview.server.listeners('request')[0];
  preview.server.removeAllListeners('request');
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use(
    '/api/labs',
    createLanguageLabRouter({
      runtimeUrl,
      pool: {
        async execute(sql, args) {
          if (sql.startsWith('INSERT'))
            rows.set(args[0], { eid: args[0], title: args[2], document_json: args[3] });
          if (sql.startsWith('SELECT')) return [[rows.get(args[0])].filter(Boolean)];
          return [[]];
        },
      },
      requireAuth: async (req, res) => {
        if (req.headers.authorization === `Bearer ${TOKEN}`) return { id: 1 };
        res.status(401).json({ message: '仅限本地测试账号' });
        return null;
      },
    }),
  );
  preview.server.on('request', (req, res) =>
    req.url.startsWith('/api/labs/') ? app(req, res) : original(req, res),
  );
  return { ...preview, rows, posts };
}
if (require.main === module)
  createLabPreview().server.listen(3118, '127.0.0.1', () =>
    console.log('Lab preview: http://127.0.0.1:3118/code-lab'),
  );
module.exports = { createLabPreview };
