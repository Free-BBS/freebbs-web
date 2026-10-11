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

function allNodes(host) {
  return [host, ...host.children.flatMap(allNodes)];
}

function analyticsBrowser(
  initialUser = { uid: '1', token: 'first-token', isLoggedIn: true },
  { consent = true } = {},
) {
  const createElement = () => ({
    children: [],
    dataset: {},
    style: {},
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

test('choices wait for server policy confirmation and never change recording policy or include text', async () => {
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

test('a choice waiting for recording policy cannot be transferred to the next account by a late response', async () => {
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

test('clearing history blocks writes while pending and resumes default recording without an opt-out control', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  const oldPreferences = deferred();
  const cleared = deferred();
  browser.setRoute((call) => {
    if (call.url === '/learning-analytics/preferences' && call.method === 'GET')
      return oldPreferences.promise;
    if (call.method === 'DELETE') return cleared.promise;
    return undefined;
  });
  browser.loadKnowledge();
  const nodes = (host) => [host, ...host.children.flatMap(nodes)];
  assert.equal(
    nodes(browser.personal).some((node) => node.type === 'checkbox'),
    false,
  );
  const clear = nodes(browser.personal).find((node) => node.textContent === '清空过程记录');
  const changed = clear.listeners.get('click')[0]();
  oldPreferences.resolve({ preferences: { enabled: true } });
  await browser.flush();
  const choice = {
    courseSlug: 'signals',
    nodeId: 'SS-01-01',
    action: 'learning_start_set',
    level: 'basic',
  };
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), false);
  cleared.resolve({ preferences: { enabled: true } });
  await changed;
  assert.equal(await browser.window.FreeBbsLearningAnalytics.recordLearningChoice(choice), true);
  assert.equal(
    browser.calls.filter((call) => call.body?.metadata?.action === 'learning_start_set').length,
    1,
  );
  assert.equal(
    browser.calls.some((call) => call.method === 'PUT'),
    false,
  );
  assert.match(browser.text(browser.personal), /后续学习继续自动记录/);
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
  assert.match(text, /回到知识点/);
  assert.match(text, /尚未采集/);
  assert.doesNotMatch(text, /六维学习看板|已经掌握|已证明/);
  browser.emitWindow('storage', { key: 'free_bbs_auth_token' });
  assert.equal(browser.personal.hidden, true);
  assert.doesNotMatch(browser.text(browser.personal), /正式自测 3/);
});

test('failed clearing leaves recording active and does not erase original evidence', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  browser.setRoute((call) =>
    call.method === 'DELETE' ? Promise.reject(new Error('fixture unavailable')) : undefined,
  );
  const clear = allNodes(browser.personal).find((node) => node.textContent === '清空过程记录');
  await clear.listeners.get('click')[0]();
  assert.equal(
    await browser.window.FreeBbsLearningAnalytics.recordLearningChoice({
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      action: 'learning_start_set',
      level: 'new',
    }),
    true,
  );
  assert.match(browser.text(browser.personal), /private-user-1/);
  assert.match(browser.text(browser.personal), /fixture unavailable/);
});

test('confirmed clearing with a failed summary discards erased history and keeps automatic recording active', async () => {
  const browser = analyticsBrowser();
  browser.loadKnowledge();
  await browser.flush();
  browser.setRoute((call) => {
    if (call.method === 'DELETE') return Promise.resolve({ preferences: { enabled: true } });
    if (call.url.startsWith('/learning-analytics/summary'))
      return Promise.reject(new Error('summary unavailable'));
    return undefined;
  });
  const clear = allNodes(browser.personal).find((node) => node.textContent === '清空过程记录');
  await clear.listeners.get('click')[0]();
  assert.doesNotMatch(browser.text(browser.personal), /private-user-1/);
  assert.match(browser.text(browser.personal), /已清空，统计刷新失败/);
  assert.equal(
    await browser.window.FreeBbsLearningAnalytics.recordLearningChoice({
      courseSlug: 'signals',
      nodeId: 'SS-01-01',
      action: 'learning_start_set',
      level: 'new',
    }),
    true,
  );
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
  assert.match(text, /学习平台观察/);
  assert.match(text, /战略部观察平台设计对学习与发展的支持/);
  assert.match(text, /课程内容和题目问题由课程部跟进/);
  assert.match(text, /本分析不读取私人批注、聊天或答案正文/);
  assert.match(text, /当前仅覆盖学习页面/);
  assert.match(text, /跨模块发展支持尚未纳入/);
  assert.match(text, /平台使用/);
  assert.match(text, /学习支持证据/);
  assert.match(text, /学习路径/);
  assert.match(text, /记录明细/);
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
          effectiveness: {
            officialLearners: 1,
            comparableSequences: 0,
            failedComparableSequences: 0,
          },
          users: [],
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  assert.match(browser.text(browser.admin), /尚无可比较的复测样本/);
  assert.match(browser.text(browser.admin), /暂无样本/);
  assert.doesNotMatch(browser.text(browser.admin), /0 \/ 0 组/);
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({ effectiveness: { officialLearners: 1 }, users: [] })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  assert.match(browser.text(browser.admin), /复测样本字段暂未提供/);
  assert.match(browser.text(browser.admin), /可比较的同题复测 未提供 组/);
  assert.doesNotMatch(browser.text(browser.admin), /尚无可比较的复测样本/);
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
  assert.match(text, /不甚熟悉 \/ 未选择/);
  assert.match(text, /1人，少于5人/);
  assert.match(text, /探索作答/);
  assert.match(text, /尚未采集/);
  assert.doesNotMatch(text, /已经证明|提高了.*%|平台提升率|能力排名/);
});

function adminUserTable(browser) {
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    return node.children.map((child) => find(child, predicate)).find(Boolean);
  };
  const details = find(browser.admin, (node) => node.children[0]?.textContent === '各用户记录');
  assert.ok(details);
  const scroll = details.children.find((node) => node.className === 'learning-data-table-scroll');
  assert.equal(scroll.tabIndex, 0);
  const table = scroll.children[0];
  return {
    headings: table.children[0].children[0].children.map((node) => node.textContent),
    rows: table.children[1].children.map((row) => row.children.map((node) => node.textContent)),
    caption: browser.text(details),
  };
}

test('admin user rows use actual formal and practice fields without treating the total as formal selftest', async () => {
  const browser = analyticsBrowser(undefined, { consent: false });
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          users: [
            {
              id: 'practice-only',
              nickname: '只做练习',
              courseCount: 1,
              process: { visits: 0 },
              selftest: {
                attempts: 200,
                officialAttempts: 0,
                practiceAttempts: 200,
                passed: 0,
                failed: 0,
                pendingReview: 0,
              },
            },
            {
              id: 'mixed',
              nickname: '<img src=x onerror=alert(1)>',
              courseCount: 2,
              process: { visits: 10 },
              selftest: {
                attempts: 203,
                officialAttempts: 3,
                practiceAttempts: 200,
                passed: 1,
                failed: 1,
                pendingReview: 1,
              },
            },
          ],
        })
      : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  const actual = adminUserTable(browser);
  assert.deepEqual(actual.headings, [
    '用户',
    '参与课程',
    '访问',
    '全部作答（次数）',
    '正式自测（次数）',
    '练习（次数）',
    '正式通过 / 尚未通过（次数）',
    '待复核（次数）',
  ]);
  assert.deepEqual(actual.rows, [
    ['只做练习', '1', '0', '200', '0', '200', '0 / 0', '0'],
    ['<img src=x onerror=alert(1)>', '2', '10', '203', '3', '200', '1 / 1', '1'],
  ]);
  assert.match(actual.caption, /含重复作答和历史版本/);
  assert.match(actual.caption, /不代表当前题库通过或掌握程度/);
  assert.equal(browser.calls.filter((call) => call.method !== 'GET').length, 0);
});

test('legacy admin payload keeps a known total and marks missing breakdowns instead of inventing zeros or formal counts', async () => {
  const browser = analyticsBrowser(undefined, { consent: false });
  await browser.flush();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          users: [
            { id: 'old', selftest: { attempts: 7, passed: 1, failed: 0, pendingReview: 0 } },
            { id: 'partial', selftest: { attempts: 200, practiceAttempts: 200 } },
            { id: 'missing' },
          ],
        })
      : undefined,
  );
  browser.app.userState.isAdmin = true;
  browser.emitWindow('freebbs:session-change');
  await browser.flush();
  const { rows, caption } = adminUserTable(browser);
  assert.deepEqual(rows[0].slice(3), ['7', '未分列', '未分列', '1 / 0', '0']);
  assert.deepEqual(rows[1].slice(3), ['200', '未分列', '200', '未提供 / 未提供', '未提供']);
  assert.deepEqual(rows[2].slice(3), ['未提供', '未分列', '未分列', '未提供 / 未提供', '未提供']);
  assert.match(caption, /接口未提供分项时显示“未分列”/);
});

test('personal view switches retain the chosen view across filter reload without private writes', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  const buttons = allNodes(browser.personal).filter((node) => node.dataset.learningDataView);
  assert.deepEqual(
    buttons.map((node) => node.textContent),
    ['学习近况', '知识点记录', '作答复盘'],
  );
  const selected = buttons.find((node) => node.dataset.learningDataView === 'units');
  selected.listeners.get('click')[0]();
  const views = () => allNodes(browser.personal).filter((node) => node.dataset.learningDataPanel);
  assert.equal(views().find((node) => node.dataset.learningDataPanel === 'units').hidden, false);
  assert.equal(views().find((node) => node.dataset.learningDataPanel === 'overview').hidden, true);
  const filter = allNodes(browser.personal).find((node) => node.value === '30');
  filter.value = '7';
  await filter.listeners.get('change')[0]();
  assert.equal(views().find((node) => node.dataset.learningDataPanel === 'units').hidden, false);
  assert.equal(
    browser.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('next steps use valid existing practice routes, stay optional and never call Max or submit answers', async () => {
  const browser = analyticsBrowser();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/summary')
      ? Promise.resolve({
          preferences: { enabled: true },
          insights: {
            nextSteps: [
              {
                id: 'retry',
                courseSlug: 'signals',
                nodeId: 'SS-01-01',
                tool: 'feedback',
                quizView: 'mistakes',
                reasonLabel: '最新记录尚未通过，按需回看条件。',
              },
              {
                // eslint-disable-next-line no-script-url -- Deliberately invalid input must not become a link.
                courseSlug: 'javascript:alert(1)',
                nodeId: 'bad',
                tool: 'feedback',
                reasonLabel: '<img src=x>',
              },
              ...['content', 'notes', 'resources', 'continue'].map((tool) => ({
                courseSlug: 'signals',
                nodeId: 'SS-01-01',
                tool,
              })),
            ],
          },
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const links = allNodes(browser.personal).filter((node) => node.href);
  assert.ok(
    links.some(
      (node) =>
        node.href === '/knowledge?course=signals&point=SS-01-01&tool=feedback&quiz=mistakes',
    ),
  );
  assert.equal(
    links.some((node) => /javascript:|alert/.test(node.href)),
    false,
  );
  for (const destination of ['view=reading', 'tool=notes', 'tool=resources', 'tool=continue'])
    assert.ok(
      links.some((node) => node.href.endsWith(destination)),
      destination,
    );
  assert.match(browser.text(browser.personal), /不要求全部完成/);
  assert.equal(
    browser.calls.some((call) => call.method !== 'GET' || /\/ai\//.test(call.url)),
    false,
  );
});

test('recent activity has accessible factual counts and no streak or mastery labels', async () => {
  const browser = analyticsBrowser();
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/summary')
      ? Promise.resolve({
          preferences: { enabled: true },
          activity: { days: [{ date: '2026-10-11', visits: 2, attempts: 1, activeSeconds: 65 }] },
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const day = allNodes(browser.personal).find((node) => node.className === 'learning-data-day');
  assert.equal(day.tabIndex, 0);
  assert.match(day.title, /2026-10-11：访问 2 次，作答 1 次/);
  assert.match(browser.text(browser.personal), /空白表示没有记录，不表示没有学习/);
  assert.doesNotMatch(browser.text(browser.personal), /连续打卡|学习能力分|有效时长/);
});

test('admin diagnostics expose counts and missing fields, not fictional ability or causal metrics', async () => {
  const browser = analyticsBrowser({
    uid: '9',
    token: 'admin-token',
    isLoggedIn: true,
    isAdmin: true,
  });
  browser.setRoute((call) =>
    call.url.startsWith('/learning-analytics/admin/overview')
      ? Promise.resolve({
          diagnostics: {
            coverage: {
              observedLearners: 3,
              processLearners: 2,
              businessLearners: 2,
              businessOnlyLearners: 1,
            },
            quality: { missingStartUnits: 1 },
            attention: [],
          },
        })
      : undefined,
  );
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const text = browser.text(browser.admin);
  assert.match(text, /本期有学习证据 3 人/);
  assert.match(text, /课程支持待办（课程部）/);
  const courseSupport = allNodes(browser.admin).find((node) =>
    node.children.some((child) => child.textContent === '课程支持待办（课程部）'),
  );
  assert.ok(courseSupport);
  assert.notEqual(courseSupport.open, true);
  assert.match(text, /起点未记录的单元 1/);
  assert.match(text, /选择时正文版本未知的单元 未提供/);
  assert.match(text, /延迟保持、新题迁移与平台因果效果：尚未验证/);
  assert.equal(allNodes(browser.admin).filter((node) => node.dataset.learningDataView).length, 4);
  assert.doesNotMatch(text, /预测成绩|学生排名|学习成效指数/);
});

test('unavailable assessment data never looks like zero attempts or no support needs in either view', async () => {
  const browser = analyticsBrowser({
    uid: '9',
    token: 'admin-token',
    isLoggedIn: true,
    isAdmin: true,
  });
  const unavailable = {
    assessmentDataStatus: 'not_available',
    officialAttempts: 0,
    practiceAttempts: 0,
    passed: 0,
    failed: 0,
    pendingReview: 0,
  };
  browser.setRoute((call) => {
    if (/\/summary|\/admin\/overview/.test(call.url))
      return Promise.resolve({
        preferences: { enabled: true },
        selftest: unavailable,
        effectiveness: { ...unavailable, officialLearners: 0, comparableSequences: 0 },
        insights: { assessmentDataStatus: 'not_available', nextSteps: [] },
        journey: {
          assessmentDataStatus: 'not_available',
          units: [
            {
              courseSlug: 'signals',
              nodeId: 'SS-01-01',
              practiceAttempts: 0,
              officialAttempts: 0,
              pendingReview: 0,
            },
          ],
        },
        diagnostics: { coverage: {}, quality: unavailable, attention: [], transitions: [] },
        users: [{ id: '9', selftest: unavailable }],
      });
    return undefined;
  });
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  const own = browser.text(browser.personal);
  const admin = browser.text(browser.admin);
  assert.match(own, /正式自测作答 未提供/);
  assert.match(own, /练习 未提供/);
  assert.match(own, /作答数据暂不可用/);
  assert.doesNotMatch(own, /正式自测作答 0|目前没有需要特别回看/);
  assert.match(admin, /不能判断复核或订正待办/);
  assert.match(admin, /学习变化证据暂不可用/);
  assert.doesNotMatch(admin, /正式自测参与 0|尚无可比较的复测样本|当前记录中没有待处理/);
});

for (const view of ['personal', 'admin'])
  test(`${view} period changes clear old evidence while loading and after failure, then recover with the selected window`, async () => {
    const browser = analyticsBrowser({
      uid: '9',
      token: 'admin-token',
      isLoggedIn: true,
      isAdmin: true,
    });
    await browser.flush();
    const route =
      view === 'personal' ? '/learning-analytics/summary' : '/learning-analytics/admin/overview';
    const report = (name) => ({
      preferences: { enabled: true },
      process: { courses: [{ name, visits: 1 }] },
      courses: [{ name, users: 5, visits: 1 }],
      users: [],
    });
    browser.setRoute((call) =>
      call.url.startsWith(route) ? Promise.resolve(report('OLD_WINDOW_30_CANARY')) : undefined,
    );
    browser.window.FreeBbsLearningAnalytics.refresh();
    await browser.flush();
    const host = browser[view];
    assert.match(browser.text(host), /OLD_WINDOW_30_CANARY/);
    const filter = allNodes(host).find((node) => node.value === '30');
    const waiting = deferred();
    browser.setRoute((call) => (call.url === `${route}?window=7` ? waiting.promise : undefined));
    filter.value = '7';
    const loading = filter.listeners.get('change')[0]();
    assert.doesNotMatch(browser.text(host), /OLD_WINDOW_30_CANARY/);
    assert.match(browser.text(host), /正在加载/);
    waiting.reject(new Error('SELECTED_WINDOW_FAILED_CANARY'));
    await loading;
    assert.match(browser.text(host), /SELECTED_WINDOW_FAILED_CANARY/);
    assert.doesNotMatch(browser.text(host), /OLD_WINDOW_30_CANARY/);
    browser.setRoute((call) =>
      call.url === `${route}?window=7` ? Promise.resolve(report('NEW_WINDOW_7_CANARY')) : undefined,
    );
    await allNodes(host)
      .find((node) => node.className === 'learning-data-refresh')
      .listeners.get('click')[0]();
    assert.match(browser.text(host), /NEW_WINDOW_7_CANARY/);
    assert.doesNotMatch(browser.text(host), /OLD_WINDOW_30_CANARY|SELECTED_WINDOW_FAILED_CANARY/);
  });

test('a personal report error from a replaced mount cannot overwrite the refreshed report status', async () => {
  const browser = analyticsBrowser();
  await browser.flush();
  const waiting = deferred();
  browser.setRoute((call) =>
    call.url === '/learning-analytics/summary?window=7' ? waiting.promise : undefined,
  );
  const filter = allNodes(browser.personal).find((node) => node.value === '30');
  filter.value = '7';
  const oldRequest = filter.listeners.get('change')[0]();
  browser.window.FreeBbsLearningAnalytics.refresh();
  await browser.flush();
  assert.match(browser.text(browser.personal), /private-user-1/);
  waiting.reject(new Error('REPLACED_MOUNT_ERROR_CANARY'));
  await oldRequest;
  assert.doesNotMatch(browser.text(browser.personal), /REPLACED_MOUNT_ERROR_CANARY/);
});
