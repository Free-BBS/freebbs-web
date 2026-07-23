const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
const developmentPagePath = path.join(projectRoot, 'public', 'development.html');

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
  assert.match(pageSource, /<h1>发展端<\/h1>/);
  assert.match(pageSource, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(pageSource, /<script src="\/app\.js"><\/script>/);
});
