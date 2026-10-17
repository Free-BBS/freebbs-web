const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const policy = require('../public/privacy-policy.json');

const script = fs.readFileSync(path.join(__dirname, '../public/privacy-consent.js'), 'utf8');
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function element() {
  const listeners = new Map();
  const children = new Map();
  return {
    checked: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    setAttribute() {},
    focus() {
      this.focused = true;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    remove() {
      this.removed = true;
    },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    dispatch(name) {
      return listeners.get(name)?.({ preventDefault() {} });
    },
  };
}
function setup() {
  const checkbox = element();
  const dialogs = [];
  const requests = [];
  const responses = [];
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById: () => checkbox,
    createElement: element,
    body: { appendChild: (dialog) => dialogs.push(dialog) },
  };
  const storage = new Map([['free_bbs_auth_token', 'token']]);
  const window = {
    document,
    location: { origin: 'https://free-bbs.test' },
    localStorage: { getItem: (key) => storage.get(key), removeItem: (key) => storage.delete(key) },
  };
  vm.runInNewContext(script, {
    document,
    window,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      assert.ok(responses.length, `unexpected request ${url}`);
      const body = responses.shift();
      return {
        ok: !body.error,
        status: body.error ? 503 : 200,
        json: async () => (body.error ? { message: '暂时不可用' } : body),
      };
    },
  });
  return { checkbox, dialogs, requests, responses, storage, privacy: window.freeBbsPrivacy };
}
const accepted = {
  version: policy.version,
  contentHash: policy.contentHash,
  accepted: true,
  requiresFullPolicy: false,
};

test('login offers an unchecked inline policy link; an unchecked submission cannot authenticate', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/login.html'), 'utf8');
  assert.match(html, /id="auth-privacy-agreement"[^>]*type="checkbox"[^>]*required/);
  assert.doesNotMatch(
    html.match(/<input[^>]*id="auth-privacy-agreement"[^>]*>/)[0],
    /\schecked(?:\s|=|\/?>)/,
  );
  assert.match(html, /href="\/privacy"[^>]*>《FreeBBS 隐私政策》/);
  const h = setup();
  await assert.rejects(h.privacy.loginAcknowledgement(), /请阅读并勾选/);
  assert.equal(h.requests.length, 0);
});

test('returning login checkbox uses current server policy metadata without a modal', async () => {
  const h = setup();
  h.checkbox.checked = true;
  h.responses.push(policy);
  const result = await h.privacy.loginAcknowledgement();
  assert.equal(result.privacyPolicyHash, policy.contentHash);
  assert.equal(result.privacyAccepted, true);
  assert.equal(h.dialogs.length, 0);
  await h.privacy.ensureAccepted('token', accepted);
  assert.equal(h.requests.length, 1);
});

test('missing acceptance opens the entire policy and records only explicit checked confirmation', async () => {
  const h = setup();
  h.responses.push({ accepted: false, requiresFullPolicy: true }, policy, accepted);
  const pending = h.privacy.ensureAccepted('token');
  await flush();
  const dialog = h.dialogs[0];
  assert.ok(dialog.open);
  assert.equal(dialog.querySelector('.privacy-dialog-content').innerHTML, policy.html);
  await dialog.querySelector('[data-primary]').dispatch('click');
  assert.equal(h.requests.length, 2);
  const checkbox = dialog.querySelector('#privacy-full-agreement');
  checkbox.checked = true;
  checkbox.dispatch('change');
  await dialog.querySelector('[data-primary]').dispatch('click');
  const result = await pending;
  assert.equal(result.acceptedNow, true);
  assert.equal(h.requests[2].headers.Authorization, 'Bearer token');
  assert.equal(JSON.parse(h.requests[2].body).privacyPolicyVersion, policy.version);
  assert.ok(dialog.removed);
});

test('declining full policy never writes an acceptance or treats dismissing as consent', async () => {
  const h = setup();
  h.responses.push(policy);
  const pending = h.privacy.ensureAccepted('token', { accepted: false });
  const rejection = assert.rejects(pending, { code: 'privacy_declined' });
  await flush();
  h.dialogs[0].dispatch('cancel');
  await rejection;
  assert.equal(h.requests.length, 1);
});

test('acceptance failure leaves the modal open and allows explicit retry without recording success', async () => {
  const h = setup();
  h.responses.push(policy, { error: true }, accepted);
  const pending = h.privacy.ensureAccepted('token', { accepted: false });
  await flush();
  const dialog = h.dialogs[0];
  dialog.querySelector('#privacy-full-agreement').checked = true;
  await dialog.querySelector('[data-primary]').dispatch('click');
  assert.ok(dialog.open);
  assert.match(dialog.querySelector('[role="alert"]').textContent, /暂时不可用/);
  await dialog.querySelector('[data-primary]').dispatch('click');
  assert.equal((await pending).accepted, true);
});

test('simultaneous same-session checks share one modal; changed account cannot reuse it', async () => {
  const h = setup();
  h.responses.push(policy);
  const first = h.privacy.ensureAccepted('token', { accepted: false });
  assert.equal(first, h.privacy.ensureAccepted('token'));
  await assert.rejects(h.privacy.ensureAccepted('another-token'), /账号已变化/);
  const rejection = assert.rejects(first, { code: 'privacy_declined' });
  await flush();
  assert.equal(h.dialogs.length, 1);
  h.dialogs[0].dispatch('cancel');
  await rejection;
});

test('missing policy text fails closed before displaying or accepting an incomplete policy', async () => {
  const h = setup();
  h.responses.push({ ...policy, html: '' });
  await assert.rejects(h.privacy.ensureAccepted('token', { accepted: false }), /暂时不可用/);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.requests.length, 1);
});

test('switching accounts in another tab prevents accepting the stale modal and preserves the new session on decline', async () => {
  const h = setup();
  h.responses.push(policy);
  const pending = h.privacy.ensureAccepted('token', { accepted: false });
  const rejection = assert.rejects(pending, { code: 'privacy_declined' });
  await flush();
  h.storage.set('free_bbs_auth_token', 'another-token');
  const dialog = h.dialogs[0];
  dialog.querySelector('#privacy-full-agreement').checked = true;
  await dialog.querySelector('[data-primary]').dispatch('click');
  assert.match(dialog.querySelector('[role="alert"]').textContent, /账号已变化/);
  assert.equal(h.requests.length, 1);
  dialog.dispatch('cancel');
  await rejection;
  h.privacy.clearDeclinedSession('token');
  assert.equal(h.storage.get('free_bbs_auth_token'), 'another-token');
});
