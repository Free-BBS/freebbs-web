const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { displayModel } = require('../public/learning-stars');

test('ordinary nodes show independent stars without exposing pending deep mastery', () => {
  const model = displayModel({
    stars: [
      { key: 'self_learning', earned: true },
      { key: 'deep_mastery', earned: true },
    ],
  });
  assert.equal(model.length, 3);
  assert.equal(model[1].earned, true);
  assert.equal(model[0].earned, false);
  assert.equal(model[0].status, '尚未开放');
  assert.equal(model[2].earned, false);
  assert.equal(model[2].status, '后续开发');
});

test('course-learning remains unavailable without an award but preserves compatible historical awards', () => {
  const unavailable = displayModel({ stars: [{ key: 'course_learning', earned: false }] })[0];
  assert.equal(unavailable.earned, false);
  assert.equal(unavailable.status, '尚未开放');
  const historical = displayModel({
    stars: [{ key: 'course_learning', earned: true, historicalVersion: true }],
  })[0];
  assert.equal(historical.earned, true);
  assert.equal(historical.status, '已记录');
  assert.equal(historical.historicalVersion, true);
});
test('extension displays continuous two-star sequence without a course-learning star', () => {
  assert.deepEqual(
    displayModel({ level: 'extension' }).map((item) => item.key),
    ['self_learning', 'deep_mastery'],
  );
});
test('course review and mastery mechanisms stay grey and historical award stays distinguishable', () => {
  const model = displayModel(
    {
      stars: [
        { key: 'course_lit', earned: true, historicalScope: true },
        { key: 'complete_review', earned: true },
      ],
    },
    { course: true },
  );
  assert.equal(model[0].earned, true);
  assert.equal(model[0].historicalVersion, true);
  assert.equal(model[1].earned, false);
});
function runtime({ knowledgePage = false, coursePage = false } = {}) {
  const elements = () => ({
    children: [],
    dataset: {},
    listeners: new Map(),
    isConnected: true,
    textContent: '',
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    setAttribute() {},
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    get childElementCount() {
      return this.children.length;
    },
  });
  const calls = [];
  const listeners = new Map();
  const app = {
    userState: { uid: 'student', token: 'token1', isLoggedIn: true },
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
  const window = {
    freeBbsApp: app,
    location: { search: '?course=signals' },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
  };
  const page = knowledgePage ? elements() : null;
  const selftestSlot = knowledgePage ? elements() : null;
  const courseSlot = coursePage ? elements() : null;
  const document = {
    createElement: elements,
    getElementById: (id) =>
      ({ 'learning-selftest-stars': selftestSlot, 'course-learning-stars': courseSlot })[id] ||
      null,
    querySelector: (selector) => (selector === '[data-knowledge-page]' ? page : null),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/learning-stars.js'), 'utf8'), {
    window,
    document,
    URLSearchParams,
  });
  return {
    app,
    calls,
    listeners,
    page,
    selftestSlot,
    courseSlot,
    api: window.FreeBbsLearningStars,
    slot: elements(),
    newSlot: elements,
  };
}
const snapshot = {
  node: { nodeId: 'SS-01-01', stars: [{ key: 'self_learning', earned: true }] },
};
const allText = (item) => [item.textContent, ...item.children.map(allText)].join(' ');
const settled = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test('historical node star and current-version selftest evidence render together', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.calls[0].resolve({
    node: {
      nodeId: 'SS-01-01',
      stars: [{ key: 'self_learning', earned: true, historicalVersion: true }],
      selftest: {
        available: true,
        passedQuestionCount: 3,
        questionCount: 4,
        pendingReviewCount: 1,
      },
    },
  });
  await settled();
  assert.match(allText(view.slot), /保留历史版本的星记录/);
  assert.match(allText(view.slot), /本版自测 3\/4 题通过 · 1 题待复核/);
  assert.match(allText(view.slot), /已记录/);
  assert.doesNotMatch(allText(view.slot), /更新学习星|掌握程度|获取条件/);
  const courseLearning = view.slot.children[0].children.find(
    (item) => item.dataset.learningStar === 'course_learning',
  );
  assert.match(courseLearning.className, /is-muted/);
  assert.match(allText(courseLearning), /尚未开放/);
});

test('historical course star and coverage of the current node range render together', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals' });
  view.calls[0].resolve({
    course: {
      stars: [{ key: 'course_lit', earned: true, historicalScope: true }],
      litNodeCount: 2,
      eligibleNodeCount: 3,
    },
  });
  await settled();
  assert.match(allText(view.slot), /保留历史范围的星记录/);
  assert.match(allText(view.slot), /当前范围 2\/3 个普通知识点有星记录/);
  assert.doesNotMatch(allText(view.slot), /全面掌握：已记录|获取条件/);
});

test('history with no published selftest does not invent current-version progress', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.calls[0].resolve({
    node: {
      nodeId: 'SS-01-01',
      stars: [{ key: 'course_learning', earned: true, historicalVersion: true }],
      selftest: { available: false, passedQuestionCount: 0, questionCount: 0 },
    },
  });
  await settled();
  assert.match(allText(view.slot), /课程学习 已记录/);
  assert.match(allText(view.slot), /保留历史版本的星记录/);
  assert.doesNotMatch(allText(view.slot), /本版自测|0\/0/);
});

test('an eligible but unrecorded star offers an explicit update, not an automatic write or success claim', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.calls[0].resolve({
    node: {
      nodeId: 'SS-01-01',
      stars: [],
      selftest: { available: true, eligible: true, passedQuestionCount: 2, questionCount: 2 },
    },
  });
  await settled();
  const findUpdate = (item) =>
    item.textContent === '更新学习星' ? item : item.children.map(findUpdate).find(Boolean);
  const button = findUpdate(view.slot);
  assert.ok(button);
  assert.match(allText(view.slot), /本版自测 2\/2 题通过/);
  assert.doesNotMatch(allText(view.slot), /自主学习 已记录/);
  assert.equal(view.calls.length, 1, 'Reading eligibility never performs a write');
  const request = button.listeners.get('click')();
  assert.equal(button.disabled, true);
  assert.equal(view.calls[1].url, '/learning-stars/signals/SS-01-01/reconcile');
  assert.equal(view.calls[1].options.method, 'POST');
  assert.equal(view.calls[1].options.body, '{}');
  view.calls[1].reject(new Error('fixture temporarily unavailable'));
  await request;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '更新失败，重试');
  assert.doesNotMatch(allText(view.slot), /自主学习 已记录/);
  const retry = button.listeners.get('click')();
  view.calls[2].resolve({ awarded: true });
  await retry;
  assert.equal(view.calls[3].url, '/learning-stars/signals/SS-01-01');
  assert.equal(view.calls[3].options.method, 'GET');
  view.calls[3].resolve(snapshot);
  await settled();
  assert.match(allText(view.slot), /自主学习 已记录/);
  assert.doesNotMatch(allText(view.slot), /更新学习星|更新失败/);
});
test('late star results cannot repaint another account and refresh uses its own identity', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  assert.equal(view.calls.length, 1);
  view.app.userState = { uid: 'other', token: 'token2', isLoggedIn: true };
  view.listeners.get('freebbs:session-change')();
  view.calls[0].resolve(snapshot);
  await settled();
  assert.doesNotMatch(allText(view.slot), /已记录/);
  view.calls[1].resolve({ node: { nodeId: 'SS-01-01', stars: [] } });
  await settled();
  assert.doesNotMatch(allText(view.slot), /已记录/);
});
test('cross-tab changes suspend even refresh and explicit identity confirmation restores loading', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.listeners.get('storage')({ key: 'free_bbs_auth_token' });
  view.api.refresh();
  assert.equal(view.calls.length, 1);
  view.calls[0].resolve(snapshot);
  await settled();
  assert.doesNotMatch(allText(view.slot), /已记录/);
  assert.match(allText(view.slot), /登录状态已变化/);
  view.listeners.get('freebbs:session-change')();
  assert.equal(view.calls.length, 2);
  view.calls[1].resolve(snapshot);
  await settled();
  assert.match(allText(view.slot), /已记录/);
});

test('the actual knowledge-loaded path requests only its node and shares the overview request', async () => {
  const view = runtime({ knowledgePage: true });
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-01-01' } },
  });
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  assert.equal(view.calls.length, 1, 'overview and selftest slots share the same node request');
  assert.equal(view.calls[0].url, '/learning-stars/signals/SS-01-01');
  assert.equal(view.calls[0].options.method, 'GET');
  view.calls[0].resolve(snapshot);
  await settled();
  assert.match(allText(view.selftestSlot), /自主学习 已记录/);
  assert.match(allText(view.slot), /自主学习 已记录/);
  const laterSlot = view.newSlot();
  view.api.mount(laterSlot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  await settled();
  assert.equal(view.calls.length, 1, 'a later slot reuses the settled node request');
  assert.match(allText(laterSlot), /自主学习 已记录/);
});

test('same-course different nodes and the course summary have isolated request caches', async () => {
  const view = runtime({ coursePage: true });
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  const second = view.newSlot();
  view.api.mount(second, { courseSlug: 'signals', nodeId: 'SS-02-01' });
  assert.deepEqual(
    view.calls.map((call) => call.url),
    [
      '/learning-stars/signals',
      '/learning-stars/signals/SS-01-01',
      '/learning-stars/signals/SS-02-01',
    ],
  );
  view.calls[2].resolve({ node: { nodeId: 'SS-02-01', level: 'extension', stars: [] } });
  view.calls[1].resolve(snapshot);
  view.calls[0].resolve({ course: { stars: [{ key: 'course_lit', earned: true }] } });
  await settled();
  assert.match(allText(view.courseSlot), /课程点亮 已记录/);
  assert.match(allText(view.slot), /自主学习 已记录/);
  assert.doesNotMatch(allText(second), /已记录|课程学习/);
  view.api.refresh();
  assert.equal(view.calls.length, 6, 'refresh invalidates each distinct scope once');
  assert.deepEqual(
    view.calls.slice(3).map((call) => call.url),
    [
      '/learning-stars/signals',
      '/learning-stars/signals/SS-01-01',
      '/learning-stars/signals/SS-02-01',
    ],
  );
});

test('switching one slot to a new point ignores the late result from the old point', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-02-01' });
  assert.equal(view.calls.length, 2);
  view.calls[1].resolve({ node: { nodeId: 'SS-02-01', level: 'extension', stars: [] } });
  await settled();
  view.calls[0].resolve(snapshot);
  await settled();
  assert.doesNotMatch(allText(view.slot), /已记录|课程学习/);
});

test('refresh deduplicates node slots and late errors do not evict the newer request', async () => {
  const view = runtime();
  const second = view.newSlot();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.api.mount(second, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  view.api.refresh();
  assert.equal(view.calls.length, 2, 'both slots share one new request after refresh');
  view.calls[0].reject(new Error('old request failed after refresh'));
  await settled();
  const third = view.newSlot();
  view.api.mount(third, { courseSlug: 'signals', nodeId: 'SS-01-01' });
  assert.equal(view.calls.length, 2, 'an old error cannot delete the newer cached request');
  view.calls[1].resolve(snapshot);
  await settled();
  for (const slot of [view.slot, second, third]) assert.match(allText(slot), /自主学习 已记录/);
});

test('a mismatched single-node response never displays another point evidence', async () => {
  const view = runtime();
  view.api.mount(view.slot, { courseSlug: 'signals', nodeId: 'SS-02-01' });
  view.calls[0].resolve(snapshot);
  await settled();
  assert.doesNotMatch(allText(view.slot), /已记录/);
});
