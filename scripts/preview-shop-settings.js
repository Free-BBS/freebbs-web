const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { normalizeAvatar } = require('../backend/avatar-upload');

const HOST = '127.0.0.1';
const PORT = 3106;
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const TOKEN = 'qa-only-3106-not-a-real-token';
const pages = new Map([
  ['/electromagnetic', 'electromagnetic.html'],
  ['/inventory', 'inventory.html'],
  ['/settings', 'settings.html'],
  ['/world', 'world.html'],
]);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
};

function previewCase(request) {
  const url = new URL(request.headers.referer || request.url || '/', `http://${HOST}:${PORT}`);
  return {
    scenario: url.searchParams.get('case') || 'normal',
    upload: url.searchParams.get('upload') || 'success',
    run: url.searchParams.get('run') || 'default',
  };
}

function catalogFor(scenario) {
  const items = JSON.parse(fs.readFileSync(path.join(publicRoot, 'data/shop-items.json'), 'utf8'));
  if (scenario === 'long') {
    items.items.push({
      key: 'qa_long_item',
      assetKey: 'qa_long_item',
      name: '隔离测试专用：电子信息学科知识图谱探索纪念徽章与特别长商品名称',
      class: 'useless',
      desc: '仅用于观察长文换行与弹窗滚动，不是真实上架商品。\n'.repeat(24),
      image: '/assets/icons/battery.svg',
      cost: { electric: 123456, magnetic: 654321 },
      isgift: true,
    });
  }
  return items.items;
}

function patchAppForPreview(source) {
  const initialization = /^const API_BASE_URL = \(\(\) => \{[\s\S]*?\r?\n\}\)\(\);/;
  if (!initialization.test(source))
    throw new Error('API initializer changed; preview fails closed');
  return source.replace(initialization, "const API_BASE_URL = '/api';");
}

function bootstrapPreview() {
  if (window.location.hostname !== '127.0.0.1' || window.location.port !== '3106') {
    throw new Error('QA bootstrap only runs on 127.0.0.1:3106');
  }
  localStorage.setItem('free_bbs_auth_token', 'qa-only-3106-not-a-real-token');
  if (!localStorage.getItem('free_bbs_theme_mode')) {
    localStorage.setItem('free_bbs_theme_mode', 'light');
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has('run')) {
    url.searchParams.set('run', String(Date.now()));
    window.history.replaceState(null, '', url);
  }
}

function installPreviewPanel() {
  const panel = document.createElement('details');
  panel.id = 'qa-preview-panel';
  panel.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:10000;max-width:min(360px,calc(100vw - 24px));' +
    'max-height:75vh;overflow:auto;padding:10px;background:#073642;color:#fff;border-radius:10px;' +
    'font:14px/1.5 system-ui;box-shadow:0 3px 16px #0004';
  panel.innerHTML = `
    <summary style="cursor:pointer">隔离测试工具 · 仅 3106</summary>
    <p>固定模拟用户与几何图；不连接真实 API，不保存头像文件。购买、赠送等写操作被拒绝。</p>
    <nav><a href="/world">学习世界</a> · <a href="/electromagnetic">商城</a> · <a href="/inventory">仓库</a> · <a href="/settings">真实设置页</a> · <a href="/settings-avatar">头像独立样例</a></nav>
    <p><label>场景 <select id="qa-scenario"><option value="normal">普通商品与资产</option><option value="long">长名称与长说明</option><option value="empty">空仓库</option></select></label></p>
    <p><label>头像响应 <select id="qa-upload"><option value="success">成功</option><option value="fail-once">首次失败，重试成功</option><option value="always-fail">持续失败</option></select></label></p>
    <p>下面按钮将固定几何图传入真实头像输入框，无需选择个人文件：</p>
    <button type="button" data-qa-image="png">固定 PNG</button>
    <button type="button" data-qa-image="jpeg">大尺寸 JPEG</button>
    <button type="button" data-qa-image="webp">固定 WEBP</button>
    <button type="button" data-qa-image="invalid">损坏图片</button>
    <p id="qa-image-message" role="status"></p>
    <button id="qa-read-state" type="button">查看内存请求状态</button>
    <pre id="qa-state" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>`;
  document.body.append(panel);
  panel.querySelectorAll('a').forEach((link) => {
    link.style.color = '#a7edf0';
  });
  const url = new URL(window.location.href);
  const scenario = panel.querySelector('#qa-scenario');
  const upload = panel.querySelector('#qa-upload');
  scenario.value = url.searchParams.get('case') || 'normal';
  upload.value = url.searchParams.get('upload') || 'success';
  [scenario, upload].forEach((control) => {
    control.addEventListener('change', () => {
      url.searchParams.set('case', scenario.value);
      url.searchParams.set('upload', upload.value);
      url.searchParams.delete('run');
      window.location.href = url.href;
    });
  });
  panel.querySelectorAll('[data-qa-image]').forEach((button) => {
    button.addEventListener('click', async () => {
      const input = document.getElementById('settings-avatar-input');
      const message = panel.querySelector('#qa-image-message');
      if (!input) {
        message.textContent = '请先进入真实设置页，再使用固定图按钮。';
        return;
      }
      const format = button.dataset.qaImage;
      let blob;
      if (format === 'invalid') {
        blob = new Blob(['fixed invalid image data'], { type: 'image/png' });
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = format === 'jpeg' ? 2400 : 640;
        canvas.height = format === 'jpeg' ? 1800 : 640;
        const context = canvas.getContext('2d');
        context.fillStyle = '#073642';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#25b5c8';
        context.fillRect(canvas.width / 6, canvas.height / 6, canvas.width / 2, canvas.height / 2);
        context.fillStyle = '#f6ecd7';
        context.beginPath();
        context.arc(canvas.width * 0.67, canvas.height * 0.63, canvas.height / 5, 0, Math.PI * 2);
        context.fill();
        blob = await new Promise((resolve) => {
          canvas.toBlob(resolve, `image/${format}`, 0.92);
        });
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], `qa-fixed-geometric.${format}`, { type: blob.type }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      message.textContent = `已发送固定 ${format.toUpperCase()} 测试图；请查看真实页面上传状态。`;
    });
  });
  panel.querySelector('#qa-read-state').addEventListener('click', async () => {
    const state = await fetch('/__qa/state').then((response) => response.json());
    panel.querySelector('#qa-state').textContent = JSON.stringify(state, null, 2);
  });
}

function prepareHtml(source) {
  return source
    .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, '')
    .replace('</head>', `<script>(${bootstrapPreview.toString()})();</script></head>`)
    .replace('</body>', '<script src="/__qa/panel.js"></script></body>');
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('Preview upload body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createPreviewServer() {
  const user = {
    id: 999999,
    uid: 'QA-LOCAL-ONLY',
    username: 'qa-preview',
    fullName: '隔离测试用户',
    studentId: 'QA-NOT-REAL',
    role: 'student',
    avatarPath: '/assets/avatar_placeholder.webp',
    bio: '固定测试资料，不代表真实个人。',
    websiteUrl: '',
    electrons: 1234567,
    manetrons: 987654,
    heat: 123,
  };
  const attempts = new Map();
  const state = { avatarRequests: 0, avatarSuccesses: 0, deniedWrites: 0, outputBytes: 0 };
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; " +
        "worker-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; " +
        "base-uri 'none'; form-action 'none'",
    );
    function send(code, content, type = 'application/json; charset=utf-8') {
      response.writeHead(code, { 'Content-Type': type });
      response.end(
        typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content),
      );
    }
    try {
      const url = new URL(request.url || '/', `http://${HOST}:${PORT}`);
      const pathname = decodeURIComponent(url.pathname);
      const selection = previewCase(request);
      if (request.method === 'POST' && pathname === '/api/profile/avatar') {
        if (request.headers.authorization !== `Bearer ${TOKEN}`) {
          send(401, { message: '仅接受隔离测试令牌' });
          return;
        }
        const body = await readJson(request);
        const attempt = (attempts.get(selection.run) || 0) + 1;
        attempts.set(selection.run, attempt);
        state.avatarRequests += 1;
        if (
          selection.upload === 'always-fail' ||
          (selection.upload === 'fail-once' && attempt === 1)
        ) {
          send(503, { message: '隔离测试：模拟上传失败，请重试' });
          return;
        }
        // Exercise the real pure image normalizer, never its file/DB service.
        const result = await normalizeAvatar(body.imageDataUrl);
        user.avatarPath = `data:image/webp;base64,${result.buffer.toString('base64')}`;
        state.avatarSuccesses += 1;
        state.outputBytes = result.buffer.length;
        send(200, {
          user,
          message: '隔离测试：头像处理成功，仅保留在内存',
          animated: result.animated,
        });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        state.deniedWrites += 1;
        send(405, { message: '隔离预览不允许此写操作；未修改任何真实数据' });
        return;
      }
      if (pathname === '/__qa/state') {
        send(200, {
          ...state,
          scenario: selection.scenario,
          upload: selection.upload,
          isolated: true,
        });
        return;
      }
      if (pathname === '/__qa/panel.js') {
        send(200, `(${installPreviewPanel.toString()})();`, MIME['.js']);
        return;
      }
      if (pathname === '/api/auth/me' || pathname === '/api/profile') {
        send(200, { user });
        return;
      }
      if (pathname === '/api/fortune-config') {
        send(200, { fortuneBonusEnabled: false });
        return;
      }
      if (pathname === '/api/checkin') {
        send(200, { checkedInToday: false, streak: 0, leaderboard: [] });
        return;
      }
      if (pathname === '/api/electromagnetic' || pathname === '/data/shop-items.json') {
        const items = catalogFor(selection.scenario);
        const assets =
          selection.scenario === 'empty'
            ? []
            : items.map((item, index) => ({
                key: item.assetKey || item.key,
                quantity: index === 0 ? 99999 : index + 1,
              }));
        send(200, pathname.startsWith('/api/') ? { user, assets, shopItems: items } : { items });
        return;
      }
      if (pathname.startsWith('/api/')) {
        send(404, { message: '此接口未在隔离预览中模拟' });
        return;
      }
      if (pathname === '/') {
        send(
          200,
          prepareHtml(
            '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面隔离预览</title></head><body><h1>学习世界、商城与头像 · 隔离预览</h1><p>仅本地模拟数据，不连接现有 3001 或数据库。</p><p><a href="/world">学习世界</a> · <a href="/electromagnetic">商城</a> · <a href="/electromagnetic?case=long">长文商品</a> · <a href="/inventory">仓库</a> · <a href="/inventory?case=empty">空仓库</a> · <a href="/settings">设置</a> · <a href="/settings?upload=fail-once">头像失败后重试</a> · <a href="/settings-avatar">头像独立样例</a></p></body></html>',
          ),
          MIME['.html'],
        );
        return;
      }
      if (
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').includes('..')
      ) {
        send(400, { message: 'Invalid static path' });
        return;
      }
      const isFixture = pathname === '/settings-avatar';
      const file = isFixture
        ? path.join(__dirname, 'fixtures/settings-avatar.html')
        : path.join(publicRoot, pages.get(pathname) || pathname.slice(1));
      if (!isFixture && !pages.has(pathname) && path.extname(file) === '.html') {
        send(404, {
          message: 'Only explicitly listed application pages are enabled in this preview',
        });
        return;
      }
      const realRoot = await fs.promises.realpath(
        isFixture ? path.join(__dirname, 'fixtures') : publicRoot,
      );
      const realFile = await fs.promises.realpath(file);
      const relative = path.relative(realRoot, realFile);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !MIME[path.extname(realFile)]) {
        send(403, { message: 'Outside static preview directory' });
        return;
      }
      let content = await fs.promises.readFile(realFile);
      if (path.extname(realFile) === '.html') content = prepareHtml(content.toString('utf8'));
      if (pathname === '/app.js') content = patchAppForPreview(content.toString('utf8'));
      send(200, content, MIME[path.extname(realFile)]);
    } catch (error) {
      send(error.status || 400, { message: error.message || 'Preview request failed' });
    }
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.on('error', (error) => {
    console.error(`Isolated preview failed to start: ${error.code || error.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Shop/settings isolated preview: http://${HOST}:${PORT}`);
    console.log(
      'Only fixed mock data; avatar normalization stays in memory; no 3001 or DB access.',
    );
  });
}

module.exports = { createPreviewServer, patchAppForPreview, catalogFor, prepareHtml };
