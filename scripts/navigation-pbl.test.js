const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createPersonalPreview } = require('./preview-personal');
const { TOKEN } = require('./preview-economy');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('runtime labels reflect the current server contract, not syntax-highlighting support', () => {
  const source = read('backend/server.js');
  const start = source.indexOf('function normalizeSandboxLanguage(');
  const end = source.indexOf('function getSandboxUid(', start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.runInNewContext(source.slice(start, end), context);
  for (const language of ['python', 'py'])
    assert.equal(context.normalizeSandboxLanguage(language), 'python');
  for (const language of ['c', 'c++', 'cpp'])
    assert.equal(context.normalizeSandboxLanguage(language), 'cpp');
  for (const language of ['matlab', 'verilog'])
    assert.equal(context.normalizeSandboxLanguage(language), '');
});

test('regular navigation retains the agreed eight entries, followed by trial activities and privileged tools', () => {
  const app = read('public/app.js');
  const items = app.split('const navItems = [')[1].split('];')[0];
  const hrefs = [...items.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [
    '/',
    '/world',
    '/discussion',
    '/workbench',
    '/laboratory',
    '/creative-workshop',
    '/pbl',
    '/aichat',
    '/surveys',
    '/system-settings',
    '/development',
    '/settings',
  ]);
  assert.match(items, /label: '活动报名（试用）'/);
  assert.match(items, /className: 'system-settings-link hidden'/);
  assert.doesNotMatch(items, /href: '\/circuits'/);
  const css = read('public/desktop-shell.css');
  hrefs.slice(0, 9).forEach((href, index) => {
    const rule = css.split(`[href='${href}'] {`)[1]?.split('}')[0];
    assert.ok(rule?.includes(`order: ${index + 1};`), href);
  });
});

test('mobile keeps five primary slots, PBL in tools, and experimental runtimes in learning', () => {
  const shell = read('public/mobile-shell.js');
  const tools = shell.split('const tools = [')[1].split('];')[0];
  assert.match(tools, /\['\/pbl', 'star', 'PBL计划'\]/);
  assert.match(tools, /活动报名（试用）/);
  const learning = shell.split('creativeLabel.textContent =')[1].split('const closeLearning')[0];
  assert.match(learning, /\/laboratory/);
  assert.match(learning, /\/creative-workshop/);
  assert.doesNotMatch(learning, /\/pbl|\/circuits/);
});

test('PBL uses the construction art and versioned plan, without development access redirects or fake actions', () => {
  const page = read('public/pbl.html');
  assert.match(page, /development-construction-bbs-v2.webp/);
  assert.match(page, /datetime="2027-03">2027 年 3 月/);
  assert.match(page, /V2\.0/);
  assert.match(page, /规划中 · 暂未开放/);
  assert.match(page, /具体能力与开放安排以正式公告为准/);
  assert.match(page, /项目匹配/);
  assert.match(page, /PBL 悬赏/);
  assert.doesNotMatch(page, /development-entry.js|<form|data-action|2026 年 10 月/);
  assert.match(read('public/development.html'), /2026 年 10 月/);
  assert.match(read('server.js'), /\['\/pbl', '\/pbl.html'\]/);
  assert.match(read('scripts/preview-onboarding.js'), /'\/pbl': 'pbl.html'/);
});

test('creative workshop is a V1.2 October plan, while the existing tool studio keeps its route', () => {
  const page = read('public/creative-workshop.html');
  assert.match(page, /development-construction-bbs-v2.webp/);
  assert.match(page, /datetime="2026-10"/);
  assert.match(page, /V1\.2/);
  assert.match(page, /IBBB/);
  assert.match(page, /Skill/);
  assert.match(page, /插件安装与发布功能尚未开放/);
  assert.doesNotMatch(page, /development-entry.js|<form|data-action/);
  assert.match(read('public/laboratory.html'), /href="\/tool-workshop"/);
  assert.match(read('public/tool-workshop.html'), /制作我的工具/);
  assert.match(read('public/tool-workshop.js'), /\/tool-workshop\?tool=/);
  assert.match(read('server.js'), /\['\/creative-workshop', '\/creative-workshop.html'\]/);
});

test('local workshop preview is explicitly read-only and does not call live generation or publication', async (t) => {
  const { server } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  assert.deepEqual(await (await fetch(`${origin}/api/tools`, { headers })).json(), { tools: [] });
  for (const route of ['/api/tools', '/api/tools/generate/html']) {
    const response = await fetch(origin + route, { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 503);
  }
});
