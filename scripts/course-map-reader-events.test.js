const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const navigation = require('../public/course-navigation');
const progress = require('../public/learning-progress');

function personalContextHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-map.js'), 'utf8');
  const readStart = source.indexOf('  function readLocalJson(');
  const readEnd = source.indexOf('\n  function renderNodeTags', readStart);
  const metaStart = source.indexOf('  function renderReaderMeta()');
  const metaEnd = source.indexOf('\n  function renderReaderHeader()', metaStart);
  const start = source.indexOf('  let progressScope =');
  const end = source.indexOf('\n  let initializing =', start);
  const storage = new Map([['free_bbs_auth_token', 'token-a']]);
  const events = new Map();
  const updates = [];
  const meta = {
    children: [],
    replacements: 0,
    replaceChildren() {
      this.children = [];
      this.replacements += 1;
    },
    append(item) {
      this.children.push(item);
    },
  };
  const focusTarget = {};
  const app = { userState: { isLoggedIn: true, uid: 'a', token: 'token-a' } };
  const state = {
    course: { slug: 'signals' },
    progress: {},
    nodes: ['SS-01-01', 'SS-02-01', 'SS-01-00'].map((id) => ({ id })),
    readerLayout: 'structure',
    structureController: { updatePersonalContext: (value) => updates.push({ ...value }) },
  };
  let denied = false;
  const environment = {
    app,
    state,
    mapPage: {},
    courseSlug: 'signals',
    PROGRESS_STORAGE_KEY: 'free_bbs_course_progress_v1',
    CURRENT_LEARNING_STORAGE_KEY: 'free_bbs_current_learning_node_v1',
    KNOWLEDGE_TAGS: [{ key: 'important' }, { key: 'learned' }, { key: 'consolidated' }],
    courseChapters: () => [{ id: 'SS-01' }, { id: 'SS-02' }],
    document: {
      activeElement: focusTarget,
      getElementById: (id) => {
        assert.equal(id, 'course-reader-meta', 'Personal refresh must not touch title/navigation');
        return meta;
      },
      createElement: () => ({}),
    },
    window: {
      FreeBbsLearningProgress: progress,
      FreeBbsLearningContent: { isChapterNode: (node) => /-0+$/.test(node.id) },
      addEventListener: (name, callback) => events.set(name, callback),
    },
    nodeById: (id) => state.nodes.find((node) => node.id === id),
  };
  Object.defineProperty(environment, 'localStorage', {
    get() {
      if (denied) throw new Error('Storage denied');
      return { getItem: (key) => storage.get(key) ?? null };
    },
  });
  vm.runInNewContext(
    `${source.slice(readStart, readEnd)}\n${source.slice(metaStart, metaEnd)}\n${source.slice(start, end)}\nglobalThis.read = readLocalJson; globalThis.recent = getLearningNodeId;`,
    environment,
  );
  const put = (base, owner, value) => {
    const key = progress.scopedKey(base, { isLoggedIn: true, uid: owner });
    storage.set(key, JSON.stringify(value));
    return key;
  };
  return {
    state,
    app,
    storage,
    updates,
    meta,
    metaText: () => meta.children.map((item) => item.textContent).join(' | '),
    focus: () => environment.document.activeElement,
    focusTarget,
    put,
    read: environment.read,
    recent: environment.recent,
    deny: () => {
      denied = true;
    },
    emit: (name, value = {}) => events.get(name)?.(value),
  };
}

test('same-owner live recent refresh does not rebuild lookup and ignores other owners and courses', () => {
  const h = personalContextHarness();
  const currentBase = 'free_bbs_current_learning_node_v1';
  const progressBase = 'free_bbs_course_progress_v1';
  h.put(currentBase, 'a', { signals: 'SS-01-01' });
  h.emit('focus');
  assert.deepEqual(h.updates, [{ resumeNodeId: 'SS-01-01' }]);
  const ownKey = h.put(currentBase, 'a', { signals: 'SS-02-01' });
  h.emit('storage', { key: ownKey });
  assert.deepEqual(h.updates.at(-1), { resumeNodeId: 'SS-02-01' });
  const count = h.updates.length;
  const otherKey = h.put(currentBase, 'b', { signals: 'SS-01-01' });
  h.emit('storage', { key: otherKey });
  h.put(currentBase, 'a', { signals: 'SS-02-01', math: 'MA-01-01' });
  h.emit('storage', { key: ownKey });
  const progressKey = h.put(progressBase, 'a', { math: { 'MA-01-01': { status: 'review' } } });
  h.emit('storage', { key: progressKey });
  h.emit('pageshow', { persisted: true });
  assert.equal(h.updates.length, count);
  h.put(progressBase, 'a', { signals: { 'SS-02-01': { tags: ['learned'] } } });
  h.emit('storage', { key: progressKey });
  assert.equal(h.updates.length, count + 1, 'Own tags also update in place');
});

test('auth replacement clears private decorations immediately and stale owner events cannot resurrect them', () => {
  const h = personalContextHarness();
  const ownKey = h.put('free_bbs_current_learning_node_v1', 'a', { signals: 'SS-01-01' });
  h.emit('focus');
  h.storage.set('free_bbs_auth_token', 'token-b');
  h.emit('storage', { key: 'free_bbs_auth_token' });
  assert.deepEqual(h.updates.at(-1), { resumeNodeId: '' });
  h.put('free_bbs_current_learning_node_v1', 'a', { signals: 'SS-02-01' });
  const count = h.updates.length;
  h.emit('storage', { key: ownKey });
  h.emit('focus');
  h.emit('pageshow', { persisted: true });
  assert.equal(h.updates.length, count);
  h.put('free_bbs_current_learning_node_v1', 'b', { signals: 'SS-02-01' });
  h.app.userState = { isLoggedIn: true, uid: 'b', token: 'token-b' };
  h.emit('freebbs:session-change');
  assert.deepEqual(h.updates.at(-1), { resumeNodeId: 'SS-02-01' });
});

test('chapter nodes never become a recent point and denied storage does not block public content', () => {
  const h = personalContextHarness();
  h.put('free_bbs_current_learning_node_v1', 'a', { signals: 'SS-01-00' });
  h.state.progress = {
    signals: {
      'SS-01-00': { status: 'review', updatedAt: '2026-10-16' },
      'SS-01-01': { status: 'review', updatedAt: '2026-10-15' },
    },
  };
  assert.equal(h.recent(), 'SS-01-01');
  h.deny();
  assert.deepEqual({ ...h.read('free_bbs_course_progress_v1') }, {});
  assert.doesNotThrow(() => h.emit('focus'));
  assert.deepEqual(h.updates.at(-1), { resumeNodeId: '' });
  assert.equal(h.state.course.slug, 'signals');
});

test('live learned metadata follows own tags, unmarking and auth clear without rebuilding navigation or moving focus', () => {
  const h = personalContextHarness();
  const controller = h.state.structureController;
  const base = 'free_bbs_course_progress_v1';
  const ownerKey = h.put(base, 'a', {
    signals: {
      'SS-01-01': { tags: ['learned'] },
      'SS-01-00': { tags: ['learned'] },
    },
  });
  h.emit('focus');
  assert.match(h.metaText(), /2 个章节.*2 个知识点.*已标记学习 1 个/);
  h.put(base, 'a', { signals: { 'SS-01-01': { tags: [] } } });
  h.emit('storage', { key: ownerKey });
  assert.doesNotMatch(h.metaText(), /已标记学习/);
  h.put(base, 'a', { signals: { 'SS-02-01': { tags: ['consolidated'] } } });
  h.emit('storage', { key: ownerKey });
  assert.match(h.metaText(), /已标记学习 1 个/);
  const replacements = h.meta.replacements;
  const foreignKey = h.put(base, 'b', { signals: { 'SS-01-01': { tags: ['learned'] } } });
  h.emit('storage', { key: foreignKey });
  assert.equal(h.meta.replacements, replacements);
  h.storage.set('free_bbs_auth_token', 'token-b');
  h.emit('storage', { key: 'free_bbs_auth_token' });
  assert.doesNotMatch(h.metaText(), /已标记学习/);
  assert.match(h.metaText(), /2 个章节.*2 个知识点/);
  assert.equal(h.state.structureController, controller);
  assert.equal(h.focus(), h.focusTarget);
});

function loadRecoveryHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-map.js'), 'utf8');
  const start = source.indexOf('  let initializing =');
  const end = source.lastIndexOf('\n  initialize();');
  const created = [];
  const messages = [];
  const title = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus(options) {
      environment.document.activeElement = this;
      this.focusOptions = options;
    },
  };
  let calls = 0;
  let binds = 0;
  let renders = 0;
  let nextResponse = () => Promise.reject(new Error('HTTP 503：课程暂不可用'));
  const state = { nodes: [], course: null };
  const element = (tag) => {
    const value = {
      tag,
      children: [],
      listeners: {},
      setAttribute() {},
      append(...items) {
        this.children.push(...items);
      },
      contains(item) {
        return this.children.includes(item);
      },
      focus() {
        environment.document.activeElement = this;
      },
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      },
      remove() {
        this.removed = true;
      },
    };
    created.push(value);
    return value;
  };
  const environment = {
    app: {
      sessionReady: Promise.resolve(),
      callApi: () => {
        calls += 1;
        return nextResponse();
      },
    },
    state,
    mapPage: {},
    editorPage: null,
    params: new URLSearchParams('focus=SS-02-01'),
    courseSlug: 'signals',
    status: { after() {} },
    document: { body: {}, createElement: element, getElementById: () => title },
    personalContextIsCurrent: () => false,
    courseChapters: () => [{ id: 'SS-01' }, { id: 'SS-02' }],
    chapterIdForNodeId: (id) => (id ? id.split('-').slice(0, 2).join('-') : ''),
    nodeById: (id) => state.nodes.find((node) => node.id === id),
    window: { FreeBbsLearningContent: { isChapterNode: () => false } },
    renderReaderHeader() {},
    bindReaderViewport: () => {
      binds += 1;
    },
    renderMap: () => {
      renders += 1;
      environment.document.activeElement = { className: 'course-structure-current' };
    },
    setSaveState() {},
    setStatus: (value, error) => messages.push({ value, error }),
  };
  environment.document.activeElement = environment.document.body;
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.load = initialize;`, environment);
  return {
    state,
    created,
    messages,
    title,
    document: environment.document,
    load: environment.load,
    respond: (callback) => {
      nextResponse = callback;
    },
    calls: () => calls,
    binds: () => binds,
    renders: () => renders,
  };
}

test('an initial map failure offers a native manual retry, keeps its error and restores requested point on success', async () => {
  const h = loadRecoveryHarness();
  await h.load();
  assert.equal(h.calls(), 1, 'A failure never starts an automatic retry');
  assert.match(h.messages.at(-1).value, /HTTP 503/);
  const retry = h.created.find((item) => item.tag === 'button');
  const back = h.created.find((item) => item.tag === 'a');
  assert.equal(retry.type, 'button');
  assert.equal(retry.textContent, '重新加载课程');
  assert.equal(back.href, '/world');
  assert.equal(h.title.textContent, '课程暂时无法加载');
  let resolve;
  h.respond(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  h.document.activeElement = retry;
  const loading = retry.listeners.click();
  await Promise.resolve();
  assert.equal(retry.disabled, true);
  assert.equal(retry.textContent, '正在加载…');
  await h.load();
  assert.equal(h.calls(), 2, 'Repeated activation does not create a second in-flight request');
  resolve({ course: { name: '信号与系统' }, nodes: [{ id: 'SS-02-01' }], edges: [] });
  await loading;
  assert.equal(h.state.focusedNodeId, 'SS-02-01');
  assert.equal(h.state.activeChapterId, 'SS-02');
  assert.equal(h.binds(), 1);
  assert.equal(h.created.find((item) => item.tag === 'nav').removed, true);
  assert.equal(h.messages.at(-1).value, '');
  assert.equal(h.document.activeElement, h.title);
  assert.equal(h.title.attributes.tabindex, '-1');
  assert.deepEqual({ ...h.title.focusOptions }, { preventScroll: true });
  h.respond(() => Promise.resolve({ course: { name: '信号与系统' }, nodes: [{ id: 'SS-02-01' }] }));
  await h.load();
  assert.equal(h.binds(), 1, 'Successful reinitialization never duplicates viewport bindings');
});

test('a repeated retry failure re-enables the same manual control and does not duplicate the recovery region', async () => {
  const h = loadRecoveryHarness();
  await h.load();
  const retry = h.created.find((item) => item.tag === 'button');
  await retry.listeners.click();
  assert.equal(h.calls(), 2);
  assert.equal(retry.disabled, false);
  assert.equal(h.created.filter((item) => item.tag === 'nav').length, 1);
  assert.match(h.messages.at(-1).value, /HTTP 503/);
});

test('retry completion never steals focus after a learner moved to the return link', async () => {
  const h = loadRecoveryHarness();
  await h.load();
  const retry = h.created.find((item) => item.tag === 'button');
  const back = h.created.find((item) => item.tag === 'a');
  let resolve;
  h.respond(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = retry.listeners.click();
  await new Promise(setImmediate);
  h.document.activeElement = back;
  resolve({ course: { name: '信号与系统' }, nodes: [{ id: 'SS-02-01' }] });
  await pending;
  assert.equal(h.document.activeElement, back);
  assert.equal(h.title.attributes.tabindex, undefined);
  const region = h.created.find((item) => item.tag === 'nav');
  assert.notEqual(region.removed, true);
  assert.equal(retry.removed, true);
  region.listeners.focusout({ relatedTarget: h.title });
  assert.equal(region.removed, true);
});

function overviewFallbackHarness({
  drawer = null,
  navigationApi = navigation,
  snapshot = {},
} = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/course-map.js'), 'utf8');
  const start = source.indexOf('  function openReaderOverview(');
  const end = source.indexOf('\n  function mapEditorHref()', start);
  const assignments = [];
  const remembered = [];
  const calls = [];
  const state = {
    course: { slug: 'signals', name: '信号与系统' },
    structureController: { getNavigationState: () => snapshot },
  };
  const environment = {
    URLSearchParams,
    courseSlug: 'signals',
    state,
    overviewDrawer: drawer && {
      open: (...args) => {
        calls.push(args);
        return drawer;
      },
    },
    window: {
      FreeBbsCourseNavigation: navigationApi && {
        ...navigationApi,
        remember: (...args) => remembered.push(args),
      },
      location: { assign: (url) => assignments.push(url) },
    },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.open = openReaderOverview;`, environment);
  return { open: environment.open, assignments, remembered, calls, state };
}

test('an explicit point opens readable same-origin content with safe return context when the optional overview is unavailable', () => {
  const snapshot = {
    focus: 'SS-02-01',
    chapter: 'SS-02',
    catalogQuery: '卷积',
    catalogPage: 1,
    catalogOpen: 1,
  };
  const h = overviewFallbackHarness({ snapshot });
  assert.equal(h.open({ id: 'SS-02-01' }), true);
  const destination = new URL(h.assignments[0], 'https://local.example');
  assert.equal(destination.origin, 'https://local.example');
  assert.equal(destination.pathname, '/knowledge');
  assert.equal(destination.searchParams.get('point'), 'SS-02-01');
  assert.equal(destination.searchParams.get('view'), 'reading');
  const returnTo = destination.searchParams.get('returnTo');
  assert.equal(navigation.parse(returnTo, 'signals').get('catalogQuery'), '卷积');
  assert.equal(navigation.parse(returnTo, 'signals').get('catalogPage'), '1');
  assert.deepEqual(h.remembered, [[returnTo, 'signals']]);
});

test('normal overview remains first and retains its trigger, relation callback and catalog dismissal options', () => {
  const drawer = {};
  const h = overviewFallbackHarness({ drawer });
  const node = { id: 'SS-02-01' };
  const trigger = {};
  const relation = () => {};
  const options = { onDismiss: () => true };
  assert.equal(h.open(node, trigger, relation, options), drawer);
  assert.deepEqual(h.calls, [[node, h.state.course, trigger, relation, options]]);
  assert.deepEqual(h.assignments, []);
  assert.deepEqual(h.remembered, []);
});

test('failed or missing return helpers never strand a chosen point and invalid optional context is not replayed', () => {
  for (const settings of [
    { navigationApi: null },
    { snapshot: { chapter: '<script>' } },
    {
      navigationApi: {
        encode() {
          throw new Error('optional unavailable');
        },
      },
    },
  ]) {
    const h = overviewFallbackHarness(settings);
    h.open({ id: 'SS-02-01' });
    assert.equal(h.assignments[0], '/knowledge?course=signals&point=SS-02-01&view=reading');
    assert.deepEqual(h.remembered, []);
  }
  const h = overviewFallbackHarness();
  assert.equal(h.open(null), false);
  assert.deepEqual(h.assignments, []);
});

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
      const options = [];
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
            render: (settings) => {
              options.push(settings);
              return {
                focusNode: (id) => calls.push(['focus', id]),
                selectChapter: (id) => calls.push(['chapter', id]),
              };
            },
          },
        },
        renderReaderHeader() {},
        getNodeTags: () => [],
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
      assert.equal(options.length, 1);
      assert.equal(options[0].resumeNodeId, 'SS-02-02');
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
