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
  const layoutHandlers = new Map();
  let renders = 0;
  class Target {
    constructor(selectors = []) {
      this.selectors = selectors;
    }

    closest(selector) {
      return this.selectors.includes(selector) ? this : null;
    }

    matches(selector) {
      return this.selectors.includes(selector);
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
      getElementById: (id) =>
        id === 'course-layout-toggle'
          ? { addEventListener: (name, handler) => layoutHandlers.set(name, handler) }
          : null,
      addEventListener: (name, handler) => documentHandlers.set(name, handler),
    },
    window: { addEventListener() {} },
    scroller: null,
    hideReaderEdgeTooltip() {},
    chapterIdForNodeId: (id) =>
      String(id || '')
        .split('-')
        .slice(0, 2)
        .join('-'),
    courseChapters: () => [{ id: 'SS-01' }, { id: 'SS-02' }, { id: 'SS-07' }],
    renderMap: () => {
      renders += 1;
    },
  });
  return {
    Target,
    state,
    canvasHandlers,
    documentHandlers,
    layoutHandlers,
    renders: () => renders,
  };
}

test('switching from structure to directory keeps its actual selected chapter and drops only another chapter filter', () => {
  const h = createHarness();
  h.state.activeChapterId = 'SS-01';
  h.state.learningNodeId = 'SS-02-01';
  h.state.directoryQuery = '旧章搜索';
  h.state.directoryPage = 3;
  h.state.structureController = { getState: () => ({ selectedChapterId: 'SS-07' }) };
  const button = {};
  h.layoutHandlers.get('click')({ currentTarget: button });
  assert.equal(h.state.readerLayout, 'directory');
  assert.equal(h.state.activeChapterId, 'SS-07');
  assert.equal(h.state.directoryQuery, '');
  assert.equal(h.state.directoryPage, 0);
  assert.equal(h.state.learningNodeId, 'SS-02-01', 'Reading history is not a view selection');
  assert.equal(h.renders(), 1);
  assert.equal(button.textContent, '知识图');
});

test('layout switching preserves matching filters and rejects absent or invalid structure chapter state', () => {
  for (const selected of ['SS-07', '', 'SS-99', '<img src=x>', null, undefined]) {
    const h = createHarness();
    h.state.activeChapterId = 'SS-07';
    h.state.directoryQuery = '卷积';
    h.state.directoryPage = 2;
    h.state.structureController =
      selected === undefined ? null : { getState: () => ({ selectedChapterId: selected }) };
    h.layoutHandlers.get('click')({ currentTarget: {} });
    assert.equal(h.state.activeChapterId, 'SS-07');
    assert.equal(h.state.directoryQuery, '卷积');
    assert.equal(h.state.directoryPage, 2);
  }
  for (const emptyState of [null, undefined]) {
    const h = createHarness();
    h.state.activeChapterId = 'SS-07';
    h.state.structureController = { getState: () => emptyState };
    h.layoutHandlers.get('click')({ currentTarget: {} });
    assert.equal(h.state.activeChapterId, 'SS-07');
  }
  const h = createHarness('directory');
  h.state.activeChapterId = 'SS-07';
  h.state.structureController = { getState: () => ({ selectedChapterId: 'SS-01' }) };
  h.layoutHandlers.get('click')({ currentTarget: {} });
  assert.equal(h.state.readerLayout, 'structure');
  assert.equal(
    h.state.activeChapterId,
    'SS-07',
    'Directory is the active owner when entering structure',
  );
});

test('production structure re-render restores only a real active chapter and never overrides explicit focus or resume evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-map.js'), 'utf8');
  const start = source.indexOf('  function renderReaderMap() {');
  const end = source.indexOf('    const viewModel = readerViewModel();', start);
  assert.ok(start >= 0 && end > start);
  for (const activeChapterId of ['SS-07', '', 'SS-99', '<img src=x>']) {
    for (const focusedNodeId of ['', 'SS-02-01']) {
      const calls = [];
      const state = {
        readerLayout: 'structure',
        activeChapterId,
        focusedNodeId,
        learningNodeId: 'SS-02-02',
        nodes: [],
        edges: [],
        course: {},
      };
      const before = state.learningNodeId;
      vm.runInNewContext(`${source.slice(start, end)}\n}\nrenderReaderMap();`, {
        state,
        canvas: { classList: { remove() {} }, style: {}, replaceChildren() {} },
        scroller: null,
        window: {
          FreeBbsCourseStructure: {
            render: () => ({
              focusNode: (id) => calls.push(['focus', id]),
              selectChapter: (id) => calls.push(['chapter', id]),
            }),
          },
        },
        renderReaderHeader() {},
        courseChapters: () => [{ id: 'SS-01' }, { id: 'SS-02' }, { id: 'SS-07' }],
      });
      assert.deepEqual(
        calls,
        focusedNodeId
          ? [['focus', focusedNodeId]]
          : activeChapterId === 'SS-07'
            ? [['chapter', 'SS-07']]
            : [],
      );
      assert.equal(state.learningNodeId, before);
    }
  }
});

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

test('directory search preserves IME composition and resets only pagination on committed input', () => {
  const h = createHarness('directory');
  const target = new h.Target(['[data-course-directory-search]']);
  target.value = '卷积';
  h.state.directoryPage = 3;
  h.canvasHandlers.get('input')({ target, isComposing: true });
  assert.equal(h.renders(), 0);
  assert.equal(h.state.directoryPage, 3);
  h.canvasHandlers.get('compositionend')({ target });
  assert.equal(h.state.directoryQuery, '卷积');
  assert.equal(h.state.directoryPage, 0);
  assert.equal(h.state.focusedNodeId, 'SS-02-01');
  assert.equal(h.renders(), 1);
  h.canvasHandlers.get('click')({ target });
  assert.equal(h.state.focusedNodeId, 'SS-02-01');
  assert.equal(h.renders(), 1);
});

test('directory pagination never activates disabled buttons or restores legacy focus', () => {
  const h = createHarness('directory');
  const target = new h.Target(['[data-directory-page]']);
  target.dataset = { directoryPage: '2' };
  target.disabled = true;
  h.canvasHandlers.get('click')({ target });
  assert.equal(h.renders(), 0);
  target.disabled = false;
  h.canvasHandlers.get('click')({ target });
  assert.equal(h.state.directoryPage, 2);
  assert.equal(h.state.focusedNodeId, 'SS-02-01');
  assert.equal(h.renders(), 1);
});
