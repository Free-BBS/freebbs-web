// Read-only, loopback-only visual lab. No database, remote API, or real session.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const publicRoot = path.resolve(__dirname, '../public');
const PORT = 3107;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
};

const boards = [
  {
    slug: 'signal',
    name: '信号与系统',
    postCount: 8,
    commentCount: 18,
    reactionCount: 10,
    interactionCount: 28,
  },
  {
    slug: 'circuit',
    name: '电子电路与系统',
    postCount: 6,
    commentCount: 12,
    reactionCount: 8,
    interactionCount: 20,
  },
  {
    slug: 'math',
    name: '数学基础',
    postCount: 4,
    commentCount: 10,
    reactionCount: 5,
    interactionCount: 15,
  },
];
const titles = [
  '从时域到频域：傅里叶变换究竟改变了什么？',
  '搭了一阶 RC 电路，想和大家聊聊时间常数',
  '微积分里的“无限接近”，该怎么直观理解？',
  '卷积为什么要先翻转，再平移？',
  '电流镜的两条支路，为什么不是完全相同的电流？',
  '学习经验分享：给自己画一张知识关系图',
];
const users = ['demo_alpha', 'demo_beta', 'demo_gamma', 'demo_delta', 'demo_epsilon'].map(
  (username, index) => ({
    uid: `demo-${index}`,
    username,
    nickname: username,
    heat: 42 - index * 6,
    avatarPath: '/assets/avatar_placeholder.webp',
  }),
);

function patchScript(source, pathname) {
  const pattern =
    pathname === '/app.js'
      ? /^const API_BASE_URL = \(\(\) => \{[\s\S]*?\r?\n\}\)\(\);/
      : new RegExp(
          `^  const ${pathname === '/notifications.js' ? 'apiBase' : 'api'} = local \\?[^;\\r\\n]+;`,
          'm',
        );
  if (!pattern.test(source))
    throw new Error('Preview API patch no longer matches; refusing to serve script');
  const name =
    pathname === '/app.js' ? 'API_BASE_URL' : pathname === '/notifications.js' ? 'apiBase' : 'api';
  return source.replace(pattern, `const ${name} = '/api';`);
}

function previewBootstrap() {
  const params = new URLSearchParams(window.location.search);
  // Preview uses its own origin. Never copy a real token or user into the lab.
  localStorage.removeItem('free_bbs_auth_token');
  if (params.get('session') === 'member')
    localStorage.setItem('free_bbs_auth_token', 'home-preview-only');
  if (params.has('theme'))
    localStorage.setItem('free_bbs_theme_mode', params.get('theme') === 'dark' ? 'dark' : 'light');
  else if (!localStorage.getItem('free_bbs_theme_mode'))
    localStorage.setItem('free_bbs_theme_mode', 'light');
  if (params.has('resume')) {
    if (params.get('resume') === 'yes') {
      localStorage.setItem(
        'free_bbs_last_learning_route',
        JSON.stringify({
          pathname: '/knowledge',
          href: '/knowledge?course=signals&point=demo-point',
        }),
      );
    } else localStorage.removeItem('free_bbs_last_learning_route');
  }
}

function createHomePreviewServer() {
  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
      });
      res.end(typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
    };
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || ''))
        return send(403, { message: 'Loopback host required' });
      if (req.method !== 'GET')
        return send(405, { message: 'Read-only preview: all writes disabled' });
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const scenario = new URL(req.headers.referer || '/', 'http://127.0.0.1').searchParams.get(
        'case',
      );
      if (pathname.startsWith('/api/')) {
        if (scenario === 'error' && /discussion|leaderboard/.test(pathname))
          return send(503, { message: 'Simulated error' });
        if (pathname === '/api/auth/me') {
          if (req.headers.authorization !== 'Bearer home-preview-only')
            return send(401, { message: 'Preview guest' });
          return send(200, {
            user: {
              uid: 'demo-local',
              username: 'demo_student',
              fullName: '演示同学',
              role: 'student',
              electrons: 0,
              manetrons: 0,
              heat: 0,
            },
          });
        }
        if (pathname === '/api/discussion/posts') {
          let posts = titles.map((title, i) => ({
            id: `demo-${i}`,
            title,
            board: boards[i % 3],
            author: { displayName: '演示用户' },
            createdAt: '2026-09-11T08:00:00Z',
            commentCount: 12 - i,
            likeCount: 8 - i,
          }));
          if (url.searchParams.get('sort') === 'latest') posts = posts.reverse();
          return send(200, { posts: scenario === 'empty' ? [] : posts });
        }
        if (pathname === '/api/discussion/stats')
          return send(200, { boards: scenario === 'empty' ? [] : boards });
        if (pathname === '/api/leaderboard/heat')
          return send(200, { users: scenario === 'empty' ? [] : users });
        if (pathname === '/api/courses/signals/map/nodes/demo-point')
          return send(200, { node: { id: 'demo-point', title: '线性时不变系统' } });
        if (pathname === '/api/fortune-config') return send(200, { enabled: false });
        if (pathname === '/api/checkin/status') return send(200, { checkedIn: false });
        if (pathname.startsWith('/api/notifications'))
          return send(200, { items: [], unreadCount: 0 });
        return send(404, { message: 'Not available in isolated homepage preview' });
      }
      if (pathname === '/__home-preview.js')
        return send(200, `(${previewBootstrap.toString()})();`, mime['.js']);
      // Other application routes deliberately do not connect to the real backend.
      if (
        /^\/(world|course|knowledge|discussion|workbench|aichat|circuit|settings|login|register|profile|development|electromagnetic|inventory)$/.test(
          pathname,
        )
      ) {
        return send(
          200,
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>首页实验：入口说明</title><body style="font:18px/1.8 system-ui;background:#edf2ef;color:#123e45;padding:8vw"><h1>这是首页的隔离预览。</h1><p>入口已保留；此处不登录、不发帖、不连接真实后端。</p><p>完整功能请通过原来的 3000 本地测试服务体验。</p><a href="/">← 返回首页实验稿</a></body></html>',
          mime['.html'],
        );
      }
      if (
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part === '..' || part.startsWith('.'))
      )
        return send(400, { message: 'Invalid path' });
      const file = path.resolve(publicRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
      const realFile = await fs.realpath(file);
      const relative = path.relative(await fs.realpath(publicRoot), realFile);
      const ext = path.extname(realFile);
      if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !mime[ext] ||
        (ext === '.html' && path.basename(file) !== 'index.html')
      )
        return send(403, { message: 'Not a homepage preview asset' });
      let content = await fs.readFile(realFile);
      if (ext === '.html') {
        content = content
          .toString()
          .replace(/<link\b[^>]*https:\/\/fonts\.[\s\S]*?>/g, '')
          .replace('</head>', '<script src="/__home-preview.js"></script></head>')
          .replace(
            '</body>',
            '<aside style="position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:7px 12px;background:#e8dcb9;color:#16383c;text-align:center;font:12px/1.6 system-ui">本地首页实验 · 动态与数字均为演示数据 · 不连接线上　<a href="/?resume=yes&session=member">有记录</a> / <a href="/?resume=no">新访客</a> / <a href="/?case=empty">空数据</a> / <a href="/?case=error">加载失败</a></aside></body>',
          );
      }
      if (['/app.js', '/notifications.js', '/username-guard.js'].includes(pathname))
        content = patchScript(content.toString(), pathname);
      return send(200, content, mime[ext]);
    } catch (error) {
      return send(error.code === 'ENOENT' ? 404 : 400, { message: 'Preview request unavailable' });
    }
  });
}

if (require.main === module) {
  const server = createHomePreviewServer();
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Homepage lab: http://127.0.0.1:${PORT} (mock data; read-only; no DB)`),
  );
}

module.exports = { createHomePreviewServer, patchScript };
