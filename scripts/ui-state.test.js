const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const uiState = require('../public/ui-state');

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.events = {};
    this.textContent = '';
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(key, callback) {
    this.events[key] = callback;
  }
}

const doc = { createElement: (tag) => new Element(tag, doc) };
const make = (tag = 'div') => doc.createElement(tag);

for (const kind of ['loading', 'empty', 'error']) {
  test(`${kind} uses shared busy and message semantics without changing the container role`, () => {
    const list = make('ul');
    list.setAttribute('role', 'list');
    const node = uiState.render(list, { kind, tag: 'li', message: '提示' });
    assert.equal(list.dataset.uiState, kind);
    assert.equal(list.attributes['aria-busy'], String(kind === 'loading'));
    assert.equal(list.attributes.role, 'list');
    assert.equal(node.attributes.role, kind === 'error' ? 'alert' : 'status');
    assert.equal(node.tagName, 'LI');
    assert.equal(node.children[0].textContent, '提示');
  });
}

test('ready releases busy state without replacing the real data', () => {
  const list = make();
  const child = make();
  list.append(child);
  uiState.set(list, 'loading');
  uiState.set(list, 'ready');
  assert.equal(list.dataset.uiState, 'ready');
  assert.equal(list.attributes['aria-busy'], 'false');
  assert.deepEqual(list.children, [child]);
  assert.throws(() => uiState.render(list, { kind: 'ready' }), /Use set/);
});

test('legacy global text rules leave shared state messages under their semantic color contract', () => {
  for (const file of ['public/styles.css', 'public/ui-polish.css']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /:not\(\s*:where\(\.ui-state, \.ui-state \*\)\s*\)/);
  }
});

test('labels and message content remain literal text, never injected HTML', () => {
  const text = '<img src=x onerror=alert(1)>';
  const node = uiState.create(doc, {
    kind: 'error',
    title: text,
    message: text,
    action: { label: text, key: 'retry' },
  });
  assert.equal(node.children[0].textContent, text);
  assert.equal(node.children[1].textContent, text);
  assert.equal(node.children[2].textContent, text);
  assert.equal(node.children[2].dataset.action, 'retry');
  assert.equal(node.children[2].dataset.actionTone, 'secondary');
});

test('a custom workbench card keeps its geometry and delegated retry action', () => {
  const list = make('ul');
  const card = make('li');
  card.className = 'workbench-state-item';
  const retry = make('button');
  retry.dataset.workbenchAction = 'retry';
  card.append(retry);
  uiState.render(list, { kind: 'error', content: card });
  assert.equal(card.className, 'workbench-state-item');
  assert.equal(card.attributes.role, 'alert');
  assert.equal(card.children[0].dataset.workbenchAction, 'retry');
});

test('actions are explicit and never retried automatically', () => {
  let calls = 0;
  const node = uiState.create(doc, {
    kind: 'error',
    action: {
      label: '重试',
      onClick: () => {
        calls += 1;
      },
    },
  });
  assert.equal(calls, 0);
  const button = node.children[0];
  assert.equal(button.attributes.type, 'button');
  button.events.click();
  assert.equal(calls, 1);
});

test('local navigation is preserved while unsafe state-action URLs are rejected', () => {
  const node = uiState.create(doc, {
    kind: 'empty',
    action: { label: '前往讨论区', href: '/discussion?board=math' },
  });
  assert.equal(node.children[0].tagName, 'A');
  assert.equal(node.children[0].attributes.href, '/discussion?board=math');
  for (const href of ['https://example.com', '//example.com', '/\\example.com', '/\nexample.com'])
    assert.throws(
      () => uiState.create(doc, { kind: 'error', action: { label: '打开', href } }),
      /local URL/,
    );
});

test('unknown kinds and tags cannot silently masquerade as a loaded empty state', () => {
  assert.throws(() => uiState.set(make(), 'failure'), /Unknown UI state/);
  assert.throws(() => uiState.create(doc, { kind: 'success' }), /Invalid message state/);
  assert.throws(
    () => uiState.create(doc, { kind: 'empty', tag: 'script' }),
    /Invalid state element/,
  );
  assert.equal(uiState.render(null, { kind: 'loading' }), null);
});

test('browser entry exports the same presentation API without storage or fetch dependencies', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('public/ui-state.js', 'utf8'), context);
  assert.deepEqual(Object.keys(context.window.freeBbsUiState), ['set', 'create', 'render']);
  assert.ok(Object.isFrozen(context.window.freeBbsUiState));
});

test('a missing presentation asset still allows native state messages and explicit retries', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  const fallback = source.slice(
    source.indexOf('function installUiStateFallback()'),
    source.indexOf('const DEFAULT_AVATAR'),
  );
  const context = { window: {} };
  vm.runInNewContext(fallback, context);
  const list = make('ol');
  const node = context.window.freeBbsUiState.render(list, {
    kind: 'error',
    message: '加载失败',
    action: { label: '重试', key: 'retry-home-heat' },
  });
  assert.equal(context.window.freeBbsUiState.degraded, true);
  assert.equal(node.tagName, 'LI');
  assert.equal(node.attributes.role, 'alert');
  assert.equal(node.children[0].dataset.action, 'retry-home-heat');
  assert.equal(list.attributes['aria-busy'], 'false');
  const actual = { set() {}, render() {} };
  const normalContext = { window: { freeBbsUiState: actual } };
  vm.runInNewContext(fallback, normalContext);
  assert.equal(normalContext.window.freeBbsUiState, actual);
});
