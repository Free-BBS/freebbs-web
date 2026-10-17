const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../public/learning-reader');

const VERSION = 'a'.repeat(64);
const bookmark = (value, index = 0) => ({
  index,
  fingerprint: reader.fingerprint(value),
  offset: -8,
  version: VERSION,
});

test('reading bookmarks normalize geometry and versions without retaining text, notes or scores', () => {
  const value = reader.normalize({
    ...bookmark('公开正文'),
    note: '私有评注',
    score: 5,
    answer: 'A',
  });
  assert.deepEqual(Object.keys(value).sort(), ['fingerprint', 'index', 'offset', 'version']);
  for (const invalid of [
    null,
    [],
    { ...value, index: -1 },
    { ...value, offset: Infinity },
    { ...value, offset: 10001 },
    { ...value, version: 'v1' },
    { ...value, fingerprint: '__proto__' },
  ])
    assert.equal(reader.normalize(invalid), null);
});

test('same-version resume tolerates layout changes and selects the original repeated block', () => {
  const blocks = ['条件相同', '条件相同', '具体例子'];
  assert.deepEqual(reader.resolve(bookmark(blocks[1], 1), blocks, VERSION), {
    block: blocks[1],
    offset: -8,
    relocated: false,
  });
});

test('changed text is never resumed on an unrelated or ambiguous old paragraph', () => {
  const value = bookmark('原来的一段');
  assert.equal(reader.resolve(value, ['全新正文'], 'b'.repeat(64)), null);
  assert.equal(reader.resolve(value, ['原来的一段', '原来的一段'], 'b'.repeat(64)), null);
  assert.deepEqual(reader.resolve(value, ['新前言', '原来的一段'], 'b'.repeat(64)), {
    block: '原来的一段',
    offset: -8,
    relocated: true,
  });
});

test('whitespace and highlight wrappers do not alter a public paragraph fingerprint', () => {
  assert.equal(reader.fingerprint('卷积\n\t积分'), reader.fingerprint('卷积 积分'));
  assert.notEqual(reader.fingerprint('条件大于0'), reader.fingerprint('条件小于0'));
});

test('closed reference answers cannot become visible reading blocks even with nonzero geometry', () => {
  const block = (copy, hidden = false) => ({
    textContent: copy,
    closest: (selector) => (hidden && selector.includes('details:not([open])') ? {} : null),
    getBoundingClientRect: () => ({ top: 50, bottom: 100, height: 50 }),
  });
  const hidden = block('尚未展开的参考解答', true);
  const visible = block('正在阅读的正文段落');
  const blank = block('  ');
  const container = { querySelectorAll: () => [hidden, visible, blank] };
  assert.deepEqual(reader.readableBlocks(container), [visible]);
  hidden.closest = () => null;
  assert.deepEqual(reader.readableBlocks(container), [hidden, visible]);
  assert.deepEqual(reader.readableBlocks(null), []);
});

test('an absent document placeholder is not a reading bookmark, while authored identical text is', () => {
  const prose = { textContent: '这个知识点的正文暂未提供。', closest: () => null };
  let absent = true;
  const container = {
    hasAttribute: (name) => name === 'data-learning-document-empty' && absent,
    querySelectorAll: () => [prose],
  };
  assert.deepEqual(reader.readableBlocks(container), []);
  absent = false;
  assert.deepEqual(reader.readableBlocks(container), [prose]);
});

test('tool positions use the actual scrollable reader rather than the outer window', () => {
  const browser = { getComputedStyle: (element) => ({ overflowY: element.overflow }) };
  const outer = { overflow: 'visible', scrollHeight: 1000, clientHeight: 600, parentElement: null };
  const scroller = {
    overflow: 'auto',
    scrollHeight: 2000,
    clientHeight: 600,
    parentElement: outer,
  };
  const inner = { overflow: 'visible', parentElement: scroller };
  assert.equal(reader.scrollHost({ parentElement: inner }, browser), scroller);
  scroller.scrollHeight = 500;
  assert.equal(reader.scrollHost({ parentElement: inner }, browser), browser);
});

test('resume remains account-scoped, explicit destinations win and no learning evidence is written', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-reader.js'), 'utf8');
  assert.match(source, /progress\.scopedKey\(BASE, app\?\.userState\)/);
  assert.match(source, /identity === signature\(\)/);
  assert.match(source, /\['focus', 'question', 'quiz', 'interaction'\]/);
  assert.match(source, /stale = true/);
  assert.doesNotMatch(source, /callApi|recordLearningChoice|recordAssessment|streamKnowledge/);
});

test('annotation reader has one static overview icon and no local typography picker', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/learning-reader.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  const annotations = fs.readFileSync(
    path.join(__dirname, '../public/knowledge-annotations.js'),
    'utf8',
  );
  assert.equal((html.match(/id="learning-reader-overview"/g) || []).length, 1);
  assert.equal((html.match(/id="learning-annotation-toolbar"/g) || []).length, 1);
  assert.match(
    annotations,
    /button\.id === 'learning-reader-overview'[\s\S]*?byId\('knowledge-return-overview'\)\?\.click\(\)/,
  );
  assert.doesNotMatch(source, /typeScalePresets|createElement\('select'\)|learning-reading-size/);
  assert.doesNotMatch(html, /class="learning-reading-size"/);
  const toolbar = html.slice(
    html.indexOf('id="learning-annotation-toolbar"'),
    html.indexOf('id="learning-reading-notes-host"'),
  );
  assert.match(toolbar, /data-annotation-ui="compact"/);
  for (const action of ['highlight', 'underline', 'comment', 'correction', 'ask', 'undo']) {
    assert.equal(
      (toolbar.match(new RegExp(`data-annotation-action="${action}"`, 'g')) || []).length,
      1,
    );
  }
  assert.doesNotMatch(toolbar, /<textarea|<details|批注目录/);
  assert.match(html, /id="learning-annotation-popover"[\s\S]*?role="dialog"/);
  assert.match(html, /<dialog\s+id="learning-annotation-directory"/);
});

test('wide tables remain semantic tables, keyboard scrollable and retain authored labels', () => {
  const makeTable = (attributes = {}, caption = '') => ({
    attributes: { ...attributes },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelector() {
      return caption ? { textContent: caption } : null;
    },
  });
  const plain = makeTable();
  const labelled = makeTable({ 'aria-labelledby': 'caption-id', tabindex: '2' });
  const captioned = makeTable({}, ' 系统特性 ');
  const tables = [plain, labelled, captioned];
  reader.prepareTables({ querySelectorAll: () => tables });
  assert.deepEqual(plain.attributes, { tabindex: '0', 'aria-label': '表格，可左右滚动查看' });
  assert.deepEqual(labelled.attributes, { 'aria-labelledby': 'caption-id', tabindex: '2' });
  assert.equal(captioned.attributes['aria-label'], '系统特性，可左右滚动查看');
  assert.ok(tables.every((table) => !Object.hasOwn(table.attributes, 'role')));
  const wrapped = makeTable();
  wrapped.parentElement = { classList: { contains: (name) => name === 'discussion-table-scroll' } };
  reader.prepareTables({ querySelectorAll: () => [wrapped] });
  assert.deepEqual(wrapped.attributes, {}, 'Shared renderer scroll region is the only Tab stop');
});

function readerHarness(search = '') {
  /* eslint-disable class-methods-use-this -- Minimal inert DOM methods are deliberate test doubles. */
  class Element extends EventTarget {
    constructor() {
      super();
      this.hidden = false;
      this.dataset = {};
      this.classList = { contains: () => false };
    }

    prepend() {}

    append() {}

    querySelector() {
      return null;
    }

    querySelectorAll() {
      return [];
    }

    getBoundingClientRect() {
      return { top: 0, height: 40 };
    }
  }
  /* eslint-enable class-methods-use-this */
  const page = new Element();
  const reading = new Element();
  const body = new Element();
  const doc = new Element();
  const browser = new Element();
  const records = { '["signals","SS-02-01"]': bookmark('原来的一段') };
  const frameQueue = [];
  const moves = [];
  const entryMoves = [];
  reading.scrollIntoView = (value) => entryMoves.push(value);
  let finishFonts;
  doc.fonts = {
    ready: new Promise((resolve) => {
      finishFonts = resolve;
    }),
  };
  doc.getElementById = (id) =>
    ({ 'knowledge-body': body, 'knowledge-reading': reading })[id] || null;
  doc.querySelector = () => page;
  doc.createElement = () => new Element();
  browser.location = { search };
  browser.getComputedStyle = () => ({ overflowY: 'visible', top: '0px' });
  browser.requestAnimationFrame = (callback) => {
    frameQueue.push(callback);
  };
  browser.clearTimeout = () => {};
  browser.setTimeout = () => 1;
  browser.scrollBy = (value) => {
    moves.push(value.top);
  };
  browser.FreeBbsLearningProgress = {
    scopedKey: () => 'isolated-fixture',
    read: () => records,
    write: () => true,
  };
  const block = {
    tagName: 'H2',
    textContent: '原来的一段',
    getBoundingClientRect: () => ({ top: 500, bottom: 600 }),
  };
  body.querySelectorAll = (selector) => (selector === 'table' ? [] : [block]);
  body.contains = (target) => target === block;
  const app = { userState: { isLoggedIn: true, uid: 'student-a', token: 'session-a' } };
  const controller = reader.install(browser, doc, app);
  const loaded = () =>
    page.dispatchEvent(
      new CustomEvent('knowledge:loaded', {
        detail: { course: { slug: 'signals' }, node: { id: 'SS-02-01', documentVersion: VERSION } },
      }),
    );
  const frames = () => {
    while (frameQueue.length) frameQueue.shift()();
  };
  return {
    page,
    doc,
    browser,
    app,
    moves,
    entryMoves,
    records,
    reading,
    body,
    block,
    loaded,
    frames,
    finishFonts,
    controller,
  };
}

test('an explicit fresh reading entry lands at the reading surface, but never steals intent or a real bookmark', () => {
  const fresh = readerHarness('?view=reading');
  delete fresh.records['["signals","SS-02-01"]'];
  fresh.loaded();
  fresh.frames();
  assert.equal(fresh.entryMoves.length, 1);
  const resumed = readerHarness('?view=reading');
  resumed.loaded();
  resumed.frames();
  assert.equal(resumed.moves.length, 1);
  assert.equal(resumed.entryMoves.length, 0);
  for (const query of [
    '?view=reading&focus=origin',
    '?view=reading&quiz=practice',
    '?view=reading&question=Q1',
  ]) {
    const targeted = readerHarness(query);
    delete targeted.records['["signals","SS-02-01"]'];
    targeted.loaded();
    targeted.frames();
    assert.equal(targeted.entryMoves.length, 0);
  }
  const acting = readerHarness('?view=reading');
  delete acting.records['["signals","SS-02-01"]'];
  acting.loaded();
  acting.doc.dispatchEvent(new Event('keydown'));
  acting.frames();
  assert.equal(acting.entryMoves.length, 0);
});

test('reading entry works for public visitors and does not replay on a document refresh or identity change', () => {
  const h = readerHarness('?view=reading');
  delete h.records['["signals","SS-02-01"]'];
  h.browser.FreeBbsLearningProgress.scopedKey = () => null;
  h.loaded();
  h.frames();
  assert.equal(h.entryMoves.length, 1);
  assert.equal(h.controller.capture(), false);
  h.page.dispatchEvent(
    new CustomEvent('knowledge:document-saved', {
      detail: { node: { id: 'SS-02-01', documentVersion: VERSION } },
    }),
  );
  h.frames();
  assert.equal(h.entryMoves.length, 1);
  h.browser.dispatchEvent(new Event('freebbs:session-change'));
  h.frames();
  assert.equal(h.entryMoves.length, 1);
});

test('outline navigation uses the actual reading inset and refuses hidden, foreign or stale targets', () => {
  const h = readerHarness();
  h.loaded();
  h.frames();
  assert.equal(h.controller.scrollToHeading(h.block), true);
  assert.equal(h.moves.at(-1), 484);
  assert.equal(h.controller.scrollToHeading({ tagName: 'H2' }), false);
  h.block.closest = () => ({ hidden: true });
  assert.equal(h.controller.scrollToHeading(h.block), false);
  h.block.closest = () => null;
  h.app.userState.token = 'another-session';
  assert.equal(h.controller.scrollToHeading(h.block), false);
});

test('heading navigation leaves space for actual fixed controls without changing bookmark restoration', () => {
  const h = readerHarness();
  const control = {
    getBoundingClientRect: () => ({ left: 16, right: 60, top: 16, bottom: 58, width: 44 }),
  };
  const oldLookup = h.doc.getElementById;
  h.doc.getElementById = (id) => (id === 'knowledge-course-link' ? control : oldLookup(id));
  h.browser.getComputedStyle = (element) => ({
    overflowY: 'visible',
    top: '0px',
    position: element === control ? 'fixed' : 'static',
  });
  h.block.getBoundingClientRect = () => ({ left: 16, right: 310, top: 500, bottom: 600 });
  h.loaded();
  h.frames();
  assert.equal(h.moves.at(-1), 492, 'Existing bookmark geometry is unchanged');
  assert.equal(h.controller.scrollToHeading(h.block), true);
  assert.equal(h.moves.at(-1), 426, 'Chosen heading clears the actual back control plus margin');
});

test('initial and late-font resume never override a learner who has already started acting', async () => {
  const fixture = readerHarness();
  fixture.loaded();
  fixture.doc.dispatchEvent(new Event('wheel'));
  fixture.frames();
  fixture.finishFonts();
  await Promise.resolve();
  fixture.frames();
  assert.deepEqual(fixture.moves, []);
  assert.equal(fixture.controller.restore(), true, 'Explicit resume still remains available');
  assert.equal(fixture.moves.length, 1);
});

test('reading restoration counts only actual visible sticky surfaces, not a short-window flowing toolbar', () => {
  for (const [historyPosition, toolbarPosition, toolbarHeight, expectedMove] of [
    ['sticky', 'sticky', 161.5, 140.5],
    ['sticky', 'relative', 161.5, 302],
    ['relative', 'sticky', 161.5, 330.5],
    ['relative', 'relative', 161.5, 492],
    ['sticky', 'sticky', 0, 302],
  ]) {
    const fixture = readerHarness();
    const history = {
      hidden: false,
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ top: 60, height: 130 }),
    };
    const toolbar = {
      hidden: false,
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ top: 198, height: toolbarHeight }),
    };
    const originalLookup = fixture.doc.getElementById;
    fixture.doc.getElementById = (id) =>
      ({ 'knowledge-history': history, 'learning-annotation-toolbar': toolbar })[id] ||
      originalLookup(id);
    fixture.browser.getComputedStyle = (element) => ({
      overflowY: 'visible',
      position:
        element === history ? historyPosition : element === toolbar ? toolbarPosition : 'static',
      top: element === history ? '60px' : '0px',
    });
    fixture.loaded();
    fixture.frames();
    assert.deepEqual(fixture.moves, [expectedMove]);
  }
});

test('short-window annotation source keeps its popover anchor and does not clip the reader toolbar', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../public/human-learning-annotations.css'),
    'utf8',
  );
  assert.match(
    css,
    /@media \(max-height: 520px\)\s*\{\s*\.knowledge-page #knowledge-reading > \.learning-annotation-toolbar\s*\{\s*position: relative;\s*top: auto;\s*max-height: none;/,
  );
});

test('short-window selected-text actions replace origin stickiness without hiding or closing either surface', () => {
  // CSS contract only; the native selection/save/return diagnostic verifies geometry.
  const css = fs.readFileSync(
    path.join(__dirname, '../public/human-learning-annotations.css'),
    'utf8',
  );
  const short = css.slice(
    css.indexOf('@media (max-height: 520px)'),
    css.indexOf('@media (forced-colors: active)'),
  );
  assert.match(
    short,
    /#knowledge-reading:has\(> \.learning-annotation-toolbar\[data-has-selection='true'\]\)\s*> \.knowledge-history\s*\{\s*position: relative;\s*top: auto;/,
  );
  assert.match(
    short,
    /> \.learning-annotation-toolbar\[data-has-selection='true'\]\s*\{\s*position: sticky;\s*top: calc\(var\(--knowledge-reading-inset, 0px\) \+ 8px\);/,
  );
  assert.doesNotMatch(short, /display:\s*none|visibility:\s*hidden|overflow:\s*hidden/);
});

test('font reflow restores the same public block only for a current, untouched session', async () => {
  const fixture = readerHarness();
  fixture.loaded();
  fixture.frames();
  assert.equal(fixture.moves.length, 1);
  fixture.finishFonts();
  await Promise.resolve();
  fixture.frames();
  assert.equal(fixture.moves.length, 2);
  fixture.app.userState.uid = 'student-b';
  assert.equal(fixture.controller.restore(), false);
});

test('explicit destinations and stale loads win over both automatic restoration passes', async () => {
  for (const query of ['?question=Q01', '?view=overview', '?tool=feedback']) {
    const fixture = readerHarness(query);
    fixture.loaded();
    fixture.frames();
    fixture.finishFonts();
    await Promise.resolve();
    fixture.frames();
    assert.deepEqual(fixture.moves, []);
  }
  const fixture = readerHarness();
  fixture.loaded();
  fixture.browser.dispatchEvent(new CustomEvent('storage', { detail: {} }));
  fixture.app.userState.token = 'new-session';
  fixture.frames();
  fixture.finishFonts();
  await Promise.resolve();
  fixture.frames();
  assert.deepEqual(fixture.moves, []);
});
