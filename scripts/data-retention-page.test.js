const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/data-retention.js'), 'utf8');
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
function element() {
  const listeners = new Map();
  return {
    textContent: '',
    children: [],
    hidden: false,
    disabled: false,
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    setAttribute() {},
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    fire(name) {
      return listeners.get(name)?.();
    },
  };
}
const payload = () => ({
  mode: 'read_only',
  newCleanupEnabled: false,
  checkedAt: '2026-10-14T01:00:00Z',
  categories: [
    {
      label: '<img src=x onerror=bad()>',
      retention: '拟定五年',
      proposed: true,
      startPoint: '创建起',
      purpose: '历史查询',
      executionStatus: '仅检查',
      coverage: '测试记录',
      stats: { status: 'available', totalCount: 3, overdueCount: 1, missingDateCount: 0 },
    },
    {
      label: '附件',
      retention: '跟随关联记录',
      stats: { status: 'unavailable', message: '暂无法统计' },
    },
  ],
});
function setup({ admin = true, pending = false } = {}) {
  const elements = new Map();
  [
    'data-retention-content',
    'retention-categories',
    'retention-status',
    'retention-refresh',
    'retention-access',
  ].forEach((id) => elements.set(id, element()));
  const handlers = new Map();
  const requests = [];
  let resolveResponse;
  const storage = new Map([['free_bbs_auth_token', 'synthetic-admin']]);
  const app = {
    userState: { isAdmin: admin, isLoggedIn: true, uid: 1, token: 'synthetic-admin' },
    apiBaseUrl: '/api',
    sessionReady: Promise.resolve(),
  };
  const window = {
    freeBbsApp: app,
    localStorage: { getItem: (key) => storage.get(key) },
    addEventListener: (name, fn) => handlers.set(name, fn),
  };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (pending)
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    return { ok: true, status: 200, json: async () => payload() };
  };
  vm.runInNewContext(source, {
    window,
    document: {
      getElementById: (id) => elements.get(id),
      createElement: element,
      createDocumentFragment: element,
    },
    fetch,
    AbortController,
    Date,
    Number,
    Promise,
  });
  return {
    elements,
    requests,
    app,
    storage,
    fire: (name, event = {}) => handlers.get(name)?.(event),
    resolve: (status = 200) =>
      resolveResponse({ ok: status === 200, status, json: async () => payload() }),
  };
}
function texts(node) {
  return [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);
}
test('ordinary users make no statistics request and cannot see the panel', async () => {
  const context = setup({ admin: false });
  await flush();
  assert.equal(context.requests.length, 0);
  assert.equal(context.elements.get('data-retention-content').hidden, true);
});
test('admin inspection sends only GET with no-store; distinguishes unavailable from zero and renders plain text', async () => {
  const context = setup();
  await flush();
  assert.equal(context.requests.length, 1);
  const request = context.requests[0];
  assert.equal(request.url, '/api/admin/data-retention');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.body, undefined);
  const text = texts(context.elements.get('retention-categories'));
  assert.ok(text.includes('<img src=x onerror=bad()>'));
  assert.ok(text.includes('超过拟定期限'));
  assert.ok(text.includes('暂无法统计'));
  assert.equal(context.elements.get('retention-refresh').disabled, false);
});
test('cross-tab account switch aborts and never displays the previous admin response', async () => {
  const context = setup({ pending: true });
  await flush();
  context.storage.set('free_bbs_auth_token', 'student');
  context.fire('storage', { key: 'free_bbs_auth_token' });
  assert.equal(context.requests[0].options.signal.aborted, true);
  context.resolve();
  await flush();
  assert.equal(context.elements.get('data-retention-content').hidden, true);
  assert.equal(context.elements.get('retention-categories').children.length, 0);
});
test('server denied permission clears statistics and offers no mutation action', async () => {
  const context = setup({ pending: true });
  await flush();
  context.resolve(403);
  await flush();
  assert.equal(context.elements.get('data-retention-content').hidden, true);
  assert.equal(context.elements.get('retention-categories').children.length, 0);
  assert.match(context.elements.get('retention-access').textContent, /管理员/);
});
test('logout clears already rendered statistics immediately', async () => {
  const context = setup();
  await flush();
  context.app.userState.isLoggedIn = false;
  context.fire('freebbs:session-change');
  await flush();
  assert.equal(context.elements.get('data-retention-content').hidden, true);
  assert.equal(context.elements.get('retention-categories').children.length, 0);
});
