const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const developmentPagePath = path.join(projectRoot, 'public', 'development.html');
const developmentStylesPath = path.join(projectRoot, 'public', 'development.css');
const developmentHeroPath = path.join(
  projectRoot,
  'public',
  'assets',
  'development-construction-bbs-v2.webp',
);

test('shared navigation places development immediately before settings', () => {
  const developmentItem = "{ href: '/development', icon: 'star', label: '发展端' }";
  const settingsItem = "{ href: '/settings', icon: 'gear', label: '设置' }";
  const developmentIndex = appSource.indexOf(developmentItem);
  const settingsIndex = appSource.indexOf(settingsItem);

  assert.notEqual(developmentIndex, -1, 'development navigation item is missing');
  assert.notEqual(settingsIndex, -1, 'settings navigation item is missing');
  assert.ok(developmentIndex < settingsIndex, 'development must appear before settings');
  assert.match(appSource, /'\/development': '发展端'/);
});

test('static server exposes the clean development route', () => {
  assert.match(serverSource, /\['\/development', '\/development\.html'\]/);
  assert.match(serverSource, /\['\/development\.html', '\/development'\]/);
});

test('development page reuses the shared application shell', () => {
  assert.equal(fs.existsSync(developmentPagePath), true, 'development page is missing');

  const pageSource = fs.readFileSync(developmentPagePath, 'utf8');
  assert.match(pageSource, /<title>FREE-BBS - 发展端<\/title>/);
  assert.match(pageSource, /class="page-shell/);
  assert.match(pageSource, /class="nav-actions"/);
  assert.match(pageSource, /<h1 id="development-title">发展端<span>正在建设<\/span><\/h1>/);
  assert.match(pageSource, /FREE-BBS V1\.1/);
  assert.match(pageSource, /2026 年 10 月/);
  assert.match(pageSource, /src="\/assets\/development-construction-bbs-v2\.webp"/);
  assert.equal(fs.existsSync(developmentHeroPath), true, 'development hero image is missing');
  assert.doesNotMatch(pageSource, /施工现场持续更新中/);
  assert.match(pageSource, /组织—同学系统/);
  assert.match(pageSource, /团委—组织系统/);
  assert.match(pageSource, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(pageSource, /<link rel="stylesheet" href="\/development\.css" \/>/);
  assert.match(pageSource, /href="\/world"/);
  assert.match(pageSource, /<script src="\/app\.js"><\/script>/);
});

test('development page keeps the full hero artwork and balanced capability rows', () => {
  const styles = fs.readFileSync(developmentStylesPath, 'utf8');
  const sceneImageRule = styles.match(/\.development-scene img\s*{[^}]*}/s)?.[0] ?? '';

  assert.match(styles, /\.development-scene-frame\s*{[^}]*aspect-ratio:\s*3 \/ 2/s);
  assert.match(sceneImageRule, /object-position:\s*center/);
  assert.doesNotMatch(sceneImageRule, /transform:/);
  assert.match(
    styles,
    /\.development-card ul\s*{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/s,
  );
  assert.match(
    styles,
    /body\.development-page \.development-card-student li:nth-child\(4\)\s*{[^}]*grid-column:\s*2 \/ span 2/s,
  );
  assert.match(
    styles,
    /body\.development-page \.development-card-student li:nth-child\(5\)\s*{[^}]*grid-column:\s*4 \/ span 2/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.development-card-status\s*{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1/s,
  );
});
