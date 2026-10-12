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
function runtime() {
  const elements = () => ({
    children: [],
    dataset: {},
    isConnected: true,
    textContent: '',
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    setAttribute() {},
    addEventListener() {},
    get childElementCount() {
      return this.children.length;
    },
  });
  const calls = [];
  const listeners = new Map();
  const app = {
    userState: { uid: 'student', token: 'token1', isLoggedIn: true },
    callApi(url) {
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      calls.push({ url, resolve });
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
  const document = {
    createElement: elements,
    getElementById: () => null,
    querySelector: () => null,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/learning-stars.js'), 'utf8'), {
    window,
    document,
    URLSearchParams,
  });
  return { app, calls, listeners, api: window.FreeBbsLearningStars, slot: elements() };
}
const snapshot = {
  nodes: [{ nodeId: 'SS-01-01', stars: [{ key: 'self_learning', earned: true }] }],
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
    nodes: [
      {
        nodeId: 'SS-01-01',
        stars: [{ key: 'self_learning', earned: true, historicalVersion: true }],
        selftest: {
          available: true,
          passedQuestionCount: 3,
          questionCount: 4,
          pendingReviewCount: 1,
        },
      },
    ],
  });
  await settled();
  assert.match(allText(view.slot), /保留历史版本的星记录/);
  assert.match(allText(view.slot), /本版自测 3\/4 题通过 · 1 题待复核/);
  assert.match(allText(view.slot), /已记录/);
  assert.doesNotMatch(allText(view.slot), /同步学习记录|掌握程度|获取条件/);
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
    nodes: [
      {
        nodeId: 'SS-01-01',
        stars: [{ key: 'course_learning', earned: true, historicalVersion: true }],
        selftest: { available: false, passedQuestionCount: 0, questionCount: 0 },
      },
    ],
  });
  await settled();
  assert.match(allText(view.slot), /课程学习 已记录/);
  assert.match(allText(view.slot), /保留历史版本的星记录/);
  assert.doesNotMatch(allText(view.slot), /本版自测|0\/0/);
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
  view.calls[1].resolve({ nodes: [{ nodeId: 'SS-01-01', stars: [] }] });
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
