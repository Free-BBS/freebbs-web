const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createController } = require('../public/settings-username');

function element() {
  return {
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    textContent: '',
    listeners: {},
    addEventListener(type, callback) {
      this.listeners[type] = callback;
    },
    setAttribute() {},
  };
}
function fixture({ cost = 0, balance = 20 } = {}) {
  const nodes = new Map(
    ['', '-policy', '-payment', '-paid', '-message', '-submit', '-refresh'].map((name) => [
      `#settings-username${name}`,
      element(),
    ]),
  );
  const form = { ...element(), querySelector: (selector) => nodes.get(selector) };
  const state = {
    session: 'one',
    policy: {
      username: 'old_name',
      cost,
      balance,
      freeAvailable: !cost,
      nextFreeAt: '2026-12-11T00:00:00Z',
    },
    delay: null,
    error: null,
    saveError: false,
  };
  const calls = [];
  const saved = [];
  const controller = createController({
    form,
    getSession: () => state.session,
    callApi: async (url, options) => {
      calls.push({ url, ...options });
      if (state.delay) await state.delay;
      if (state.error) throw state.error;
      if (options.method === 'GET') return { policy: { ...state.policy } };
      const request = JSON.parse(options.body);
      state.policy = {
        ...state.policy,
        username: request.username,
        cost: 10,
        balance: balance - cost,
        freeAvailable: false,
      };
      return {
        user: { username: request.username },
        token: 'new-token',
        policy: { ...state.policy },
        message: '昵称已更新',
      };
    },
    onSaved: (payload) => {
      if (state.saveError) throw new Error('storage unavailable');
      saved.push(payload);
    },
  });
  return {
    state,
    calls,
    saved,
    controller,
    get: (suffix = '') => nodes.get(`#settings-username${suffix}`),
  };
}

test('free rename shows zero cost and submits the original name as a concurrency guard', async () => {
  const f = fixture();
  await f.controller.load();
  assert.equal(f.get().value, 'old_name');
  assert.equal(f.get('-payment').hidden, true);
  f.get().value = 'new_name';
  await f.controller.submit();
  assert.deepEqual(JSON.parse(f.calls[1].body), {
    username: 'new_name',
    expectedUsername: 'old_name',
    allowPaid: false,
  });
  assert.equal(f.saved.length, 1);
  assert.match(f.get('-message').textContent, /新昵称或邮箱登录/);
});

test('paid change requires confirmation and changing the input revokes consent', async () => {
  const f = fixture({ cost: 10 });
  await f.controller.load();
  assert.equal(f.get('-payment').hidden, false);
  assert.equal(f.get('-submit').disabled, true);
  f.get().value = 'new_name';
  await f.controller.submit();
  assert.equal(f.calls.length, 1);
  f.get('-paid').checked = true;
  f.get('-paid').listeners.change();
  assert.equal(f.get('-submit').disabled, false);
  f.get().listeners.input();
  assert.equal(f.get('-paid').checked, false);
  f.get('-paid').checked = true;
  await f.controller.submit();
  assert.equal(JSON.parse(f.calls[1].body).allowPaid, true);
});

test('invalid or unchanged names and insufficient balance do not send mutation requests', async () => {
  for (const name of ['old_name', 'ab', '中文昵称', 'abc\n']) {
    const f = fixture();
    await f.controller.load();
    f.get().value = name;
    await f.controller.submit();
    assert.equal(f.calls.length, 1);
  }
  const f = fixture({ cost: 10, balance: 9 });
  await f.controller.load();
  f.get().value = 'new_name';
  f.get('-paid').checked = true;
  await f.controller.submit();
  assert.equal(f.calls.length, 1);
});

test('double clicks send only one paid request', async () => {
  const f = fixture({ cost: 10 });
  await f.controller.load();
  f.get().value = 'new_name';
  f.get('-paid').checked = true;
  let resolve;
  f.state.delay = new Promise((done) => {
    resolve = done;
  });
  const pending = f.controller.submit();
  await f.controller.submit();
  assert.equal(f.calls.length, 2);
  resolve();
  await pending;
  assert.equal(f.saved.length, 1);
});

test('uncertain failures preserve input, clear consent and require policy reconciliation before retry', async () => {
  const f = fixture({ cost: 10 });
  await f.controller.load();
  f.get().value = 'new_name';
  f.get('-paid').checked = true;
  f.state.error = new Error('Connection reset');
  await f.controller.submit();
  assert.equal(f.get().value, 'new_name');
  assert.equal(f.get('-paid').checked, false);
  assert.equal(f.get('-submit').disabled, true);
  await f.controller.submit();
  assert.equal(f.calls.length, 2);
  f.state.error = null;
  // Simulate an accepted change whose response was lost.
  f.state.policy.username = 'new_name';
  await f.controller.load();
  await f.controller.submit();
  assert.equal(f.calls.length, 3);
  assert.match(f.get('-message').textContent, /未变化/);
});

test('local display failure after server success never invites a second charge', async () => {
  const f = fixture();
  await f.controller.load();
  f.get().value = 'new_name';
  f.state.saveError = true;
  await f.controller.submit();
  assert.match(f.get('-message').textContent, /已更新/);
  await f.controller.submit();
  assert.equal(f.calls.length, 2);
});

for (const action of ['load', 'submit']) {
  test(`logout discards late ${action} result instead of restoring the previous account`, async () => {
    const f = fixture();
    await f.controller.load();
    f.get().value = 'new_name';
    let resolve;
    f.state.delay = new Promise((done) => {
      resolve = done;
    });
    const pending = f.controller[action]();
    f.state.session = '';
    f.controller.reset();
    resolve();
    await pending;
    assert.equal(f.saved.length, 0);
    assert.equal(f.get().value, '');
    assert.equal(f.get('-submit').disabled, true);
  });
}

test('settings makes the real name readonly and removes it from ordinary save requests', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /<input\s+id="settings-full-name"[^>]*readonly/);
  const start = source.indexOf('async function handleSettingsSubmit(');
  const end = source.indexOf('async function handleSettingsPasswordSubmit(', start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /fullName:/);
});

test('nickname session refresh preserves unsaved bio and website', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf("window.addEventListener('freebbs:username-updated'");
  const end = source.indexOf("window.addEventListener('storage'", start);
  assert.ok(start > 0 && end > start);
  const settingsBio = { value: '未保存的简介' };
  const settingsWebsiteUrl = { value: 'https://draft.example/' };
  let callback;
  vm.runInNewContext(source.slice(start, end), {
    window: {
      addEventListener: (name, handler) => {
        callback = handler;
      },
    },
    settingsForm: {},
    settingsBio,
    settingsWebsiteUrl,
    saveSession: () => {
      settingsBio.value = 'saved';
      settingsWebsiteUrl.value = '';
    },
  });
  callback({ detail: { token: 'new-token', user: {} } });
  assert.equal(settingsBio.value, '未保存的简介');
  assert.equal(settingsWebsiteUrl.value, 'https://draft.example/');
});
