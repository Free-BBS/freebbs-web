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
  createUndoHistory,
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

test('empty-document UI copy is not an annotation block regardless of its visible wording', () => {
  const source = fs.readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8');
  const start = source.indexOf('    function blocksFor(container) {');
  const end = source.indexOf('    function textNodes(element)', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}\nthis.blocksFor = blocksFor;`, context);
  const container = {
    hasAttribute: (name) => name === 'data-learning-document-empty',
    querySelectorAll: () => {
      assert.fail('empty UI copy must not enter original-material block discovery');
    },
  };
  assert.equal(context.blocksFor(container).length, 0);
  assert.equal(context.blocksFor(null).length, 0);
  const readerSource = fs.readFileSync(require.resolve('../public/knowledge'), 'utf8');
  assert.match(readerSource, /toggleAttribute\('data-learning-document-empty', !markdown\)/);
  assert.match(source, /if \(container\.hasAttribute\('data-learning-document-empty'\)\)/);
});
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

test('origin and body anchors never relocate onto each other, even for identical quotes and hashes', () => {
  const [body] = stableBlocks([{ text: '系统如何响应输入？' }]);
  const origin = { ...body, section: 'origin' };
  const anchor = anchorFor(origin, 0, 2, { section: 'origin' });
  assert.equal(anchor.section, 'origin');
  assert.equal(locateAnchor(anchor, [body], version).status, 'pending');
  assert.equal(locateAnchor(anchor, [body, origin], version).block, origin);
  assert.equal(locateAnchor(anchor, [body], changedVersion).status, 'pending');
  assert.equal(locateAnchor(anchorFor(body, 0, 2), [origin], version).status, 'pending');
  assert.equal(locateAnchor(anchorFor(body, 0, 2), [origin, body], version).block, body);
  assert.throws(() => anchorFor(body, 0, 2, { section: 'sidebar' }));
});

test('only a successful current-session annotation DELETE acknowledges removal', async () => {
  const source = fs
    .readFileSync(require.resolve('../public/knowledge-workspace'), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf("  page.addEventListener('knowledge:annotation-remove',");
  const boundary = source
    .slice(start)
    .search(/ {2}page\s*\.querySelectorAll\('\[data-learning-go\]'\)/);
  const end = boundary < 0 ? -1 : start + boundary;
  assert.ok(start >= 0 && end > start);
  const events = [];
  const listeners = new Map();
  let loads = 0;
  let remove = async () => undefined;
  const state = { generation: 1, busy: false };
  const status = { textContent: '' };
  vm.runInNewContext(source.slice(start, end), {
    page: {
      addEventListener: (name, callback) => {
        listeners.set(name, callback);
      },
      dispatchEvent: (event) => events.push(event),
    },
    app: { callApi: (...args) => remove(...args) },
    loggedIn: () => true,
    endpoint: () => '/learning/signals/SS-01-01',
    state,
    loadEntries: async () => {
      loads += 1;
    },
    el: () => status,
    CustomEvent: function AnnotationRemovalEvent(type, { detail }) {
      this.type = type;
      this.detail = detail;
    },
  });
  const listener = listeners.get('knowledge:annotation-remove');
  const request = { detail: { entry: { id: 'private-fixture-1' } } };
  await listener(request);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'knowledge:annotation-removed');
  assert.equal(events[0].detail.entryId, 'private-fixture-1');
  assert.equal(loads, 1);
  events.length = 0;
  remove = async () => {
    throw new Error('本地删除失败夹具');
  };
  await listener(request);
  assert.equal(events.length, 1, 'a failed DELETE reports an error, never acknowledges removal');
  assert.equal(events[0].type, 'knowledge:annotation-error');
  assert.ok(!events.some((event) => event.type === 'knowledge:annotation-removed'));
  assert.equal(loads, 1);
  assert.equal(status.textContent, '本地删除失败夹具');
  events.length = 0;
  let complete;
  remove = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = listener(request);
  state.generation += 1;
  complete();
  await pending;
  assert.equal(
    events.length,
    0,
    'an old session response cannot acknowledge removal in the new session',
  );
  assert.equal(loads, 1);
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

test('new whole-image anchors recover only the same hashed src/srcset, never a same-alt replacement', () => {
  const image = (src, srcset = '') => ({
    type: 'image',
    text: '相同图片说明',
    imageSource: JSON.stringify([[src, srcset]]),
  });
  const [original] = stableBlocks([image('/local-A.svg?signature=private-fixture')]);
  const anchor = anchorFor(original, 0, original.text.length, { wholeBlock: true });
  assert.match(anchor.blockAnchor, /^b-i-[a-f0-9]{16}-[a-f0-9]{8}-1$/);
  assert.ok(
    !JSON.stringify(anchor).includes('private-fixture'),
    'source URL/query values remain only a hash in the persisted anchor',
  );
  assert.equal(locateAnchor(anchor, [original], version).status, 'exact');
  const unchanged = stableBlocks([
    { text: '新增正文段落' },
    image('/local-A.svg?signature=private-fixture'),
  ]);
  assert.equal(locateAnchor(anchor, unchanged, changedVersion).status, 'relocated');
  for (const replacement of [
    image('/local-B.svg?signature=private-fixture'),
    image('/local-A.svg?signature=changed-fixture'),
    image('/local-A.svg?signature=private-fixture', '/local-B.svg 2x'),
  ]) {
    assert.equal(
      locateAnchor(anchor, stableBlocks([replacement]), changedVersion).status,
      'pending',
    );
    assert.equal(
      locateAnchor(anchor, stableBlocks([replacement]), version).status,
      'pending',
      'a runtime source change also cannot inherit a new identity-aware image anchor',
    );
  }
  const repeated = stableBlocks([
    image('/local-A.svg?signature=private-fixture'),
    image('/local-A.svg?signature=private-fixture'),
  ]);
  assert.equal(
    locateAnchor(anchor, repeated, changedVersion).status,
    'pending',
    'identical repeated images are not guessed after revision',
  );
});

test('legacy whole-image alt-only anchors remain compatible on the same body but pending after revision', () => {
  const [legacy] = stableBlocks([{ type: 'image', text: '相同图片说明' }]);
  const anchor = anchorFor(legacy, 0, legacy.text.length, { wholeBlock: true });
  const current = stableBlocks([
    { type: 'image', text: '相同图片说明', imageSource: JSON.stringify([['/local-A.svg', '']]) },
  ]);
  assert.equal(locateAnchor(anchor, [legacy], version).status, 'exact');
  assert.equal(locateAnchor(anchor, current, version).status, 'relocated');
  assert.equal(locateAnchor(anchor, current, changedVersion).status, 'pending');
  assert.equal(
    locateAnchor(anchor, [legacy], changedVersion).status,
    'pending',
    'no source identity is not proof that a revised image is unchanged',
  );
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

// Execute the production directory/editor functions with a bounded DOM/geometry fixture.
// This verifies their contracts, not native browser layout or a real student's records.
function annotationNavigationHarness({ pending = false, windowHost = false } = {}) {
  const source = fs
    .readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8')
    .replace(/\r\n/g, '\n');
  const frames = [];
  const messages = [];
  const scrolls = [];
  const rangeOffsets = [];
  let active;
  let quoteTop = 600;
  let currentBlocks;
  const element = (box = {}, css = {}) => ({
    children: [],
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    classList: { contains: () => false, toggle() {} },
    style: { setProperty() {} },
    hidden: false,
    isConnected: true,
    css: {
      position: 'static',
      overflowY: 'visible',
      display: 'block',
      visibility: 'visible',
      ...css,
    },
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 700,
      left: 0,
      right: 390,
      width: 390,
      height: 700,
      ...box,
    }),
    closest: () => null,
    append(...values) {
      this.children.push(...values);
    },
    replaceChildren(...values) {
      this.children.forEach((child) => {
        child.isConnected = false;
      });
      this.children = values;
    },
    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    getAttribute(name) {
      return this.attributes.get(name);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    close() {
      this.open = false;
    },
    focus(options) {
      active = { element: this, options };
    },
    matches(selector) {
      return selector === '.mobile-nav' && this.nav;
    },
  });
  const original = element({ top: 100 });
  original.contains = (target) =>
    target === quote ||
    target === original ||
    Boolean(target?.originalMark) ||
    target === quote.textNodes[0];
  const quote = element();
  quote.getBoundingClientRect = () => ({
    top: quoteTop - 200,
    bottom: quoteTop + 200,
    height: 400,
    width: 300,
    left: 20,
    right: 320,
  });
  quote.textNodes = [{ data: '先平移，再积分。' }];
  quote.contains = (target) => target === quote.textNodes[0];
  const [block] = stableBlocks([{ text: quote.textNodes[0].data, element: quote }]);
  currentBlocks = [block];
  const entry = (id, content = `已保存评注 ${id}`) => ({
    id,
    kind: 'note',
    status: 'private',
    revision: 3,
    content,
    annotation: { style: 'comment', color: 'yellow', anchor: anchorFor(block, 1, 3) },
  });
  const first = entry('first');
  const second = entry('second');
  const reading = element();
  const toolbar = element({ top: 575, height: 80 }, { position: 'sticky', top: '168px' });
  const history = element({ top: 349, height: 100 }, { position: 'sticky', top: '60px' });
  const header = element({ top: 0, bottom: 60, height: 60 }, { position: 'fixed' });
  const nav = element({ top: 640, bottom: 700, height: 60 }, { position: 'fixed' });
  nav.nav = true;
  const host = element({}, { overflowY: 'auto' });
  host.scrollHeight = 2500;
  host.clientHeight = 700;
  host.scrollBy = (options) => {
    scrolls.push(options);
    quoteTop -= options.top;
  };
  original.parentElement = host;
  const directory = element();
  directory.open = true;
  const commentField = element();
  const comment = element();
  comment.value = '';
  const popover = element({ width: 300, height: 180 });
  popover.hidden = true;
  popover.dataset.mode = 'edit';
  const list = element();
  const elements = new Map([
    ['knowledge-body', original],
    ['knowledge-reading', reading],
    ['knowledge-history', history],
    ['learning-annotation-toolbar', toolbar],
    ['learning-annotation-directory', directory],
    ['learning-annotation-comment', comment],
    ['learning-annotation-list', list],
    ['learning-annotation-popover', popover],
    ...['title', 'quote', 'content', 'info'].map((name) => [
      `learning-annotation-popover-${name}`,
      element(),
    ]),
  ]);
  const state = {
    uid: 'student-fixture',
    token: 'token-fixture',
    version: 1,
    editing: true,
    course: { slug: 'signals' },
    node: { id: 'SS-01-01', documentVersion: version },
    selection: null,
    selectedEntry: null,
    saveDraft: null,
    color: 'yellow',
    colors: { highlight: 'yellow', underline: 'blue' },
    composeMode: 'comment',
    popoverEntry: null,
    popoverTarget: null,
    pending: null,
    undo: createUndoHistory(),
    entries: [first, second],
    callback: {},
  };
  const app = { userState: { uid: state.uid, token: state.token, isLoggedIn: true } };
  const root = {
    innerHeight: 700,
    innerWidth: 390,
    getSelection: () => ({ rangeCount: 1, isCollapsed: true, anchorNode: quote.textNodes[0] }),
    getComputedStyle: (target) => target.css,
    requestAnimationFrame: (callback) => frames.push(callback),
    scrollBy: host.scrollBy,
    FreeBbsLearningReader: { getScrollHost: () => (windowHost ? root : host) },
  };
  const page = {
    querySelectorAll: () => [],
    addEventListener: (name, callback) => {
      page[name] = callback;
    },
  };
  const document = {
    createElement: element,
    querySelectorAll: () => [header, nav],
    createRange: () => ({
      setStart: (node, offset) => rangeOffsets.push(['start', node, offset]),
      setEnd: (node, offset) => rangeOffsets.push(['end', node, offset]),
      getClientRects: () => [
        { top: quoteTop, bottom: quoteTop + 30, height: 30, width: 180, left: 20, right: 200 },
      ],
    }),
  };
  const context = {
    state,
    app,
    root,
    page,
    document,
    popover,
    directory,
    commentField,
    annotationToolbar: toolbar,
    locationRequest: 0,
    byId: (id) => elements.get(id),
    message: (value) => messages.push(value),
    textNodes: (target) => target.textNodes,
    blocksFor: () => currentBlocks,
    locateAnchor,
    createAnchor,
    offsetOf: (container, node, offset) => offset,
    privateAnnotations,
    COLORS,
    preserveReadingPosition: (change) => change(),
    showToolbar: () => {},
    captureAtomic: () =>
      assert.fail('an existing private mark must not capture a fresh atomic anchor'),
    act: () => assert.fail('navigation must not implicitly save'),
  };
  const commentStart = source.indexOf('    function positionPopover(');
  const commentEnd = source.indexOf('    function strip(container)', commentStart);
  const start = source.indexOf('    function recordContext()');
  const end = source.indexOf('    function refresh()', start);
  const markStart = source.indexOf("    page.addEventListener('click', (event) => {");
  const markEnd = source.indexOf("    page.addEventListener('mousedown'", markStart);
  const captureStart = source.indexOf('    function captureSelection(event)');
  const captureEnd = source.indexOf('    function captureAtomic(target)', captureStart);
  const mouseupStart = source.indexOf("    page.addEventListener('mouseup', captureSelection);");
  const mouseupEnd = source.indexOf("    page.addEventListener('keyup'", mouseupStart);
  const snapshotStart = source.indexOf('    function editorSnapshot(style)');
  const controlsStart = source.indexOf('    function closePalettes(');
  const controlsEnd = source.indexOf(
    "    popover?.addEventListener('click', handleControls);",
    controlsStart,
  );
  const snapshotEnd = source.indexOf('    function act(action)', snapshotStart);
  const savedStart = source.indexOf(
    "    page.addEventListener('knowledge:annotation-saved', (event) => {",
  );
  const savedEnd = source.indexOf(
    "    page.addEventListener('knowledge:annotation-removed'",
    savedStart,
  );
  assert.ok(commentStart >= 0 && commentEnd > commentStart && start >= 0 && end > start);
  assert.ok(markStart >= 0 && markEnd > markStart);
  assert.ok(
    captureStart >= 0 &&
      captureEnd > captureStart &&
      mouseupStart >= 0 &&
      mouseupEnd > mouseupStart,
  );
  assert.ok(
    snapshotStart >= 0 && snapshotEnd > snapshotStart && savedStart >= 0 && savedEnd > savedStart,
  );
  vm.runInNewContext(
    `${source.slice(source.indexOf('    const sectionOf ='), source.indexOf('    function preserveReadingPosition('))}\n${source.slice(commentStart, commentEnd)}\n${source.slice(start, end)}\n${source.slice(controlsStart, controlsEnd)}\n${source.slice(snapshotStart, snapshotEnd)}\n${source.slice(captureStart, captureEnd)}\n${source.slice(markStart, markEnd)}\n${source.slice(mouseupStart, mouseupEnd)}\n${source.slice(savedStart, savedEnd)}\nthis.api = { recordContext, editRecord, viewRecords, locateRecord, renderList, editorSnapshot, closePopover, showPopover };`,
    context,
  );
  context.api.renderList([
    { entry: first, location: { status: pending ? 'pending' : 'exact', block } },
  ]);
  const card = list.children[0];
  const locate = card.children.find((child) => Object.hasOwn(child.dataset, 'annotationLocate'));
  const edit = card.children.find((child) => Object.hasOwn(child.dataset, 'annotationEdit'));
  const flush = () => {
    let count = 0;
    while (frames.length) {
      count += 1;
      assert.ok(count <= 20);
      frames.shift()();
    }
  };
  const clickMark = (record = first, atomic = false, mouseup = false) => {
    const marked = element();
    marked.originalMark = true;
    marked.dataset[atomic ? 'privateAnnotationBlock' : 'privateAnnotation'] = record.id;
    marked.closest = (selector) =>
      ['#knowledge-body', '#knowledge-body,#knowledge-history-prose'].includes(selector)
        ? original
        : null;
    const event = {
      target: {
        originalMark: true,
        closest: (selector) =>
          selector === '[data-private-annotation],[data-private-annotation-block]' ? marked : null,
      },
    };
    if (mouseup) page.mouseup({ ...event, type: 'mouseup' });
    page.click(event);
  };
  return {
    api: context.api,
    state,
    app,
    root,
    elements,
    original,
    quote,
    first,
    second,
    card,
    directory,
    commentField,
    comment,
    toolbar,
    popover,
    history,
    host,
    nav,
    locate,
    edit,
    messages,
    scrolls,
    rangeOffsets,
    clickMark,
    flush,
    flushOne: () => frames.shift()?.(),
    mouseupProse: () => page.mouseup({ type: 'mouseup', target: quote }),
    acknowledge: (detail) => page['knowledge:annotation-saved']({ detail }),
    get active() {
      return active;
    },
    get quoteTop() {
      return quoteTop;
    },
    replaceBlocks: (values) => {
      currentBlocks = values;
    },
  };
}

test('explicit edit separates from marker details and retains same-record or unsaved drafts', () => {
  const harness = annotationNavigationHarness();
  const { edit, locate, state, comment, first, second, api, card } = harness;
  assert.equal(edit.textContent, '编辑评注');
  assert.equal(locate.textContent, '定位原文');
  assert.equal(locate.disabled, false);
  edit.listeners.get('click')();
  assert.equal(state.selectedEntry, first);
  assert.equal(comment.value, first.content);
  assert.equal(harness.commentField.hidden, false);
  assert.equal(harness.directory.open, false);
  assert.equal(harness.active.element, comment);
  assert.equal(harness.active.options.preventScroll, true);
  assert.equal(
    harness.scrolls.length,
    0,
    'editing does not scroll the source block into a sticky toolbar',
  );
  state.selectedEntry = { ...first, revision: 4 };
  comment.value = '尚未保存的 B';
  const confirmedOwnBase = state.selectedEntry;
  edit.listeners.get('click')();
  assert.equal(comment.value, '尚未保存的 B');
  assert.equal(
    state.selectedEntry,
    confirmedOwnBase,
    'reopen does not regress the confirmed own ACK revision',
  );
  harness.clickMark();
  assert.equal(
    comment.value,
    '尚未保存的 B',
    'a marker never replaces the dirty editor with details',
  );
  harness.clickMark(second, true);
  assert.equal(state.selectedEntry, confirmedOwnBase);
  assert.match(harness.messages.at(-1), /未保存|尚未保存/);
  comment.value = '';
  api.editRecord(second, api.recordContext(), card);
  assert.equal(
    state.selectedEntry,
    confirmedOwnBase,
    'deleting the previous text is also an unsaved edit',
  );
  comment.value = first.content;
  api.editRecord(second, api.recordContext(), card);
  assert.equal(
    state.selectedEntry,
    second,
    'an unchanged old record does not block normal editing',
  );
  state.selectedEntry = null;
  state.selection = { quote: '新的原句' };
  comment.value = '全新未保存评注';
  edit.listeners.get('click')();
  assert.equal(state.selectedEntry, null);
  assert.equal(state.selection.quote, '新的原句');
  assert.equal(comment.value, '全新未保存评注');
});

test('a confirmed own ACK cannot make an unsubmitted revert to old content look clean when switching records', () => {
  const harness = annotationNavigationHarness();
  harness.edit.listeners.get('click')();
  const oldContent = harness.first.content;
  harness.comment.value = '提交中的 A';
  harness.state.saveDraft = {
    key: 'A-intent',
    signature: 'A-signature',
    style: 'comment',
    editorSnapshot: harness.api.editorSnapshot('comment'),
  };
  const draft = harness.state.saveDraft;
  harness.comment.value = oldContent;
  harness.acknowledge({
    requestKey: draft.key,
    signature: draft.signature,
    entryId: harness.first.id,
    previousRevision: 3,
    revision: 4,
  });
  assert.equal(
    harness.state.selectedEntry.revision,
    4,
    'the actual own ACK advances only its confirmed base',
  );
  assert.equal(harness.comment.value, oldContent);
  const selected = harness.state.selectedEntry;
  harness.api.editRecord(harness.second, harness.api.recordContext(), harness.card);
  assert.equal(
    harness.state.selectedEntry,
    selected,
    'old content is still unsubmitted B, not proof of a clean editor',
  );
  assert.equal(harness.comment.value, oldContent);
  assert.equal(harness.state.saveDraft, draft);
  assert.match(harness.messages.at(-1), /未保存|尚未保存/);
  harness.clickMark(harness.second, false, true);
  assert.equal(
    harness.state.selectedEntry,
    selected,
    'mark editing uses the same submitted-snapshot protection',
  );
  harness.locate.listeners.get('click')();
  harness.flush();
  assert.match(harness.messages.at(-1), /未保存.*草稿仍保留/);
  assert.equal(harness.comment.value, oldContent);
  const clean = annotationNavigationHarness();
  clean.edit.listeners.get('click')();
  clean.api.editRecord(clean.second, clean.api.recordContext(), clean.card);
  assert.equal(
    clean.state.selectedEntry,
    clean.second,
    'an unchanged record without a submitted snapshot can switch normally',
  );
  const matching = annotationNavigationHarness();
  matching.edit.listeners.get('click')();
  matching.state.saveDraft = {
    key: 'same',
    signature: 'same',
    style: 'comment',
    editorSnapshot: matching.api.editorSnapshot('comment'),
  };
  matching.api.editRecord(matching.second, matching.api.recordContext(), matching.card);
  assert.equal(
    matching.state.selectedEntry,
    matching.second,
    'a matching submitted snapshot alone is not treated as a dirty change',
  );
});

test('locate uses the quote Range and actual scroll host reading band without changing the edit intent', () => {
  for (const windowHost of [false, true]) {
    const harness = annotationNavigationHarness({ windowHost });
    const { state, first, comment, directory, commentField, locate } = harness;
    state.selection = first.annotation.anchor;
    state.selectedEntry = first;
    state.saveDraft = { key: 'unchanged-intent', signature: 'unchanged-signature' };
    const draft = state.saveDraft;
    comment.value = '未保存的 B';
    commentField.hidden = false;
    locate.listeners.get('click')();
    assert.equal(directory.open, false);
    assert.equal(commentField.hidden, true);
    assert.equal(harness.active.element, harness.elements.get('knowledge-reading'));
    assert.equal(state.selectedEntry, first);
    assert.equal(state.saveDraft, draft);
    assert.equal(state.selection, first.annotation.anchor);
    harness.flush();
    assert.equal(harness.scrolls.length, 1);
    assert.equal(harness.scrolls[0].behavior, 'instant');
    assert.equal(
      harness.quoteTop,
      429,
      'the quote is between projected sticky bottom 256 and nav top 640 with 8px gaps',
    );
    assert.deepEqual(
      harness.rangeOffsets.map(([side, , offset]) => [side, offset]),
      [
        ['start', 1],
        ['end', 3],
      ],
    );
    assert.equal(harness.active.element, harness.quote);
    assert.equal(harness.quote.attributes.get('tabindex'), '-1');
    assert.equal(comment.value, '未保存的 B');
    assert.equal(state.saveDraft, draft);
    assert.match(harness.messages.at(-1), /草稿仍保留/);
  }
  const clean = annotationNavigationHarness();
  clean.locate.listeners.get('click')();
  clean.flush();
  assert.equal(clean.messages.at(-1), '已定位原文。');
});

test('native mark mouseup then click retains the same dirty edit; ordinary cancellation and real drag remain distinct', () => {
  const harness = annotationNavigationHarness();
  harness.edit.listeners.get('click')();
  harness.comment.value = '未保存的 B';
  harness.state.saveDraft = { key: 'B-intent' };
  const selected = harness.state.selectedEntry;
  const selection = harness.state.selection;
  const draft = harness.state.saveDraft;
  harness.clickMark(harness.first, false, true);
  assert.equal(harness.state.selectedEntry, selected);
  assert.equal(harness.state.selection, selection);
  assert.equal(harness.state.saveDraft, draft);
  assert.equal(harness.comment.value, '未保存的 B');
  assert.equal(harness.active.element, harness.comment);
  harness.clickMark(harness.second, true, true);
  assert.equal(harness.state.selectedEntry, selected);
  assert.equal(harness.state.selection, selection);
  assert.equal(harness.state.saveDraft, draft);
  assert.match(harness.messages.at(-1), /未保存|尚未保存/);
  harness.mouseupProse();
  assert.equal(
    harness.state.selectedEntry,
    selected,
    'an ordinary prose click cannot detach an unsaved comment from its original target',
  );
  assert.equal(harness.state.selection, selection);
  assert.equal(harness.state.saveDraft, draft);
  assert.equal(
    harness.comment.value,
    '未保存的 B',
    'ordinary reading clicks preserve the whole editable draft, not just its text',
  );
  harness.api.closePopover({ discard: true });
  harness.mouseupProse();
  assert.equal(harness.state.selectedEntry, null, 'explicit cancel ends the prior edit target');
  assert.equal(harness.state.selection, null, 'a clean prose click cancels the old range');
  assert.equal(harness.state.saveDraft, null);
  const drag = annotationNavigationHarness();
  drag.edit.listeners.get('click')();
  drag.comment.value = '';
  drag.api.closePopover({ discard: true });
  const textNode = drag.quote.textNodes[0];
  drag.root.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => ({
      startContainer: textNode,
      endContainer: textNode,
      startOffset: 0,
      endOffset: 1,
    }),
  });
  drag.clickMark(drag.first, false, true);
  assert.equal(
    drag.state.selection.quote,
    '先',
    'a real noncollapsed drag through a mark still captures the new range',
  );
  assert.equal(
    drag.state.selectedEntry,
    null,
    'the later click cannot replace a genuine drag with the saved mark',
  );
});

test('pending locations cannot pretend to navigate but historical text remains editable', () => {
  const harness = annotationNavigationHarness({ pending: true });
  assert.equal(harness.locate.disabled, true);
  assert.match(harness.locate.title, /仍保留/);
  harness.locate.listeners.get('click')();
  harness.flush();
  assert.equal(harness.scrolls.length, 0);
  assert.equal(harness.directory.open, true);
  harness.edit.listeners.get('click')();
  assert.equal(harness.comment.value, harness.first.content);
  assert.equal(harness.state.selection, harness.first.annotation.anchor);
  assert.match(harness.messages.at(-1), /尚未定位/);
  assert.equal(harness.scrolls.length, 0);
});

test('locate ignores flowing origin/toolbars, clips a visual viewport and honestly refuses a blocked reading band', () => {
  const flowing = annotationNavigationHarness();
  flowing.history.css.position = 'relative';
  flowing.toolbar.css.position = 'relative';
  flowing.quote.attributes.set('tabindex', '0');
  delete flowing.root.FreeBbsLearningReader;
  flowing.locate.listeners.get('click')();
  flowing.flush();
  assert.equal(flowing.quoteTop, 335, 'relative flow boxes do not become a false sticky ceiling');
  assert.equal(
    flowing.quote.attributes.get('tabindex'),
    '0',
    'an existing keyboard target is respected',
  );
  assert.equal(flowing.scrolls.length, 1, 'fallback discovers the real overflowing ancestor');
  const clipped = annotationNavigationHarness();
  clipped.root.visualViewport = { offsetTop: 100, height: 350 };
  clipped.locate.listeners.get('click')();
  clipped.flush();
  assert.equal(clipped.quoteTop, 334);
  assert.ok(clipped.quoteTop >= 256 && clipped.quoteTop + 30 <= 442);
  const blocked = annotationNavigationHarness();
  blocked.nav.getBoundingClientRect = () => ({
    top: 200,
    bottom: 700,
    height: 500,
    left: 0,
    right: 390,
  });
  blocked.comment.value = '未保存';
  blocked.locate.listeners.get('click')();
  blocked.flush();
  assert.equal(blocked.scrolls.length, 0);
  assert.equal(blocked.comment.value, '未保存');
  assert.match(blocked.messages.at(-1), /没有可阅读空间/);
});

test('late locate work cannot scroll or replace status after account, node, document, attachment or editor changes', () => {
  const mutations = [
    (h) => {
      h.app.userState.uid = 'other-student';
    },
    (h) => {
      h.app.userState.token = 'new-session';
    },
    (h) => {
      h.app.userState.isLoggedIn = false;
    },
    (h) => {
      h.state.version += 1;
    },
    (h) => {
      h.state.course = { slug: 'other-course' };
    },
    (h) => {
      h.state.node = { ...h.state.node, id: 'SS-02-01' };
    },
    (h) => {
      h.state.node = { ...h.state.node, documentVersion: changedVersion };
    },
    (h) => {
      h.card.isConnected = false;
    },
    (h) => {
      h.original.isConnected = false;
    },
    (h) => {
      h.elements.set('knowledge-body', { isConnected: true });
    },
    (h) => {
      h.state.selection = { quote: 'another target' };
    },
    (h) => {
      h.state.selectedEntry = h.second;
    },
    (h) => {
      h.state.saveDraft = { key: 'newer intent' };
    },
    (h) => {
      h.comment.value = 'newer typing';
    },
    (h) => {
      h.edit.listeners.get('click')();
    },
    (h) => {
      h.original.closest = () => ({ hidden: true });
    },
  ];
  for (const secondFrame of [false, true]) {
    for (const mutate of mutations) {
      const harness = annotationNavigationHarness();
      harness.locate.listeners.get('click')();
      if (secondFrame) harness.flushOne();
      mutate(harness);
      const messages = [...harness.messages];
      const active = harness.active;
      harness.flush();
      assert.equal(harness.scrolls.length, 0);
      assert.deepEqual(harness.messages, messages);
      assert.equal(
        harness.active,
        active,
        'late work never refocuses another account or editing task',
      );
    }
  }
});

test('closing the nonmodal annotation editor keeps the exact fresh draft for reopening', () => {
  const harness = annotationNavigationHarness();
  harness.state.selection = { quote: 'fresh original' };
  harness.comment.value = 'fresh unsaved comment';
  harness.state.saveDraft = { key: 'fresh-intent' };
  const draft = harness.state.saveDraft;
  harness.commentField.hidden = false;
  harness.api.showPopover('edit');
  assert.equal(harness.popover.hidden, false);
  harness.api.closePopover();
  harness.flush();
  assert.equal(harness.scrolls.length, 0);
  assert.equal(harness.commentField.hidden, true);
  assert.equal(harness.popover.hidden, true);
  assert.equal(harness.comment.value, 'fresh unsaved comment');
  assert.equal(harness.state.saveDraft, draft);
  assert.equal(harness.state.selection.quote, 'fresh original');
  harness.api.showPopover('edit');
  assert.equal(harness.popover.hidden, false);
  assert.equal(harness.commentField.hidden, false);
  assert.equal(harness.comment.value, 'fresh unsaved comment');
  assert.equal(harness.state.saveDraft, draft);
});

test('a saved marker opens details without automatically editing, navigating or saving', () => {
  const harness = annotationNavigationHarness();
  harness.popover.dataset.mode = 'view';
  harness.state.editing = false;
  harness.clickMark();
  assert.equal(harness.popover.hidden, false);
  assert.equal(harness.popover.dataset.mode, 'view');
  assert.equal(harness.commentField.hidden, true);
  assert.equal(harness.comment.value, '');
  assert.equal(harness.state.popoverEntry, harness.first);
  assert.equal(harness.state.selectedEntry, harness.first);
  assert.equal(harness.state.editing, false, 'viewing a mark is not annotation editing mode');
  assert.equal(
    harness.elements.get('learning-annotation-popover-content').textContent,
    harness.first.content,
  );
  assert.equal(harness.scrolls.length, 0);
  assert.equal(harness.active, undefined);
});

test('dedicated annotation pages are not displaced by mixed records and clear on account changes', () => {
  function fakeElement() {
    return {
      children: [],
      dataset: {},
      hidden: false,
      listeners: new Map(),
      attributes: new Map(),
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      append(...children) {
        this.children.push(...children);
      },
      prepend(...children) {
        this.children.unshift(...children);
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
      setAttribute(name, value) {
        this.attributes.set(name, value);
      },
      getAttribute(name) {
        return this.attributes.get(name);
      },
      getBoundingClientRect() {
        return { top: 80, bottom: 200, left: 10, width: 300, height: 120 };
      },
      querySelectorAll() {
        return [];
      },
      querySelector() {
        return null;
      },
      closest() {
        return null;
      },
      close() {
        this.open = false;
      },
      hasAttribute(name) {
        return (
          name === 'data-learning-document-empty' && this.dataset.learningDocumentEmpty === true
        );
      },
      focus() {},
    };
  }
  const page = fakeElement();
  page.querySelector = () => null;
  page.querySelectorAll = () => [];
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
    ['learning-annotation-directory', fakeElement()],
    ['learning-annotation-popover', fakeElement()],
    ['learning-annotation-popover-actions', fakeElement()],
    ...['title', 'quote', 'content', 'info'].map((name) => [
      `learning-annotation-popover-${name}`,
      fakeElement(),
    ]),
  ]);
  elements.get('learning-annotation-directory').open = false;
  elements.get('learning-annotation-popover').hidden = true;
  const field = fakeElement();
  const comment = elements.get('learning-annotation-comment');
  comment.value = '';
  comment.closest = (selector) => (selector === 'label' ? field : null);
  const sessionListeners = new Map();
  const documentListeners = new Map();
  const window = {
    innerWidth: 390,
    innerHeight: 700,
    getComputedStyle: () => ({ position: 'static', overflowY: 'visible' }),
    freeBbsApp: { userState: { uid: '1', token: 'first', isLoggedIn: true } },
    document: {
      body: fakeElement(),
      readyState: 'complete',
      querySelector: () => page,
      getElementById: (id) => elements.get(id),
      createElement: () => fakeElement(),
      addEventListener: (name, callback) => documentListeners.set(name, callback),
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
  const emitUi = (type, event) => page.dispatchEvent({ type, ...event });
  emit('knowledge:loaded', {
    node: { id: 'SS-01-01', documentVersion: version },
    course: { slug: 'signals' },
  });
  assert.equal(
    elements.get('learning-annotation-toolbar').hidden,
    true,
    'reading starts without annotation tools',
  );
  const [block] = stableBlocks([{ text: '学' }]);
  const entry = (id) => ({
    id,
    kind: 'note',
    status: 'private',
    revision: 1,
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
  const selectionLabel = toolbar.children.find(
    (item) => item.id === 'learning-annotation-selection',
  );
  let saved;
  page.addEventListener('knowledge:annotation-save', (event) => {
    saved = event.detail;
  });
  const clickAction = (action = 'highlight') =>
    emitUi('click', {
      target: {
        closest: (selector) =>
          selector === 'button' ? { dataset: { annotationAction: action } } : null,
      },
    });
  const selectSaved = () => cards()[0].children.at(-1).listeners.get('click')();
  const releaseFailedRequest = () =>
    emit('knowledge:annotation-error', {
      requestKey: saved.requestKey,
      status: 503,
      message: '可重试的夹具错误，草稿必须保留。',
    });
  selectSaved();
  assert.equal(toolbar.dataset.hasSelection, 'true');
  window.getSelection = () => ({ rangeCount: 1, isCollapsed: true, anchorNode: {} });
  emitUi('keyup', { key: 'ArrowLeft', target: { closest: () => toolbar } });
  assert.equal(
    toolbar.dataset.hasSelection,
    'true',
    'a toolbar control retains its original quote',
  );
  emitUi('keyup', { key: 'ArrowRight', target: { closest: () => ({ tagName: 'TEXTAREA' }) } });
  assert.equal(
    toolbar.dataset.hasSelection,
    'true',
    'editing the comment does not cancel its original quote',
  );
  emit('knowledge:annotation-records-loaded', { entries: [], nextCursor: '2' });
  clickAction();
  assert.equal(saved.entry.id, '2', 'a missing entry on a paged refresh is not proof of deletion');
  releaseFailedRequest();
  emit('knowledge:annotation-removed', { entryId: 'unrelated' });
  clickAction();
  assert.equal(saved.entry.id, '2', 'another removal does not clear the current edit target');
  releaseFailedRequest();
  emit('knowledge:annotation-removed', { entryId: '2' });
  saved = undefined;
  clickAction();
  assert.equal(
    saved,
    undefined,
    'matching removal ends the old selection instead of reusing a deleted record ID',
  );
  assert.equal(
    toolbar.dataset.hasSelection,
    'false',
    'a removed comment needs a fresh explicit selection before another mark',
  );
  emit('knowledge:annotation-records-loaded', { entries: [entry('2')], nextCursor: '2' });
  selectSaved();
  assert.equal(toolbar.hidden, false, 'explicit editing keeps the one-line toolbar visible');
  const directory = elements.get('learning-annotation-directory');
  const more = directory.children.find((item) => item.id === 'learning-annotations-more');
  const count = directory.children.find((item) => item.id === 'learning-annotations-count');
  assert.equal(directory.open, false, 'paged records do not open a second permanent surface');
  assert.equal(more.hidden, false);
  assert.equal(count.textContent, '已加载 1 条评注');
  let requested;
  page.addEventListener('knowledge:annotations-more', (event) => {
    requested = event.detail;
  });
  more.listeners.get('click')();
  assert.equal(requested.nextCursor, '2');
  clickAction();
  emit('knowledge:annotation-saved', {
    requestKey: saved.requestKey,
    signature: saved.signature,
  });
  assert.equal(toolbar.hidden, false, 'saving does not hide the tools');
  assert.equal(elements.get('learning-annotation-directory').open, false);
  emit('knowledge:entries-loaded', { entries: [entry('3')] });
  assert.deepEqual(
    cards().map((item) => item.dataset.annotationId),
    ['2'],
  );
  const original = fakeElement();
  original.contains = () => true;
  original.closest = () => null;
  original.querySelectorAll = () => [];
  elements.set('knowledge-body', original);
  selectSaved();
  assert.equal(selectionLabel.textContent, '已选原文：学');
  const liveComment = elements.get('learning-annotation-comment');
  liveComment.value = '原先提交的 A';
  clickAction();
  const acknowledgment = {
    requestKey: saved.requestKey,
    signature: saved.signature,
    entryId: saved.entry.id,
    previousRevision: saved.entry.revision,
    revision: saved.entry.revision + 1,
  };
  liveComment.value = '后来输入的 B';
  emit('knowledge:annotation-saved', acknowledgment);
  assert.equal(liveComment.value, '后来输入的 B', 'a slow A receipt cannot erase later typing B');
  assert.equal(toolbar.dataset.hasSelection, 'true', 'the live quote is retained for B');
  assert.match(elements.get('learning-annotation-status').textContent, /当前修改还未保存/);
  clickAction();
  assert.equal(saved.entry.revision, 2, 'B uses the confirmed own A revision, not a stale base');
  const laterAcknowledgment = { requestKey: saved.requestKey, signature: saved.signature };
  emit('knowledge:annotation-saved', acknowledgment);
  assert.equal(
    liveComment.value,
    '后来输入的 B',
    'an older receipt cannot clear a new save intent',
  );
  emit('knowledge:annotation-saved', laterAcknowledgment);
  assert.equal(liveComment.value, '', 'the matching unchanged B receipt may clear only B');
  assert.equal(toolbar.dataset.hasSelection, 'false');
  selectSaved();
  original.dataset.learningDocumentEmpty = true;
  saved = undefined;
  clickAction();
  assert.equal(saved, undefined, 'an existing mistaken UI-copy quote cannot be saved again');
  assert.match(elements.get('learning-annotation-status').textContent, /普通笔记/);
  let removeRequested;
  page.addEventListener('knowledge:annotation-remove', (event) => {
    removeRequested = event.detail.entry.id;
  });
  emitUi('click', {
    target: {
      closest: (selector) =>
        selector === 'button' ? { dataset: { annotationAction: 'remove' } } : null,
    },
  });
  assert.equal(removeRequested, '2', 'historical mistaken quotes can still be explicitly deleted');
  original.dataset.learningDocumentEmpty = false;
  emitUi('keyup', { key: 'Shift', target: { closest: () => null } });
  assert.equal(
    toolbar.dataset.hasSelection,
    'false',
    'an explicit collapsed original-text selection clears its pending quote and record ID',
  );
  assert.ok(!selectionLabel.textContent.includes('已选原文'));
  saved = undefined;
  clickAction();
  assert.equal(
    saved,
    undefined,
    'cancelled native selections cannot save the previous one-character quote',
  );
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
