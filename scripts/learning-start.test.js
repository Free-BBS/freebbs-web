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
    ['new', /必要术语.*直观情境/],
    ['familiar', /已知与不确定处.*针对缺口解释/],
    ['basic', /减少重复讲授.*独立解释/],
    ['advanced', /边界、反例、联系与验证/],
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
test('an unset preference stays optional and a new course visit restores the saved preference directly', async () => {
  const { make } = fixture();
  const first = make();
  await first.setContext('signals');
  assert.equal(first.snapshot().valid, true);
  assert.equal(first.snapshot().editing, false);
  assert.equal(first.snapshot().confirmed, false);
  assert.equal(first.confirm({ goal: 'concepts' }), false);
  assert.equal(first.promptHint(), '');
  assert.equal(first.confirm({ level: 'basic', goal: 'practice' }), true);
  await first.setContext({ course: { slug: 'signals' }, node: { id: 'SS-02-01' } });
  assert.equal(first.snapshot().confirmed, true);
  const nextVisit = make();
  await nextVisit.setContext('signals');
  assert.equal(nextVisit.snapshot().confirmed, true);
  assert.equal(nextVisit.snapshot().editing, false);
  assert.deepEqual(nextVisit.snapshot().preference, { level: 'basic', goal: 'practice' });
  assert.deepEqual(nextVisit.currentPreference(), { level: 'basic', goal: 'practice' });
});
test('saved preferences survive a new tab and a verified token rotation while staying account and course scoped', async () => {
  const { make, storage, sessionStorage, change } = fixture();
  const course = make();
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
  assert.equal(refreshed.snapshot().confirmed, true);
  assert.equal(refreshed.snapshot().preference.level, 'new');
  const otherTab = make({ sessionStorage: memoryStorage() });
  await otherTab.setContext('signals');
  assert.equal(otherTab.snapshot().confirmed, true);
  assert.deepEqual(otherTab.currentPreference(), { level: 'new', goal: 'concepts' });
  assert.equal(otherTab.snapshot().editing, false);
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

test('crypto failure restores a browser preference without trusting or overwriting an old tab ticket', async () => {
  const { make, sessionStorage } = fixture();
  const confirmed = make();
  await confirmed.setContext('signals');
  confirmed.confirm({ level: 'basic' });
  const before = JSON.stringify([...sessionStorage.values]);
  const unavailable = make({ fingerprint: () => Promise.reject(new Error('crypto unavailable')) });
  await unavailable.setContext('signals');
  assert.equal(unavailable.snapshot().valid, true);
  assert.equal(unavailable.snapshot().confirmed, true);
  assert.equal(unavailable.currentPreference().level, 'basic');
  assert.equal(unavailable.confirm({ level: 'familiar', goal: 'concepts' }), true);
  assert.equal(unavailable.snapshot().persistenceAvailable, true);
  assert.equal(unavailable.snapshot().persistenceScope, 'browser');
  assert.equal(JSON.stringify([...sessionStorage.values]), before);
});

test('adjustment and cancellation retain the effective preference and reject a cancelled editor handler', async () => {
  const { make, storage } = fixture();
  const controller = make();
  await controller.setContext('signals');
  controller.confirm({ level: 'basic', goal: 'practice' });
  const before = JSON.stringify([...storage.values]);
  const hint = controller.promptHint();
  assert.equal(controller.adjust(), true);
  const editorGeneration = controller.snapshot().generation;
  assert.equal(controller.snapshot().editing, true);
  assert.equal(controller.snapshot().confirmed, true);
  assert.deepEqual(controller.currentPreference(), { level: 'basic', goal: 'practice' });
  assert.equal(controller.promptHint(), hint);
  assert.equal(controller.cancel(editorGeneration), true);
  assert.equal(controller.snapshot().editing, false);
  assert.equal(controller.confirm({ level: 'advanced', goal: 'explore' }, editorGeneration), false);
  assert.deepEqual(controller.currentPreference(), { level: 'basic', goal: 'practice' });
  assert.equal(JSON.stringify([...storage.values]), before);
});

test('changing course closes the editor and does not apply its draft to another course', async () => {
  const { make } = fixture();
  const controller = make();
  await controller.setContext('signals');
  controller.confirm({ level: 'new', goal: 'concepts' });
  controller.adjust();
  const editorGeneration = controller.snapshot().generation;
  await controller.setContext('calculus');
  assert.equal(controller.snapshot().editing, false);
  assert.equal(controller.currentPreference(), null);
  assert.equal(controller.confirm({ level: 'advanced' }, editorGeneration), false);
  await controller.setContext('signals');
  assert.deepEqual(controller.currentPreference(), { level: 'new', goal: 'concepts' });
});

test('page-only preferences survive course changes in this page without crossing accounts', async () => {
  const { make, change, storage, sessionStorage } = fixture();
  const controller = make({ memoryOnly: true, authStorageUnavailable: true });
  await controller.setContext('signals');
  controller.confirm({ level: 'new', goal: 'concepts' });
  await controller.setContext('calculus');
  assert.equal(controller.currentPreference(), null);
  controller.confirm({ level: 'basic', goal: 'practice' });
  await controller.setContext('signals');
  assert.deepEqual(controller.currentPreference(), { level: 'new', goal: 'concepts' });
  assert.equal(controller.snapshot().persistenceScope, 'page');
  change(bob);
  await controller.sessionChanged();
  assert.equal(controller.currentPreference(), null);
  controller.confirm({ level: 'advanced', goal: 'explore' });
  change(alice);
  await controller.sessionChanged();
  assert.deepEqual(controller.currentPreference(), { level: 'new', goal: 'concepts' });
  assert.equal(storage.values.has(progress.scopedKey(BASE, alice)), false);
  assert.equal(sessionStorage.values.size, 0);
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
  let activeElement = null;
  function node(tag) {
    return {
      tag,
      children: [],
      dataset: {},
      listeners: new Map(),
      classList: { add() {} },
      textContent: '',
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
      focus() {
        activeElement = this;
      },
    };
  }
  const host = node('section');
  const page = node('main');
  const storage = options.storage || memoryStorage();
  storage.setItem('free_bbs_auth_token', alice.token);
  const calls = [];
  const events = [];
  const app = {
    userState: { ...alice },
    callApi(...args) {
      calls.push(args);
    },
  };
  const window = {
    freeBbsApp: app,
    FreeBbsLearningProgress: options.progress || progress,
    FreeBbsLearningStrategies: require('../public/learning-strategies'),
    CustomEvent: class {
      constructor(type, eventOptions) {
        this.type = type;
        this.detail = eventOptions?.detail;
      }
    },
    dispatchEvent(event) {
      events.push(event);
      listeners.get(event.type)?.(event);
    },
    localStorage: storage,
    sessionStorage: options.sessionStorage || memoryStorage(),
    crypto: {
      subtle: {
        async digest(algorithm, bytes) {
          assert.equal(algorithm, 'SHA-256');
          if (options.digest) return options.digest(bytes);
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
  if (options.noSessionStorage)
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
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
  const all = (testNode, rootNode = host) => [
    ...(testNode(rootNode) ? [rootNode] : []),
    ...rootNode.children.flatMap((child) => all(testNode, child)),
  ];
  return {
    window,
    host,
    page,
    app,
    calls,
    events,
    listeners,
    storage,
    find,
    all,
    focused: () => activeElement,
    flush: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 15);
      }),
  };
}
function editor(view) {
  return view.find((item) => item.className === 'learning-start-editor');
}
function openEditor(view) {
  if (!editor(view))
    view.find((item) => item.className === 'learning-start-adjust').listeners.get('click')();
  return editor(view);
}
function chooseGoal(view, goal) {
  const inputs = view.all((item) => item.name === 'learning-start-goal');
  for (const input of inputs) input.checked = input.value === goal;
  const input = inputs.find((item) => item.checked);
  assert.ok(input, 'Goal is always one of the four visible purposes');
  input.listeners.get('change')();
}
function selectedGoal(view) {
  return view.find((item) => item.name === 'learning-start-goal' && item.checked)?.value || '';
}
function chooseLevel(view, level) {
  const input = view.find((item) => item.name === 'level');
  input.value = level;
  input.listeners.get('change')();
}
function applyChoice(view, level, goal) {
  openEditor(view);
  if (level) chooseLevel(view, level);
  if (goal) chooseGoal(view, goal);
  view.find((item) => item.textContent === '按这个方式学习').listeners.get('click')();
}
function escapeEditor(view, extra = {}) {
  let prevented = false;
  editor(view).listeners.get('keydown')({
    key: 'Escape',
    preventDefault() {
      prevented = true;
    },
    ...extra,
  });
  return prevented;
}
function watchWorkspaceGoal(view) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const from = source.indexOf("  window.addEventListener('learning:start-change'");
  const to = source.indexOf("  page.addEventListener('knowledge:annotation-save'", from);
  assert.ok(from >= 0 && to > from);
  const state = {
    stale: false,
    uid: view.app.userState.uid,
    token: view.app.userState.token,
    planGoal: 'explore',
  };
  let changes = 0;
  vm.runInNewContext(source.slice(from, to), {
    state,
    app: view.app,
    window: view.window,
    refreshPlan() {
      changes += 1;
    },
  });
  return { state, changes: () => changes };
}

test('first course and direct knowledge visits naturally show one non-modal two-dimension entry', async () => {
  for (const pathname of ['/course', '/knowledge']) {
    const view = browser(pathname);
    await view.flush();
    assert.ok(editor(view));
    assert.equal(
      view.find((item) => item.tag === 'dialog'),
      undefined,
    );
    assert.equal(view.all((item) => item.tag === 'select').length, 1);
    assert.deepEqual(
      view.all((item) => item.type === 'radio').map((item) => item.value),
      ['concepts', 'practice', 'review', 'explore'],
    );
    assert.equal(selectedGoal(view), '');
    assert.equal(view.find((item) => item.name === 'level').value, '');
    assert.equal(view.find((item) => item.textContent === '按这个方式学习').disabled, true);
    assert.ok(view.find((item) => item.textContent === '先直接学习'));
    assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
    assert.equal(view.window.FreeBbsLearningStart.promptHint(), '');
    assert.equal(view.calls.length, 0);
    const visibleText = view
      .all((item) => Boolean(item.textContent))
      .map((item) => item.textContent)
      .join(' ');
    assert.doesNotMatch(visibleText, /实验|16 类|十六类|待验证|问卷/);
    assert.match(visibleText, /熟悉程度只帮助调整建议，随时可以改/);
    assert.equal(view.focused(), null, 'Initial entry must not steal reading or keyboard focus');
  }
});

test('all sixteen explicit selections apply and restore without silently substituting another purpose', async () => {
  for (const level of ['new', 'familiar', 'basic', 'advanced'])
    for (const goal of ['concepts', 'practice', 'review', 'explore']) {
      const view = browser('/knowledge');
      await view.flush();
      const changes = view.events.length;
      chooseGoal(view, goal);
      assert.equal(view.find((item) => item.textContent === '按这个方式学习').disabled, true);
      chooseLevel(view, level);
      assert.equal(view.find((item) => item.textContent === '按这个方式学习').disabled, false);
      assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
      applyChoice(view);
      assert.equal(editor(view), undefined);
      assert.equal(view.window.FreeBbsLearningStart.currentPreference().level, level);
      assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, goal);
      assert.equal(view.events.length, changes + 1);
      assert.equal(view.events.at(-1).type, 'learning:start-change');
      assert.equal(view.calls.length, 0, 'Applying preferences never sends a Max question');
      assert.equal(view.focused().className, 'learning-start-adjust');
      const restored = browser('/knowledge', { storage: view.storage });
      await restored.flush();
      assert.equal(editor(restored), undefined);
      assert.equal(restored.window.FreeBbsLearningStart.currentPreference().goal, goal);
      assert.equal(restored.window.FreeBbsLearningStart.currentPreference().level, level);
    }
});

test('a purpose stays selected while all four familiarity levels change and no alternate options disappear', async () => {
  const view = browser();
  await view.flush();
  chooseGoal(view, 'review');
  for (const level of ['new', 'familiar', 'basic', 'advanced']) {
    chooseLevel(view, level);
    assert.equal(selectedGoal(view), 'review');
    assert.deepEqual(
      view.all((item) => item.name === 'learning-start-goal').map((item) => item.value),
      ['concepts', 'practice', 'review', 'explore'],
    );
    assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
  }
  assert.deepEqual(
    view
      .find((item) => item.name === 'level')
      .children.slice(1)
      .map((item) => item.textContent),
    ['第一次学', '不甚熟悉', '能独立做题', '完整掌握'],
  );
});

test('continue directly only folds this page entry and never saves or invents a learning choice', async () => {
  const view = browser();
  const choices = [];
  view.window.FreeBbsLearningAnalytics = { recordLearningChoice: (value) => choices.push(value) };
  await view.flush();
  const before = JSON.stringify([...view.storage.values]);
  const events = view.events.length;
  chooseGoal(view, 'explore');
  chooseLevel(view, 'advanced');
  const oldApply = view.find((item) => item.textContent === '按这个方式学习');
  view.find((item) => item.textContent === '先直接学习').listeners.get('click')();
  oldApply.listeners.get('click')();
  assert.equal(editor(view), undefined);
  assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
  assert.equal(JSON.stringify([...view.storage.values]), before);
  assert.equal(view.events.length, events);
  assert.equal(choices.length, 0);
  assert.equal(view.focused().className, 'learning-start-adjust');
  await view.window.FreeBbsLearningStart.setContext({
    course: { slug: 'signals' },
    node: { id: 'SS-02-01' },
  });
  assert.equal(editor(view), undefined);
  const next = browser('/knowledge', { storage: view.storage });
  await next.flush();
  assert.ok(editor(next), 'A new visit remains unset, not a fictitious persisted preference');
});

test('cancel and Escape discard only the draft while Max and recommendations retain the applied preference', async () => {
  const view = browser('/knowledge');
  await view.flush();
  applyChoice(view, 'basic', 'practice');
  const before = JSON.stringify([...view.storage.values]);
  const hint = view.window.FreeBbsLearningStart.promptHint();
  const changes = view.events.length;
  for (const method of ['cancel', 'escape']) {
    openEditor(view);
    chooseLevel(view, 'advanced');
    chooseGoal(view, 'explore');
    const staleApply = view.find((item) => item.textContent === '按这个方式学习');
    assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
    assert.equal(view.window.FreeBbsLearningStart.promptHint(), hint);
    if (method === 'cancel')
      view.find((item) => item.textContent === '取消').listeners.get('click')();
    else assert.equal(escapeEditor(view), true);
    staleApply.listeners.get('click')();
    assert.equal(editor(view), undefined);
    assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
    assert.equal(JSON.stringify([...view.storage.values]), before);
    assert.equal(view.events.length, changes);
  }
  applyChoice(view, 'familiar', 'review');
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'review');
  assert.equal(view.events.length, changes + 1);
});

test('Escape while composing or already handled by a select does not dismiss an inline draft', async () => {
  const view = browser();
  await view.flush();
  const current = editor(view);
  assert.equal(escapeEditor(view, { isComposing: true }), false);
  assert.equal(escapeEditor(view, { defaultPrevented: true }), false);
  assert.equal(
    escapeEditor(view, {
      target: {
        closest(selector) {
          assert.equal(selector, 'select, option');
          return {};
        },
      },
    }),
    false,
    'Native select Escape belongs to the dropdown, not to dismissing its parent editor',
  );
  assert.equal(editor(view), current);
  assert.equal(escapeEditor(view), true);
  assert.equal(editor(view), undefined);
});

test('reopening a deferred unset entry and cancelling keeps it folded', async () => {
  const view = browser();
  await view.flush();
  view.find((item) => item.textContent === '先直接学习').listeners.get('click')();
  openEditor(view);
  chooseGoal(view, 'review');
  escapeEditor(view);
  assert.equal(editor(view), undefined);
  openEditor(view);
  assert.equal(selectedGoal(view), '');
  assert.equal(view.find((item) => item.name === 'level').value, '');
});

test('same-session notifications and repeated same-course points preserve the exact unsaved inline controls', async () => {
  const view = browser('/knowledge');
  await view.flush();
  applyChoice(view, 'basic', 'practice');
  const workspace = watchWorkspaceGoal(view);
  const current = openEditor(view);
  const level = view.find((item) => item.name === 'level');
  chooseLevel(view, 'familiar');
  chooseGoal(view, 'review');
  await view.listeners.get('freebbs:session-change')();
  await view.window.FreeBbsLearningStart.setContext({
    course: { slug: 'signals' },
    node: { id: 'SS-02-01' },
  });
  await view.flush();
  assert.equal(editor(view), current);
  assert.equal(
    view.find((item) => item.name === 'level'),
    level,
  );
  assert.equal(level.value, 'familiar');
  assert.equal(selectedGoal(view), 'review');
  assert.equal(workspace.state.planGoal, 'explore');
  assert.equal(workspace.changes(), 0);
});

test('a superseded outer digest cannot clear a newer editor or overwrite its selected purpose', async () => {
  const storage = memoryStorage();
  progress.write(storage, BASE, alice, {
    signals: { schemaVersion: SCHEMA_VERSION, level: 'basic', goal: 'practice' },
  });
  let release;
  let calls = 0;
  const view = browser('/knowledge', {
    storage,
    digest: (bytes) => {
      const value = Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer;
      calls += 1;
      if (calls === 1)
        return new Promise((resolve) => {
          release = () => resolve(value);
        });
      return Promise.resolve(value);
    },
  });
  await view.window.FreeBbsLearningStart.setContext('signals');
  await view.flush();
  const workspace = watchWorkspaceGoal(view);
  const current = openEditor(view);
  chooseLevel(view, 'familiar');
  chooseGoal(view, 'review');
  release();
  await view.flush();
  assert.equal(editor(view), current);
  assert.equal(selectedGoal(view), 'review');
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
  assert.equal(workspace.changes(), 0);
});

test('a no-op course notification during digest completion cannot strand the loading UI', async () => {
  const storage = memoryStorage();
  progress.write(storage, BASE, alice, {
    signals: { schemaVersion: SCHEMA_VERSION, level: 'basic', goal: 'practice' },
  });
  let notified = false;
  const view = browser('/knowledge', {
    storage,
    progress: {
      ...progress,
      read(...args) {
        const saved = progress.read(...args);
        if (args[1] === BASE && !notified) {
          notified = true;
          view.window.FreeBbsLearningStart.setContext('signals');
        }
        return saved;
      },
    },
  });
  await view.flush();
  assert.equal(notified, true);
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
  assert.ok(view.find((item) => item.textContent === '调整学习方式'));
  assert.equal(
    view.find((item) => item.textContent === '正在恢复学习偏好；可继续阅读。'),
    undefined,
  );
  assert.equal(editor(view), undefined);
});

test('late old-account completion cannot reset a newer account unsaved selection', async () => {
  let release;
  let hold = false;
  const view = browser('/knowledge', {
    digest: (bytes) => {
      const value = Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer;
      if (hold) {
        hold = false;
        return new Promise((resolve) => {
          release = () => resolve(value);
        });
      }
      return Promise.resolve(value);
    },
  });
  await view.flush();
  view.app.userState = { ...alice, token: 'rotated-alice-token' };
  view.storage.setItem('free_bbs_auth_token', view.app.userState.token);
  hold = true;
  const old = view.listeners.get('freebbs:session-change')();
  view.app.userState = { ...bob };
  view.storage.setItem('free_bbs_auth_token', bob.token);
  await view.listeners.get('freebbs:session-change')();
  const workspace = watchWorkspaceGoal(view);
  const current = openEditor(view);
  chooseLevel(view, 'familiar');
  chooseGoal(view, 'review');
  release();
  await old;
  await view.flush();
  assert.equal(editor(view), current);
  assert.equal(selectedGoal(view), 'review');
  assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
  assert.equal(workspace.changes(), 0);
  assert.equal(progress.read(view.storage, BASE, bob).signals, undefined);
});

test('a new tab restores account preferences without asking even without crypto or session storage', async () => {
  const first = browser();
  await first.flush();
  applyChoice(first, 'new', 'review');
  const next = browser('/knowledge', {
    storage: first.storage,
    noCrypto: true,
    noSessionStorage: true,
  });
  await next.flush();
  assert.equal(editor(next), undefined);
  assert.equal(next.window.FreeBbsLearningStart.currentPreference().goal, 'review');
  assert.ok(next.find((item) => item.textContent === '偏好已保存在本机浏览器。'));
  assert.equal(next.calls.length, 0);
});

test('account changes and cross-tab token invalidation reject detached drafts without applying to a different owner', async () => {
  const view = browser('/knowledge');
  await view.flush();
  chooseGoal(view, 'explore');
  chooseLevel(view, 'advanced');
  const oldApply = view.find((item) => item.textContent === '按这个方式学习');
  view.app.userState = { ...bob };
  view.storage.setItem('free_bbs_auth_token', bob.token);
  const pending = view.listeners.get('freebbs:session-change')();
  oldApply.listeners.get('click')();
  await pending;
  await view.flush();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference(), null);
  assert.equal(selectedGoal(view), '');
  assert.equal(view.find((item) => item.name === 'level').value, '');
  chooseGoal(view, 'review');
  chooseLevel(view, 'basic');
  const otherApply = view.find((item) => item.textContent === '按这个方式学习');
  view.listeners.get('storage')({ key: 'free_bbs_auth_token' });
  otherApply.listeners.get('click')();
  assert.equal(editor(view), undefined);
  assert.ok(
    view.find((item) => item.textContent === '登录状态已变化，学习偏好暂不可用；可继续阅读。'),
  );
  assert.equal(view.window.FreeBbsLearningStart.promptHint(), '');
  assert.equal(progress.read(view.storage, BASE, alice).signals, undefined);
  assert.equal(progress.read(view.storage, BASE, bob).signals, undefined);
  assert.equal(view.calls.length, 0);
});

test('storage and crypto failures still allow a preference with an honest save-scope message', async () => {
  for (const options of [
    { noStorage: true },
    { noStorageMethods: true },
    { noCrypto: true },
    { noSessionStorage: true },
  ]) {
    const view = browser('/knowledge', options);
    await view.flush();
    assert.ok(editor(view));
    applyChoice(view, 'new', 'concepts');
    assert.equal(editor(view), undefined);
    assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'concepts');
    assert.ok(
      view.find(
        (item) =>
          item.textContent ===
          (options.noStorage || options.noStorageMethods
            ? '偏好仅在当前页面生效，未持久保存。'
            : '偏好已保存在本机浏览器。'),
      ),
    );
    assert.equal(view.calls.length, 0);
  }
});

test('the default course entry selects signals without requiring a preference', async () => {
  const view = browser('/course', { search: '' });
  await view.flush();
  assert.ok(editor(view));
  applyChoice(view, 'basic', 'practice');
  assert.equal(progress.read(view.storage, BASE, alice).signals.goal, 'practice');
});

test('legacy advanced intent never becomes complete mastery implicitly while ordinary legacy choices remain untouched', async () => {
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
  assert.equal(controller.currentPreference(), null);
  assert.equal(restorablePreference({ level: 'advanced' }), null);
  assert.equal(controller.confirm({ level: 'advanced', goal: 'review' }), true);
  assert.equal(progress.read(storage, BASE, alice).signals.schemaVersion, SCHEMA_VERSION);
  const another = make();
  await another.setContext('signals');
  assert.equal(another.currentPreference().goal, 'review');
  progress.write(storage, BASE, alice, { signals: { level: 'familiar', goal: 'practice' } });
  const ordinary = make();
  await ordinary.setContext('signals');
  assert.deepEqual(ordinary.currentPreference(), { level: 'familiar', goal: 'practice' });
});

test('stored review now restores as review rather than being discarded or remapped', async () => {
  const { make, storage } = fixture();
  progress.write(storage, BASE, alice, {
    signals: { schemaVersion: SCHEMA_VERSION, level: 'familiar', goal: 'review' },
  });
  const controller = make();
  await controller.setContext('signals');
  assert.deepEqual(controller.currentPreference(), { level: 'familiar', goal: 'review' });
  assert.equal(controller.snapshot().editing, false);
  assert.equal(controller.snapshot().confirmed, true);
});

test('a previously saved unspecified goal does not reopen the first-entry selector automatically', async () => {
  const storage = memoryStorage();
  progress.write(storage, BASE, alice, { signals: { level: 'basic', goal: '' } });
  const view = browser('/knowledge', { storage });
  await view.flush();
  assert.equal(editor(view), undefined);
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, '');
  openEditor(view);
  assert.equal(selectedGoal(view), '');
  assert.equal(view.find((item) => item.textContent === '按这个方式学习').disabled, true);
  chooseGoal(view, 'review');
  applyChoice(view);
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'review');
});

test('Max receives the same controlled sixteen strategies, never free-form instructions', () => {
  const { buildStrategy } = require('../public/learning-strategies');
  for (const level of ['new', 'familiar', 'basic', 'advanced'])
    for (const goal of ['concepts', 'practice', 'review', 'explore']) {
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

test('only explicit apply at a real node records a choice; draft, restoration and course-page choices do not', async () => {
  const view = browser();
  const choices = [];
  view.window.FreeBbsLearningAnalytics = { recordLearningChoice: (value) => choices.push(value) };
  await view.flush();
  applyChoice(view, 'basic', 'review');
  assert.equal(choices.length, 0);
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-01-01' } },
  });
  await view.flush();
  assert.equal(choices.length, 0);
  openEditor(view);
  const apply = view.find((item) => item.textContent === '按这个方式学习');
  apply.listeners.get('click')();
  apply.listeners.get('click')();
  assert.equal(choices.length, 1);
  assert.equal(choices[0].goal, 'review');
  assert.equal(choices[0].action, 'learning_start_set');
  assert.equal(choices[0].nodeId, 'SS-01-01');
  assert.equal(choices[0].documentVersion, undefined);
  assert.doesNotMatch(JSON.stringify(choices), /token|prompt|笔记/);
  view.page.listeners.get('knowledge:loaded')({
    detail: { course: { slug: 'signals' }, node: { id: 'SS-02-01' } },
  });
  await view.flush();
  assert.equal(choices.length, 1);
  assert.equal(editor(view), undefined);
  assert.equal(view.calls.length, 0);
});

test('restoration, same-session notification and cross-account restoration never record fictitious choices', async () => {
  const storage = memoryStorage();
  progress.write(storage, BASE, alice, {
    signals: { schemaVersion: SCHEMA_VERSION, level: 'basic', goal: 'practice' },
  });
  progress.write(storage, BASE, bob, {
    signals: { schemaVersion: SCHEMA_VERSION, level: 'new', goal: 'review' },
  });
  const view = browser('/knowledge', { storage });
  const choices = [];
  view.window.FreeBbsLearningAnalytics = { recordLearningChoice: (value) => choices.push(value) };
  await view.flush();
  for (const id of ['SS-01-01', 'SS-01-01', 'SS-02-01']) {
    view.page.listeners.get('knowledge:loaded')({
      detail: { course: { slug: 'signals' }, node: { id } },
    });
    await view.flush();
  }
  await view.listeners.get('freebbs:session-change')();
  view.app.userState = { ...bob };
  storage.setItem('free_bbs_auth_token', bob.token);
  await view.listeners.get('freebbs:session-change')();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'review');
  view.app.userState = { ...alice };
  storage.setItem('free_bbs_auth_token', alice.token);
  await view.listeners.get('freebbs:session-change')();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
  view.listeners.get('storage')({ key: 'free_bbs_auth_token' });
  await view.listeners.get('freebbs:session-change')();
  assert.equal(view.window.FreeBbsLearningStart.currentPreference().goal, 'practice');
  assert.equal(choices.length, 0);
  assert.equal(editor(view), undefined);
});
