// Independent lifecycle review: deterministic browser timing, no service or source mutation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reader = require('../public/learning-reader');
const progress = require('../public/learning-progress');
const { labels } = require('../public/knowledge-workspace');

const VERSION = 'a'.repeat(64);
function runtime({ blockedStorage = false, fontsPending = false, typography = false } = {}) {
  const created = [];
  const element = (tag = 'div') => ({
    tagName: tag,
    children: [],
    hidden: false,
    classList: { contains: () => false },
    listeners: new Map(),
    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    },
    setAttribute() {},
    append(...items) {
      this.children.push(...items);
    },
  });
  const page = { ...element(), dataset: { learningTool: 'content' } };
  const actions = { prepend() {}, append() {} };
  const reading = { ...element(), querySelector: () => actions };
  const frames = [];
  const timers = [];
  const scroller = {
    ...element(),
    parentElement: null,
    scrollHeight: 2000,
    clientHeight: 300,
    scrollTop: 0,
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0 }),
    scrollBy({ top }) {
      this.scrollTop += top;
    },
  };
  let layoutScale = 1;
  let typographyPreference = 'regular';
  const block = {
    textContent: '公开正文中的独立测试段落',
    getBoundingClientRect: () => ({
      top: 400 * layoutScale - scroller.scrollTop,
      bottom: 450 * layoutScale - scroller.scrollTop,
    }),
  };
  const body = {
    parentElement: scroller,
    querySelectorAll: (selector) => (selector === reader.BLOCKS ? [block] : []),
  };
  const stored = new Map();
  const app = { userState: { isLoggedIn: true, uid: 'review-user', token: 'review-session' } };
  stored.set(
    progress.scopedKey(reader.BASE, app.userState),
    JSON.stringify({
      '["signals","SS-01-01"]': {
        index: 0,
        fingerprint: reader.fingerprint(block.textContent),
        offset: -8,
        version: VERSION,
      },
    }),
  );
  const storage = {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, value),
  };
  const browser = {
    ...element(),
    FreeBbsLearningProgress: progress,
    location: { search: '' },
    getComputedStyle: () => ({ overflowY: 'auto' }),
    requestAnimationFrame: (callback) => frames.push(callback),
    setTimeout: (callback) => timers.push(callback),
    clearTimeout() {},
  };
  if (typography)
    browser.freeBbsTypography = {
      typeScalePresets: { regular: { name: '正常' }, large: { name: '大字' } },
      getCurrentPreferences: () => ({ typeScale: typographyPreference }),
      applyPreferences({ typeScale }) {
        typographyPreference = typeScale;
        layoutScale = typeScale === 'large' ? 1.2 : 1;
      },
      savePreferences: () => true,
    };
  Object.defineProperty(browser, 'localStorage', {
    get() {
      if (blockedStorage) throw new Error('SecurityError: localStorage denied');
      return storage;
    },
  });
  const dom = {
    ...element(),
    querySelector: () => page,
    getElementById: (id) => ({ 'knowledge-body': body, 'knowledge-reading': reading })[id] || null,
    createElement: (tag) => {
      const item = element(tag);
      created.push(item);
      return item;
    },
    createTextNode: (copy) => ({ textContent: copy }),
  };
  let finishFonts;
  if (fontsPending)
    dom.fonts = {
      ready: new Promise((resolve) => {
        finishFonts = resolve;
      }),
    };
  const api = reader.install(browser, dom, app);
  const enter = () =>
    page.listeners.get('knowledge:loaded')({
      detail: { course: { slug: 'signals' }, node: { id: 'SS-01-01', documentVersion: VERSION } },
    });
  const flushFrames = () => {
    while (frames.length) frames.shift()();
  };
  return {
    browser,
    dom,
    scroller,
    api,
    enter,
    flushFrames,
    finishFonts,
    timers,
    stored,
    created,
    app,
  };
}

test('reader lifecycle tolerates a denied localStorage getter and remains usable in memory', () => {
  const view = runtime({ blockedStorage: true });
  assert.doesNotThrow(view.enter);
  view.flushFrames();
  assert.equal(view.api.capture(), true);
});

test('a user wheel action before initial animation-frame restore wins over old bookmark', () => {
  const view = runtime();
  view.enter();
  view.dom.listeners.get('wheel')();
  view.scroller.scrollTop = 100;
  view.flushFrames();
  assert.equal(view.scroller.scrollTop, 100);
});

test('late font readiness does not move a reader who started acting', async () => {
  const view = runtime({ fontsPending: true });
  view.enter();
  view.flushFrames();
  view.dom.listeners.get('wheel')();
  view.scroller.scrollTop = 100;
  view.finishFonts();
  await Promise.resolve();
  view.flushFrames();
  assert.equal(view.scroller.scrollTop, 100);
});

test('a resize before the scroll debounce captures its latest position does not rewind the user', () => {
  const view = runtime();
  view.enter();
  view.flushFrames();
  view.dom.listeners.get('wheel')();
  view.scroller.scrollTop = 100;
  view.scroller.listeners.get('scroll')();
  view.browser.listeners.get('resize')();
  assert.equal(view.scroller.scrollTop, 100);
});

test('site-wide typography reflow and resize do not rewind a learner who has scrolled', async () => {
  const view = runtime({ typography: true, fontsPending: true });
  view.enter();
  view.flushFrames();
  assert.equal(
    view.created.some((item) => item.tagName === 'select'),
    false,
    'the reader does not create a local font selector',
  );
  view.browser.freeBbsTypography.applyPreferences({ typeScale: 'large' });
  assert.equal(view.browser.freeBbsTypography.getCurrentPreferences().typeScale, 'large');
  view.dom.listeners.get('wheel')();
  view.scroller.scrollTop = 100;
  view.scroller.listeners.get('scroll')();
  view.browser.listeners.get('resize')();
  assert.equal(
    view.scroller.scrollTop,
    100,
    'layout resize captures the current human position instead of restoring an old bookmark',
  );
  view.finishFonts();
  await Promise.resolve();
  view.flushFrames();
  assert.equal(view.scroller.scrollTop, 100);
});

test('the last-visit shortcut retains its destination after a learner scrolls back to the header', () => {
  const view = runtime();
  view.enter();
  view.flushFrames();
  const resumedAtEntry = view.scroller.scrollTop;
  view.scroller.scrollTop = 100;
  view.api.capture();
  view.scroller.scrollTop = 0;
  view.api.capture();
  const resume = view.created.find((item) => item.id === 'learning-reader-resume');
  assert.equal(resume.hidden, false);
  resume.listeners.get('click')();
  assert.equal(view.scroller.scrollTop, resumedAtEntry);
});

function workspaceRuntime() {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.js'), 'utf8');
  const functionSource = source.slice(
    source.indexOf('  function switchTool('),
    source.indexOf('  function requestTool('),
  );
  const frames = [];
  const writes = [];
  const state = {
    tool: 'content',
    positions: { feedback: 250 },
    previousTool: 'content',
    generation: 1,
    ready: true,
    loaded: true,
    uid: 'first-user',
    token: 'first-session',
  };
  const sandbox = {
    state,
    labels,
    app: { userState: { uid: 'first-user', token: 'first-session' } },
    page: { dataset: {}, dispatchEvent() {} },
    root: { querySelectorAll: () => [] },
    document: { querySelectorAll: () => [], querySelector: () => null, getElementById: () => ({}) },
    window: { requestAnimationFrame: (callback) => frames.push(callback) },
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    show() {},
    el: () => ({}),
    refreshPlan() {},
    keepPreference() {},
    loggedIn: () => false,
    scrollPosition: () => 800,
    scrollHost: () => ({ scrollTo: (position) => writes.push(position) }),
  };
  vm.runInNewContext(functionSource, sandbox);
  return { sandbox, state, frames, writes };
}

test('workspace queued tool scroll cannot change a new identity after generation reset', () => {
  const { sandbox, state, frames, writes } = workspaceRuntime();
  sandbox.switchTool('feedback');
  state.generation += 1;
  state.uid = 'another-user';
  state.tool = 'content';
  state.positions = {};
  frames.shift()();
  assert.equal(
    writes.length,
    0,
    'An old tool callback must not scroll the current reader after identity reset',
  );
});

test('workspace current tool callback still restores its own saved position', () => {
  const { sandbox, frames, writes } = workspaceRuntime();
  sandbox.switchTool('feedback');
  frames.shift()();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].top, 250);
});

test('workspace old callback is ignored after a newer tool selection in the same identity', () => {
  const { sandbox, state, frames, writes } = workspaceRuntime();
  sandbox.switchTool('feedback');
  state.tool = 'resources';
  frames.shift()();
  assert.equal(writes.length, 0);
});

test('storage-denied in-memory reading bookmark remains private to its stable user scope', () => {
  const view = runtime({ blockedStorage: true });
  view.enter();
  view.flushFrames();
  view.scroller.scrollTop = 100;
  assert.equal(view.api.capture(), true);
  view.app.userState = { isLoggedIn: true, uid: 'another-reader', token: 'other-session' };
  view.scroller.scrollTop = 0;
  view.browser.listeners.get('freebbs:session-change')();
  view.flushFrames();
  assert.equal(view.scroller.scrollTop, 0);
  view.app.userState = { isLoggedIn: true, uid: 'review-user', token: 'rotated-session' };
  view.browser.listeners.get('freebbs:session-change')();
  view.flushFrames();
  assert.equal(
    view.scroller.scrollTop,
    100,
    'Reading convenience retains one uid across token rotation, unlike unsubmitted answers',
  );
});

function viewNavigation({ resumable = true } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const functionSource = source.slice(
    source.indexOf('  function setKnowledgeView('),
    source.indexOf('  function toggleKnowledgeTag('),
  );
  const actions = [];
  const target = (name) => ({
    classList: { toggle: () => {} },
    focus: (options) => actions.push({ name, action: 'focus', ...options }),
    scrollIntoView: (options) => actions.push({ name, action: 'scroll', ...options }),
  });
  const reading = target('reading');
  const overview = target('overview');
  const sandbox = {
    state: { view: 'overview', node: { id: 'SS-02-01' } },
    page: { dispatchEvent: () => {} },
    CustomEvent,
    document: {
      getElementById: (id) =>
        ({ 'knowledge-reading': reading, 'knowledge-overview': overview })[id],
    },
    saveCurrentLearningNode: () => {},
    window: {
      FreeBbsLearningReader: {
        restore: () => {
          actions.push({ action: 'resume' });
          return resumable;
        },
      },
    },
  };
  vm.runInNewContext(functionSource, sandbox);
  return { sandbox, actions };
}

test('returning from overview resumes the paragraph and focuses reading without scrolling header', () => {
  const { sandbox, actions } = viewNavigation();
  sandbox.setKnowledgeView('reading', { focus: true });
  assert.deepEqual(actions, [
    { action: 'resume' },
    { name: 'reading', action: 'focus', preventScroll: true },
  ]);
});

test('a first-time reader without a matching bookmark still starts at the reading section', () => {
  const { sandbox, actions } = viewNavigation({ resumable: false });
  sandbox.setKnowledgeView('reading', { focus: true });
  assert.deepEqual(actions.at(-1), {
    name: 'reading',
    action: 'scroll',
    behavior: 'smooth',
    block: 'start',
  });
});

test('overview navigation does not apply a hidden reading bookmark', () => {
  const { sandbox, actions } = viewNavigation();
  sandbox.state.view = 'reading';
  sandbox.setKnowledgeView('overview', { focus: true });
  assert.equal(
    actions.some((action) => action.action === 'resume'),
    false,
  );
  assert.equal(actions.at(-1).name, 'overview');
});

test('an unfocused explicit task transition does not override its own destination', () => {
  const { sandbox, actions } = viewNavigation();
  sandbox.setKnowledgeView('reading');
  assert.deepEqual(actions, []);
});
