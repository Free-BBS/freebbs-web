const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  createController,
  validateAvatarFile,
  MAX_AVATAR_BYTES,
} = require('../public/settings-avatar');

function createElement() {
  const listeners = {};
  return {
    listeners,
    dataset: {},
    attributes: {},
    value: '',
    textContent: '',
    disabled: false,
    hidden: false,
    src: '',
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    removeAttribute(name) {
      delete this[name];
    },
    focus() {
      this.focused = true;
    },
    click() {
      this.clicked = true;
      return listeners.click?.();
    },
  };
}

function harness(options = {}) {
  const elements = new Map();
  const root = createElement();
  root.querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, createElement());
    return elements.get(selector);
  };
  const uploads = [];
  const saved = [];
  const controller = createController({
    root,
    readImage: async () => 'data:image/png;base64,cGljdHVyZQ==',
    upload: async (dataUrl) => {
      uploads.push(dataUrl);
      return { user: { avatarPath: '/uploads/test.webp' } };
    },
    onSaved: (payload) => saved.push(payload),
    ...options,
  });
  return {
    ...controller,
    root,
    uploads,
    saved,
    element: (selector) => elements.get(selector),
  };
}

const png = { name: '几何测试.png', type: 'image/png', size: 128 };

test('avatar validation allows exactly the advertised formats and 5 MiB boundary', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.equal(validateAvatarFile({ ...png, type, size: MAX_AVATAR_BYTES }), '');
  }
  assert.match(validateAvatarFile({ ...png, type: 'image/svg+xml' }), /PNG/);
  assert.match(validateAvatarFile({ ...png, type: 'image/avif' }), /PNG/);
  assert.match(validateAvatarFile({ ...png, type: '' }), /PNG/);
  assert.match(validateAvatarFile({ ...png, size: 0 }), /为空/);
  assert.match(validateAvatarFile({ ...png, size: MAX_AVATAR_BYTES + 1 }), /5 MiB/);
});

test('selecting previews without uploading; cancel clears it without a request', async () => {
  const h = harness();
  assert.equal(h.element('[data-avatar-action="confirm"]').hidden, true);
  await h.selectFile(png);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.element('[data-avatar-preview]').hidden, false);
  assert.match(h.element('[data-avatar-file]').textContent, /几何测试.png/);
  assert.match(h.element('[data-avatar-message]').textContent, /待上传预览/);
  h.cancel();
  assert.equal(h.element('[data-avatar-preview]').hidden, true);
  assert.equal(h.element('#settings-avatar-pending-image').src, undefined);
  assert.equal(h.element('[data-avatar-action="choose"]').focused, true);
  await h.submit();
  assert.equal(h.uploads.length, 0);
});

test('unsupported, oversized and unreadable files never make an upload request', async () => {
  let reads = 0;
  const h = harness({
    readImage: async () => {
      reads += 1;
      throw new Error('图片损坏');
    },
  });
  await h.selectFile({ ...png, size: MAX_AVATAR_BYTES + 1 });
  await h.selectFile({ ...png, type: 'text/plain' });
  assert.equal(reads, 0);
  await h.selectFile(png);
  assert.equal(reads, 1);
  assert.match(h.element('[data-avatar-message]').textContent, /损坏/);
  assert.equal(h.element('[data-avatar-action="confirm"]').hidden, true);
  assert.equal(h.uploads.length, 0);
});

test('a cancelled native picker keeps the existing pending selection', async () => {
  const h = harness();
  await h.selectFile(png);
  await h.selectFile(undefined);
  assert.equal(h.element('[data-avatar-preview]').hidden, false);
  await h.submit();
  assert.equal(h.uploads.length, 1);
});

test('confirmation uploads once and refreshes saved avatar only after success', async () => {
  const h = harness();
  await h.selectFile(png);
  await h.submit();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.saved[0].user.avatarPath, '/uploads/test.webp');
  assert.equal(h.element('[data-avatar-preview]').hidden, true);
  assert.equal(h.element('[data-avatar-message]').dataset.state, 'success');
  assert.match(h.element('[data-avatar-message]').textContent, /512.*GIF/);
  assert.equal(h.element('#settings-avatar-input').value, '');
});

test('pending upload locks choosing, cancellation and duplicate submission', async () => {
  let release;
  let calls = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness({
    upload: async () => {
      calls += 1;
      return wait;
    },
  });
  await h.selectFile(png);
  const sending = h.submit();
  assert.equal(h.root.attributes['aria-busy'], 'true');
  assert.equal(h.element('[data-avatar-action="choose"]').disabled, true);
  assert.equal(h.element('[data-avatar-action="cancel"]').disabled, true);
  await h.submit();
  h.cancel();
  await h.selectFile({ ...png, name: 'second.png' });
  assert.equal(calls, 1);
  release({ user: { avatarPath: '/uploads/test.webp' } });
  await sending;
  assert.equal(h.root.attributes['aria-busy'], 'false');
});

test('a failed upload retains preview and allows explicit retry', async () => {
  let calls = 0;
  const h = harness({
    upload: async () => {
      calls += 1;
      if (calls === 1) throw new Error('网络连接失败');
      return { user: { avatarPath: '/uploads/retry.webp' } };
    },
  });
  await h.selectFile(png);
  await h.submit();
  assert.equal(h.saved.length, 0);
  assert.equal(h.element('[data-avatar-preview]').hidden, false);
  assert.equal(h.element('[data-avatar-action="confirm"]').textContent, '重试上传');
  assert.match(h.element('[data-avatar-message]').textContent, /网络连接失败/);
  await h.submit();
  assert.equal(calls, 2);
  assert.equal(h.saved.length, 1);
});

test('UI or storage failure after server success does not invite duplicate upload', async () => {
  const h = harness({
    onSaved: () => {
      throw new Error('QuotaExceededError');
    },
  });
  await h.selectFile(png);
  await h.submit();
  assert.equal(h.element('[data-avatar-preview]').hidden, true);
  assert.match(h.element('[data-avatar-message]').textContent, /已上传.*刷新/);
  await h.submit();
  assert.equal(h.uploads.length, 1);
});

test('re-selecting the same file works and uses the native accessible choose button', async () => {
  const h = harness();
  await h.element('[data-avatar-action="choose"]').click();
  const input = h.element('#settings-avatar-input');
  assert.equal(input.clicked, true);
  input.files = [png];
  input.value = 'fake-path';
  await input.listeners.change();
  assert.equal(input.value, '');
  h.cancel();
  await input.listeners.change();
  assert.equal(h.element('[data-avatar-preview]').hidden, false);
});

test('settings integration preserves unsaved profile fields and never persists auth token', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('function initializeAvatarUpload()');
  const end = source.indexOf('\nasync function handleAdminUsersClick', start);
  assert.ok(start !== -1 && end > start);
  let options;
  let rendered = false;
  const draft = { name: '未保存姓名', bio: '未保存简介', website: 'https://example.invalid/draft' };
  const userState = { token: 'local-test-token', avatarPath: '/old.webp', fullName: '已保存姓名' };
  const requests = [];
  vm.runInNewContext(`${source.slice(start, end)}\ninitializeAvatarUpload();`, {
    document: { getElementById: () => ({}) },
    window: {
      freeBbsAvatar: {
        createController: (config) => {
          options = config;
        },
      },
    },
    userState,
    callApi: async (...args) => {
      requests.push(args);
      return {};
    },
    renderUser: () => {
      rendered = true;
    },
    renderSettingsForm: () => {
      throw new Error('must not overwrite profile draft');
    },
    localStorage: {
      setItem: () => {
        throw new Error('storage unavailable');
      },
    },
  });
  await options.upload('data:image/png;base64,fixture');
  assert.equal(requests[0][0], '/profile/avatar');
  assert.equal(requests[0][1].method, 'POST');
  options.onSaved({ user: { avatarPath: '/uploads/new.webp', fullName: '已保存姓名' } });
  assert.equal(userState.avatarPath, '/uploads/new.webp');
  assert.equal(userState.token, 'local-test-token');
  assert.equal(rendered, true);
  assert.deepEqual(draft, {
    name: '未保存姓名',
    bio: '未保存简介',
    website: 'https://example.invalid/draft',
  });
  assert.doesNotMatch(source.slice(start, end), /saveSession\(|renderSettingsForm\(|localStorage/);
});

test('production settings loads controller before app and exposes local live feedback', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
  assert.ok(html.indexOf('/settings-avatar.js') < html.indexOf('/app.js'));
  assert.match(html, /<button[^>]*type="button"[^>]*data-avatar-action="choose"/);
  assert.match(html, /data-avatar-message[\s\S]*?role="status"[\s\S]*?aria-live="polite"/);
  assert.match(html, /aria-describedby="settings-avatar-help"/);
  assert.match(html, /5 MiB/);
});
