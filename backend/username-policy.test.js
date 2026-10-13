const assert = require('node:assert/strict');
const test = require('node:test');
const { isValidUsername, enforceUsername } = require('./username-policy');

test('new usernames require 3 to 64 ASCII letters, digits or underscores', () => {
  for (const value of [
    'a',
    'ab',
    'a'.repeat(65),
    '名字',
    '中文名_Z09',
    '𠀀'.repeat(3),
    '名字🙂',
    'abc\n',
    'abc ',
    'abc-def',
    'Ａbc',
    null,
  ]) {
    assert.equal(isValidUsername(value), false, String(value));
  }
  for (const value of ['abc', 'A_Z09', '123', '___', 'x'.repeat(64)])
    assert.equal(isValidUsername(value), true);
});

test('legacy accounts receive a machine-readable mandatory rename response', () => {
  const response = {
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
    },
  };
  assert.equal(enforceUsername({ username: '旧 用户' }, response), false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'username_change_required');
  assert.equal(response.body.requiresUsernameChange, true);
  assert.equal(enforceUsername({ username: 'renamed_user' }, response), true);
  assert.equal(enforceUsername({ username: '中文用户' }, response), false);
  assert.equal(enforceUsername({ username: 'ab' }, response), false);
});
