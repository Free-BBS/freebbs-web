const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readReturnTo, sanitizeReturnTo } = require('../public/return-to');

const projectRoot = path.resolve(__dirname, '..');
const origin = 'https://free-bbs.cn';

test('return target accepts one same-origin absolute path and preserves its deep state', () => {
  assert.equal(
    sanitizeReturnTo('/development/sports?team=a#today', origin),
    '/development/sports?team=a#today',
  );
  assert.equal(
    readReturnTo('?returnTo=%2Fdevelopment%2Fsports%3Fteam%3Da%23today', origin),
    '/development/sports?team=a#today',
  );
});

test('return target fails closed for open redirects and ambiguous encodings', () => {
  for (const value of [
    '',
    'https://free-bbs.cn/development/',
    'https://evil.example/development/',
    '//evil.example/development/',
    '/a/..//evil.example/development/',
    '/%2e%2e//evil.example/development/',
    '/\\evil.example/development/',
    '/development/%5cevil',
  ]) {
    assert.equal(sanitizeReturnTo(value, origin), '/', value);
  }
  assert.equal(readReturnTo('', origin), '/');
  assert.equal(readReturnTo('?returnTo=%E0%A4%A', origin), '/');
  assert.equal(readReturnTo('?returnTo=https%3A%2F%2Fevil.example', origin), '/');
});

test('login loads the helper before auth and only login restores returnTo', () => {
  const login = fs.readFileSync(path.join(projectRoot, 'public', 'login.html'), 'utf8');
  const auth = fs.readFileSync(path.join(projectRoot, 'public', 'auth.js'), 'utf8');
  const helperIndex = login.indexOf('<script src="/return-to.js"></script>');
  const authIndex = login.indexOf('<script src="/auth.js"></script>');

  assert.notEqual(helperIndex, -1, 'login must load the return target helper');
  assert.ok(helperIndex < authIndex, 'return target helper must load before auth');
  assert.match(auth, /mode === 'login'/);
  assert.match(auth, /window\.FreeBBSReturnTo\.readReturnTo\(\)/);
  assert.match(auth, /window\.location\.assign/);
});
