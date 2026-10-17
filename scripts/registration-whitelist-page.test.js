const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const developmentRequire = createRequire(path.join(root, 'development', 'package.json'));
const { JSDOM } = developmentRequire('jsdom');
const html = fs.readFileSync(path.join(root, 'public', 'adminusers.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public', 'registration-whitelist.js'), 'utf8');
const privateName = '仅供本地回归的名单记录';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function payload(entries = []) {
  return {
    entries,
    total: entries.length,
    page: 1,
    pageSize: 25,
    stats: { total: entries.length, claimed: 0 },
  };
}

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 503, json: async () => body };
}

function record() {
  return { id: 1, studentId: '', fullName: privateName, email: '', claimed: false };
}

async function settle() {
  for (let step = 0; step < 4; step += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

function harness(t, fetchHandler = () => response(payload())) {
  const dom = new JSDOM(html, {
    url: 'https://example.invalid/adminusers',
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const ready = deferred();
  const requests = [];
  const app = {
    apiBaseUrl: '/api',
    userState: { isLoggedIn: false, isAdmin: false, uid: '', token: '' },
    sessionReady: ready.promise,
  };
  dom.window.freeBbsApp = app;
  dom.window.fetch = async (url, options = {}) => {
    const request = { url: String(url), options, method: options.method || 'GET' };
    requests.push(request);
    return fetchHandler(request);
  };
  vm.runInContext(source, dom.getInternalVMContext(), {
    filename: 'registration-whitelist.js',
  });
  const session = (state) => {
    Object.assign(app.userState, state);
    dom.window.dispatchEvent(
      new dom.window.CustomEvent('freebbs:session-change', {
        detail: { user: app.userState.isLoggedIn ? { ...app.userState } : null },
      }),
    );
  };
  const admin = () =>
    Object.assign(app.userState, {
      isLoggedIn: true,
      isAdmin: true,
      uid: 'local-admin',
      token: 'local-admin-test-token',
    });
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    app,
    requests,
    ready,
    session,
    admin,
  };
}

function retryButton(document) {
  return [...document.querySelectorAll('#registration-whitelist-panel button')].find((button) =>
    /重试|刷新|重新加载/.test(button.textContent),
  );
}

function selectWorkbook(window, form) {
  const file = new window.File(['local-test-only'], 'local-whitelist.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  Object.defineProperty(form.elements.file, 'files', { configurable: true, value: [file] });
}

test('the static admin page exposes an expanded whitelist entry before learning observations', (t) => {
  const { document } = harness(t);
  const panel = document.getElementById('registration-whitelist-panel');
  assert.ok(panel, 'the entry must exist before session restoration or controller initialization');
  assert.match(panel.querySelector('summary').textContent, /注册白名单/);
  assert.equal(panel.querySelector('details.whitelist-details').open, true);
  const shortcut = document.querySelector('header a[href="#registration-whitelist-panel"]');
  assert.ok(shortcut, 'the directory header must expose a direct whitelist link');
  assert.match(shortcut.textContent, /注册白名单/);
  const learning = document.getElementById('admin-learning-data');
  assert.ok(learning);
  const sections = [...document.querySelectorAll('section')];
  assert.ok(sections.indexOf(panel) < sections.indexOf(learning));
  const scripts = [...document.querySelectorAll('script[src]')];
  const appIndex = scripts.findIndex((script) => new URL(script.src).pathname === '/app.js');
  const whitelistIndex = scripts.findIndex(
    (script) => new URL(script.src).pathname === '/registration-whitelist.js',
  );
  assert.ok(appIndex >= 0 && whitelistIndex > appIndex, 'the controller must load after the app');
  assert.equal(new URL(scripts[whitelistIndex].src).searchParams.get('v'), '20261017-entry-1');
});

test('the controller starts after asynchronous session restoration without an app init call', async (t) => {
  const h = harness(t, () => response(payload([record()])));
  await settle();
  assert.equal(h.requests.length, 0, 'anonymous restoration must not request a private list');
  h.admin();
  h.ready.resolve();
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, 'GET');
  assert.match(h.requests[0].url, /^\/api\/admin\/registration-whitelist\?/);
  assert.equal(h.requests[0].options.headers.Authorization, 'Bearer local-admin-test-token');
  assert.match(
    h.document.querySelector('#registration-whitelist-panel tbody').textContent,
    new RegExp(privateName),
  );
});

test('repeated session events and init calls retain one panel and one upload handler', async (t) => {
  const h = harness(t, (request) =>
    request.method === 'POST' ? response({ imported: 1, duplicates: 0 }) : response(payload()),
  );
  h.admin();
  h.ready.resolve();
  await settle();
  for (let repeat = 0; repeat < 3; repeat += 1) {
    h.session({});
    h.window.initRegistrationWhitelist({
      apiBaseUrl: h.app.apiBaseUrl,
      getToken: () => h.app.userState.token,
    });
  }
  await settle();
  assert.equal(h.document.querySelectorAll('#registration-whitelist-panel').length, 1);
  assert.equal(h.document.querySelectorAll('.whitelist-upload-form').length, 1);
  const form = h.document.querySelector('.whitelist-upload-form');
  selectWorkbook(h.window, form);
  form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const imports = h.requests.filter((request) => request.method === 'POST');
  assert.equal(imports.length, 1, 'one user submission must cause exactly one import request');
  assert.match(imports[0].url, /\/import\?mode=append$/);
  assert.equal(form.querySelector('[type="submit"]').disabled, false);
});

test('a list failure keeps its title and a usable retry control', async (t) => {
  let failed = true;
  const h = harness(t, () =>
    failed ? response({ message: '模拟离线，请重试' }, false) : response(payload([record()])),
  );
  h.admin();
  h.ready.resolve();
  await settle();
  const panel = h.document.getElementById('registration-whitelist-panel');
  assert.match(panel.querySelector('summary').textContent, /注册白名单/);
  assert.match(panel.querySelector('.whitelist-message').textContent, /模拟离线/);
  const retry = retryButton(h.document);
  assert.ok(retry, 'failure must leave an explicit retry control');
  assert.equal(retry.disabled, false);
  failed = false;
  retry.click();
  await settle();
  assert.equal(h.requests.length, 2);
  assert.match(panel.querySelector('tbody').textContent, new RegExp(privateName));
});

test('logout and a non-admin session clear private rows without new requests', async (t) => {
  const h = harness(t, () => response(payload([record()])));
  h.admin();
  h.ready.resolve();
  await settle();
  assert.match(
    h.document.querySelector('#registration-whitelist-panel tbody').textContent,
    new RegExp(privateName),
  );
  const loadedRequests = h.requests.length;
  h.session({ isLoggedIn: false, isAdmin: false, uid: '', token: '' });
  await settle();
  assert.equal(h.requests.length, loadedRequests);
  assert.doesNotMatch(
    h.document.getElementById('registration-whitelist-panel').textContent,
    new RegExp(privateName),
  );
  h.session({
    isLoggedIn: true,
    isAdmin: false,
    uid: 'local-member',
    token: 'local-member-test-token',
  });
  await settle();
  assert.equal(h.requests.length, loadedRequests);
  assert.doesNotMatch(
    h.document.getElementById('registration-whitelist-panel').textContent,
    new RegExp(privateName),
  );
});

test('an old admin response cannot restore private rows after logout', async (t) => {
  const pending = deferred();
  const h = harness(t, () => pending.promise);
  h.admin();
  h.ready.resolve();
  await settle();
  assert.equal(h.requests.length, 1);
  h.session({ isLoggedIn: false, isAdmin: false, uid: '', token: '' });
  await settle();
  pending.resolve(response(payload([record()])));
  await settle();
  assert.doesNotMatch(
    h.document.getElementById('registration-whitelist-panel').textContent,
    new RegExp(privateName),
  );
  assert.equal(h.requests.length, 1);
});

test('cross-tab credential changes block pending restoration until the app confirms a session', async (t) => {
  const h = harness(t, () => response(payload([record()])));
  h.admin();
  h.window.dispatchEvent(
    new h.window.StorageEvent('storage', {
      key: 'free_bbs_auth_token',
      oldValue: 'local-admin-test-token',
      newValue: 'another-tab-test-token',
    }),
  );
  h.ready.resolve();
  await settle();
  assert.equal(h.requests.length, 0, 'a pending restore must not revive the stale admin session');
  assert.doesNotMatch(
    h.document.getElementById('registration-whitelist-panel').textContent,
    new RegExp(privateName),
  );
  h.session({ token: 'app-confirmed-admin-test-token' });
  await settle();
  assert.equal(h.requests.length, 1);
  assert.equal(
    h.requests[0].options.headers.Authorization,
    'Bearer app-confirmed-admin-test-token',
  );
  assert.match(
    h.document.querySelector('#registration-whitelist-panel tbody').textContent,
    new RegExp(privateName),
  );
});
