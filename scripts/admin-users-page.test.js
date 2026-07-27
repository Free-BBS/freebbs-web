const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public', 'adminusers.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'adminusers.css'), 'utf8');

test('user management page exposes the responsive directory controls', () => {
  const sharedStyleIndex = page.indexOf('/ui-polish.css');
  const directoryStyleIndex = page.indexOf('/adminusers.css');

  assert.ok(sharedStyleIndex >= 0, 'shared UI stylesheet is missing');
  assert.ok(
    directoryStyleIndex > sharedStyleIndex,
    'user directory stylesheet must load after shared styles',
  );
  assert.match(page, /id="admin-user-search"/);
  assert.match(page, /aria-label="搜索用户"/);
  assert.match(page, /id="admin-user-role-filter"/);
  assert.match(page, /id="admin-user-scope-filter"/);
  assert.match(page, /id="admin-user-visible-count"/);
  assert.match(page, /id="admin-user-empty"/);
  assert.match(page, /<details class="admin-utility-settings">/);
  assert.match(page, /id="fortune-bonus-toggle"/);
  assert.doesNotMatch(page, /<h1>用户与权限<\/h1>/);
  assert.doesNotMatch(page, /查找用户，管理身份、账户数值与课程或讨论区负责范围/);
  assert.doesNotMatch(page, /class="admin-users-head"/);
});

test('user cards keep every account and responsibility field in the editor', () => {
  for (const field of [
    'username',
    'fullName',
    'studentId',
    'email',
    'password',
    'role',
    'isAdmin',
    'electrons',
    'manetrons',
    'heat',
  ]) {
    assert.match(controller, new RegExp(`data-field="${field}"`));
  }

  assert.match(controller, /data-permission="board"/);
  assert.match(controller, /data-permission="course"/);
  assert.match(controller, /data-admin-ui-action="toggle-editor"/);
  assert.match(controller, /function updateAdminUserListFilters\(\)/);
  assert.match(controller, /function handleAdminUserFieldInput\(event\)/);
  assert.match(controller, /button\.dataset\.confirming !== 'true'/);
  assert.match(controller, /card\.classList\.contains\('is-expanded'\)/);
  assert.match(controller, /\.admin-user-row:not\(\.admin-user-row-draft\)\.is-dirty/);
  assert.match(controller, /input:not\(\[readonly\]\), select/);
  assert.doesNotMatch(controller, /管理员身份/);
});

test('directory styles remove the legacy wide table and provide mobile touch layouts', () => {
  assert.doesNotMatch(styles, /min-width:\s*1240px/);
  assert.match(styles, /\.admin-user-editor-actions\s*\{[\s\S]*position:\s*sticky/);
  assert.match(styles, /\.admin-permission-toggle\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(styles, /\.admin-user-row\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /:has\(\.admin-user-row\.is-expanded\) \.admin-message:not\(:empty\)/);
  assert.match(
    styles,
    /\.admin-user-fields-grid,[\s\S]*\.admin-user-permissions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});
