const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  stableBlocks,
  createAnchor,
  locateAnchor,
  privateAnnotations,
  correctionExcerpt,
  COLORS,
} = require('../public/knowledge-annotations');

const version = 'a'.repeat(64);
const changedVersion = 'b'.repeat(64);
function anchorFor(block, start, end, extra = {}) {
  return createAnchor({
    nodeId: 'SS-01-01',
    documentVersion: version,
    block,
    start,
    end,
    ...extra,
  });
}
test('one-character and arbitrary UTF-16 text ranges preserve exact quotations and context', () => {
  const [block] = stableBlocks([{ text: '  学习卷积🙂要慢慢拆解。' }]);
  const anchor = anchorFor(block, 2, 3);
  assert.equal(anchor.quote, '学');
  assert.equal(anchor.prefix, '  ');
  assert.deepEqual(locateAnchor(anchor, [block], version), {
    status: 'exact',
    block,
    start: 2,
    end: 3,
  });
  assert.equal(anchorFor(block, 6, 8).quote, '🙂');
  assert.throws(() => anchorFor(block, 3, 3));
});
test('block anchors remain stable when unrelated paragraphs move or are inserted', () => {
  const original = stableBlocks([{ text: '信号先做平移。' }, { text: '卷积再做叠加。' }]);
  const updated = stableBlocks([
    { text: '新增说明。' },
    { text: '卷积再做叠加。' },
    { text: '信号先做平移。' },
  ]);
  assert.equal(original[0].anchor, updated[2].anchor);
  const anchor = anchorFor(original[0], 2, 4);
  const location = locateAnchor(anchor, updated, changedVersion);
  assert.equal(location.status, 'relocated');
  assert.equal(location.block.anchor, original[0].anchor);
});
test('changed paragraphs relocate by exact quote and context only when one location is reliable', () => {
  const [block] = stableBlocks([{ text: '先平移，再积分。' }]);
  const anchor = anchorFor(block, 1, 3);
  const changed = stableBlocks([{ text: '说明：先平移，再积分。' }]);
  const location = locateAnchor(anchor, changed, changedVersion);
  assert.equal(location.status, 'relocated');
  assert.equal(location.start, 4);
  assert.equal(
    locateAnchor(
      anchor,
      stableBlocks([{ text: '先平移，再积分。' }, { text: '先平移，再积分。' }]),
      changedVersion,
    ).status,
    'pending',
  );
  assert.equal(
    locateAnchor(anchor, stableBlocks([{ text: '文字被替换。' }]), changedVersion).status,
    'pending',
  );
});
test('repeated one-character quotes must not be guessed on changed documents', () => {
  const [block] = stableBlocks([{ text: '学' }]);
  const anchor = anchorFor(block, 0, 1);
  assert.equal(
    locateAnchor(anchor, stableBlocks([{ text: '学' }, { text: '学' }]), changedVersion).status,
    'pending',
  );
});
test('whole-block formula, image and table annotations never become partial selections', () => {
  for (const type of ['formula', 'image', 'table']) {
    const [block] = stableBlocks([{ text: type === 'image' ? '[示意图]' : '全部块内容', type }]);
    const anchor = anchorFor(block, 1, 2, { wholeBlock: true });
    assert.equal(anchor.quote, block.text);
    assert.equal(anchor.range.start, 0);
    assert.equal(anchor.range.end, block.text.length);
    assert.equal(
      locateAnchor(anchor, stableBlocks([{ text: `${block.text}修改`, type }]), changedVersion)
        .status,
      'pending',
    );
  }
});
test('private overlay extraction excludes contributions, reviewer data, paths and ordinary notes', () => {
  const [block] = stableBlocks([{ text: '学' }]);
  const annotation = { style: 'highlight', color: 'yellow', anchor: anchorFor(block, 0, 1) };
  const records = [
    { id: '1', kind: 'note', status: 'private', annotation },
    { id: '2', kind: 'contribution', status: 'pending', annotation },
    { id: '3', kind: 'path', status: 'private', annotation },
    { id: '4', kind: 'note', status: 'private' },
    { id: '5', kind: 'note', status: 'pending', annotation },
  ];
  assert.deepEqual(
    privateAnnotations(records).map((record) => record.id),
    ['1'],
  );
  assert.deepEqual(COLORS, ['yellow', 'green', 'blue', 'purple']);
});
test('cross-block anchors use the complete rendered text range and remain precise', () => {
  const block = { anchor: 'document', type: 'text', text: '第一段第二段' };
  const anchor = anchorFor(block, 2, 5);
  assert.equal(anchor.quote, '段第二');
  assert.equal(locateAnchor(anchor, [block], version).status, 'exact');
});

test('long correction quotations keep their complete anchor while bounding the form preview', () => {
  const [block] = stableBlocks([{ text: '学'.repeat(1200) }]);
  const anchor = anchorFor(block, 0, 1200);
  assert.equal(correctionExcerpt(anchor).length, 600);
  assert.equal(anchor.quote.length, 1200);
  assert.equal(anchor.range.end, 1200);
  assert.equal(correctionExcerpt(undefined), '');
});

test('dedicated annotation pages are not displaced by mixed records and clear on account changes', () => {
  function fakeElement() {
    return {
      children: [],
      dataset: {},
      hidden: false,
      listeners: new Map(),
      classList: { toggle() {}, add() {}, remove() {} },
      append(...children) {
        this.children.push(...children);
      },
      after(element) {
        this.nextElementSibling = element;
      },
      replaceChildren(...children) {
        this.children = children;
      },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
      setAttribute() {},
    };
  }
  const page = fakeElement();
  page.querySelector = () => null;
  const events = new Map();
  page.addEventListener = (name, callback) => {
    events.set(name, [...(events.get(name) || []), callback]);
  };
  page.dispatchEvent = (event) => {
    (events.get(event.type) || []).forEach((callback) => callback(event));
  };
  const elements = new Map([
    ['learning-annotation-toolbar', fakeElement()],
    ['learning-annotation-list', fakeElement()],
    ['learning-annotation-status', fakeElement()],
    ['learning-annotation-comment', fakeElement()],
  ]);
  const sessionListeners = new Map();
  const window = {
    freeBbsApp: { userState: { uid: '1', token: 'first', isLoggedIn: true } },
    document: {
      readyState: 'complete',
      querySelector: () => page,
      getElementById: (id) => elements.get(id),
      createElement: () => fakeElement(),
    },
    crypto: { randomUUID: () => 'test-request' },
    addEventListener: (name, callback) => sessionListeners.set(name, callback),
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8'), {
    window,
  });
  const emit = (type, detail) => page.dispatchEvent({ type, detail });
  emit('knowledge:loaded', {
    node: { id: 'SS-01-01', documentVersion: version },
    course: { slug: 'signals' },
  });
  const [block] = stableBlocks([{ text: '学' }]);
  const entry = (id) => ({
    id,
    kind: 'note',
    status: 'private',
    content: '私有文字',
    annotation: { style: 'highlight', color: 'yellow', anchor: anchorFor(block, 0, 1) },
  });
  const cards = () =>
    elements.get('learning-annotation-list').children.filter((item) => item.dataset.annotationId);
  emit('knowledge:entries-loaded', { entries: [entry('1')] });
  assert.deepEqual(
    cards().map((item) => item.dataset.annotationId),
    ['1'],
  );
  emit('knowledge:annotation-records-loaded', { entries: [entry('2')], nextCursor: '2' });
  emit('knowledge:entries-loaded', { entries: [entry('3')] });
  assert.deepEqual(
    cards().map((item) => item.dataset.annotationId),
    ['2'],
  );
  const toolbar = elements.get('learning-annotation-toolbar');
  const more = toolbar.children.find((item) => item.id === 'learning-annotations-more');
  const count = toolbar.children.find((item) => item.id === 'learning-annotations-count');
  assert.equal(more.hidden, false);
  assert.equal(count.textContent, '已加载 1 条评注');
  let requested;
  page.addEventListener('knowledge:annotations-more', (event) => {
    requested = event.detail;
  });
  more.listeners.get('click')();
  assert.equal(requested.nextCursor, '2');
  emit('knowledge:annotation-saved', {});
  emit('knowledge:entries-loaded', { entries: [entry('3')] });
  assert.deepEqual(
    cards().map((item) => item.dataset.annotationId),
    ['2'],
  );
  const original = fakeElement();
  original.contains = () => true;
  original.closest = () => null;
  elements.set('knowledge-body', original);
  window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => ({ startContainer: {}, endContainer: {} }),
  });
  window.FreeBbsKnowledgeAnnotations.setEditing(false);
  emit('mouseup', {});
  assert.equal(toolbar.hidden, true);
  assert.equal(cards().length, 1);
  elements.delete('knowledge-body');
  window.freeBbsApp.userState = { uid: '2', token: 'second', isLoggedIn: true };
  sessionListeners.get('freebbs:session-change')();
  assert.equal(cards().length, 0);
  assert.equal(more.hidden, true);
  assert.equal(count.hidden, true);
  emit('knowledge:entries-loaded', { entries: [entry('4')] });
  assert.deepEqual(
    cards().map((item) => item.dataset.annotationId),
    ['4'],
  );
});
