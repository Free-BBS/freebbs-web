const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createController } = require('../public/moderation-settings');

function element() {
  return {
    value: '',
    type: 'password',
    textContent: '',
    disabled: false,
    listeners: {},
    attributes: {},
    classList: { toggle() {}, add() {} },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {
      this.focused = true;
    },
  };
}

function fixture({ configured = true } = {}) {
  const inputIds = ['base-url', 'text-model', 'image-model', 'api-key'];
  const controlIds = [...inputIds, 'key-toggle', 'key-clear', 'reload', 'submit'];
  const nodes = Object.fromEntries(
    [...controlIds, 'state', 'message'].map((id) => [id, element()]),
  );
  const form = {
    ...element(),
    querySelector: (selector) => nodes[selector.replace('#moderation-settings-', '')],
    querySelectorAll: (selector) =>
      (selector === 'input' ? inputIds : controlIds).map((id) => nodes[id]),
  };
  const state = {
    payload: {
      baseUrl: 'https://cloud.infini-ai.com/maas/v1',
      textModel: 'qwen3.6-27b',
      imageModel: 'kimi-k2.6',
      configured,
      lastFour: configured ? '1234' : '',
      revision: 1,
    },
    error: null,
    delay: null,
  };
  const calls = [];
  const controller = createController({
    form,
    callApi: async (url, options) => {
      calls.push({ url, ...options });
      if (state.delay) await state.delay;
      if (state.error) throw state.error;
      if (options.method === 'PATCH') {
        const { apiKey, ...update } = JSON.parse(options.body);
        state.payload = {
          ...state.payload,
          ...update,
          configured: state.payload.configured || Boolean(apiKey),
          lastFour: apiKey ? apiKey.slice(-4) : state.payload.lastFour,
        };
      }
      if (options.method === 'DELETE') {
        state.payload = { ...state.payload, configured: false, lastFour: '' };
      }
      return { ...state.payload };
    },
  });
  return { controller, nodes, state, calls, form };
}

test('loads only independent moderation settings and never fills the saved secret', async () => {
  const f = fixture();
  f.state.payload.apiKey = 'server-must-not-return-this';
  await f.controller.load();
  assert.equal(f.calls[0].url, '/admin/system-settings/moderation');
  assert.equal(f.nodes['base-url'].value, f.state.payload.baseUrl);
  assert.equal(f.nodes['text-model'].value, 'qwen3.6-27b');
  assert.equal(f.nodes['image-model'].value, 'kimi-k2.6');
  assert.equal(f.nodes['api-key'].value, '');
  assert.match(f.nodes.state.textContent, /1234/);
  assert.equal(f.nodes['key-clear'].disabled, false);
});

test('saving model changes with a blank key preserves the key and never calls MAX', async () => {
  const f = fixture();
  await f.controller.load();
  f.nodes['text-model'].value = 'provider/new-text-model';
  await f.controller.save();
  assert.deepEqual(JSON.parse(f.calls[1].body), {
    baseUrl: f.state.payload.baseUrl,
    textModel: 'provider/new-text-model',
    imageModel: 'kimi-k2.6',
  });
  assert.ok(f.calls.every((call) => call.url === '/admin/system-settings/moderation'));
  assert.match(f.nodes.message.textContent, /工作台控制/);
});

test('changing provider requires a new key and successful replacement clears the input', async () => {
  const f = fixture();
  await f.controller.load();
  f.nodes['base-url'].value = 'https://api.example.com/v1/';
  await f.controller.save();
  assert.equal(f.calls.length, 1);
  assert.match(f.nodes.message.textContent, /同时填写/);
  assert.equal(f.nodes['api-key'].focused, true);
  f.nodes['api-key'].value = 'new-provider-key';
  f.nodes['key-toggle'].listeners.click();
  assert.equal(f.nodes['api-key'].type, 'text');
  await f.controller.save();
  assert.equal(JSON.parse(f.calls[1].body).apiKey, 'new-provider-key');
  assert.equal(JSON.parse(f.calls[1].body).baseUrl, 'https://api.example.com/v1');
  assert.equal(f.nodes['api-key'].value, '');
  assert.equal(f.nodes['api-key'].type, 'password');
  assert.match(f.nodes.state.textContent, /-key/);
});

test('equivalent URL spelling does not require replacing a saved key', async () => {
  const f = fixture();
  await f.controller.load();
  f.nodes['base-url'].value = 'https://CLOUD.INFINI-AI.COM/maas/v1/';
  await f.controller.save();
  assert.equal(f.calls.length, 2);
  assert.equal('apiKey' in JSON.parse(f.calls[1].body), false);
});

test('missing independent key is explicit without borrowing MAX configuration', async () => {
  const f = fixture({ configured: false });
  await f.controller.load();
  assert.match(f.nodes.state.textContent, /尚未配置监管密钥/);
  assert.equal(f.nodes['key-clear'].disabled, true);
  await f.controller.save();
  assert.match(f.nodes.message.textContent, /尚未配置监管密钥/);
});

test('clear requires confirmation, editing cancels it, and DELETE only clears moderation', async () => {
  const f = fixture();
  await f.controller.load();
  await f.controller.clearKey();
  assert.equal(f.calls.length, 1);
  f.nodes['text-model'].listeners.input();
  await f.controller.clearKey();
  assert.equal(f.calls.length, 1);
  await f.controller.clearKey();
  assert.equal(f.calls[1].url, '/admin/system-settings/moderation/api-key');
  assert.equal(f.calls[1].method, 'DELETE');
  assert.equal(f.nodes['key-clear'].disabled, true);
  assert.equal(f.nodes['api-key'].value, '');
});

test('initial load failure blocks edits and reload can recover', async () => {
  const f = fixture();
  f.state.error = new Error('读取失败');
  await f.controller.load();
  assert.equal(f.nodes.submit.disabled, true);
  assert.equal(f.nodes.reload.disabled, false);
  await f.controller.save();
  assert.equal(f.calls.length, 1);
  f.state.error = null;
  await f.controller.load();
  assert.equal(f.nodes.submit.disabled, false);
});

test('failed save keeps unsaved changes and prevents overlapping requests', async () => {
  const f = fixture();
  await f.controller.load();
  f.nodes['text-model'].value = 'new-model';
  f.state.error = new Error('保存失败');
  let release;
  f.state.delay = new Promise((resolve) => {
    release = resolve;
  });
  const pending = f.controller.save();
  await f.controller.save();
  await f.controller.clearKey();
  assert.equal(f.calls.length, 2);
  assert.equal(f.nodes.submit.disabled, true);
  release();
  await pending;
  assert.equal(f.nodes['text-model'].value, 'new-model');
  assert.match(f.nodes.message.textContent, /保存失败/);
  assert.equal(f.nodes.submit.disabled, false);
});

test('invalid endpoints and empty models do not send mutations', async () => {
  const f = fixture();
  await f.controller.load();
  for (const value of ['http://api.example.com/v1', 'https://u:p@api.example.com', 'not-a-url']) {
    f.nodes['base-url'].value = value;
    await f.controller.save();
  }
  f.nodes['base-url'].value = f.state.payload.baseUrl;
  f.nodes['image-model'].value = '';
  await f.controller.save();
  assert.equal(f.calls.length, 1);
});

test('browser bootstrap does not fetch configurations for non-admin sessions', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/moderation-settings.js'), 'utf8');
  let calls = 0;
  vm.runInNewContext(source, {
    window: {
      freeBbsApp: {
        sessionReady: Promise.resolve(),
        userState: { isLoggedIn: true, isAdmin: false },
        callApi: () => {
          calls += 1;
        },
      },
    },
    document: { getElementById: () => ({}) },
  });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(calls, 0);
});
