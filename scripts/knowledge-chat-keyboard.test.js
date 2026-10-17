const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');

function fixture(width = 390) {
  let narrowWidth = width;
  let overlay = null;
  let shown = true;
  let sends = 0;
  const revealed = [];
  const closes = [];
  const listeners = new Map();
  const document = { activeElement: null };
  const control = (id, options = {}) => ({
    id,
    tabIndex: options.tabIndex ?? 0,
    visibility: options.visibility || 'visible',
    insidePanel: Boolean(options.insidePanel),
    getClientRects: () => (options.noRects ? [] : [{}]),
    matches: () => Boolean(options.disabled),
    closest: () => (options.inert ? {} : null),
    focus() {
      document.activeElement = this;
    },
    addEventListener() {},
  });
  const controls = [control('close'), control('tab'), control('input'), control('send')];
  const toggle = control('toggle');
  const panel = {
    getClientRects: () => (shown ? [{}] : []),
    querySelectorAll: () => controls,
    contains: (element) => controls.includes(element) || element?.insidePanel === true,
  };
  const state = { chatOpen: true };
  Object.assign(document, {
    getElementById: (id) =>
      ({
        'knowledge-chat-panel': panel,
        'knowledge-chat-toggle': toggle,
        'knowledge-chat-close': controls[0],
        'knowledge-chat-input': controls[2],
      })[id] || null,
    querySelector: () => overlay,
    querySelectorAll: () => [],
    addEventListener: (type, callback) => listeners.set(type, callback),
  });
  const sandbox = {
    state,
    document,
    window: {
      matchMedia: () => ({ matches: narrowWidth <= 920 }),
      getComputedStyle: (element) => ({ visibility: element.visibility }),
      addEventListener() {},
    },
    revealNarrowChatControl: (element) => revealed.push(element.id),
    setChatOpen: (open) => {
      state.chatOpen = open;
      closes.push(open);
    },
    submitChatPrompt: () => {
      sends += 1;
    },
    persistChatDraft: () => true,
  };
  const first = source.indexOf('  function confineNarrowChatFocus(');
  const last = source.indexOf('  function renderKnowledgeOrigin(', first);
  assert.ok(first >= 0 && last > first);
  vm.runInNewContext(source.slice(first, last), sandbox);
  sandbox.bindChatControls();
  const event = (options = {}) => ({
    key: 'Tab',
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...options,
  });
  return {
    controls,
    control,
    toggle,
    state,
    document,
    revealed,
    closes,
    sends: () => sends,
    resize: (next) => {
      narrowWidth = next;
    },
    overlay: (value) => {
      overlay = value;
    },
    shown: (value) => {
      shown = value;
    },
    confine(options) {
      const key = event(options);
      return { result: sandbox.confineNarrowChatFocus(key), event: key };
    },
    keydown(options) {
      const key = event(options);
      listeners.get('keydown')(key);
      return key;
    },
  };
}

test('the viewport drawer wraps only keyboard endpoints and repairs an underlay focus without sending', () => {
  for (const width of [320, 390, 920]) {
    const qa = fixture(width);
    qa.document.activeElement = qa.controls.at(-1);
    assert.equal(qa.confine().result, true);
    assert.equal(qa.document.activeElement.id, 'close');
    assert.equal(qa.confine({ shiftKey: true }).result, true);
    assert.equal(qa.document.activeElement.id, 'send');
    qa.document.activeElement = qa.controls.at(1);
    assert.equal(qa.confine().result, false, 'ordinary inner Tab stays native');
    qa.document.activeElement = qa.control('underlay');
    assert.equal(qa.confine().result, true);
    assert.equal(qa.document.activeElement.id, 'close');
    qa.document.activeElement = qa.control('underlay');
    assert.equal(qa.confine({ shiftKey: true }).result, true);
    assert.equal(qa.document.activeElement.id, 'send');
    assert.deepEqual(qa.revealed, ['close', 'send', 'close', 'send']);
    assert.equal(qa.sends(), 0);
  }
});

test('focusables are recomputed from actual shown, enabled and keyboard-reachable panel controls', () => {
  const qa = fixture();
  for (const options of [
    { tabIndex: -1 },
    { disabled: true },
    { noRects: true },
    { inert: true },
    { visibility: 'hidden' },
    { visibility: 'collapse' },
  ])
    qa.controls.push(qa.control('excluded', options));
  qa.document.activeElement = qa.controls.at(3);
  assert.equal(qa.confine().result, true);
  assert.equal(qa.document.activeElement.id, 'close');
  const dynamic = qa.control('new-discussion-control');
  qa.controls.push(dynamic);
  qa.document.activeElement = qa.controls.at(3);
  assert.equal(qa.confine().result, false, 'new discussion controls remain in native order');
  qa.document.activeElement = dynamic;
  assert.equal(qa.confine().result, true);
  assert.equal(qa.document.activeElement.id, 'close');
  qa.controls.length = 0;
  assert.equal(qa.confine().result, false);
});

test('a native scroll-container Tab stop already inside the drawer is never mistaken for the underlay', () => {
  const qa = fixture();
  qa.document.activeElement = qa.control('implicit-native-scroll-stop', {
    tabIndex: -1,
    insidePanel: true,
  });
  assert.equal(qa.confine().result, false);
  assert.equal(qa.confine({ shiftKey: true }).result, false);
  assert.equal(qa.document.activeElement.id, 'implicit-native-scroll-stop');
  assert.deepEqual(qa.revealed, []);
  assert.equal(qa.sends(), 0);
});

test('desktop, resize, closed drawers and hidden markup never acquire a keyboard trap', () => {
  for (const width of [921, 1440]) {
    const qa = fixture(width);
    qa.document.activeElement = qa.controls.at(-1);
    assert.equal(qa.confine().result, false);
    assert.equal(qa.document.activeElement.id, 'send');
    qa.resize(390);
    assert.equal(qa.confine().result, true);
    qa.resize(1440);
    assert.equal(qa.confine({ shiftKey: true }).result, false);
  }
  const qa = fixture();
  qa.state.chatOpen = false;
  assert.equal(qa.confine().result, false);
  qa.state.chatOpen = true;
  qa.shown(false);
  assert.equal(qa.confine().result, false);
});

test('IME, consumed keys, platform shortcuts and a nested modal or annotation retain keyboard ownership', () => {
  const qa = fixture();
  qa.document.activeElement = qa.controls.at(-1);
  for (const options of [
    { isComposing: true },
    { defaultPrevented: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { key: 'Enter' },
  ])
    assert.equal(qa.confine(options).result, false);
  qa.overlay({ type: 'native dialog or annotation layer' });
  assert.equal(qa.confine().result, false);
  qa.keydown({ key: 'Escape' });
  assert.deepEqual(qa.closes, []);
  qa.overlay(null);
  qa.keydown({ key: 'Escape', isComposing: true });
  qa.keydown({ key: 'Escape', defaultPrevented: true });
  assert.deepEqual(qa.closes, []);
  assert.equal(qa.sends(), 0);
});

test('Escape still closes the companion and returns its toggle on phone and desktop', () => {
  for (const width of [390, 1440]) {
    const qa = fixture(width);
    qa.document.activeElement = qa.controls.at(2);
    qa.keydown({ key: 'Escape' });
    assert.equal(qa.state.chatOpen, false);
    assert.equal(qa.document.activeElement, qa.toggle);
    assert.deepEqual(qa.closes, [false]);
    assert.equal(qa.sends(), 0);
  }
});
