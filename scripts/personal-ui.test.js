const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPersonalPreview } = require('./preview-personal');
const { TOKEN } = require('./preview-economy');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('laboratory distinguishes circuits and tools from four planned runtimes', () => {
  const html = read('public/laboratory.html');
  assert.match(read('server.js'), /\['\/laboratory', '\/laboratory.html'\]/);
  assert.match(html, /href="\/circuits"/);
  assert.equal((html.match(/class="laboratory-status is-planned"/g) || []).length, 4);
  for (const title of ['C / C++', 'Python', 'MATLAB', 'Verilog 运行与仿真', '制作我的工具'])
    assert.ok(html.includes(title));
  assert.equal((html.match(/class="laboratory-enter"/g) || []).length, 2);
  assert.doesNotMatch(html, /Max 内可用/);
  assert.doesNotMatch(html, /href="\/code-lab"/);
  assert.match(html, /独立代码运行环境尚未开放/);
  assert.match(read('public/mobile-shell.js'), /\['\/laboratory', 'circuit', '实验室'\]/);
  assert.match(read('public/app.js'), /href: '\/laboratory', icon: 'circuit', label: '实验室'/);
});
test('shared shell preserves mobile breakpoints, original elements and privileged navigation', () => {
  assert.match(read('public/desktop-shell.js'), /marker\.replaceWith\(element\)/);
  assert.match(read('public/desktop-shell.css'), /@media \(min-width: 901px\)/);
  assert.match(read('public/personal-polish.css'), /@media \(min-width: 901px\)/);
  assert.match(
    read('public/app.js'),
    /label: '管理员端',[\s\S]*?className: 'system-settings-link hidden'/,
  );
  assert.match(read('public/site-search.js'), /classList\.contains\('desktop-shell-active'\)/);
  assert.doesNotMatch(read('public/app.js'), /Absoulute/);
});
test('live shop and guide descriptions match random wool growth, not the former fixed counter', () => {
  const shop = read('public/data/shop-items.json');
  assert.match(shop, /泊松分布（λ=0.2）/);
  assert.doesNotMatch(shop, /每累计5次有效喂养/);
  assert.doesNotMatch(read('public/max-guide-stations.js'), /每累计5次成功喂养/);
});
test('personal preview serves real pages, same shell, fake dialogs and no real AI calls', async (t) => {
  const { server, store } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    '/',
    '/aichat',
    '/settings',
    '/profile?uid=u_preview01',
    '/laboratory',
    '/code-lab',
    '/pbl',
    '/creative-workshop',
    '/tool-workshop',
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /desktop-shell\.css/);
    assert.match(html, /personal-polish\.css/);
    assert.match(html, /desktop-shell\.js/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const dialogs = await (await fetch(`${origin}/api/ai/dialogs`, { headers })).json();
  assert.equal(dialogs.dialogs.length, 3);
  const catalog = await (await fetch(`${origin}/api/ai/models`, { headers })).json();
  assert.ok(catalog.models.every((model) => model.efforts.includes(model.defaultEffort)));
  const before = structuredClone(store.account());
  assert.equal(
    (await fetch(`${origin}/api/ai/tasks`, { method: 'POST', headers, body: '{}' })).status,
    503,
  );
  assert.equal(
    (await fetch(`${origin}/api/profile/extras`, { method: 'POST', body: '{}' })).status,
    403,
  );
  assert.deepEqual(store.account(), before);
  const state = await (await fetch(`${origin}/api/profile/extras`, { headers })).json();
  assert.equal(state.ranch.growthModel, 'poisson-v1');
  assert.equal(state.ranch.woolRate, 0.2);
});
