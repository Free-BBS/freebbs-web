const assert = require('node:assert/strict');
const test = require('node:test');
const { renderVerificationEmail } = require('./mailer');

test('verification email uses the shared clean card style and sanitizes the code', () => {
  const html = renderVerificationEmail('123456<script>');
  assert.match(html, /FREE-BBS · 邮箱验证/);
  assert.match(html, /border-radius:20px/);
  assert.match(html, />123456script</);
  assert.doesNotMatch(html, /<script>/);
});
