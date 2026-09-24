const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('main site preserves the construction route and serves the peer SPA below it', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'public', 'development.html'), 'utf8');
  assert.match(server, /\['\/development', '\/development\.html'\]/);
  assert.match(server, /requestUrl\.pathname\.startsWith\('\/development\/'\)/);
  assert.match(server, /development[\s\S]*apps[\s\S]*web[\s\S]*dist/);
  assert.match(page, /development-entry\.js/);
});

test('authentication accepts only same-origin development return paths', () => {
  const auth = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');
  assert.match(auth, /next\.pathname\.startsWith\('\/development\/'\)/);
  assert.match(auth, /next\.origin === window\.location\.origin && allowed/);
});
