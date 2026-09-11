const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createController } = require('../public/knowledge-history');

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    hidden: false,
    attributes: {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    emit(name, event = {}) {
      listeners.get(name)?.(event);
    },
    focus(options) {
      this.focusOptions = options;
    },
  };
}

function harness({ storage = new Map(), course = 'circuits', point = 'A1', uid = 'student' } = {}) {
  const elements = new Map(
    ['', '-content', '-toggle', '-toggle-label'].map((suffix) => [
      `knowledge-history${suffix}`,
      element(),
    ]),
  );
  const page = element();
  const writes = [];
  const owner = { uid };
  const controller = createController({
    page,
    document: { getElementById: (id) => elements.get(id) },
    storage: {
      getItem: (key) => storage.get(key),
      setItem(key, value) {
        writes.push([key, value]);
        storage.set(key, value);
      },
    },
    course,
    point,
    owner: () => owner.uid,
  });
  return {
    page,
    controller,
    owner,
    writes,
    box: elements.get('knowledge-history'),
    content: elements.get('knowledge-history-content'),
    toggle: elements.get('knowledge-history-toggle'),
    label: elements.get('knowledge-history-toggle-label'),
  };
}

test('history defaults to expanded without writing to browser storage', () => {
  const fixture = harness();
  assert.equal(fixture.content.hidden, false);
  assert.equal(fixture.toggle.attributes['aria-expanded'], 'true');
  assert.equal(fixture.writes.length, 0);
});

test('minimize and expand keep the same keyboard control and restore across reloads', () => {
  const storage = new Map();
  const fixture = harness({ storage });
  fixture.toggle.emit('click');
  assert.equal(fixture.content.hidden, true);
  assert.equal(fixture.box.classList.contains('is-collapsed'), true);
  assert.equal(fixture.toggle.attributes['aria-expanded'], 'false');
  assert.match(fixture.label.textContent, /展开/);
  const reloaded = harness({ storage });
  assert.equal(reloaded.content.hidden, true);
  reloaded.toggle.emit('click');
  assert.equal(reloaded.content.hidden, false);
  assert.equal(harness({ storage }).content.hidden, false);
});

test('history preference is isolated by course, knowledge point and account', () => {
  const storage = new Map();
  const fixture = harness({ storage });
  fixture.toggle.emit('click');
  assert.equal(harness({ storage }).content.hidden, true);
  assert.equal(harness({ storage, point: 'A2' }).content.hidden, false);
  assert.equal(harness({ storage, course: 'signals' }).content.hidden, false);
  assert.equal(harness({ storage, uid: 'another-student' }).content.hidden, false);
  fixture.owner.uid = '';
  fixture.controller.restore();
  assert.equal(fixture.content.hidden, false);
});

test('invalid stored values fall back to expanded', () => {
  const storage = new Map();
  const fixture = harness({ storage });
  fixture.toggle.emit('click');
  storage.set(fixture.writes[0][0], '{broken');
  assert.equal(harness({ storage }).content.hidden, false);
});

test('blocked storage reads do not prevent opening the shell', () => {
  const fixture = harness({
    storage: {
      get() {
        throw new Error('SecurityError');
      },
    },
  });
  assert.equal(fixture.content.hidden, false);
});

test('quota failure still permits repeated expand and collapse in the current page', () => {
  const fixture = harness({
    storage: {
      get() {},
      set() {
        throw new Error('QuotaExceededError');
      },
    },
  });
  assert.doesNotThrow(() => fixture.toggle.emit('click'));
  assert.equal(fixture.content.hidden, true);
  fixture.toggle.emit('click');
  assert.equal(fixture.content.hidden, false);
});

test('Escape inside the shell minimizes it without also closing the discussion panel', () => {
  const fixture = harness();
  let stopped = false;
  fixture.box.emit('keydown', {
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  assert.equal(fixture.content.hidden, true);
  assert.deepEqual(fixture.toggle.focusOptions, { preventScroll: true });
});

test('selecting another tool hides history without discarding its collapsed state', () => {
  const fixture = harness();
  fixture.toggle.emit('click');
  for (const tool of ['resources', 'feedback', 'continue', 'notes', 'contribute']) {
    fixture.page.emit('knowledge:tool-select', { detail: { tool } });
    assert.equal(fixture.box.hidden, true);
  }
  fixture.page.emit('knowledge:tool-select', { detail: { tool: 'content' } });
  assert.equal(fixture.box.hidden, false);
  assert.equal(fixture.content.hidden, true);
});

test('returning from overview to reading restores visibility', () => {
  const fixture = harness();
  fixture.page.emit('knowledge:view-change', { detail: { view: 'overview' } });
  assert.equal(fixture.box.hidden, true);
  fixture.page.emit('knowledge:view-change', { detail: { view: 'reading' } });
  assert.equal(fixture.box.hidden, false);
});

test('a background document render does not show history over another selected tool', () => {
  const fixture = harness();
  fixture.page.emit('knowledge:tool-select', { detail: { tool: 'resources' } });
  fixture.page.emit('knowledge:view-change', {
    detail: { view: 'reading', activateContent: false },
  });
  assert.equal(fixture.box.hidden, true);
  fixture.page.emit('knowledge:view-change', {
    detail: { view: 'reading', activateContent: true },
  });
  assert.equal(fixture.box.hidden, false);
});

test('history is a purple reading shell, never part of the editable Markdown body', () => {
  const publicDir = path.join(__dirname, '../public');
  const html = fs.readFileSync(path.join(publicDir, 'knowledge.html'), 'utf8');
  const css = fs.readFileSync(path.join(publicDir, 'course.css'), 'utf8');
  const editorCss = fs.readFileSync(path.join(publicDir, 'knowledge-editor.css'), 'utf8');
  assert.match(html, /aria-controls="knowledge-history-content"/);
  assert.match(html, /src="\/knowledge-history.js"/);
  assert.ok(html.indexOf('id="knowledge-reading"') < html.indexOf('id="knowledge-history"'));
  assert.ok(html.indexOf('id="knowledge-history"') < html.indexOf('id="knowledge-body"'));
  assert.match(
    css,
    /\.knowledge-history\s*\{[^}]*--history-surface: #f2edfc;[^}]*position: sticky;/,
  );
  assert.match(css, /\.knowledge-history\s*\{[^}]*width: 100%;/);
  assert.match(css, /body.theme-dark \.knowledge-history\s*\{[^}]*--history-surface:/);
  assert.match(editorCss, /\.course-material-reader\.is-editing #knowledge-reading/);
});
