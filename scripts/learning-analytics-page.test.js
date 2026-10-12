const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  activeDelta,
  canViewOwnProfile,
  minutes,
  normalizeLearningChoice,
} = require('../public/learning-analytics');

test('visible, focused and recently active time is bounded and monotonic', () => {
  const input = { start: 1000, end: 21000, lastInteraction: 1000, visible: true, focused: true };
  assert.equal(activeDelta(input), 20);
  assert.equal(activeDelta({ ...input, visible: false }), 0);
  assert.equal(activeDelta({ ...input, focused: false }), 0);
  assert.equal(activeDelta({ ...input, end: 900 }), 0);
  assert.equal(activeDelta({ ...input, start: 70000, end: 90000 }), 0);
  assert.equal(activeDelta({ ...input, start: 51000, end: 71000 }), 10);
  assert.equal(activeDelta({ ...input, end: 500000 }), 30);
});
test('private profile panel only belongs to the signed-in owner', () => {
  const state = { uid: 'abc', isLoggedIn: true };
  assert.equal(canViewOwnProfile('abc', state), true);
  assert.equal(canViewOwnProfile('', state), true);
  assert.equal(canViewOwnProfile('other', state), false);
  assert.equal(canViewOwnProfile('abc', { ...state, isLoggedIn: false }), false);
  assert.equal(minutes(125), '2 分钟');
});
test('collector never sends text content or silently downloads a partial export', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-analytics.js'), 'utf8');
  assert.match(source, /deltaSeconds/);
  assert.match(source, /document\.hasFocus\(\)/);
  assert.match(source, /state\.enabled = false/);
  assert.doesNotMatch(source, /innerHTML|sendBeacon|userAgent|screen\./);
  assert.match(source, /本次未下载不完整文件/);
  assert.match(source, /generation !== state\.generation/);
});

test('learning choice normalization preserves unknown goals, accepts controlled enums and rejects text or fake mastery', () => {
  const choice = {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'new',
    goal: '',
  };
  assert.deepEqual(normalizeLearningChoice(choice), {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    metadata: { action: 'learning_start_set', level: 'new', goal: null },
  });
  assert.deepEqual(normalizeLearningChoice({ ...choice, goal: undefined }).metadata, {
    action: 'learning_start_set',
    level: 'new',
  });
  for (const goal of ['concepts', 'practice', 'explore'])
    assert.equal(normalizeLearningChoice({ ...choice, goal }).metadata.goal, goal);
  for (const changes of [
    { goal: 'review' },
    { level: 'expert' },
    { nodeId: '' },
    { courseSlug: 'private text' },
    { notes: 'private notes' },
    { score: 100 },
    { answer: 'private answer' },
    { documentVersion: 'unknown' },
    { pathType: 'custom' },
  ])
    assert.equal(normalizeLearningChoice({ ...choice, ...changes }), null);
  assert.equal(
    normalizeLearningChoice({
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      action: 'recommendation_choose',
      pathType: 'recommended',
    }).metadata.pathType,
    'recommended',
  );
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function analyticsBrowser(
  initialUser = { uid: '1', token: 'first-token', isLoggedIn: true },
  { consent = true } = {},
) {
  const createElement = () => ({
    children: [],
    dataset: {},
    listeners: new Map(),
    textContent: '',
    hidden: false,
    append(...children) {
      children.forEach((child) => {
        child.parentNode = this;
      });
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    },
    before(...children) {
      const index = this.parentNode.children.indexOf(this);
      children.forEach((child) => {
        child.parentNode = this.parentNode;
      });
      this.parentNode.children.splice(index, 0, ...children);
    },
    setAttribute() {},
    addEventListener(name, callback) {
      this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
    },
    querySelector() {
      const search = (item) => {
        if (item.dataset.learningDataStatus !== undefined) return item;
        return item.children.map(search).find(Boolean);
      };
      return search(this);
    },
  });
  const page = createElement();
  page.dataset.learningTool = 'content';
  const personal = createElement();
  const admin = createElement();
  const calls = [];
  const browserListeners = new Map();
  let route;
  let clock = 1000;
  let heartbeat;
  let serial = 0;
  const app = {
    userState: { ...initialUser },
    callApi(url, options = {}) {
      const call = {
        url,
        method: options.method || 'GET',
        uid: String(this.userState.uid || ''),
        token: this.userState.token || '',
        body: options.body ? JSON.parse(options.body) : null,
      };
      calls.push(call);
      const intercepted = route?.(call);
      if (intercepted !== undefined) return intercepted;
      if (url === '/learning-analytics/preferences')
        return Promise.resolve({ preferences: { enabled: consent } });
      if (url.startsWith('/learning-analytics/summary'))
        return Promise.resolve({
          preferences: { enabled: consent },
          process: { courses: [{ name: `private-user-${call.uid}`, visits: 1 }] },
          selftest: {},
        });
      return Promise.resolve(call.method === 'POST' ? { recorded: true } : {});
    },
  };
  const window = {
    freeBbsApp: app,
    location: { search: '' },
    confirm: () => true,
    addEventListener(name, callback) {
      browserListeners.set(name, [...(browserListeners.get(name) || []), callback]);
    },
  };
  const document = {
    querySelector: () => page,
    getElementById: (id) =>
      id === 'personal-learning-data' ? personal : id === 'admin-learning-data' ? admin : null,
    createElement,
    addEventListener() {},
    visibilityState: 'visible',
    hasFocus: () => true,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/learning-analytics.js'), 'utf8'),
    {
      window,
      document,
      URLSearchParams,
      crypto: {
        randomUUID: () => {
          serial += 1;
          return `analytics-request-${serial}`;
        },
      },
      performance: { now: () => clock },
      setInterval: (callback) => {
        heartbeat = callback;
      },
    },
  );
  const text = (element) => [element.textContent, ...element.children.map(text)].join(' ');
  const emitWindow = (name, detail = {}) =>
    browserListeners.get(name)?.forEach((callback) => callback(detail));
  const emitPage = (name, detail) =>
    page.listeners.get(name)?.forEach((callback) => callback({ detail }));
  return {
    app,
    calls,
    personal,
    admin,
    window,
    emitWindow,
    emitPage,
    setRoute: (handler) => {
      route = handler;
    },
    text,
    visits: () =>
      calls.filter((call) => call.method === 'POST' && call.body?.metadata?.action === 'visit'),
    loadKnowledge: () =>
      emitPage('knowledge:loaded', { course: { slug: 'signals' }, node: { id: 'SS-01-01' } }),
    tick: () => {
      clock += 20000;
      heartbeat();
    },
    flush: () =>
      new Promise((resolve) => {
        setImmediate(resolve);
      }),
  };
}

test('same-identity wallet/session notifications, manual refresh and BFCache do not manufacture visits', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  assert.equal(browser.visits().length, 1);
  const originalSession = browser.visits()[0].body.metadata.sessionId;
  const summaries = () =>
    browser.calls.filter((call) => call.url.startsWith('/learning-analytics/summary')).length;
  assert.equal(summaries(), 1);
  browser.app.userState = { ...browser.app.userState, walletBalance: 200 };
  browser.emitWindow('freebbs:session-change');
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  assert.equal(browser.visits().length, 1);
  assert.equal(summaries(), 1);
  browser.window.FreeBbsLearningAnalytics.refresh();
  browser.emitWindow('pageshow', { persisted: true });
  await browser.flush();
  assert.equal(browser.visits().length, 1);
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  assert.equal(browser.admin.hidden, false);
  assert.equal(browser.visits().length, 1);
  browser.emitPage('knowledge:tool-change', { tool: 'notes' });
  await browser.flush();
  const tool = browser.calls.find((call) => call.body?.metadata?.action === 'tool_open');
  assert.equal(tool.body.metadata.sessionId, originalSession);
});

test('starting-point and path choice APIs never turn consent on or post before verified opt-in', async () => {
  const choice = {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'new',
    goal: '',
  };
  const off = analyticsBrowser(undefined, { consent: false });
  off.loadKnowledge();
  await off.flush();
  assert.equal(await off.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), false);
  assert.equal(off.calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(off.calls.filter((call) => call.method === 'PUT').length, 0);
  const on = analyticsBrowser();
  on.loadKnowledge();
  await on.flush();
  assert.equal(await on.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), true);
  const recorded = on.calls.find((call) => call.body?.metadata?.action === 'learning_start_set');
  assert.equal(recorded.body.metadata.goal, null);
  assert.equal(recorded.body.deltaSeconds, 0);
  assert.equal(recorded.uid, '1');
  assert.equal(
    await on.window.FreeBbsLearningAnalytics.recordLearningChoice({ ...choice, answer: 'PRIVATE' }),
    false,
  );
  assert.equal(
    on.calls.filter((call) => call.body?.metadata?.action === 'learning_start_set').length,
    1,
  );
});

test('a choice waiting for consent cannot be transferred to the next account by a late response', async () => {
  const browser = analyticsBrowser(undefined, { consent: false });
  await browser.flush();
  const waiting = deferred();
  browser.setRoute((call) =>
    call.uid === '1' && call.url === '/learning-analytics/preferences'
      ? waiting.promise
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  browser.loadKnowledge();
  const recording = browser.window.FreeBbsLearningAnalytics.recordLearningChoice({
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'new',
  });
  browser.app.userState = { uid: '2', token: 'second-token', isLoggedIn: true };
  browser.emitWindow('freebbs:session-change');
  waiting.resolve({ preferences: { enabled: true } });
  assert.equal(await recording, false);
  await browser.flush();
  assert.equal(
    browser.calls.filter((call) => call.body?.metadata?.action === 'learning_start_set').length,
    0,
  );
});

test('choice attribution uses only the current assessment document hash and never reads answers', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  const snapshot = { documentVersion: 'a'.repeat(64) };
  Object.defineProperty(snapshot, 'attempts', {
    get() {
      throw new Error('private answers accessed');
    },
  });
  browser.emitPage('knowledge:assessment-updated', snapshot);
  await browser.window.FreeBbsLearningAnalytics.recordLearningChoice({
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'basic',
  });
  assert.equal(
    browser.calls.find((call) => call.body?.metadata?.action === 'learning_start_set').body.metadata
      .documentVersion,
    'a'.repeat(64),
  );
});

test('same-identity session acknowledgement can resume after storage invalidation without manufacturing visits', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  const choice = {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'recommendation_choose',
    pathType: 'custom',
    goal: 'explore',
  };
  browser.emitWindow('storage', { key: 'free_bbs_auth_token' });
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), false);
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), true);
  assert.equal(browser.visits().length, 1);
});

test('turning collection off blocks choices immediately even if an older opt-in response arrives late', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  const oldPreferences = deferred();
  const turnOff = deferred();
  let disabled = false;
  browser.setRoute((call) => {
    if (call.url === '/learning-analytics/preferences' && call.method === 'GET')
      return oldPreferences.promise;
    if (call.method === 'PUT') return turnOff.promise;
    if (disabled && call.url.startsWith('/learning-analytics/summary'))
      return Promise.resolve({ preferences: { enabled: false }, process: {}, selftest: {} });
    return undefined;
  });
  browser.loadKnowledge();
  const nodes = (host) => [host, ...host.children.flatMap(nodes)];
  const check = nodes(browser.personal).find((node) => node.type === 'checkbox');
  check.checked = false;
  const changed = check.listeners.get('change')[0]();
  oldPreferences.resolve({ preferences: { enabled: true } });
  await browser.flush();
  const choice = {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'basic',
  };
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), false);
  disabled = true;
  turnOff.resolve({ preferences: { enabled: false } });
  await changed;
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), false);
  assert.equal(
    browser.calls.filter((call) => call.body?.metadata?.action === 'learning_start_set').length,
    0,
  );
});

test('personal learning evidence remains private and shows real attempts plus unknown preferences without mastery claims', async () => {
  const browser = analyticsBrowser();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/summary')
      ? Promise.resolve({
          preferences: { enabled: false },
          process: {},
          selftest: {},
          journey: {
            units: [
              {
                courseSlug: 'signals',
                nodeId: 'SS-01-01',
                currentChoice: { level: 'basic', goal: null },
                practiceAttempts: 2,
                officialAttempts: 3,
                repeatedQuestions: 1,
                correctedQuestions: 1,
                pendingReview: 1,
                explorationAttempts: 0,
              },
            ],
          },
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const text = browser.text(browser.personal);
  assert.match(text, /我的学习证据/);
  assert.match(text, /目的未选择/);
  assert.match(text, /正式自测 3/);
  assert.match(text, /同题复测 1/);
  assert.match(text, /查看并调整起点/);
  assert.match(text, /尚未采集/);
  assert.doesNotMatch(text, /六维学习看板|已经掌握|已证明/);
  browser.emitWindow('storage', { key: 'free_bbs_auth_token' });
  assert.equal(browser.personal.hidden, true);
  assert.doesNotMatch(browser.text(browser.personal), /正式自测 3/);
});

test('real account changes clear old private data, invalidate late responses and record exactly one new authorized visit', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  assert.match(browser.text(browser.personal), /private-user-1/);
  const oldSummary = deferred();
  const oldPreference = deferred();
  const newSummary = deferred();
  browser.setRoute((call) => {
    if (call.uid === '1' && call.url.startsWith('/learning-analytics/summary'))
      return oldSummary.promise;
    if (call.uid === '1' && call.url === '/learning-analytics/preferences')
      return oldPreference.promise;
    if (call.uid === '2' && call.url.startsWith('/learning-analytics/summary'))
      return newSummary.promise;
    return undefined;
  });
  browser.window.FreeBbsLearningAnalytics.refresh();
  browser.app.userState = { uid: '2', token: 'second-token', isLoggedIn: true };
  browser.emitWindow('freebbs:session-change');
  assert.doesNotMatch(browser.text(browser.personal), /private-user-1/);
  await browser.flush();
  assert.deepEqual(
    browser.visits().map((call) => call.uid),
    ['1', '2'],
  );
  assert.notEqual(
    browser.visits()[0].body.metadata.sessionId,
    browser.visits()[1].body.metadata.sessionId,
  );
  newSummary.resolve({
    preferences: { enabled: true },
    process: { courses: [{ name: 'private-user-2' }] },
  });
  oldSummary.resolve({
    preferences: { enabled: true },
    process: { courses: [{ name: 'private-user-1' }] },
  });
  oldPreference.reject(new Error('old account request failed'));
  await browser.flush();
  assert.match(browser.text(browser.personal), /private-user-2/);
  assert.doesNotMatch(browser.text(browser.personal), /private-user-1/);
  browser.tick();
  await browser.flush();
  assert.equal(
    browser.calls.filter((call) => call.uid === '2' && call.body?.type === 'engagement').length,
    1,
  );
  browser.app.userState = { uid: '', token: '', isLoggedIn: false };
  browser.emitWindow('freebbs:session-change');
  browser.tick();
  await browser.flush();
  assert.equal(browser.personal.hidden, true);
  assert.equal(browser.admin.hidden, true);
  assert.doesNotMatch(browser.text(browser.personal), /private-user-/);
  assert.equal(browser.visits().length, 2);
});

test('visitors and stale cross-tab identities never record or restore private panels', async () => {
  const browser = analyticsBrowser({ uid: '', token: '', isLoggedIn: false });
  browser.loadKnowledge();
  browser.emitWindow('freebbs:session-change');
  browser.emitWindow('pageshow', { persisted: true });
  browser.tick();
  await browser.flush();
  assert.equal(browser.calls.length, 0);
  browser.app.userState = { uid: '1', token: 'first-token', isLoggedIn: true };
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  assert.equal(browser.visits().length, 1);
  browser.emitWindow('storage', { key: 'free_bbs_auth_token' });
  browser.window.FreeBbsLearningAnalytics.refresh();
  browser.emitWindow('pageshow', { persisted: true });
  browser.tick();
  await browser.flush();
  assert.equal(browser.visits().length, 1);
  assert.equal(browser.personal.hidden, true);
  assert.doesNotMatch(browser.text(browser.personal), /private-user-/);
});

test('admin flag redraws do not count a visit or let revoked pending data repaint the panel', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  const pendingAdmin = deferred();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview') ? pendingAdmin.promise : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  assert.equal(browser.admin.hidden, false);
  browser.app.userState.isAdmin = false;
  browser.emitWindow('freebbs:session-change');
  pendingAdmin.resolve({ users: [{ nickname: 'late-admin-only-data' }] });
  await browser.flush();
  assert.equal(browser.admin.hidden, true);
  assert.equal(browser.admin.children.length, 0);
  assert.doesNotMatch(browser.text(browser.admin), /late-admin-only-data/);
  assert.equal(browser.visits().length, 1);
});

test('admin evidence separates usage from same-version change and shows denominators without causal or mastery claims', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          enabledUserCount: 3,
          processUserCount: 2,
          process: { visits: 10 },
          selftest: { officialAttempts: 8 },
          users: [],
          effectiveness: {
            officialLearners: 3,
            comparableSequences: 3,
            comparableLearners: 2,
            failedComparableSequences: 2,
            failedComparableLearners: 2,
            improvedSequences: 1,
            improvedLearners: 1,
            notRetriedFailedSequences: 1,
            notRetriedFailedLearners: 1,
            regressedSequences: 1,
            regressedLearners: 1,
            limitedSample: true,
            tools: [{ tool: 'notes', users: 2, events: 4 }],
            actions: [{ action: 'annotation_save', users: 1, events: 2 }],
            courses: [
              {
                courseSlug: 'signals',
                comparableSequences: 3,
                comparableLearners: 2,
                failedComparableSequences: 2,
                improvedSequences: 1,
                notRetriedFailedSequences: 1,
              },
            ],
          },
        })
      : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  const text = browser.text(browser.admin);
  assert.match(text, /使用与参与/);
  assert.match(text, /学习变化证据/);
  assert.match(text, /1 \/ 2 组/);
  assert.match(text, /1 \/ 2 人至少一组再次通过/);
  assert.match(text, /缺少后续证据，不计为失败/);
  assert.match(text, /可比较样本少于5人/);
  assert.match(text, /不能单独证明平台因果效果/);
  assert.match(text, /完整正文和题目版本/);
  assert.match(text, /自愿反馈、延迟或新题验证/);
  assert.match(text, /学习工具参与/);
  assert.match(text, /个人笔记/);
  assert.doesNotMatch(text, /50%|掌握率|平均能力|优秀率/);
  assert.doesNotMatch(browser.text(browser.personal), /使用与参与|学习变化证据/);
});

test('empty and unavailable evidence states do not imply failure or benefit', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  assert.match(browser.text(browser.admin), /学习变化证据暂不可用/);
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          effectiveness: { officialLearners: 1, comparableSequences: 0 },
          users: [],
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  assert.match(browser.text(browser.admin), /尚无可比较的复测样本/);
  assert.match(browser.text(browser.admin), /暂无样本/);
  assert.doesNotMatch(browser.text(browser.admin), /0 \/ 0 组/);
});

test('admin cohort presentation labels true denominators, unknown goals, small samples and uncollected outcomes', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          users: [],
          journey: {
            observedUnits: 8,
            learners: 3,
            classifiedUnits: 5,
            missingStartUnits: 3,
            missingGoalUnits: 2,
            revisedUnits: 1,
            unknownChoiceVersionUnits: 1,
            cohorts: [
              {
                level: 'familiar',
                goal: null,
                units: 2,
                learners: 1,
                limitedSample: true,
                selectedPathUnits: 1,
                attemptedUnits: 2,
                gradedOfficialUnits: 1,
                retryUnits: 1,
                correctedUnits: 1,
                explorationAttemptUnits: 0,
              },
            ],
          },
        })
      : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  const text = browser.text(browser.admin);
  assert.match(text, /不同起点的学习参与/);
  assert.match(text, /5 \/ 8/);
  assert.match(text, /起点缺失 3 个/);
  assert.match(text, /目的未选择/);
  assert.match(text, /2 \/ 5/);
  assert.match(text, /接触过一些 \/ 未选择/);
  assert.match(text, /1人，少于5人/);
  assert.match(text, /探索作答/);
  assert.match(text, /尚未采集/);
  assert.doesNotMatch(text, /已经证明|提高了.*%|平台提升率|能力排名/);
});
