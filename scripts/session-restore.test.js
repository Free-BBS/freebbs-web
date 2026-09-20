const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('public/app.js', 'utf8');
const source = app.slice(
  app.indexOf('async function restoreSession()'),
  app.indexOf('\nasync function loadFortuneConfig()'),
);
async function run(status, changed = false) {
  let stored = 'saved-token',
    cleared = false,
    saved = false;
  const context = {
    userState: { token: stored },
    STORAGE_KEY: 'token',
    localStorage: { getItem: () => stored },
    userName: {},
    isSettingsPage: () => false,
    isAdminManagementPage: () => false,
    renderUser: () => {},
    window: { location: { replace: () => {} } },
    callApi: async () => {
      if (changed) stored = 'new-token';
      if (status !== 200) {
        const e = new Error('request failed');
        e.status = status;
        throw e;
      }
      return { user: { id: 1 } };
    },
    clearSession: () => {
      cleared = true;
      stored = null;
    },
    saveSession: () => {
      saved = true;
    },
  };
  vm.createContext(context);
  await vm.runInContext(source + '\nrestoreSession()', context);
  return { stored, cleared, saved };
}
test('navigation abort and temporary auth lookup errors preserve credentials', async () => {
  for (const status of [undefined, 500, 502, 429])
    assert.equal((await run(status)).stored, 'saved-token');
});
test('only a current unauthorized response clears the session', async () => {
  assert.equal((await run(401)).cleared, true);
  assert.equal((await run(401, true)).stored, 'new-token');
  assert.equal((await run(200, true)).saved, false);
  assert.equal((await run(200)).saved, true);
});
