const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('public/about.html');
const css = read('public/about-freebbs.css');

test('about explains purpose, three parallel entries, continuity and human boundaries', () => {
  assert.doesNotMatch(html, /暂未开放|Max 正在施工|10 月 18 日|10月18日/);
  for (const phrase of [
    '学生主导、长期公益、独立于评价体系',
    '自主学习',
    '自主讨论',
    '自主探索',
    '不是先后闯关',
    'IBBB',
    '个人笔记不会因此向教师开放',
    '是否分享由本人决定',
  ])
    assert.ok(html.includes(phrase), phrase);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /建设示意，含后续规划，非已上线功能清单/);
  assert.match(html, /教师认证不等于直接改稿/);
  assert.equal(
    (html.match(/<a\b[^>]*class="bbs-action about-primary"[^>]*data-action-tone="primary"/g) || [])
      .length,
    2,
    'primary links reuse the shared theme-aware action contract',
  );
});

test('about local links are routed, shell assets exist and diagrams support both themes', () => {
  const routes = read('server.js');
  for (const [, route] of html.matchAll(/href="(\/[a-z-]+)"/g))
    assert.ok(routes.includes(`'${route}'`), route);
  for (const [, resource] of html.matchAll(/(?:src|href)="(\/[^"?]+\.(?:js|css|svg|png|webp))"/g))
    assert.ok(fs.existsSync(path.join(root, 'public', resource)), resource);
  assert.match(css, /body\.theme-dark/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /var\(--font-ui\)/);
  assert.match(css, /focus-visible/);
  assert.doesNotMatch(css, /filter:\s*invert|\bheight:\s*100vh/);
  for (const file of [
    'about-freebbs-system-20261022.svg',
    'about-freebbs-system-dark-20261022.svg',
  ]) {
    const source = read(`public/assets/${file}`);
    assert.match(source, /后续建设/);
    assert.match(source, /不表示全部功能已上线/);
    assert.doesNotMatch(source, /<script|https?:\/\/[^" ]+\.(?:png|jpg)|主旨母稿/);
  }
});

test('teacher APIs use current auth and initialize association after course schema', () => {
  const source = read('backend/server.js');
  assert.match(
    source,
    /app\.use\('\/api', createTeacherParticipationRouter\(\{ pool, requireAuth, requireAdmin \}\)\)/,
  );
  const start = source.slice(source.indexOf('async function start()'));
  assert.ok(
    start.indexOf('await ensureCourseMapTables(pool)') <
      start.indexOf('await ensureTeacherParticipationTables(pool)'),
  );
  assert.ok(
    start.indexOf('await ensureUserCertificationTables(pool)') <
      start.indexOf('await ensureTeacherParticipationTables(pool)'),
  );
  assert.match(read('server.js'), /\['\/teachers', '\/teachers\.html'\]/);
  assert.match(read('server.js'), /\['\/teachers\.html', '\/teachers'\]/);
  assert.match(read('public/app.js'), /'\/teachers': '教师参与'/);
});
