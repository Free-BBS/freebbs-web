const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  create,
  normalizeNodes,
  normalizeState,
  filterNodes,
  paginate,
} = require('../public/course-catalog');

const nodes = Array.from({ length: 85 }, (_, index) => ({
  id: `SS-${index < 12 ? '01' : '02'}-${String(index + 1).padStart(3, '0')}`,
  title: index === 0 ? '<img src=x onerror=alert(1)> 的完整标题' : `真实知识点 ${index + 1}`,
  aliases: index === 84 ? ['卷积的另一种说法'] : [],
}));
const model = {
  nodes: [{ id: 'SS-01-00', title: '章概览' }, ...nodes],
  chapters: [
    { id: 'SS-01', title: '信号的实际名称与足够长的章节标题，而不是第 X 章' },
    { id: 'SS-02', title: '系统性质与卷积' },
  ],
};

test('catalog normalization keeps real ordinary nodes without duplication, chapter fabrication or mutation', () => {
  const source = JSON.stringify(model);
  assert.equal(
    normalizeNodes([...model.nodes, nodes[0], { id: '<script>', title: 'no' }]).length,
    85,
  );
  assert.equal(JSON.stringify(model), source);
  assert.deepEqual(normalizeNodes(null), []);
});

test('one full-course query overrides a selected chapter, while clearing returns to its actual nodes', () => {
  const selected = { chapterId: 'SS-01', query: '' };
  assert.equal(filterNodes(model.nodes, selected).length, 12);
  const query = '卷积的另一种说法';
  assert.deepEqual(
    filterNodes(model.nodes, { ...selected, query }).map((node) => node.id),
    [nodes[84].id],
  );
  assert.deepEqual(
    filterNodes(model.nodes, {
      ...selected,
      query,
      matches: [nodes[84], nodes[84], { id: 'SS-09-001' }, model.nodes[0]],
    }),
    [nodes[84]],
  );
  assert.equal(filterNodes(model.nodes, selected).length, 12);
  assert.deepEqual(filterNodes(model.nodes, { query: 'does not exist', matches: [] }), []);
  assert.equal(filterNodes(model.nodes, { query: 'ＳＳ－０２－０８５' })[0], nodes[84]);
});

test('every point stays reachable in bounded 40-item pages including empty and malformed states', () => {
  for (const count of [0, 40, 41, 85, 600]) {
    const input = Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));
    const first = paginate(input);
    assert.equal(first.pageSize, 40);
    const seen = [];
    for (let page = 0; page < first.pageCount; page += 1) {
      const result = paginate(input, page);
      assert.ok(result.nodes.length <= 40);
      seen.push(...result.nodes.map((node) => node.id));
    }
    assert.equal(new Set(seen).size, count);
    assert.equal(paginate(input, 9999).page, Math.max(0, Math.ceil(count / 40) - 1));
  }
  for (const value of [-1, '1', NaN, Infinity, 1.5]) assert.equal(paginate(nodes, value).page, 0);
  assert.deepEqual(paginate(null), {
    nodes: [],
    total: 0,
    page: 0,
    pageCount: 0,
    pageSize: 40,
    start: 0,
    end: 0,
  });
});

function fixture({ input = model, lookup, rectangle, frames = false } = {}) {
  const document = { activeElement: null };
  const frameCallbacks = new Map();
  let frameSequence = 0;
  if (frames)
    document.defaultView = {
      requestAnimationFrame(callback) {
        frameSequence += 1;
        frameCallbacks.set(frameSequence, callback);
        return frameSequence;
      },
      cancelAnimationFrame(id) {
        frameCallbacks.delete(id);
      },
    };
  class Element extends EventTarget {
    constructor(tag = 'div') {
      super();
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.disabled = false;
      this.hidden = false;
      this.open = false;
      this.focusCount = 0;
      this.scrollTop = 0;
      this.clientHeight = 0;
      this.revealCount = 0;
    }

    append(...items) {
      this.children.push(...items);
      for (const item of items) item.parent = this;
    }

    replaceChildren() {
      this.children = [];
    }

    setAttribute(key, value) {
      this.attributes.set(key, String(value));
    }

    showModal() {
      this.open = true;
    }

    close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    }

    focus() {
      document.activeElement = this;
      this.focusCount += 1;
    }

    getBoundingClientRect() {
      return rectangle?.(this) || { top: 0, bottom: 0, height: 0, width: 0 };
    }

    scrollIntoView() {
      this.revealCount += 1;
      this.revealed = true;
    }

    click() {
      if (!this.disabled) this.dispatchEvent(new Event('click'));
    }

    remove() {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }
  document.body = new Element('body');
  document.createElement = (tag) => new Element(tag);
  const trigger = new Element('button');
  const selections = [];
  const sourceStates = [];
  let dialog;
  const controller = create({
    document,
    model: input,
    trigger,
    searchNodes: lookup,
    onOpenNode: (node, sourceState) => {
      assert.equal(dialog.open, false, 'The directory closes before the knowledge overview opens');
      selections.push(node);
      sourceStates.push(sourceState);
    },
  });
  [dialog] = document.body.children;
  const find = (className, base = dialog) => {
    if (base.className === className) return base;
    for (const child of base.children) {
      const result = find(className, child);
      if (result) return result;
    }
    return null;
  };
  return {
    controller,
    document,
    dialog,
    trigger,
    selections,
    sourceStates,
    find,
    frameCallbacks,
    flushFrames() {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

test('large directory opens only on request, searches across chapters and clears back without any selection', () => {
  const queries = [];
  const view = fixture({
    lookup: (query) => {
      queries.push(query);
      return [nodes[84]];
    },
  });
  assert.equal(view.dialog.open, false);
  assert.equal(view.controller.open({ chapterId: 'SS-01' }), true);
  const results = view.find('course-catalog-results');
  const search = view.find('course-catalog-search');
  assert.equal(results.children.length, 12);
  assert.equal(view.document.activeElement, search);
  search.value = '别名';
  search.dispatchEvent(new Event('input'));
  assert.deepEqual(queries, ['别名']);
  assert.equal(results.children[0].dataset.catalogNodeId, nodes[84].id);
  assert.match(view.find('course-catalog-status').textContent, /全课程搜索 · 1 个知识点/);
  view.find('course-catalog-clear').click();
  assert.equal(results.children.length, 12);
  assert.match(view.find('course-catalog-status').textContent, /本章 · 12 个知识点/);
  assert.equal(
    view.find('course-catalog-chapters').children[1].children[0].textContent,
    model.chapters[0].title,
  );
  assert.equal(view.selections.length, 0);
  view.find('course-catalog-close').click();
  assert.equal(view.document.activeElement, view.trigger);
});

test('chapter selection clears a query and full titles and identifiers are plain text, not HTML', () => {
  const view = fixture();
  view.controller.open();
  const row = view.find('course-catalog-results').children[0];
  assert.equal(row.children[0].textContent, nodes[0].title);
  assert.equal(row.children[0].tagName, 'STRONG');
  assert.equal(row.children[0].children.length, 0);
  assert.ok(row.children[1].textContent.includes(nodes[0].id));
  const search = view.find('course-catalog-search');
  search.value = 'nothing';
  search.dispatchEvent(new Event('input'));
  assert.match(view.find('course-catalog-results').children[0].textContent, /没有匹配/);
  view.find('course-catalog-chapters').children[1].click();
  assert.equal(search.value, '');
  assert.equal(view.find('course-catalog-results').children.length, 12);
});

test('pagination preserves keyboard direction and node selection closes before callback without stealing new focus', () => {
  const view = fixture();
  view.controller.open();
  const next = view.find('course-catalog-next');
  const previous = view.find('course-catalog-previous');
  next.focus();
  next.click();
  assert.equal(view.document.activeElement, next);
  assert.equal(view.find('course-catalog-page-count').textContent, '2 / 3');
  next.click();
  assert.equal(view.document.activeElement, previous);
  assert.equal(view.find('course-catalog-page-count').textContent, '3 / 3');
  const row = view.find('course-catalog-results').children[0];
  const focusedBefore = view.trigger.focusCount;
  row.click();
  assert.deepEqual(view.selections, [nodes[80]]);
  assert.equal(
    view.trigger.focusCount,
    focusedBefore,
    'Close callback does not steal focus from the new overview',
  );
  assert.equal(view.dialog.open, false);
});

test('cancelled overview can return to the chosen card, page and all scroll containers without restarting the list', () => {
  const view = fixture();
  view.controller.open();
  view.find('course-catalog-next').click();
  const results = view.find('course-catalog-results');
  const chosen = results.children[38].dataset.catalogNodeId;
  const scrolls = [
    [results, 4809, 0],
    [view.find('course-catalog-body'), 250, 0],
    [view.find('course-catalog-chapters'), 117, 0],
    [view.find('course-catalog-main'), 35, 2],
    [view.dialog, 11, 0],
  ];
  for (const [element, top, left] of scrolls) {
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  results.children[38].click();
  for (const [element] of scrolls) {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }
  const before = view.controller.getState();
  view.controller.open({ focusNodeId: chosen, preserveScroll: true });
  assert.equal(view.dialog.open, true);
  assert.equal(view.document.activeElement, results.children[38]);
  assert.equal(view.document.activeElement.dataset.catalogNodeId, chosen);
  assert.deepEqual(view.controller.getState(), { ...before, open: true });
  for (const [element, top, left] of scrolls) {
    assert.equal(element.scrollTop, top);
    assert.equal(element.scrollLeft, left);
  }
  assert.equal(view.selections.length, 1, 'Returning focus does not choose a point again');
  view.dialog.close();
  view.controller.open();
  assert.equal(
    view.document.activeElement,
    view.find('course-catalog-search'),
    'An ordinary opening still starts at search',
  );
});

test('return-focus options cannot resurrect a stale result page or an invalid card', () => {
  const view = fixture();
  view.controller.open();
  const results = view.find('course-catalog-results');
  results.scrollTop = 600;
  results.children[3].click();
  const previousId = nodes[3].id;
  view.controller.restoreState({ chapterId: '', query: nodes[84].id, page: 0, open: false });
  view.controller.open({ focusNodeId: previousId, preserveScroll: true });
  assert.equal(view.document.activeElement, view.find('course-catalog-search'));
  assert.equal(results.scrollTop, 0);
  assert.equal(results.children.length, 1);
  assert.equal(results.children[0].dataset.catalogNodeId, nodes[84].id);
  view.controller.open({ focusNodeId: '<script>', preserveScroll: true });
  assert.equal(view.document.activeElement, view.find('course-catalog-search'));
  assert.doesNotThrow(() => view.controller.open(null));
  assert.equal(view.selections.length, 1);
});

test('returning after responsive reflow reveals an offscreen card without discarding a visible same-size position', () => {
  let reflow = false;
  const chosen = nodes[3].id;
  const box = (top, bottom) => ({ top, bottom, height: bottom - top, width: 300 });
  const view = fixture({
    frames: true,
    rectangle: (element) => {
      if (element.dataset.catalogNodeId === chosen)
        return box(
          reflow && !element.revealed ? 3300 : 150,
          reflow && !element.revealed ? 3438 : 250,
        );
      if (element.className === 'course-catalog-results') return box(100, 400);
      return box(0, 500);
    },
  });
  view.controller.open();
  const results = view.find('course-catalog-results');
  results.clientHeight = 300;
  results.scrollTop = 1390;
  results.children[3].click();
  view.controller.open({ focusNodeId: chosen, preserveScroll: true });
  assert.equal(
    results.scrollTop,
    1390,
    'A still-visible same-size card keeps the exact saved viewport',
  );
  assert.equal(view.document.activeElement.revealCount, 0);
  view.flushFrames();
  assert.equal(view.document.activeElement.revealCount, 0);
  view.dialog.close();
  reflow = true;
  view.controller.open({ focusNodeId: chosen, preserveScroll: true });
  const card = view.document.activeElement;
  assert.equal(card.dataset.catalogNodeId, chosen);
  assert.equal(
    card.revealCount,
    1,
    'The same pixel offset is insufficient after a grid-to-column reflow',
  );
  view.flushFrames();
  assert.equal(
    card.revealCount,
    1,
    'An already-revealed card is not moved again in the deferred frame',
  );
});

test('deferred viewport checks cannot act after new input, a different opening, user gestures or destruction', () => {
  let outside = false;
  const box = (top, bottom) => ({ top, bottom, height: bottom - top, width: 300 });
  const view = fixture({
    frames: true,
    rectangle: (element) => {
      if (element.dataset.catalogNodeId)
        return outside && !element.revealed ? box(1500, 1600) : box(150, 250);
      if (element.className === 'course-catalog-results') return box(100, 400);
      return box(0, 500);
    },
  });
  view.find('course-catalog-results').clientHeight = 300;
  for (const interrupt of ['input', 'different-card', 'pointerdown', 'destroy']) {
    outside = false;
    view.controller.restoreState({ chapterId: '', query: '', page: 0, open: false });
    view.controller.open({ focusNodeId: nodes[2].id, preserveScroll: true });
    const original = view.document.activeElement;
    const revealsBefore = original.revealCount;
    original.revealed = false;
    const deferred = [...view.frameCallbacks.values()][0];
    assert.equal(typeof deferred, 'function');
    outside = true;
    if (interrupt === 'input') {
      const search = view.find('course-catalog-search');
      search.value = 'missing';
      search.dispatchEvent(new Event('input'));
    } else if (interrupt === 'different-card')
      view.controller.open({ focusNodeId: nodes[3].id, preserveScroll: true });
    else if (interrupt === 'pointerdown') view.dialog.dispatchEvent(new Event('pointerdown'));
    else view.controller.destroy();
    deferred();
    assert.equal(
      original.revealCount,
      revealsBefore,
      `A late frame must not override ${interrupt}`,
    );
    view.flushFrames();
    if (interrupt === 'destroy') assert.equal(view.frameCallbacks.size, 0);
  }
});

test('empty, unsupported and destroyed directories remain safe without inventing course content', () => {
  const view = fixture({ input: {} });
  view.controller.open();
  assert.match(view.find('course-catalog-results').children[0].textContent, /尚未发布/);
  assert.equal(view.find('course-catalog-page-count').textContent, '0 / 0');
  view.controller.destroy();
  view.controller.destroy();
  assert.equal(view.controller.open(), false);
  assert.equal(view.document.body.children.length, 0);
  assert.equal(create({}).open(), false);
  assert.equal(
    create({ document: { body: { append() {} }, createElement: () => ({}) } }).open(),
    false,
  );
  const source = fs.readFileSync(path.join(__dirname, '../public/course-catalog.js'), 'utf8');
  assert.doesNotMatch(
    source,
    /innerHTML|localStorage|sessionStorage|fetch\(|callApi|knowledge:ask/,
  );
});

test('a failed injected search still permits local name, identifier and alias matching', () => {
  const view = fixture({
    lookup: () => {
      throw new Error('injected search is unavailable');
    },
  });
  view.controller.open({ chapterId: 'SS-01' });
  const search = view.find('course-catalog-search');
  search.value = '卷积的另一种说法';
  search.dispatchEvent(new Event('input'));
  assert.equal(view.find('course-catalog-results').children[0].dataset.catalogNodeId, nodes[84].id);
});

test('catalog captures its own open chapter/query/page before selecting and restores without reopening an overview', () => {
  const view = fixture({ lookup: () => nodes });
  view.controller.open({ chapterId: 'SS-01' });
  const search = view.find('course-catalog-search');
  search.value = '任意查询';
  search.dispatchEvent(new Event('input'));
  view.find('course-catalog-next').click();
  view.find('course-catalog-next').click();
  const before = view.controller.getState();
  assert.deepEqual(before, { chapterId: 'SS-01', query: '任意查询', page: 2, open: true });
  view.find('course-catalog-results').children[0].click();
  assert.deepEqual(view.sourceStates, [before]);
  assert.equal(view.controller.getState().open, false);
  const restored = fixture({ lookup: () => nodes });
  assert.equal(restored.controller.restoreState(before), true);
  assert.equal(restored.dialog.open, false, 'Restoring state alone is not a new modal prompt');
  assert.equal(restored.selections.length, 0);
  assert.deepEqual(restored.controller.getState(), { ...before, open: false });
  assert.equal(restored.controller.restoreState(before, { reopen: true }), true);
  assert.deepEqual(restored.controller.getState(), before);
  assert.equal(
    restored.find('course-catalog-results').children[0].dataset.catalogNodeId,
    nodes[80].id,
  );
  assert.equal(restored.selections.length, 0, 'No point is silently chosen on return');
});

test('repeated directory openings preserve the active search even when a caller passes a browsing chapter again', () => {
  const view = fixture({ lookup: () => nodes });
  view.controller.open({ chapterId: 'SS-01' });
  const search = view.find('course-catalog-search');
  search.value = '保留我的搜索';
  search.dispatchEvent(new Event('input'));
  view.find('course-catalog-next').click();
  view.find('course-catalog-close').click();
  view.controller.open({ chapterId: 'SS-02' });
  assert.deepEqual(view.controller.getState(), {
    chapterId: 'SS-01',
    query: '保留我的搜索',
    page: 1,
    open: true,
  });
  const snapshot = view.controller.getState();
  snapshot.query = 'caller cannot mutate live state';
  assert.equal(view.controller.getState().query, '保留我的搜索');
});

test('restored directory state is bounded, rejects hostile shapes and does not invent a removed chapter', () => {
  const good = { chapterId: 'SS-01', query: '  %2F%2Fevil.example 中文 😀  ', page: 1, open: true };
  assert.deepEqual(normalizeState(good), good);
  assert.deepEqual(normalizeState({ query: '😀'.repeat(200) }).query, '😀'.repeat(200));
  for (const value of [
    null,
    [],
    'state',
    { query: '中'.repeat(201) },
    { query: 'line\nline' },
    { chapterId: 'ss-01' },
    { chapterId: 'SS-01-02' },
    { chapterId: '<script>' },
    { page: '1' },
    { page: -1 },
    { page: 1.5 },
    { page: 10001 },
    { open: '1' },
    { open: 1 },
  ])
    assert.equal(normalizeState(value), null, JSON.stringify(value));
  const view = fixture();
  assert.equal(
    view.controller.restoreState({ chapterId: 'SS-99', query: '', page: 10000, open: false }),
    true,
  );
  assert.deepEqual(view.controller.getState(), { chapterId: '', query: '', page: 2, open: false });
  const before = view.controller.getState();
  assert.equal(view.controller.restoreState({ query: '\u0000' }, { reopen: true }), false);
  assert.deepEqual(view.controller.getState(), before);
  assert.equal(
    create({ document: { body: { append() {} }, createElement: () => null } }).getState().open,
    false,
  );
});

test('catalog responsive CSS keeps natural card rows, collapsible chapters and a nontrivial result viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/course-catalog.css'), 'utf8');
  assert.match(css, /\.course-catalog-results\s*\{[^}]*grid-auto-rows:\s*max-content/);
  assert.match(css, /@media \(max-width: 700px\), \(max-height: 700px\)/);
  assert.match(css, /min-height:\s*clamp\(140px, 25dvh, 220px\)/);
  assert.match(css, /flex:\s*1 0 max\(320px, 16rem\)/);
  assert.match(css, /\.course-catalog-chapter-picker > summary/);
  assert.doesNotMatch(css, /\.course-catalog-search\s*\{[^}]*display:\s*none/);
});
