const assert = require('node:assert/strict');
const test = require('node:test');
const { isValidUsername, enforceUsername } = require('./username-policy');

test('username policy rejects Unicode, whitespace, punctuation and invalid lengths', () => {
  for (const value of ['ab', 'a'.repeat(65), '名字', 'abc\n', 'abc ', 'abc-def', 'Ａbc', null]) {
    assert.equal(isValidUsername(value), false, String(value));
  }
  for (const value of ['abc', 'A_Z09', 'x'.repeat(64)]) assert.equal(isValidUsername(value), true);
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
  assert.equal(enforceUsername({ username: '旧用户' }, response), false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'username_change_required');
  assert.equal(response.body.requiresUsernameChange, true);
  assert.equal(enforceUsername({ username: 'renamed_user' }, response), true);
});
