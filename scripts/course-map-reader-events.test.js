const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness(layout = 'structure') {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-map.js'), 'utf8');
  const start = source.indexOf('  function bindReaderViewport() {');
  const end = source.indexOf('\n  let progressScope =', start);
  assert.ok(start >= 0 && end > start);
  const canvasHandlers = new Map();
  const documentHandlers = new Map();
  let renders = 0;
  class Target {
    constructor(selectors = []) {
      this.selectors = selectors;
    }

    closest(selector) {
      return this.selectors.includes(selector) ? this : null;
    }
  }
  const state = {
    focusedNodeId: 'SS-02-01',
    readerLayout: layout,
    activeChapterId: '',
    manuallyCollapsedChapters: new Set(),
    manualExpandedChapters: new Set(),
  };
  vm.runInNewContext(`${source.slice(start, end)}\nbindReaderViewport();`, {
    Element: Target,
    state,
    mapPage: {},
    overviewDrawer: null,
    canvas: {
      addEventListener: (name, handler) => canvasHandlers.set(name, handler),
      querySelector: () => null,
    },
    document: {
      getElementById: () => null,
      addEventListener: (name, handler) => documentHandlers.set(name, handler),
    },
    window: { addEventListener() {} },
    scroller: null,
    hideReaderEdgeTooltip() {},
    chapterIdForNodeId: () => 'SS-02',
    renderMap: () => {
      renders += 1;
    },
  });
  return { Target, state, canvasHandlers, documentHandlers, renders: () => renders };
}

test('structure summary, form, text and graph clicks do not trigger legacy blank exit', () => {
  const h = createHarness();
  for (const kind of ['summary', 'select', 'text', 'svg', 'drag-release']) {
    const target = new h.Target(['.course-structure']);
    target.kind = kind;
    h.canvasHandlers.get('click')({ target });
    assert.equal(h.state.focusedNodeId, 'SS-02-01', kind);
    assert.equal(h.renders(), 0, kind);
  }
});

test('structure navigation keeps its explicit return control instead of global Escape reset', () => {
  const h = createHarness();
  h.documentHandlers.get('keydown')({ key: 'Escape', target: new h.Target() });
  assert.equal(h.state.focusedNodeId, 'SS-02-01');
  assert.equal(h.renders(), 0);
});

test('legacy directory blank click and Escape still restore the focused chapter', () => {
  for (const event of ['click', 'keydown']) {
    const h = createHarness('directory');
    const handlers = event === 'click' ? h.canvasHandlers : h.documentHandlers;
    handlers.get(event)({ target: new h.Target(), key: 'Escape' });
    assert.equal(h.state.focusedNodeId, '');
    assert.equal(h.state.activeChapterId, 'SS-02');
    assert.equal(h.state.manualExpandedChapters.has('SS-02'), true);
    assert.equal(h.renders(), 1);
  }
});

test('Escape in a field, dialog or already handled event does not discard directory focus', () => {
  for (const selectors of [['input, textarea, select, [contenteditable], dialog[open]'], []]) {
    const h = createHarness('directory');
    h.documentHandlers.get('keydown')({
      key: 'Escape',
      target: new h.Target(selectors),
      defaultPrevented: selectors.length === 0,
    });
    assert.equal(h.state.focusedNodeId, 'SS-02-01');
    assert.equal(h.renders(), 0);
  }
});
