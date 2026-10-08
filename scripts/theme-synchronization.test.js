const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', 'public');
const themeKey = 'free_bbs_theme_mode';
const origin = 'https://freebbs.example';

function button() {
  const classes = new Set();
  return {
    attributes: {},
    innerHTML: '',
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function harness({ mode, failReads = false, failWrites = false, parent } = {}) {
  const storage = new Map(mode ? [[themeKey, mode]] : []);
  const writes = [];
  const events = new Map();
  const frames = [];
  const controls = [button()];
  const document = {
    body: button(),
    documentElement: { dataset: {}, style: { setProperty() {} } },
    querySelectorAll(selector) {
      if (selector === 'iframe') return frames;
      if (selector === '[data-theme-toggle]') return controls;
      return [];
    },
  };
  const localStorage = {
    getItem(key) {
      if (failReads) throw new Error('SecurityError');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error('QuotaExceededError');
      writes.push({ key, value });
      storage.set(key, value);
    },
  };
  const window = {
    localStorage,
    location: { origin },
    parent,
    setTimeout(callback) {
      callback();
    },
    addEventListener(type, listener) {
      events.set(type, listener);
    },
  };
  window.parent ||= window;
  const context = vm.createContext({ document, window, localStorage });
  vm.runInContext(fs.readFileSync(path.join(publicDir, 'typography.js'), 'utf8'), context);
  return {
    context,
    window,
    document,
    controls,
    frames,
    writes,
    storage,
    theme: window.freeBbsTheme,
    dispatch(type, event) {
      events.get(type)(event);
    },
  };
}

function peer() {
  const messages = [];
  return {
    messages,
    postMessage(data, targetOrigin) {
      messages.push({ data, targetOrigin });
    },
  };
}

test('shared startup restores a theme and renders matching controls without storage writes', () => {
  const h = harness({ mode: 'light' });
  assert.equal(h.theme.getCurrentMode(), 'light');
  assert.equal(h.document.body.classList.contains('theme-light'), true);
  assert.equal(h.document.body.classList.contains('theme-dark'), false);
  assert.equal(h.controls[0].attributes['aria-pressed'], 'true');
  assert.equal(h.controls[0].attributes['aria-label'], '切换到暗色模式');
  assert.match(h.controls[0].innerHTML, /moon\.svg/);
  assert.equal(h.writes.length, 0);
});

for (const [file, boundary] of [
  ['auth.js', 'function initializeThemeMode('],
  ['app.js', 'function getStoredTypographyPreferences('],
]) {
  test(`${file} theme switching remains usable when storage reads and writes are blocked`, () => {
    const h = harness({ failReads: true, failWrites: true });
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    const start = source.indexOf('function getStoredThemeMode(');
    const end = source.indexOf(boundary, start);
    vm.runInContext(source.slice(start, end), h.context);
    assert.equal(h.context.getStoredThemeMode(), 'dark');
    h.context.toggleThemeMode({ currentTarget: h.controls[0] });
    assert.equal(h.theme.getCurrentMode(), 'light');
    assert.equal(h.theme.getStoredMode(), 'light');
    assert.equal(h.document.body.classList.contains('theme-light'), true);
    assert.equal(h.controls[0].attributes['aria-pressed'], 'true');
    assert.equal(h.theme.saveMode('light'), false);
    assert.equal(h.writes.length, 0);
  });
}

test('cross-tab changes, removal and storage clearing refresh theme and controls without echo writes', () => {
  const h = harness();
  const changes = [];
  const unsubscribe = h.theme.subscribe((mode) => changes.push(mode));
  h.dispatch('storage', { key: themeKey, newValue: 'light' });
  assert.equal(h.document.body.classList.contains('theme-light'), true);
  assert.equal(h.controls[0].attributes['aria-label'], '切换到暗色模式');
  h.dispatch('storage', { key: 'unrelated', newValue: 'dark' });
  assert.equal(h.theme.getCurrentMode(), 'light');
  h.dispatch('storage', { key: themeKey, newValue: null });
  assert.equal(h.theme.getCurrentMode(), 'dark');
  h.theme.applyMode('light');
  h.dispatch('storage', { key: null });
  assert.equal(h.theme.getCurrentMode(), 'dark');
  assert.deepEqual(changes, ['light', 'dark', 'light', 'dark']);
  unsubscribe();
  h.theme.applyMode('light');
  assert.equal(changes.length, 4);
  assert.equal(h.writes.length, 0);
});

test('same-origin embedded pages request and follow their parent theme even with blocked storage', () => {
  const parent = peer();
  const child = peer();
  const h = harness({ parent, failReads: true, failWrites: true });
  h.frames.push({ contentWindow: child });
  assert.equal(parent.messages[0].data.type, 'freebbs:theme-request');
  assert.equal(parent.messages[0].targetOrigin, origin);
  h.dispatch('message', {
    origin,
    source: parent,
    data: { type: 'freebbs:theme-sync', mode: 'light' },
  });
  assert.equal(h.theme.getCurrentMode(), 'light');
  assert.equal(parent.messages.length, 1, 'do not echo a received theme back to its sender');
  assert.equal(child.messages.length, 1, 'relay a parent change to nested pages');
  assert.equal(child.messages[0].data.mode, 'light');
  h.dispatch('message', { origin, source: child, data: { type: 'freebbs:theme-request' } });
  assert.equal(child.messages.at(-1).data.mode, 'light');
  assert.equal(h.writes.length, 0);
});

test('embedded startup uses the visible parent preference before the first message arrives', () => {
  const parent = peer();
  const parentBody = button();
  parentBody.classList.add('theme-light');
  parent.document = { body: parentBody };
  const h = harness({ parent, failReads: true, failWrites: true });
  assert.equal(h.document.body.classList.contains('theme-light'), true);
  assert.equal(h.theme.getCurrentMode(), 'light');
  assert.equal(h.writes.length, 0);
  assert.equal(parent.messages[0].data.type, 'freebbs:theme-request');
});

test('parent changes relay to sibling frames and ignore unrelated or untrusted messages', () => {
  const h = harness();
  const first = peer();
  const second = peer();
  h.frames.push({ contentWindow: first }, { contentWindow: second });
  const sync = { type: 'freebbs:theme-sync', mode: 'light' };
  for (const event of [
    { origin: 'https://other.example', source: first, data: sync },
    { origin, source: peer(), data: sync },
    { origin, source: first, data: { ...sync, mode: 'system' } },
    { origin, source: first, data: { type: 'freebbs:circuit-theme', theme: 'light' } },
  ])
    h.dispatch('message', event);
  assert.equal(h.theme.getCurrentMode(), 'dark');
  h.dispatch('message', { origin, source: first, data: sync });
  assert.equal(h.theme.getCurrentMode(), 'light');
  assert.equal(first.messages.length, 0);
  assert.equal(second.messages.length, 1);
  h.dispatch('message', { origin, source: first, data: sync });
  assert.equal(second.messages.length, 1, 'repeated synchronization must not cause a message loop');
  assert.equal(h.writes.length, 0);
});
