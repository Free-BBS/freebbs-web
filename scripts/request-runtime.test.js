const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.join(__dirname, '../public/request-runtime.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const notificationSource = fs.readFileSync(
  path.join(__dirname, '../public/notifications.js'),
  'utf8',
);
const never = () => new Promise(() => {});
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function fixture() {
  const timers = new Map();
  let id = 0;
  let now = 0;
  const context = vm.createContext({
    AbortController,
    DOMException,
    FormData,
    Blob,
    setTimeout: (callback, duration) => {
      id += 1;
      timers.set(id, { callback, at: now + duration });
      return id;
    },
    clearTimeout: (timer) => timers.delete(timer),
  });
  vm.runInContext(runtimeSource, context);
  return {
    context,
    runtime: context.freeBbsRequests,
    timers,
    tick: (duration) => {
      now += duration;
      for (const [timer, entry] of timers) {
        if (entry.at <= now) {
          timers.delete(timer);
          entry.callback();
        }
      }
    },
  };
}

test('default deadline aborts a pending transport once without retrying a write', async () => {
  const { runtime, tick, timers } = fixture();
  let calls = 0;
  let signal;
  const pending = runtime.request(
    '/api/profile',
    { method: 'POST' },
    (response) => response.json(),
    (url, init) => {
      calls += 1;
      signal = init.signal;
      assert.equal('timeoutMs' in init, false);
      return never();
    },
  );
  const rejected = assert.rejects(pending, {
    name: 'TimeoutError',
    code: 'request_timeout',
    status: 0,
  });
  await flush();
  tick(14999);
  assert.equal(signal.aborted, false);
  tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(timers.size, 0);
});

test('the same deadline remains active while a successful response body hangs', async () => {
  const { runtime, tick, timers } = fixture();
  let reading = false;
  const pending = runtime.request(
    '/api/health',
    { timeoutMs: 45 },
    (response) => response.json(),
    async () => ({
      json: () => {
        reading = true;
        return never();
      },
    }),
  );
  const rejected = assert.rejects(pending, { code: 'request_timeout', timeoutMs: 45 });
  await flush();
  assert.equal(reading, true);
  tick(45);
  await rejected;
  assert.equal(timers.size, 0);
});

test('a late response from an abort-ignoring transport is never consumed', async () => {
  const { runtime, tick } = fixture();
  let finish;
  let consumed = false;
  const pending = runtime.request(
    '/api/health',
    {},
    async () => {
      consumed = true;
    },
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = assert.rejects(pending, { code: 'request_timeout' });
  await flush();
  tick(15000);
  await rejected;
  finish({});
  await flush();
  assert.equal(consumed, false);
});

test('caller cancellation keeps its reason, aborts transport and removes the deadline listener', async () => {
  const { runtime, timers } = fixture();
  const controller = new AbortController();
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  let removals = 0;
  controller.signal.removeEventListener = (...args) => {
    removals += 1;
    return remove(...args);
  };
  let signal;
  const pending = runtime.request(
    '/api/health',
    { signal: controller.signal },
    (response) => response.json(),
    (url, init) => {
      signal = init.signal;
      return never();
    },
  );
  const reason = new DOMException('Page closed', 'AbortError');
  const rejected = assert.rejects(pending, (error) => error === reason);
  await flush();
  controller.abort(reason);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
  assert.equal(removals, 1);
  assert.equal(timers.size, 0);
});

test('already cancelled callers never start transport; success and network failure clean timers', async () => {
  const { runtime, timers } = fixture();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    runtime.request(
      '/api/health',
      { signal: controller.signal },
      () => never(),
      () => {
        calls += 1;
      },
    ),
  );
  assert.equal(calls, 0);
  assert.equal(timers.size, 0);
  assert.equal(
    await runtime.request(
      '/api/health',
      {},
      async () => 'ready',
      async () => ({}),
    ),
    'ready',
  );
  assert.equal(timers.size, 0);
  const offline = new TypeError('offline');
  await assert.rejects(
    runtime.request(
      '/api/health',
      {},
      () => never(),
      async () => {
        throw offline;
      },
    ),
    (error) => error === offline,
  );
  assert.equal(timers.size, 0);
});

test('auth, AI, upload, sync and caller overrides retain distinct finite budgets', () => {
  const { runtime } = fixture();
  assert.equal(runtime.timeoutFor('/api/auth/me'), 8000);
  assert.equal(runtime.timeoutFor('/api/development/v1/me'), 8000);
  assert.equal(runtime.timeoutFor('/api/ai/circuit/chat'), 180000);
  assert.equal(runtime.timeoutFor('/api/workbench/schedule-planner/preview'), 180000);
  assert.equal(runtime.timeoutFor('/api/workbench/connectors/tsinghua/direct-login'), 180000);
  assert.equal(
    runtime.timeoutFor('/api/workbench/connectors/tsinghua/sync-runs', { method: 'POST' }),
    180000,
  );
  assert.equal(runtime.timeoutFor('/api/workbench/connectors/tsinghua/sync-runs/run-1'), 15000);
  assert.equal(runtime.timeoutFor('/api/discussion/uploads/images'), 120000);
  assert.equal(
    runtime.timeoutFor('/api/development/v1/sports/media/images', { body: new FormData() }),
    120000,
  );
  assert.equal(runtime.timeoutFor('/api/ai/tasks/latest?watching=1'), 15000);
  assert.equal(runtime.timeoutFor('/api/health', { timeoutMs: 240000 }), 240000);
  assert.equal(runtime.timeoutFor('/api/health', { timeoutMs: 0 }), 15000);
});

test('pending auth restoration settles sessionReady and preserves saved credentials', async () => {
  const { context, runtime, tick, timers } = fixture();
  let cleared = false;
  const userName = {};
  Object.assign(context, {
    API_BASE_URL: 'https://example.test/api',
    STORAGE_KEY: 'token',
    userState: { token: 'saved-token' },
    userName,
    localStorage: { getItem: () => 'saved-token' },
    getStoredAuthToken: () => 'saved-token',
    window: {
      freeBbsRequests: {
        request: (url, options, consume) => runtime.request(url, options, consume, never),
      },
    },
    clearSession: () => {
      cleared = true;
    },
    saveSession: () => {
      throw new Error('no successful response');
    },
    isSettingsPage: () => false,
    isAdminManagementPage: () => false,
    renderUser: () => {},
    renderAdminSection: () => {},
    loadCheckinShortcutState: () => {},
    loadElectromagneticPage: () => {},
    loadInventoryPage: () => {},
    sessionRestored: false,
  });
  const start = appSource.indexOf('async function callApi(');
  const end = appSource.indexOf('\nasync function loadFortuneConfig()', start);
  const startup = appSource.slice(appSource.indexOf('sessionReady = restoreSession().finally('));
  vm.runInContext(
    `${appSource.slice(start, end)}\n${startup.slice(0, startup.indexOf('\nrenderAdminSection();'))}`,
    context,
  );
  await flush();
  assert.equal(context.sessionRestored, false);
  tick(8000);
  await context.sessionReady;
  assert.equal(context.sessionRestored, true);
  assert.equal(cleared, false);
  assert.equal(context.userState.token, 'saved-token');
  assert.match(userName.title, /暂未确认/);
  assert.equal(timers.size, 0);
});

test('blocked credential storage permits guest startup and missing user-name markup does not reject restoration', async () => {
  const { context, runtime, tick } = fixture();
  Object.assign(context, {
    STORAGE_KEY: 'token',
    localStorage: {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    },
  });
  const start = appSource.indexOf('function getStoredAuthToken(');
  const end = appSource.indexOf('\nconst TYPOGRAPHY_PRESETS', start);
  vm.runInContext(appSource.slice(start, end), context);
  assert.equal(context.getStoredAuthToken(), '');
  Object.assign(context, {
    API_BASE_URL: 'https://example.test/api',
    userState: { token: 'saved-token' },
    userName: null,
    getStoredAuthToken: () => 'saved-token',
    window: {
      freeBbsRequests: {
        request: (url, options, consume) => runtime.request(url, options, consume, never),
      },
    },
    isSettingsPage: () => false,
    isAdminManagementPage: () => false,
  });
  const apiStart = appSource.indexOf('async function callApi(');
  vm.runInContext(
    appSource.slice(apiStart, appSource.indexOf('\nasync function loadFortuneConfig()', apiStart)),
    context,
  );
  const pending = context.restoreSession();
  await flush();
  tick(8000);
  await pending;
});

test('notification JSON and HTTP errors stay compatible, and stalled bodies are bounded', async () => {
  const { context, runtime, tick } = fixture();
  let response = { ok: false, status: 403, json: async () => ({ message: '没有权限' }) };
  Object.assign(context, {
    apiBase: 'https://example.test/api',
    storageKey: 'token',
    localStorage: { getItem: () => 'saved-token' },
    window: {
      freeBbsRequests: {
        request: (url, options, consume) =>
          runtime.request(url, options, consume, async () => response),
      },
    },
  });
  const start = notificationSource.indexOf('  async function api(');
  vm.runInContext(
    notificationSource.slice(start, notificationSource.indexOf('\n  function updateCount(', start)),
    context,
  );
  await assert.rejects(context.api('/notifications'), { status: 403, message: '没有权限' });
  response = { ok: true, status: 200, json: never };
  const rejected = assert.rejects(context.api('/notifications'), { code: 'request_timeout' });
  await flush();
  tick(15000);
  await rejected;
});
