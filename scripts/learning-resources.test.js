/* eslint-disable no-script-url -- Intentional hostile URL fixtures verify canonical downloads. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCourseUploadRouter } = require('../backend/course-upload');
const { downloadUrl, groupFiles, install } = require('../public/learning-resources');
const { availableResource } = require('../public/learning-next-steps');

const API = 'https://freebbs.example/api';
const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const raw = (id, nodeId, fileName = '课程资料.pdf') => ({
  id,
  node_id: nodeId,
  file_name: fileName,
  content_type: 'application/pdf',
  byte_size: '2048',
  sha256: 'a'.repeat(64),
  created_at: '2026-10-10T00:00:00.000Z',
});
async function publicPayload(rows) {
  let payload;
  const router = createCourseUploadRouter({
    pool: { execute: async () => [rows] },
    requireAuth: () => {
      throw new Error('Public files must not require authentication');
    },
    uploadDir: '/unused',
  });
  const route = router.stack.find((item) => item.route?.path === '/public/courses/:slug/files');
  await route.route.stack[0].handle(
    { params: { slug: 'signals' } },
    {
      json: (data) => {
        payload = data;
      },
    },
  );
  return payload;
}
function runtime({ loggedIn = true } = {}) {
  const element = (tag = 'div') => ({
    tagName: tag,
    children: [],
    dataset: {},
    style: {},
    attributes: {},
    listeners: new Map(),
    textContent: '',
    isConnected: true,
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
  });
  const page = element();
  const host = element();
  const events = [];
  page.dispatchEvent = (event) => events.push(event);
  const calls = [];
  const app = {
    apiBaseUrl: API,
    userState: loggedIn
      ? { isLoggedIn: true, uid: 'student', token: 'private1' }
      : { isLoggedIn: false },
    callApi(url, options) {
      let resolve;
      let reject;
      const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      });
      calls.push({ url, options, resolve, reject });
      return promise;
    },
  };
  const listeners = new Map();
  const browser = {
    location: { href: 'https://freebbs.example/knowledge?course=signals' },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  const dom = {
    querySelector: () => page,
    getElementById: () => host,
    createElement: element,
  };
  const api = install(browser, dom, app);
  const enter = (nodeId = 'SS-01-01', slug = 'signals') =>
    page.listeners.get('knowledge:loaded')({ detail: { course: { slug }, node: { id: nodeId } } });
  return { api, app, host, calls, events, listeners, enter };
}
const text = (item) => [item.textContent, ...item.children.map(text)].join(' ');
const descendants = (item) => [item, ...item.children.flatMap(descendants)];
const settled = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test('the real public upload response groups only exact node associations and independent course files', async () => {
  const payload = await publicPayload([
    raw(ID1, 'SS-01-01'),
    raw(ID2, null, '课程总览.pdf'),
    raw(ID3, 'SS-02-01', '其他点.pdf'),
  ]);
  assert.equal(payload.files[0].url, `/api/course-upload/files/${ID1}`);
  assert.equal(payload.files[0].size, 2048);
  const groups = groupFiles(payload, 'SS-01-01', API);
  assert.deepEqual(
    groups.associated.map((file) => file.id),
    [ID1],
  );
  assert.deepEqual(
    groups.courseFiles.map((file) => file.id),
    [ID2],
  );
  assert.equal(groups.otherNodeCount, 1);
  assert.equal(groups.associated[0].href, `${API}/course-upload/files/${ID1}`);
  assert.equal(availableResource(groups.associated[0]), true);
});

test('filename and response URLs are untrusted: text-only names and canonical ID download links', async () => {
  const payload = await publicPayload([raw(ID1, 'SS-01-01', '<img src=x onerror=alert(1)>.pdf')]);
  payload.files[0].url = 'javascript:alert(1)';
  payload.files[0].markdown = '<script>alert(1)</script>';
  const view = runtime();
  view.enter();
  view.calls[0].resolve(payload);
  await settled();
  const links = descendants(view.host).filter((item) => item.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, '<img src=x onerror=alert(1)>.pdf');
  assert.equal(links[0].href, `${API}/course-upload/files/${ID1}`);
  assert.equal(
    descendants(view.host).some((item) => ['img', 'script'].includes(item.tagName)),
    false,
  );
  for (const id of ['../../evil', 'javascript:alert(1)', `${ID1}?url=https://evil.example`])
    assert.equal(downloadUrl(id, API), null);
  for (const base of [
    'javascript:alert(1)',
    'https://user:password@example/api',
    'https://example/api?redirect=1',
  ])
    assert.equal(downloadUrl(ID1, base), null);
});

test('anonymous readers load public resources without credentials and course files do not become node evidence', async () => {
  const view = runtime({ loggedIn: false });
  view.enter();
  assert.match(text(view.host), /正在载入公开资料.*无需登录/);
  assert.equal(view.calls[0].url, '/course-upload/public/courses/signals/files');
  assert.equal(view.calls[0].options.credentials, 'omit');
  assert.equal(view.calls[0].options.headers.Authorization, undefined);
  view.calls[0].resolve(await publicPayload([raw(ID2, null)]));
  await settled();
  assert.equal(view.api.getSnapshot().status, 'ready');
  assert.equal(view.api.getSnapshot().resources.length, 0);
  assert.equal(view.api.getSnapshot().hasAssociatedResources, false);
  assert.equal(view.api.getSnapshot().hasCourseResources, true);
  assert.match(text(view.host), /未找到本知识点关联资料/);
});

test('empty and failed loading are distinct and retry uses a new real request', async () => {
  const view = runtime();
  view.enter();
  view.calls[0].reject(new Error('offline'));
  await settled();
  assert.equal(view.api.getSnapshot().status, 'error');
  assert.match(text(view.host), /不表示没有资料/);
  const retry = descendants(view.host).find((item) => item.tagName === 'button');
  retry.listeners.get('click')();
  assert.equal(view.calls.length, 2);
  view.calls[1].resolve({ files: [] });
  await settled();
  assert.equal(view.api.getSnapshot().status, 'empty');
  assert.match(text(view.host), /最多 200 份.*不代表全部/);
});

test('node and course changes isolate cache scopes and ignore late old results', async () => {
  const view = runtime();
  view.enter('SS-01-01');
  view.enter('SS-02-01');
  assert.equal(view.calls.length, 2);
  view.calls[1].resolve(await publicPayload([raw(ID3, 'SS-02-01', '当前点.pdf')]));
  await settled();
  view.calls[0].resolve(await publicPayload([raw(ID1, 'SS-01-01', '旧点.pdf')]));
  await settled();
  assert.match(text(view.host), /当前点.pdf/);
  assert.doesNotMatch(text(view.host), /旧点.pdf/);
  view.enter('MA-01-1', 'math');
  assert.equal(view.calls[2].url, '/course-upload/public/courses/math/files');
  assert.doesNotMatch(text(view.host), /当前点.pdf/);
});

test('identity and cross-tab transitions clear lists, ignore late requests, and allow public retry', async () => {
  const view = runtime();
  view.enter();
  view.app.userState = { isLoggedIn: false };
  view.listeners.get('freebbs:session-change')();
  assert.equal(view.calls.length, 2);
  view.calls[0].resolve(await publicPayload([raw(ID1, 'SS-01-01', '迟到.pdf')]));
  await settled();
  assert.doesNotMatch(text(view.host), /迟到.pdf/);
  view.listeners.get('storage')({ key: 'free_bbs_auth_token' });
  view.calls[1].resolve(await publicPayload([raw(ID1, 'SS-01-01', '跨标签迟到.pdf')]));
  await settled();
  assert.equal(view.api.getSnapshot().status, 'stale');
  assert.doesNotMatch(text(view.host), /跨标签迟到.pdf/);
  view.api.refresh();
  assert.equal(view.calls.length, 3);
  view.calls[2].resolve(await publicPayload([raw(ID1, 'SS-01-01', '公开可读.pdf')]));
  await settled();
  assert.match(text(view.host), /公开可读.pdf/);
});

test('malformed records are omitted, the displayed window never exceeds 200, and a bad response is an error', async () => {
  const payload = await publicPayload([raw(ID1, 'SS-01-01')]);
  const files = Array.from({ length: 201 }, (_, index) => ({
    ...payload.files[0],
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  assert.equal(groupFiles({ files }, 'SS-01-01', API).associated.length, 200);
  assert.equal(
    groupFiles(
      {
        files: [
          { ...payload.files[0], nodeId: {} },
          { ...payload.files[0], id: '../bad' },
        ],
      },
      'SS-01-01',
      API,
    ).omitted,
    2,
  );
  const view = runtime();
  view.enter();
  view.calls[0].resolve({ files: 'not a list' });
  await settled();
  assert.equal(view.api.getSnapshot().status, 'error');
});

test('an old failed refresh cannot evict a newer cached response', async () => {
  const view = runtime();
  view.enter();
  view.api.refresh();
  view.calls[0].reject(new Error('old failed request'));
  await settled();
  view.enter();
  assert.equal(view.calls.length, 2);
  view.calls[1].resolve(await publicPayload([raw(ID1, 'SS-01-01')]));
  await settled();
  assert.equal(view.api.getSnapshot().associated.length, 1);
});

test('file association accepts the full backend node identifier contract, without prefix matching', async () => {
  const view = runtime();
  view.enter('SS-02-01-EXT1');
  assert.equal(view.calls.length, 1);
  view.calls[0].resolve(await publicPayload([raw(ID1, 'SS-02-01-EXT1'), raw(ID2, 'SS-02-01')]));
  await settled();
  assert.deepEqual(
    view.api.getSnapshot().associated.map((file) => file.id),
    [ID1],
  );
  view.enter('SS-02');
  assert.equal(view.calls.length, 2);
  view.enter(`SS-${'A'.repeat(65)}`);
  assert.equal(view.api.getSnapshot().status, 'idle');
});
