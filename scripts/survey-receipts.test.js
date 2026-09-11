const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync('public/survey-receipts.js', 'utf8');
function storage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function setup({
  local = storage(),
  session = storage(),
  initialToken = '',
  cryptography = crypto.webcrypto,
} = {}) {
  let token = initialToken;
  const window = {};
  vm.runInNewContext(source, { window, TextEncoder });
  const create = () =>
    window.createSurveyReceiptStore({
      local,
      session,
      crypto: cryptography,
      getToken: () => token,
    });
  return {
    store: create(),
    create,
    local,
    session,
    setToken: (next) => {
      token = next;
    },
  };
}
const receiptA = 'a'.repeat(64);
const receiptB = 'b'.repeat(64);

test('legacy browser-wide anonymous receipts are removed and never migrated', async () => {
  const { store, local } = setup({ initialToken: 'account-b' });
  local.setItem('freebbs-survey-event', receiptA);
  local.setItem('free_bbs_auth_token', 'account-b');
  await store.sync();
  assert.equal(store.get('event'), '');
  assert.equal(local.getItem('freebbs-survey-event'), null);
  assert.equal(local.getItem('free_bbs_auth_token'), 'account-b');
});
test('anonymous receipt survives same-tab reload but is not shared with another tab', async () => {
  const context = setup();
  await context.store.sync();
  context.store.set('event', receiptA);
  const reload = context.create();
  await reload.sync();
  assert.equal(reload.get('event'), receiptA);
  const otherTab = setup({ local: context.local });
  await otherTab.store.sync();
  assert.equal(otherTab.store.get('event'), '');
});
test('login, account switch and logout cannot reuse previous receipts or submit with old ownership', async () => {
  const { store, setToken } = setup();
  await store.sync();
  store.set('event', receiptA);
  setToken('account-a');
  assert.equal(store.get('event'), '');
  assert.equal(store.set('event', receiptB), false);
  await store.sync();
  assert.equal(store.get('event'), '');
  store.set('event', receiptB);
  setToken('account-b');
  await store.sync();
  assert.equal(store.get('event'), '');
  setToken('');
  await store.sync();
  assert.equal(store.get('event'), '');
});
test('new pages restore only the matching login session, without persisting auth tokens', async () => {
  const context = setup({ initialToken: 'account-a-token' });
  await context.store.sync();
  context.store.set('event', receiptA);
  assert.ok(!context.session.getItem('freebbs_activity_receipts_v2').includes('account-a-token'));
  const reload = context.create();
  await reload.sync();
  assert.equal(reload.get('event'), receiptA);
  context.setToken('account-b-token');
  const nextPage = context.create();
  await nextPage.sync();
  assert.equal(nextPage.get('event'), '');
});
test('blocked storage and unavailable Web Crypto degrade to memory without sharing ownership', async () => {
  const blocked = new Proxy(
    {},
    {
      get: () => {
        throw new Error('Storage denied');
      },
    },
  );
  const { store, setToken } = setup({
    local: blocked,
    session: blocked,
    initialToken: 'a',
    cryptography: {},
  });
  await store.sync();
  assert.equal(store.set('event', receiptA), true);
  assert.equal(store.get('event'), receiptA);
  setToken('b');
  await store.sync();
  assert.equal(store.get('event'), '');
});
test('a delayed identity fingerprint cannot restore an earlier session', async () => {
  let release;
  let calls = 0;
  const digest = (algorithm, value) => {
    calls += 1;
    if (calls === 1)
      return new Promise((resolve) => {
        release = async () => resolve(await crypto.webcrypto.subtle.digest(algorithm, value));
      });
    return crypto.webcrypto.subtle.digest(algorithm, value);
  };
  const { store, setToken } = setup({ initialToken: 'a', cryptography: { subtle: { digest } } });
  const old = store.sync();
  setToken('b');
  assert.equal(await store.sync(), true);
  store.set('event', receiptB);
  await release();
  assert.equal(await old, false);
  assert.equal(store.get('event'), receiptB);
});
