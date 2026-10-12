const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const progress = require('../public/learning-progress');
const {
  BASE,
  TICKETS,
  normalizePreference,
  promptHintFromPreference,
  courseKey,
  createController,
  SCHEMA_VERSION,
  restorablePreference,
} = require('../public/learning-start');

const alice = { uid: '101', token: 'alice-secret-token', isLoggedIn: true };
const bob = { uid: '102', token: 'bob-secret-token', isLoggedIn: true };
const guest = { uid: '', token: '', isLoggedIn: false };
function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}
function fixture(options = {}) {
  let user = { ...alice };
  const storage = options.storage || memoryStorage();
  const sessionStorage = options.sessionStorage || memoryStorage();
  storage.setItem('free_bbs_auth_token', user.token);
  const make = (settings = {}) =>
    createController({
      progress,
      storage,
      sessionStorage,
      userState: () => user,
      fingerprint: (value) => crypto.createHash('sha256').update(value).digest('hex'),
      ...settings,
    });
  return {
    make,
    storage,
    sessionStorage,
    change(next, storedToken = next.token || '') {
      user = { ...next };
      storage.setItem('free_bbs_auth_token', storedToken);
    },
  };
}

test('starting point accepts only a required level and an optional enumerated goal', () => {
  for (const value of [null, {}, [], { goal: 'concepts' }, { level: 'scored' }])
    assert.equal(normalizePreference(value), null);
  assert.deepEqual(
    normalizePreference({ level: 'basic', goal: 'practice', prompt: 'PRIVATE_INJECTION' }),
    { level: 'basic', goal: 'practice' },
  );
  assert.deepEqual(normalizePreference({ level: 'new', goal: 'PRIVATE_INJECTION' }), {
    level: 'new',
    goal: '',
  });
  const hint = promptHintFromPreference({
    level: 'familiar',
    goal: 'concepts',
    prompt: 'PRIVATE_INJECTION',
  });
  assert.match(hint, /学生自述.*非测评结论/);
  assert.match(hint, /不甚熟悉/);
  assert.match(hint, /理解知识/);
  assert.match(hint, /不限制资料或判定星级/);
  assert.doesNotMatch(hint, /PRIVATE_INJECTION/);
  assert.equal(promptHintFromPreference({ goal: 'practice' }), '');
});
test('each starting point provides distinct help without turning self-report into a grade', () => {
  for (const [level, expected] of [
    ['new', /直觉/],
    ['familiar', /模糊处/],
    ['basic', /独立作答/],
    ['advanced', /探究/],
  ]) {
    const hint = promptHintFromPreference({ level });
    assert.match(hint, expected);
    assert.match(hint, /学生自述.*非测评结论/);
    assert.match(hint, /不限制资料或判定星级/);
  }
});

test('course scope is independent of knowledge point and document version', () => {
  assert.equal(courseKey({ course: { slug: 'signals' }, node: { id: 'SS-01-01' } }), 'signals');
  assert.equal(courseKey({ course: { slug: 'signals' }, node: { id: 'SS-02-01' } }), 'signals');
  assert.equal(courseKey('signals'), 'signals');
  for (const value of [null, '__proto__', 'a/b', 'SIGNALS', 'x'.repeat(121)])
    assert.equal(courseKey(value), null);
});
test('a course visit requires confirmation, remembers the last choice, and reasks on a new course visit', async () => {
  const { make } = fixture();
  const first = make({ forceConfirm: true });
  await first.setContext('signals');
  assert.equal(first.snapshot().confirmed, false);
  assert.equal(first.confirm({ goal: 'concepts' }), false);
  assert.equal(first.promptHint(), '');
  assert.equal(first.confirm({ level: 'basic', goal: 'practice' }), true);
  await first.setContext({ course: { slug: 'signals' }, node: { id: 'SS-02-01' } });
  assert.equal(first.snapshot().confirmed, true);
  const nextVisit = make({ forceConfirm: true });
  await nextVisit.setContext('signals');
  assert.equal(nextVisit.snapshot().confirmed, false);
  assert.deepEqual(nextVisit.snapshot().preference, { level: 'basic', goal: 'practice' });
  assert.equal(nextVisit.currentPreference(), null);
  assert.equal(nextVisit.confirm(nextVisit.snapshot().preference), true);
});
test('deep links reuse only this tab, course, user and current-token confirmation', async () => {
  const { make, storage, sessionStorage, change } = fixture();
  const course = make({ forceConfirm: true });
  await course.setContext('signals');
  course.confirm({ level: 'new', goal: 'concepts' });
  const link = make();
  await link.setContext('signals');
  assert.equal(link.snapshot().confirmed, true);
  await link.setContext('calculus');
  assert.equal(link.snapshot().confirmed, false);
  change(bob);
  const otherUser = make();
  await otherUser.setContext('signals');
  assert.equal(otherUser.snapshot().confirmed, false);
  assert.equal(otherUser.snapshot().preference, null);
  change({ ...alice, token: 'rotated-token' });
  const refreshed = make();
  await refreshed.setContext('signals');
  assert.equal(refreshed.snapshot().confirmed, false);
  assert.equal(refreshed.snapshot().preference.level, 'new');
  const otherTab = make({ sessionStorage: memoryStorage() });
  await otherTab.setContext('signals');
  assert.equal(otherTab.snapshot().confirmed, false);
  assert.doesNotMatch(
    JSON.stringify([...sessionStorage.values]),
    /alice-secret-token|rotated-token|bob-secret-token/,
  );
  assert.equal(progress.read(storage, BASE, alice).signals.level, 'new');
  assert.ok(progress.read(sessionStorage, TICKETS, alice).signals.fingerprint);
});
test('pending login never becomes a guest choice and later loads the identified account', async () => {
  const { make, change, storage } = fixture();
  change(guest, alice.token);
  const controller = make();
  await controller.setContext('signals');
  assert.equal(controller.snapshot().valid, false);
  assert.equal(controller.confirm({ level: 'advanced' }), false);
  assert.equal(storage.values.has(`${BASE}:guest`), false);
  change(alice);
  await controller.sessionChanged();
  assert.equal(controller.snapshot().valid, true);
  assert.equal(controller.snapshot().confirmed, false);
});
test('cross-account changes invalidate old handlers and isolate saved course choices', async () => {
  const { make, change, storage } = fixture();
  const controller = make();
  await controller.setContext('signals');
  const oldGeneration = controller.snapshot().generation;
  controller.confirm({ level: 'new', goal: 'concepts' });
  change(bob);
  const pending = controller.sessionChanged();
  assert.equal(controller.currentPreference(), null);
  assert.equal(controller.confirm({ level: 'advanced' }, oldGeneration), false);
  await pending;
  assert.equal(controller.snapshot().preference, null);
  controller.confirm({ level: 'advanced', goal: 'explore' });
  assert.equal(progress.read(storage, BASE, alice).signals.level, 'new');
  assert.equal(progress.read(storage, BASE, bob).signals.level, 'advanced');
  change(alice);
  await controller.sessionChanged();
  assert.equal(controller.currentPreference().level, 'new');
});
test('cross-tab token invalidation cannot resurrect an old identity or a late digest', async () => {
  const { make, change, storage } = fixture();
  let resolve;
  const controller = make({
    fingerprint: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = controller.setContext('signals');
  storage.setItem('free_bbs_auth_token', bob.token);
  controller.invalidate();
  resolve('late-digest');
  await pending;
  await controller.sessionChanged();
  assert.equal(controller.snapshot().valid, false);
  assert.equal(controller.confirm({ level: 'basic' }), false);
  change(bob);
  const next = controller.sessionChanged();
  resolve('new-user-digest');
  await next;
  assert.equal(controller.snapshot().valid, true);
  assert.equal(controller.snapshot().confirmed, false);
});
test('guest choices are temporary and storage failure does not block the chosen learning mode', async () => {
  const { make, change, storage } = fixture();
  change(guest);
  const guestController = make();
  await guestController.setContext('signals');
  guestController.confirm({ level: 'familiar', goal: '' });
  assert.equal(guestController.currentPreference().level, 'familiar');
  assert.equal(storage.values.has(`${BASE}:guest`), false);
  const guestLink = make();
  await guestLink.setContext('signals');
  assert.equal(guestLink.snapshot().confirmed, true);
  change(alice);
  const failing = {
    getItem: storage.getItem,
    setItem() {
      throw new Error('storage disabled');
    },
  };
  const controller = make({ storage: failing, sessionStorage: failing });
  await controller.setContext('signals');
  assert.equal(controller.confirm({ level: 'basic' }), true);
  assert.equal(controller.snapshot().persistenceAvailable, false);
  assert.match(controller.promptHint(), /能独立做题/);
});

test('verified same-token session changes restore stale UI, but cleared or changed storage cannot restore it', async () => {
  const { make, storage } = fixture();
  const controller = make();
  await controller.setContext('signals');
  controller.confirm({ level: 'basic' });
  controller.invalidate();
  assert.equal(await controller.sessionChanged(), true);
  assert.equal(controller.snapshot().confirmed, true);
  storage.values.delete('free_bbs_auth_token');
  controller.invalidate();
  assert.equal(await controller.sessionChanged(), false);
  assert.equal(controller.currentPreference(), null);
  storage.setItem('free_bbs_auth_token', bob.token);
  assert.equal(await controller.sessionChanged(), false);
});

test('digest failure retains mandatory choice and never accepts or overwrites an old confirmation ticket', async () => {
  const { make, sessionStorage } = fixture();
  const confirmed = make();
  await confirmed.setContext('signals');
  confirmed.confirm({ level: 'basic' });
  const before = JSON.stringify([...sessionStorage.values]);
  const unavailable = make({ fingerprint: () => Promise.reject(new Error('crypto unavailable')) });
  await unavailable.setContext('signals');
  assert.equal(unavailable.snapshot().valid, true);
  assert.equal(unavailable.snapshot().confirmed, false);
  assert.equal(unavailable.currentPreference(), null);
  assert.equal(unavailable.confirm({ level: 'familiar', goal: 'concepts' }), true);
  assert.equal(unavailable.snapshot().persistenceAvailable, false);
  assert.equal(JSON.stringify([...sessionStorage.values]), before);
});

test('a late old-account digest rejection cannot degrade a newer account confirmation', async () => {
  const { make, change } = fixture();
  const pending = [];
  const controller = make({
    fingerprint: () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  });
  const old = controller.setContext('signals');
  change(bob);
  const next = controller.sessionChanged();
  pending[1].resolve('b'.repeat(64));
  await next;
  controller.confirm({ level: 'advanced', goal: 'explore' });
  pending[0].reject(new Error('old request failed'));
  await old;
  assert.equal(controller.snapshot().persistenceAvailable, true);
  assert.equal(controller.currentPreference().level, 'advanced');
});

function browser(pathname = '/course', options = {}) {
  const listeners = new Map();
  function node(tag) {
    return {
      tag,
      children: [],
      dataset: {},
      listeners: new Map(),
      classList: { add() {} },
      textContent: '',
      open: false,
      hidden: false,
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
    };
  }
  const host = node('section');
  const page = node('main');
  const storage = memoryStorage();
  storage.setItem('free_bbs_auth_token', alice.token);
  const calls = [];
  const app = {
    userState: { ...alice },
    callApi(...args) {
      calls.push(args);
    },
  };
  const window = {
    freeBbsApp: app,
    FreeBbsLearningProgress: progress,
    FreeBbsLearningStrategies: require('../public/learning-strategies'),
    CustomEvent: class {
      constructor(type, eventOptions) {
        this.type = type;
        this.detail = eventOptions?.detail;
      }
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    localStorage: storage,
    sessionStorage: memoryStorage(),
    crypto: {
      subtle: {
        async digest(algorithm, bytes) {
          assert.equal(algorithm, 'SHA-256');
          return Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer;
        },
      },
    },
    location: { pathname, search: options.search ?? '?course=signals' },
    addEventListener: (name, callback) => listeners.set(name, callback),
    document: { getElementById: () => host, querySelector: () => page, createElement: node },
  };
  if (options.noStorage) {
    for (const key of ['localStorage', 'sessionStorage'])
      Object.defineProperty(window, key, {
        get() {
          throw new Error('SecurityError');
        },
      });
  }
  if (options.noStorageMethods) {
    for (const key of ['localStorage', 'sessionStorage'])
      window[key] = {
        getItem() {
          throw new Error('SecurityError');
        },
        setItem() {},
      };
  }
  if (options.noCrypto)
    window.crypto = { subtle: { digest: () => Promise.reject(new Error('crypto unavailable')) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/learning-start.js'), 'utf8'), {
    window,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
  });
  const find = (testNode, rootNode = host) =>
    testNode(rootNode)
      ? rootNode
      : rootNode.children.map((child) => find(testNode, child)).find(Boolean);
  return {
    window,
    host,
    page,
    app,
    calls,
    listeners,
    storage,
    find,
    flush: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 15);
      }),
  };
}
test('course dialog is mandatory, blocks Escape, confirms once and never sends an AI question', async () => {
  const view = browser();
  await view.flush();
  const dialog = view.find((item) => item.tag === 'dialog');
  assert.equal(dialog.open, true);
  let prevented = false;
  dialog.listeners.get('cancel')({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  const allText = (item) => [item.textContent, ...item.children.map(allText)].join(' ');
  assert.doesNotMatch(allText(view.host), /直接开始|跳过|关闭/);
  const level = view.find((item) => item.name === 'level');
  const goal = view.find((item) => item.name === 'goal');
  const apply = view.find((item) => item.textContent === '按这个起点学习');
  assert.equal(level.required, true);
  assert.equal(apply.disabled, true);
  assert.equal(goal.value, '');
  assert.equal(view.find((item) => item.tag === 'a').href, '/world');
  level.value = 'basic';
  level.listeners.get('change')();
  assert.equal(apply.disabled, false);
  apply.listeners.get('click')();
  assert.equal(
    view.find((item) => item.tag === 'dialog'),
    undefined,
  );
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().level, 'basic');
  assert.match(view.window.FreeBbsLearningStart.promptHint(), /学生自述.*非测评结论/);
  assert.equal(view.calls.length, 0);
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-02-01' } },
  });
  await view.flush();
  assert.equal(
    view.find((item) => item.tag === 'dialog'),
    undefined,
  );
  view.find((item) => item.textContent === '调整学习起点').listeners.get('click')();
  assert.equal(view.find((item) => item.tag === 'dialog').open, true);
});
test('dialog account changes and storage invalidation cannot reuse stale confirmation handlers', async () => {
  const view = browser('/knowledge');
  await view.flush();
  const oldApply = view.find((item) => item.textContent === '按这个起点学习');
  const oldLevel = view.find((item) => item.name === 'level');
  oldLevel.value = 'advanced';
  view.app.userState = { ...bob };
  view.storage.setItem('free_bbs_auth_token', bob.token);
  const pending = view.listeners.get('freebbs:session-change')();
  oldApply.listeners.get('click')();
  await pending;
  await view.flush();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
  assert.equal(view.find((item) => item.name === 'level').value, '');
  view.listeners.get('storage')({ key: 'free_bbs_auth_token' });
  assert.equal(view.host.hidden, false);
  assert.equal(view.find((item) => item.tag === 'dialog').open, true);
  assert.ok(view.find((item) => item.textContent === '登录状态已变化，请刷新后继续。'));
  assert.equal(view.window.FreeBbsLearningStart.promptHint(), '');
  assert.equal(view.calls.length, 0);
});

test('throwing storage getters and rejected crypto still require a choice without leaking or crashing', async () => {
  for (const options of [{ noStorage: true }, { noStorageMethods: true }, { noCrypto: true }]) {
    const view = browser('/knowledge', options);
    await view.flush();
    assert.equal(view.find((item) => item.tag === 'dialog').open, true);
    assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
    const level = view.find((item) => item.name === 'level');
    level.value = 'new';
    const apply = view.find((item) => item.textContent === '按这个起点学习');
    apply.listeners.get('click')();
    assert.equal(view.window.FreeBbsLearningStart.currentPreference().level, 'new');
    assert.equal(
      view.find((item) => item.tag === 'dialog'),
      undefined,
    );
    assert.ok(view.find((item) => item.textContent === '本次选择仅在当前页面生效。'));
    assert.equal(view.calls.length, 0);
  }
});

test('the default course entry also requires the signals starting point', async () => {
  const view = browser('/course', { search: '' });
  await view.flush();
  assert.equal(view.find((item) => item.tag === 'dialog').open, true);
  const level = view.find((item) => item.name === 'level');
  level.value = 'basic';
  view.find((item) => item.textContent === '按这个起点学习').listeners.get('click')();
  assert.equal(progress.read(view.storage, BASE, alice).signals.level, 'basic');
});

test('legacy advanced intent cannot become complete mastery or bypass a new confirmation', async () => {
  const { make, storage, sessionStorage } = fixture();
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify([true, alice.uid, alice.token]))
    .digest('hex');
  progress.write(storage, BASE, alice, { signals: { level: 'advanced', goal: 'explore' } });
  progress.write(sessionStorage, TICKETS, alice, {
    signals: { fingerprint, preference: { level: 'advanced', goal: 'explore' } },
  });
  const controller = make();
  await controller.setContext('signals');
  assert.equal(controller.snapshot().preference, null);
  assert.equal(controller.snapshot().confirmed, false);
  assert.equal(controller.promptHint(), '');
  assert.equal(restorablePreference({ level: 'advanced' }), null);
  assert.equal(controller.confirm({ level: 'advanced', goal: 'explore' }), true);
  assert.equal(progress.read(storage, BASE, alice).signals.schemaVersion, SCHEMA_VERSION);
  assert.equal(progress.read(sessionStorage, TICKETS, alice).signals.schemaVersion, SCHEMA_VERSION);
  assert.equal(controller.currentPreference().level, 'advanced');
  const another = make();
  await another.setContext('signals');
  assert.equal(another.snapshot().confirmed, true);
  assert.equal(another.currentPreference().level, 'advanced');
});

test('old ordinary levels may preselect but every old ticket must be reconfirmed', async () => {
  const { make, storage, sessionStorage } = fixture();
  progress.write(storage, BASE, alice, { signals: { level: 'familiar', goal: 'review' } });
  progress.write(sessionStorage, TICKETS, alice, {
    signals: { preference: { level: 'familiar', goal: 'review' } },
  });
  const controller = make();
  await controller.setContext('signals');
  assert.deepEqual(controller.snapshot().preference, { level: 'familiar', goal: '' });
  assert.equal(controller.snapshot().confirmed, false);
});

test('the default goal stays unselected and does not overwrite a deliberate goal change', async () => {
  const view = browser();
  await view.flush();
  const level = view.find((item) => item.name === 'level');
  const goal = view.find((item) => item.name === 'goal');
  assert.deepEqual(
    Array.from(level.children.slice(1), (item) => item.textContent),
    ['第一次学', '不甚熟悉', '能独立做题', '完整掌握'],
  );
  assert.deepEqual(
    Array.from(goal.children.slice(1), (item) => item.textContent),
    ['理解知识', '练习解题', '探索研究'],
  );
  level.value = 'new';
  level.listeners.get('change')();
  assert.equal(goal.value, '');
  assert.equal(goal.children[0].textContent, '建议：理解知识');
  goal.value = 'explore';
  level.value = 'basic';
  level.listeners.get('change')();
  assert.equal(goal.value, 'explore');
  view.find((item) => item.textContent === '按这个起点学习').listeners.get('click')();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'explore');
  assert.equal(view.calls.length, 0);
});

test('Max uses the same controlled twelve strategies, never free-form preference instructions', () => {
  const { buildStrategy } = require('../public/learning-strategies');
  for (const level of ['new', 'familiar', 'basic', 'advanced'])
    for (const goal of ['concepts', 'practice', 'explore']) {
      const context = {
        nodeTitle: '卷积',
        hasContent: true,
        hasQuestions: true,
        quizView: 'quick',
      };
      assert.equal(
        promptHintFromPreference({ level, goal, hint: 'INJECT' }, context),
        buildStrategy({ level, goal }, context).hint,
      );
    }
});

test('confirmed choices are recorded only with a real node and keep an unspecified goal unknown', async () => {
  const view = browser();
  const choices = [];
  view.window.FreeBbsLearningAnalytics = { recordLearningChoice: (value) => choices.push(value) };
  await view.flush();
  const level = view.find((item) => item.name === 'level');
  level.value = 'basic';
  level.listeners.get('change')();
  view.find((item) => item.textContent === '按这个起点学习').listeners.get('click')();
  assert.equal(choices.length, 0);
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-01-01' } },
  });
  await view.flush();
  assert.equal(choices.length, 1);
  assert.equal(choices[0].goal, null);
  assert.equal(choices[0].level, 'basic');
  assert.equal(choices[0].action, 'learning_start_set');
  assert.equal(choices[0].pathType, undefined);
  assert.equal(choices[0].documentVersion, undefined);
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-02-01' } },
  });
  await view.flush();
  assert.equal(choices.length, 1);
  assert.equal(view.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(choices), /token|prompt|笔记/);
});
