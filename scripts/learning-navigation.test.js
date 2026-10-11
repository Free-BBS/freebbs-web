const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Executes the actual loading/view/initialize functions with a small DOM and deferred GETs.
// Course data, renderer dependencies and storage are fixtures, not real HTTP/Chrome/DB.
function loadingFixture({ point = 'SS-02-01' } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  const elements = new Map();
  [...html.matchAll(/\bid="([^"]+)"/g)].forEach((match) => {
    const attributes = new Map();
    const classes = new Set();
    elements.set(match[1], {
      textContent: '',
      innerHTML: '',
      hidden: false,
      disabled: false,
      focusCount: 0,
      scrollCount: 0,
      before() {},
      setAttribute: (key, value) => attributes.set(key, value),
      hasAttribute: (key) => attributes.has(key),
      removeAttribute: (key) => attributes.delete(key),
      toggleAttribute(key, value) {
        if (value) attributes.set(key, '');
        else attributes.delete(key);
      },
      classList: {
        add: (value) => classes.add(value),
        remove: (value) => classes.delete(value),
        toggle(value, enabled) {
          if (enabled) classes.add(value);
          else classes.delete(value);
        },
        contains: (value) => classes.has(value),
      },
      focus() {
        this.focusCount += 1;
      },
      scrollIntoView() {
        this.scrollCount += 1;
      },
    });
  });
  const button = elements.get('knowledge-start-reading');
  const label = elements.get('knowledge-start-reading-label');
  const reading = elements.get('knowledge-reading');
  reading.classList.add('hidden');
  const attrs = new Map();
  let errorHtml = '';
  const errorControls = new Map();
  let reloadCount = 0;
  let removed = false;
  const events = [];
  const page = {
    setAttribute: (key, value) => attrs.set(key, value),
    dispatchEvent: (event) => events.push(event),
    set innerHTML(value) {
      errorHtml = value;
      removed = true;
      errorControls.clear();
      for (const match of value.matchAll(/<(button|a)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const attributes = new Map(
          [...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [
            attribute[1],
            attribute[2],
          ]),
        );
        const handlers = new Map();
        errorControls.set(match[3], {
          tagName: match[1].toUpperCase(),
          getAttribute: (name) => attributes.get(name),
          addEventListener: (name, handler) => handlers.set(name, handler),
          click: () => handlers.get('click')?.(),
        });
      }
    },
  };
  const requests = [];
  const pending = new Map();
  const app = {
    sessionReady: Promise.resolve(),
    userState: { uid: 'student-A', token: 'token-A' },
    renderMarkdownContent: (value) => value,
    enhanceMarkdownContent() {},
    callApi(url) {
      requests.push(url);
      return new Promise((resolve, reject) => {
        pending.set(url, { resolve, reject });
      });
    },
  };
  const saved = [];
  const state = { node: null, course: null, map: null, view: 'reading' };
  const sandbox = {
    state,
    page,
    app,
    nodeId: point,
    courseSlug: 'signals',
    params: new URLSearchParams(),
    URLSearchParams,
    document: {
      getElementById: (id) => errorControls.get(id) || (removed ? null : elements.get(id) || null),
    },
    window: {
      location: {
        reload: () => {
          reloadCount += 1;
        },
      },
      FreeBbsLearningContent: {
        originMarkdown: (sections) => sections?.originMarkdown || '',
        stripQuizSource: (value) => value,
        isChapterNode: () => false,
        renderNetwork() {},
      },
      FreeBbsKnowledgeOverview: { render() {} },
    },
    CustomEvent: function Event(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
    escapeHtml: (value) => String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    saveCurrentLearningNode: (id) => saved.push({ uid: app.userState.uid, id }),
    courseDirectoryHref: () => '/course?course=signals',
    getStoredTags: () => ({}),
    renderTags() {},
    renderKnowledgeSequence() {},
    syncDiscussionContext() {},
    loadDiscussionPosts() {},
    navigateLearning() {},
    bindTagControls() {},
    bindWorkspaceControls() {},
    bindChatControls() {},
    bindDiscussionComposer() {},
    restoreInteractionPreferences() {},
    restoreChatDraft: async () => {},
    restoreDiscussionPostDraft() {},
    updateDiscussionFormControls() {},
  };
  const ranges = [
    ['  function setKnowledgeView(', '  function toggleKnowledgeTag('],
    ['  function setKnowledgeLoading(', '  function bindTagControls('],
    ['  function renderKnowledgeContent(', "  page.addEventListener('knowledge:document-saved'"],
    ['  async function initialize()', '  initialize();'],
  ];
  const code = ranges
    .map(([start, end]) => {
      const first = source.indexOf(start);
      const last = source.indexOf(end, first);
      assert.ok(first >= 0 && last > first);
      return source.slice(first, last);
    })
    .join('\n');
  vm.runInNewContext(code, sandbox);
  return {
    html,
    sandbox,
    elements,
    state,
    app,
    pending,
    requests,
    saved,
    events,
    button,
    label,
    reading,
    attrs,
    error: () => errorHtml,
    errorControls,
    reloadCount: () => reloadCount,
  };
}

const settleLoadingFixture = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });
const loadingPointPath = '/courses/signals/map/nodes/SS-02-01';
const loadingMapPath = '/courses/signals/map';
const loadedPointFixture = {
  course: { name: 'Fixture course' },
  node: { id: 'SS-02-01', title: 'Fixture B', markdown: 'Fixture B text', sections: {} },
};

test('initial HTML distinguishes pending material from missing origin or sequence boundaries', () => {
  const qa = loadingFixture();
  const readingTag = qa.html.match(/<button\b[^>]*id="knowledge-start-reading"[^>]*>/s)?.[0];
  assert.match(readingTag, /\bdisabled\b/);
  assert.match(qa.html, /id="knowledge-title">正在载入知识点…/);
  assert.match(qa.html, /id="knowledge-previous-title">正在载入前后知识点…/);
  assert.match(qa.html, /id="knowledge-next-title">正在载入前后知识点…/);
  assert.doesNotMatch(qa.html, /本知识点尚未提供起源说明|已经是第一个知识点|已经是最后一个知识点/);
});

test('actual initialize keeps reading blocked until both public GETs resolve, then restores every reading/overview transition', async () => {
  const qa = loadingFixture();
  const loading = qa.sandbox.initialize();
  await settleLoadingFixture();
  assert.equal(qa.attrs.get('aria-busy'), 'true');
  assert.equal(qa.button.disabled, true);
  assert.equal(qa.label.textContent, '正在载入正文…');
  qa.sandbox.setKnowledgeView('reading', { focus: true });
  assert.equal(qa.reading.classList.contains('hidden'), true);
  assert.deepEqual(qa.saved, []);
  assert.deepEqual(qa.events, []);
  qa.pending.get(loadingPointPath).resolve(loadedPointFixture);
  await settleLoadingFixture();
  assert.equal(qa.state.node, null, 'A successful node GET cannot bypass the pending map GET');
  assert.equal(qa.button.disabled, true);
  qa.pending.get(loadingMapPath).resolve({ nodes: [loadedPointFixture.node] });
  await loading;
  assert.equal(
    qa.error(),
    '',
    'The actual renderer must complete, not be mistaken for a load failure',
  );
  assert.equal(qa.attrs.get('aria-busy'), 'false');
  assert.equal(qa.button.disabled, false);
  assert.equal(qa.label.textContent, '开始阅读正文');
  assert.equal(qa.elements.get('knowledge-start-reading-arrow').hidden, false);
  assert.equal(qa.elements.get('knowledge-title').textContent, 'Fixture B');
  assert.equal(qa.reading.classList.contains('hidden'), false);
  assert.equal(qa.events.filter((event) => event.type === 'knowledge:loaded').length, 1);
  qa.sandbox.setKnowledgeView('overview', { focus: true });
  assert.equal(qa.reading.classList.contains('hidden'), true);
  qa.sandbox.setKnowledgeView('reading', { focus: true });
  assert.equal(qa.reading.classList.contains('hidden'), false);
  assert.equal(qa.reading.focusCount, 1);
  assert.equal(qa.saved.at(-1).id, 'SS-02-01');
});

test('partial GET failure terminates loading explicitly without enabling reading or saving a new current point', async () => {
  const qa = loadingFixture();
  const loading = qa.sandbox.initialize();
  await settleLoadingFixture();
  qa.pending.get(loadingPointPath).resolve(loadedPointFixture);
  qa.pending.get(loadingMapPath).reject(new Error('503 <unavailable>'));
  await loading;
  assert.equal(qa.state.node, null);
  assert.equal(qa.button.disabled, true);
  assert.equal(qa.attrs.get('aria-busy'), 'false');
  assert.match(qa.error(), /role="alert"/);
  assert.match(qa.error(), /503 &lt;unavailable&gt;/);
  assert.deepEqual(qa.saved, []);
  assert.equal(
    qa.events.some((event) => event.type === 'knowledge:loaded'),
    false,
  );
  assert.equal(qa.requests.length, 2, 'Failure never starts an automatic retry');
});

test('missing point fails before any GET or current-record update', async () => {
  const qa = loadingFixture({ point: '' });
  await qa.sandbox.initialize();
  assert.match(qa.error(), /未指定知识结点/);
  assert.equal(qa.attrs.get('aria-busy'), 'false');
  assert.equal(qa.button.disabled, true);
  assert.deepEqual(qa.requests, []);
  assert.deepEqual(qa.saved, []);
});

test('public-load failure offers native recovery controls and reloads only on explicit action', async () => {
  const qa = loadingFixture();
  const loading = qa.sandbox.initialize();
  await settleLoadingFixture();
  qa.pending.get(loadingPointPath).resolve(loadedPointFixture);
  qa.pending.get(loadingMapPath).reject(new Error('503 unavailable'));
  await loading;
  const reload = qa.errorControls.get('knowledge-reload-page');
  const back = qa.errorControls.get('knowledge-error-return');
  assert.equal(reload.tagName, 'BUTTON');
  assert.equal(reload.getAttribute('type'), 'button');
  assert.equal(back.tagName, 'A');
  assert.equal(
    back.getAttribute('href'),
    '/world',
    'Unconfirmed query course is not a return target',
  );
  assert.match(qa.error(), />重新加载<|>返回学习世界</);
  assert.equal(qa.reloadCount(), 0);
  assert.equal(qa.requests.length, 2);
  reload.click();
  assert.equal(qa.reloadCount(), 1);
  assert.equal(qa.requests.length, 2, 'Recovery does not rebind or rerun initialize');
  assert.deepEqual(qa.saved, []);
  assert.equal(
    qa.events.some((event) => event.type === 'knowledge:loaded'),
    false,
  );
});

test('error return targets only a confirmed safe course slug, otherwise the learning world', () => {
  for (const [slug, expected] of [
    ['signals', '/course?course=signals'],
    ['calculus-1', '/course?course=calculus-1'],
    ['signals?next=https://example.com', '/world'],
    ['../adminusers', '/world'],
    // eslint-disable-next-line no-script-url -- An unsafe fixture must never become a return URL.
    ['javascript:alert(1)', '/world'],
    ['', '/world'],
    [undefined, '/world'],
  ]) {
    const qa = loadingFixture();
    qa.state.course = { slug };
    qa.sandbox.showPageError('<script>unsafe</script>');
    const back = qa.errorControls.get('knowledge-error-return');
    assert.equal(back.getAttribute('href'), expected);
    assert.match(qa.error(), /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(qa.error(), /<script>/);
    assert.equal(qa.reloadCount(), 0);
    assert.deepEqual(qa.requests, []);
    assert.deepEqual(qa.saved, []);
  }
});

test('a session switch during public loading keeps the entry pending and never saves under a captured old identity', async () => {
  const qa = loadingFixture();
  const loading = qa.sandbox.initialize();
  await settleLoadingFixture();
  qa.app.userState = { uid: 'student-B', token: 'token-B' };
  qa.sandbox.setKnowledgeView('reading', { focus: true });
  assert.equal(qa.button.disabled, true);
  assert.deepEqual(qa.saved, []);
  qa.pending.get(loadingPointPath).resolve(loadedPointFixture);
  qa.pending.get(loadingMapPath).resolve({ nodes: [loadedPointFixture.node] });
  await loading;
  assert.equal(qa.saved.length, 1);
  assert.deepEqual(qa.saved[0], { uid: 'student-B', id: 'SS-02-01' });
});

test('actual renderer claims missing origin only after loaded data, and hides that claim when an origin exists', () => {
  const qa = loadingFixture();
  qa.state.node = loadedPointFixture.node;
  qa.sandbox.renderKnowledgeContent(qa.state.node);
  const empty = qa.elements.get('knowledge-history-empty');
  assert.equal(empty.textContent, '本知识点尚未提供起源说明。');
  assert.equal(empty.hasAttribute('hidden'), false);
  qa.state.node = {
    ...loadedPointFixture.node,
    sections: { originMarkdown: 'Actual fixture origin' },
  };
  qa.sandbox.renderKnowledgeContent(qa.state.node);
  assert.equal(qa.elements.get('knowledge-history-prose').innerHTML, 'Actual fixture origin');
  assert.equal(empty.hasAttribute('hidden'), true);
});

// Actual chat functions with a lightweight geometry/DOM fixture; not native layout or focus QA.
function chatFixture(width = 390, viewport = { height: 640, offsetTop: 0 }) {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const properties = new Map();
  const timers = [];
  const frames = [];
  const focuses = [];
  const classes = () => ({ toggle() {} });
  const view = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 140, bottom: (viewport?.height || 640) - 12 }),
  };
  const input = {
    value: '尚未提交的聊天草稿',
    getBoundingClientRect: () => ({ top: 760 - view.scrollTop, bottom: 810 - view.scrollTop }),
    closest: (selector) => (selector === '.knowledge-chat-view' ? view : null),
    focus(options) {
      focuses.push({ target: 'input', options });
      sandbox.document.activeElement = input;
    },
  };
  const discussion = {
    focus: (options) => focuses.push({ target: 'discussion', options }),
    closest: () => null,
  };
  const toggle = {
    classList: classes(),
    setAttribute() {},
    querySelector: () => ({ textContent: '' }),
    focus: (options) => focuses.push({ target: 'toggle', options }),
  };
  const panel = { classList: classes(), toggleAttribute() {} };
  const workbench = {
    style: { setProperty: (key, value) => properties.set(key, value) },
    classList: classes(),
  };
  const elements = new Map([
    ['knowledge-workbench', workbench],
    ['knowledge-chat-panel', panel],
    ['knowledge-panel-resizer', { classList: classes(), toggleAttribute() {} }],
    ['knowledge-chat-toggle', toggle],
    ['knowledge-chat-toggle-symbol', { textContent: '' }],
    ['knowledge-chat-input', input],
  ]);
  let captures = 0;
  let restores = 0;
  let persists = 0;
  const state = {
    chatOpen: false,
    chatTab: 'max',
    learningTask: { goal: 'concepts', tool: 'feedback', questionId: 'Q02' },
  };
  const sandbox = {
    state,
    document: {
      activeElement: null,
      getElementById: (id) => elements.get(id),
      querySelector: () => discussion,
    },
    window: {
      innerHeight: 640,
      visualViewport: viewport,
      matchMedia: () => ({ matches: width <= 920 }),
      setTimeout: (callback) => timers.push(callback),
      requestAnimationFrame: (callback) => frames.push(callback),
      FreeBbsLearningReader: {
        capture() {
          captures += 1;
          return { scrollTop: 1200 };
        },
        restore() {
          restores += 1;
        },
      },
    },
    persistInteractionPreferences: () => {
      persists += 1;
    },
  };
  const ranges = [
    ['  function revealNarrowChatControl(', '  function setToolsCollapsed('],
    ['  function setChatOpen(', '  function renderChatMessage('],
    ['  function setHidden(', '  function readInteractionPreferences('],
  ];
  vm.runInNewContext(
    ranges
      .map(([start, end]) => {
        const first = source.indexOf(start);
        const last = source.indexOf(end, first);
        assert.ok(first >= 0 && last > first);
        return source.slice(first, last);
      })
      .join('\n'),
    sandbox,
  );
  return {
    sandbox,
    state,
    input,
    view,
    focuses,
    properties,
    flushTimers: () => timers.splice(0).forEach((callback) => callback()),
    flushFrames: () => frames.splice(0).forEach((callback) => callback()),
    counts: () => ({ captures, restores, persists }),
  };
}

test('narrow chat source contract overrides implicit grid/static/min-height only at the inclusive 920 breakpoint', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/knowledge-workspace.css'), 'utf8');
  const override = css.slice(css.indexOf('/* Narrow interaction is a viewport drawer'));
  assert.match(override, /@media \(max-width: 920px\)/);
  assert.match(override, /72px \+ env\(safe-area-inset-top, 0px\)/);
  assert.match(override, /\.knowledge-page \.knowledge-workbench \.knowledge-chat,/);
  assert.match(override, /grid-column: auto;\s*grid-row: auto;\s*position: fixed;/);
  assert.match(override, /min-height: 0;/);
  assert.match(override, /var\(--knowledge-chat-viewport-height, 100dvh\)/);
  assert.match(override, /overflow-y: auto;\s*overscroll-behavior: contain;/);
  assert.match(override, /@media \(max-width: 900px\)/);
  assert.match(override, /60px \+ env\(safe-area-inset-top, 0px\)/);
  assert.match(override, /env\(safe-area-inset-bottom, 0px\)/);
});

test('chat opening reveals only the local drawer control at 320/390/920, with unchanged desktop focus semantics', () => {
  for (const width of [320, 390, 920, 921, 1440]) {
    const qa = chatFixture(width);
    qa.sandbox.setChatOpen(true);
    qa.flushTimers();
    assert.equal(qa.focuses.length, 1);
    assert.equal(qa.focuses[0].target, 'input');
    assert.equal(qa.focuses[0].options.preventScroll, true);
    assert.equal(qa.view.scrollTop, width <= 920 ? 190 : 0);
    assert.equal(qa.input.value, '尚未提交的聊天草稿');
    assert.deepEqual(qa.state.learningTask, {
      goal: 'concepts',
      tool: 'feedback',
      questionId: 'Q02',
    });
  }
});

test('closing chat preserves the draft and reading restoration while invalidating a queued opening focus', () => {
  const qa = chatFixture();
  qa.sandbox.setChatOpen(true);
  qa.sandbox.setChatOpen(false);
  qa.flushTimers();
  qa.flushFrames();
  assert.deepEqual(
    qa.focuses.map((item) => item.target),
    ['toggle'],
  );
  assert.equal(qa.focuses[0].options.preventScroll, true);
  assert.equal(qa.view.scrollTop, 0);
  assert.equal(qa.input.value, '尚未提交的聊天草稿');
  assert.deepEqual(qa.counts(), { captures: 2, restores: 2, persists: 2 });
  assert.equal(qa.state.chatOpen, false);
});

test('a later chat opening alone owns its deferred focus, and layout restoration never steals initial focus', () => {
  const qa = chatFixture();
  qa.sandbox.setChatOpen(true);
  qa.state.chatTab = 'discussion';
  qa.sandbox.setChatOpen(true);
  qa.flushTimers();
  assert.deepEqual(
    qa.focuses.map((item) => item.target),
    ['discussion'],
  );
  qa.sandbox.setChatOpen(true, { focus: false, persist: false });
  qa.flushTimers();
  assert.deepEqual(
    qa.focuses.map((item) => item.target),
    ['discussion'],
  );
  assert.deepEqual(qa.counts(), { captures: 2, restores: 0, persists: 2 });
});

test('actual visual viewport shrink/offset updates only local chat metrics and keeps the focused draft visible', () => {
  const viewport = { height: 640, offsetTop: 0 };
  const qa = chatFixture(390, viewport);
  qa.sandbox.setChatOpen(true);
  qa.flushTimers();
  const before = qa.view.scrollTop;
  viewport.height = 280.75;
  viewport.offsetTop = 36;
  qa.sandbox.syncChatViewport();
  qa.flushFrames();
  assert.equal(qa.properties.get('--knowledge-chat-viewport-height'), '280px');
  assert.equal(qa.properties.get('--knowledge-chat-viewport-top'), '36px');
  assert.ok(qa.view.scrollTop > before);
  assert.equal(qa.input.value, '尚未提交的聊天草稿');
  assert.equal(qa.focuses.length, 1);
  const fallback = chatFixture(390, undefined);
  fallback.sandbox.window.visualViewport = undefined;
  fallback.sandbox.syncChatViewport();
  assert.equal(fallback.properties.get('--knowledge-chat-viewport-height'), '640px');
  assert.equal(fallback.properties.get('--knowledge-chat-viewport-top'), '0px');
});

test('returning to the course carries the actual current point rather than losing its location', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const start = source.indexOf('  function courseDirectoryHref() {');
  const end = source.indexOf('  function setSequenceLink(', start);
  assert.ok(start >= 0 && end > start);
  const state = { node: { id: 'SS-02-01' } };
  const sandbox = { state, courseSlug: 'signals', URLSearchParams };
  vm.runInNewContext(source.slice(start, end), sandbox);
  assert.equal(sandbox.courseDirectoryHref(), '/course?course=signals&focus=SS-02-01');
  state.node = { id: 'SS-01-01' };
  assert.equal(sandbox.courseDirectoryHref(), '/course?course=signals&focus=SS-01-01');
  state.node = null;
  assert.equal(sandbox.courseDirectoryHref(), '/course?course=signals');
});

function fixture() {
  const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
  const code = source.slice(
    source.indexOf('  let pendingQuestionNavigation'),
    source.indexOf('  let chatSessionToken'),
  );
  let snapshot = {
    loaded: false,
    questions: [],
    practiceQuestions: [{ id: 'Q06', assessmentRole: 'practice' }],
  };
  const selected = [];
  const events = [];
  const handlers = {};
  const state = { node: { id: 'SS-02-01' } };
  const sandbox = {
    state,
    courseSlug: 'signals',
    nodeId: 'SS-02-01',
    URLSearchParams,
    page: {
      dispatchEvent: (event) => events.push(event),
      addEventListener: (type, callback) => {
        handlers[type] = callback;
      },
    },
    document: { querySelectorAll: () => [], getElementById: () => null },
    window: {
      FreeBbsLearningAssessment: {
        getSnapshot: () => snapshot,
        selectView: (view, filter) => selected.push({ view, filter }),
      },
      requestAnimationFrame: (callback) => callback(),
      location: { assign() {} },
    },
    CustomEvent: function Event(type, options) {
      this.type = type;
      this.detail = options.detail;
    },
    setKnowledgeView() {},
  };
  vm.runInNewContext(code, sandbox);
  return {
    sandbox,
    selected,
    events,
    handlers,
    state,
    setSnapshot: (value) => {
      snapshot = value;
    },
  };
}

test('an identically numbered heading-only fallback cannot resolve an exploration deep link prematurely', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'practice', questionId: 'Q06' });
  assert.equal(qa.selected.at(-1).filter.assessmentRole, '');
  qa.handlers['knowledge:assessment-updated']({
    detail: { loaded: false, practiceQuestions: [{ id: 'Q06' }] },
  });
  assert.equal(qa.selected.length, 1);
  const real = {
    loaded: true,
    questions: [],
    practiceQuestions: [{ id: 'Q06', assessmentRole: 'exploration' }],
  };
  qa.setSnapshot(real);
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  assert.equal(qa.selected.at(-1).filter.assessmentRole, 'exploration');
  assert.equal(qa.state.learningTask.questionId, 'Q06');
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  assert.equal(
    qa.selected.length,
    2,
    'resolved anchors are consumed once, not on every later attempt',
  );
});

test('guide navigation keeps every real tool, and formal selftest never inherits a practice difficulty filter', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'continue' });
  assert.equal(qa.events.at(-1).detail.tool, 'continue');
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'quick', difficulty: 'basic' });
  assert.equal(qa.selected.at(-1).view, 'quick');
  assert.equal(qa.selected.at(-1).filter, undefined);
});

test('manual tool changes clear stale question context while explicit question help remains current', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'practice', questionId: 'Q06' });
  assert.equal(qa.state.learningTask.questionId, 'Q06');
  qa.handlers['knowledge:tool-select']({ detail: { tool: 'content' } });
  assert.equal(qa.state.learningTask.tool, 'content');
  assert.equal(qa.state.learningTask.questionId, undefined);
  assert.equal(qa.state.learningTask.quizView, undefined);
  qa.handlers['knowledge:task-focus']({
    detail: { tool: 'feedback', quizView: 'quick', questionId: 'Q02' },
  });
  assert.equal(qa.state.learningTask.questionId, 'Q02');
  qa.handlers['knowledge:tool-select']({ detail: { tool: 'notes', questionId: 'Q02' } });
  assert.equal(qa.state.learningTask.questionId, undefined);
  qa.handlers['knowledge:task-focus']({
    detail: { tool: 'feedback', quizView: 'invalid', questionId: 'bad<script>' },
  });
  assert.equal(qa.state.learningTask.questionId, undefined);
});

test('an absent server-loaded question does not reopen a stale destination on future updates', () => {
  const qa = fixture();
  qa.sandbox.navigateLearning({ tool: 'feedback', quizView: 'practice', questionId: 'ABSENT' });
  const real = { loaded: true, questions: [], practiceQuestions: [] };
  qa.setSnapshot(real);
  qa.handlers['knowledge:assessment-updated']({ detail: real });
  const future = {
    loaded: true,
    questions: [],
    practiceQuestions: [{ id: 'ABSENT', assessmentRole: 'exploration' }],
  };
  qa.setSnapshot(future);
  qa.handlers['knowledge:assessment-updated']({ detail: future });
  assert.equal(qa.selected.length, 1);
});
