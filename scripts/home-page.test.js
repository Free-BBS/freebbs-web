const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { readRecentRoute, installHomeResume } = require('../public/home');
const { createHomePreviewServer, patchScript } = require('./preview-home');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:3000';
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/home.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/home.css'), 'utf8');
const storage = (data) => ({ getItem: () => JSON.stringify(data) });

test('homepage places all four primary actions before community discovery', () => {
  const start = html.indexOf('class="home-actions"');
  const end = html.indexOf('class="home-dashboard"');
  assert.ok(start > 0 && end > start);
  const actions = html.slice(start, end);
  for (const href of ['/world', '/discussion', '/workbench', '/aichat'])
    assert.ok(actions.includes(`href="${href}"`));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /让学习<span>自由而不孤独/);
  assert.doesNotMatch(html, /class="searchbar"|href="#staff"/);
  assert.match(html, /独立于评价体系/);
  assert.match(html, /不代表学习能力或综合表现/);
});

test('homepage retains all original data hooks, with each id unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of [
    'home-feed-toggle',
    'home-feed-mode-label',
    'home-feed-status',
    'home-discussion-list',
    'home-board-activity',
    'home-board-status',
    'landing-heat-list',
    'home-heat-status',
    'user-name',
  ])
    assert.ok(ids.includes(id), id);
  assert.ok(html.indexOf('src="/app.js"') < html.indexOf('src="/home.js"'));
  assert.ok(html.indexOf('href="/home.css"') > html.indexOf('href="/layout-fixes.css"'));
});

test('homepage defers feedback and shows about and staff construction sections', () => {
  assert.doesNotMatch(html, /feedback|mailto:/i);
  for (const [id, title] of [
    ['about-freebbs', '关于FREE BBS'],
    ['freebbs-staff', 'FREE BBS工作人员名单'],
  ]) {
    assert.ok(html.includes(`href="#${id}"`));
    const section = html.split(`id="${id}">`)[1].split('</details>')[0];
    assert.ok(section.includes(title));
    assert.match(section, /<span>正在施工<\/span>/);
    assert.match(section, /<p>正在施工<\/p>/);
  }
});

test('all homepage local images, icons and styles exist; app links have real routes', () => {
  for (const match of html.matchAll(
    /(?:src|href|srcset)="(\/(?:assets\/[^" ]+|[\w-]+\.(?:js|css)))"/g,
  )) {
    assert.ok(fs.existsSync(path.join(root, 'public', match[1])), match[1]);
  }
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  for (const match of html.matchAll(/href="(\/[\w-]+)(?:\?[^"<>]*)?"/g)) {
    assert.ok(serverSource.includes(`'${match[1]}'`), `missing application route ${match[1]}`);
  }
});

test('typography, dark theme, mobile sizing and reduced motion remain scoped to homepage', () => {
  assert.match(css, /var\(--font-display\)/);
  assert.match(css, /var\(--font-ui\)/);
  assert.match(css, /body\.theme-dark\.home-page/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(source, /localStorage\.setItem|storage\.setItem|innerHTML\s*=/);
});

test('recent route supports the existing workbench format and strips unrelated query data', () => {
  assert.deepEqual(
    readRecentRoute(
      storage({
        pathname: '/knowledge',
        href: '/knowledge?course=signals&point=S1&redirect=https://example.com',
      }),
      origin,
    ),
    {
      href: '/knowledge?course=signals&point=S1',
      course: 'signals',
      point: 'S1',
      name: '信号与系统',
    },
  );
  assert.equal(
    readRecentRoute(storage({ pathname: '/course', href: '/course?course=math' }), origin).href,
    '/course?course=math',
  );
});

const rejected = [
  null,
  [],
  { href: '/world', pathname: '/world' },
  { href: 'https://evil.invalid/course?course=math', pathname: '/course' },
  { href: '//evil.invalid/course?course=math', pathname: '/course' },
  // eslint-disable-next-line no-script-url -- deliberately malicious input for rejection testing
  { href: 'javascript:alert(1)', pathname: '/knowledge' },
  { href: '/course?course=math', pathname: '/knowledge' },
  { href: '/course?course=__proto__', pathname: '/course' },
  { href: '/course?course=constructor', pathname: '/course' },
  { href: '/knowledge?course=signals', pathname: '/knowledge' },
  { href: '/knowledge?course=signals&point=%00', pathname: '/knowledge' },
  { href: `/knowledge?course=signals&point=${'x'.repeat(129)}`, pathname: '/knowledge' },
];
for (const [index, value] of rejected.entries()) {
  test(`unsafe or stale recent route ${index + 1} falls back without navigation`, () =>
    assert.equal(readRecentRoute(storage(value), origin), null));
}

test('broken and blocked storage do not prevent static homepage actions', () => {
  assert.equal(readRecentRoute({ getItem: () => '{invalid' }, origin), null);
  assert.equal(
    readRecentRoute(
      {
        getItem() {
          throw new Error('storage denied');
        },
      },
      origin,
    ),
    null,
  );
});

function harness(initial, callApi = async () => ({ node: { id: 'S1', title: '系统' } })) {
  const elements = new Map(
    ['home-learning-link', 'home-resume-note', 'home-world-link'].map((id) => [
      id,
      { href: '', textContent: '', hidden: true },
    ]),
  );
  let current = initial;
  const events = new Map();
  const win = {
    localStorage: { getItem: () => JSON.stringify(current) },
    location: { origin },
    addEventListener: (name, fn) => events.set(name, fn),
  };
  installHomeResume({
    document: { getElementById: (id) => elements.get(id) },
    window: win,
    app: { sessionReady: Promise.resolve(), callApi },
  });
  return {
    elements,
    win,
    events,
    change(next) {
      current = next;
      events.get('storage')({ key: 'free_bbs_last_learning_route' });
    },
  };
}
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const pointRoute = { pathname: '/knowledge', href: '/knowledge?course=signals&point=S1' };

test('valid point is verified through read-only API and rendered as text', async () => {
  const calls = [];
  const h = harness(pointRoute, async (route, options) => {
    calls.push([route, options.method]);
    return { node: { id: 'S1', title: '<img src=x onerror=alert(1)>' } };
  });
  await flush();
  assert.deepEqual(calls, [['/courses/signals/map/nodes/S1', 'GET']]);
  assert.equal(h.elements.get('home-learning-link').href, pointRoute.href);
  assert.match(h.elements.get('home-resume-note').textContent, /本浏览器最近访问/);
  assert.match(h.elements.get('home-resume-note').textContent, /非账号同步记录/);
  assert.match(h.elements.get('home-resume-note').textContent, /<img/);
  assert.equal(h.elements.get('home-world-link').hidden, false);
});

test('deleted, unreadable or malformed points fall back to learning world', async () => {
  for (const callApi of [
    async () => {
      throw new Error('404');
    },
    async () => ({}),
    async () => ({ node: { id: 'different', title: 'stale' } }),
  ]) {
    const h = harness(pointRoute, callApi);
    await flush();
    assert.equal(h.elements.get('home-learning-link').href, '/world');
    assert.equal(h.elements.get('home-world-link').hidden, true);
  }
});

test('late response cannot restore a route after another tab clears it', async () => {
  let resolveRequest;
  const h = harness(
    pointRoute,
    () =>
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
  );
  await flush();
  h.change(null);
  resolveRequest({ node: { id: 'S1', title: 'old result' } });
  await flush();
  assert.equal(h.elements.get('home-learning-link').href, '/world');
});

test('session change revalidates access and ignores the previous in-flight session', async () => {
  const pending = [];
  const h = harness(
    pointRoute,
    () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  );
  await flush();
  h.events.get('freebbs:session-change')();
  await flush();
  pending[1]({});
  pending[0]({ node: { id: 'S1', title: 'previous session' } });
  await flush();
  assert.equal(h.elements.get('home-learning-link').href, '/world');
});

test('preview patches fail closed if the application API declaration changes', () => {
  for (const name of ['app.js', 'notifications.js', 'username-guard.js']) {
    const original = fs.readFileSync(path.join(root, 'public', name), 'utf8');
    const patched = patchScript(original, `/${name}`);
    assert.match(patched, /const (?:API_BASE_URL|apiBase|api) = '\/api';/);
    assert.throws(() => patchScript('// declaration missing', `/${name}`));
  }
});

test('isolated preview serves labelled mocks and forbids writes, remote hosts and private files', async (t) => {
  const server = createHomePreviewServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const homepage = await fetch(`${base}/`);
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await homepage.text(), /动态与数字均为演示数据/);
  for (const route of [
    '/app.js',
    '/home.js',
    '/home.css',
    '/notifications.js',
    '/username-guard.js',
    '/assets/signals_island.webp',
  ])
    assert.equal((await fetch(base + route)).status, 200, route);
  assert.equal((await fetch(`${base}/api/profile`, { method: 'POST' })).status, 405);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    http
      .get(`${base}/`, { headers: { Host: 'evil.invalid' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  for (const route of [
    '/.env',
    '/.git/config',
    '/%5c..%5cbackend/server.js',
    '/settings.html',
    '/package.json',
  ])
    assert.ok((await fetch(base + route)).status >= 400, route);
  const empty = await fetch(`${base}/api/discussion/posts`, {
    headers: { referer: `${base}/?case=empty` },
  });
  assert.deepEqual((await empty.json()).posts, []);
  assert.equal(
    (await fetch(`${base}/api/discussion/posts`, { headers: { referer: `${base}/?case=error` } }))
      .status,
    503,
  );
});
