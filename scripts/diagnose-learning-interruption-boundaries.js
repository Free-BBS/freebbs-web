// Read-only production audit: explicit dynamic UI fixtures, actual router + memory store, no listener.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createMemoryLearningStore } = require('./fixtures/learning-memory-store');
const {
  createLearningWorkspaceRouter,
  documentVersion,
  validateEntry,
} = require('../backend/learning-workspace');
const { stableBlocks, createAnchor } = require('../public/knowledge-annotations');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

class FixtureElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.classList = { toggle() {} };
  }

  append(...items) {
    this.children.push(...items);
  }

  prepend(...items) {
    this.children.unshift(...items);
  }

  replaceChildren(...items) {
    this.children = items;
  }

  querySelector() {
    return this.queryMatch || null;
  }

  querySelectorAll() {
    return this.queryMatches || [];
  }

  closest() {
    return this.closestMatch || null;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  focus() {
    this.focused = true; // A fake fixture observation, never a native interaction claim.
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  dispatchEvent(event) {
    return Promise.all((this.listeners.get(event.type) || []).map((listener) => listener(event)));
  }
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function annotationUi(app) {
  const page = new FixtureElement();
  const elements = new Map(
    [
      'learning-annotation-toolbar',
      'learning-annotation-list',
      'learning-annotation-status',
      'learning-annotation-comment',
      'learning-annotation-directory',
    ].map((id) => [id, new FixtureElement()]),
  );
  const browser = new FixtureElement();
  browser.freeBbsApp = app;
  browser.crypto = crypto;
  browser.requestAnimationFrame = (callback) => callback();
  browser.CustomEvent = function FixtureEvent(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  };
  browser.document = {
    readyState: 'complete',
    querySelector: () => page,
    getElementById: (id) => elements.get(id),
    createElement: () => new FixtureElement(),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/knowledge-annotations'), 'utf8'), {
    window: browser,
  });
  const emit = (type, detail) => page.dispatchEvent({ type, detail });
  const edit = () => {
    const card = elements
      .get('learning-annotation-list')
      .children.find((item) => item.dataset.annotationId);
    assert.ok(card, 'Explicit memory record is available to the production annotation editor');
    return card.children.at(-1).dispatchEvent({ type: 'click' });
  };
  // A click-shaped event exercises the installed listener, not Chrome or trusted native input.
  const clickSave = () =>
    page.dispatchEvent({
      type: 'click',
      target: {
        closest: (selector) =>
          selector === '[data-annotation-action]'
            ? { dataset: { annotationAction: 'comment' } }
            : null,
      },
    });
  return { page, elements, browser, emit, edit, clickSave };
}

async function runCase(mode) {
  const source = fs.readFileSync(require.resolve('../public/knowledge-workspace'), 'utf8');
  const start = source.indexOf('  async function saveAnnotation(detail) {');
  const end = source.indexOf('  function resetSession(', start);
  assert.ok(start > 0 && end > start);
  const context = {
    slug: 'signals',
    course_id: 1,
    node_id: 'SS-01-01',
    document_markdown: '# Explicit local fixture\n\nPUBLIC QUOTE\n',
  };
  const actor = { id: 1, uid: 'fixture-student', token: 'fixture-session', isLoggedIn: true };
  const app = { userState: actor };
  const store = createMemoryLearningStore();
  store.context = async () => context;
  const router = createLearningWorkspaceRouter({
    store,
    requireAuth: async (request) => request.actor,
  });
  const call = async (method, id, body) => {
    const route = router.stack.find(
      (entry) =>
        entry.route?.path === '/:slug/:point/entries/:id' &&
        entry.route.methods[method.toLowerCase()],
    );
    const response = {
      statusCode: 200,
      set() {
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };
    await route.route.stack[0].handle(
      { actor, params: { slug: 'signals', point: context.node_id, id }, query: {}, body },
      response,
    );
    assert.equal(response.statusCode, 200);
    return response.payload;
  };
  const [block] = stableBlocks([{ text: 'PUBLIC QUOTE' }]);
  const anchor = createAnchor({
    nodeId: context.node_id,
    documentVersion: documentVersion(context),
    block,
    start: 0,
    end: block.text.length,
  });
  const seed = await store.create(
    actor,
    context,
    validateEntry({
      kind: 'note',
      title: 'Explicit local annotation fixture',
      content: 'previously saved fixture note',
      annotation: { style: 'comment', color: 'yellow', anchor },
    }),
    crypto.randomUUID(),
  );
  const ui = annotationUi(app);
  const state = { generation: 1, busy: false };
  const receipt = deferred();
  const entered = deferred();
  const saves = [];
  const outgoing = [];
  app.callApi = async (url, options) => {
    outgoing.push({ url, method: options.method, payload: JSON.parse(options.body) });
    if (mode === 'prewrite-failure') {
      entered.resolve();
      await receipt.promise;
      throw Object.assign(new Error('Explicit fixture503 before persistence'), { status: 503 });
    }
    const result = await call('PUT', seed.id, JSON.parse(options.body));
    entered.resolve();
    await receipt.promise;
    return result;
  };
  const scope = {
    state,
    app,
    page: ui.page,
    window: ui.browser,
    CustomEvent: ui.browser.CustomEvent,
    loggedIn: () => app.userState.isLoggedIn,
    endpoint: () => '/learning/signals/SS-01-01',
    el: () => ui.elements.get('learning-annotation-status'),
    loadEntries: async () =>
      ui.emit('knowledge:annotation-records-loaded', {
        entries: await store.list(app.userState, context, '', false, 'note', true),
      }),
  };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.saveAnnotation = saveAnnotation;`, scope);
  ui.page.addEventListener('knowledge:annotation-save', (event) => {
    const saving = scope.saveAnnotation(event.detail);
    saves.push(saving);
    return saving;
  });
  let acknowledgements = 0;
  ui.page.addEventListener('knowledge:annotation-saved', () => {
    acknowledgements += 1;
  });
  await ui.emit('knowledge:loaded', {
    course: { slug: 'signals' },
    node: { id: context.node_id, documentVersion: documentVersion(context) },
  });
  await ui.emit('knowledge:annotation-records-loaded', { entries: [seed] });
  await ui.edit();
  const comment = ui.elements.get('learning-annotation-comment');
  comment.value = 'A: exact submitted fixture thought';
  const submitted = ui.clickSave();
  await entered.promise;
  assert.equal(state.busy, true);
  assert.equal(
    comment.disabled,
    false,
    'Production save handler does not lock the annotation input',
  );
  if (mode === 'late-old-owner-success') {
    app.userState = {
      id: 2,
      uid: 'fixture-other',
      token: 'fixture-other-session',
      isLoggedIn: true,
    };
    // Explicit controller-generation reset fixture; not a production-login or browser-event claim.
    state.generation += 1;
    state.busy = false;
    await ui.browser.dispatchEvent({ type: 'freebbs:session-change' });
    assert.equal(comment.value, '');
  } else {
    context.document_markdown = '# Revised explicit local fixture\n\nPUBLIC QUOTE\n';
    await ui.emit('knowledge:document-saved', {
      node: { id: context.node_id, documentVersion: documentVersion(context) },
    });
  }
  comment.value = 'B: newly typed unsubmitted thought after the boundary';
  const beforeReceipt = comment.value;
  receipt.resolve();
  await submitted;
  await Promise.all(saves);
  await tick();
  const clobbered = comment.value !== beforeReceipt;
  if (mode === 'success-after-revision') {
    assert.equal(store.rows[0].content, 'A: exact submitted fixture thought');
    assert.equal(acknowledgements, 1);
    assert.equal(
      comment.value,
      '',
      'Baseline finding: successful old acknowledgement clears the later unsaved thought',
    );
  } else {
    assert.equal(
      clobbered,
      false,
      'Failure or old-owner acknowledgement must not clear current input',
    );
    assert.equal(acknowledgements, 0);
  }
  assert.equal(outgoing.length, 1);
  return {
    mode,
    passed: true,
    inputEnabledDuringSave: !comment.disabled,
    beforeReceipt,
    afterReceipt: comment.value,
    clobbered,
    acknowledgements,
    outgoing,
    stored: store.rows.map(({ id, content, revision, user }) => ({ id, content, revision, user })),
  };
}

async function main() {
  const output =
    process.env.LEARNING_INTERRUPTION_DIAGNOSTIC_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-interruption-audit-'));
  fs.mkdirSync(output, { recursive: true });
  if (process.argv.includes('--browser') || process.argv.includes('--expected-fixed')) {
    await browserCase(output, process.argv.includes('--expected-fixed'));
    return;
  }
  const report = {
    startedAt: new Date().toISOString(),
    boundary:
      'Small dynamic production-handler audit with explicitly synthetic DOM/event objects and actual registered workspace PUT router + memory records. No Chrome, native input, IME, HTTP listener, external API, AI, MySQL, Git write or durable/cross-device promise. Baseline assertions confirm one finding, not a desired future behavior.',
    cases: [],
  };
  try {
    for (const mode of ['success-after-revision', 'prewrite-failure', 'late-old-owner-success'])
      report.cases.push(await runCase(mode));
    report.finding =
      'The same-owner successful annotation acknowledgement after a body revision clears a newer unsubmitted comment. Prewrite failure and old-owner generation reset preserve newer input.';
    report.confirmed = report.cases[0].clobbered;
  } catch (error) {
    report.error = error.stack || error.message;
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  const file = path.join(output, 'interruption-diagnostic.json');
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        report: file,
        confirmed: report.confirmed,
        cases: report.cases.map(({ mode, clobbered }) => ({ mode, clobbered })),
        error: report.error,
      },
      null,
      2,
    ),
  );
}

async function browserCase(output, expectedFixed = false) {
  const quote = 'UNIQUE LOCAL PUBLIC QUOTE';
  const markdown = `# 明确本地批注回执夹具（非正式课程）\n\n${quote}\n\n本段只用于软件输入与延迟回执诊断。\n`;
  const context = {
    slug: 'signals',
    course_id: 1,
    node_id: 'SS-01-01',
    document_markdown: markdown,
    knowledge_markdown: markdown,
    basic_info_markdown: '知识点层级：核心',
    is_active: 1,
  };
  const node = {
    id: context.node_id,
    title: '明确本地批注回执夹具（非正式课程）',
    markdown,
    documentVersion: documentVersion(context),
    hasDocument: true,
    sections: {
      knowledgeMarkdown: markdown,
      basicInfoMarkdown: context.basic_info_markdown,
      applicationsMarkdown: '',
    },
  };
  const preview = createLearningPreview({ mapNodes: [node], mapEdges: [], contextRows: [context] });
  const receipt = deferred();
  const entered = deferred();
  const unchangedReceipt = deferred();
  const unchangedEntered = deferred();
  const originalCreate = preview.store.create.bind(preview.store);
  let pauseNext = { receipt, entered };
  preview.store.create = async (...args) => {
    const saved = await originalCreate(...args);
    if (args[2].annotation && pauseNext) {
      const paused = pauseNext;
      pauseNext = null;
      paused.entered.resolve();
      await paused.receipt.promise;
    }
    return saved;
  };
  const report = {
    startedAt: new Date().toISOString(),
    expectedFixed,
    expectation: expectedFixed
      ? 'fixed input-preservation regression'
      : 'original clobber finding must reproduce, otherwise this baseline diagnostic explicitly fails',
    boundary:
      'Installed Chrome on actual production UI and registered HTTP router, native mouse drag/click + keyboard. Explicit local one-paragraph memory fixture; annotation POST acknowledgements are paused only after their real memory writes. Fixed mode also pauses an unchanged final A. No body revision, synthetic input events, fake focus(), real accounts/MySQL/API/AI or durable/cross-device claim.',
    requests: [],
    screenshots: [],
    pageErrors: [],
    blockedExternal: [],
    blockedAI: [],
    nativeTrace: [],
    nativeSelectionGeometries: [],
  };
  let browser;
  let page;
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    const base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    // Existing explicitly configured runtime; no installation or download.
    // eslint-disable-next-line import/no-dynamic-require
    const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
    });
    report.chrome = await browser.version();
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(() => {
      const trace = [];
      window.learningAnnotationNativeTrace = trace;
      const describe = (element) => {
        const target = element?.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        if (!target?.tagName) return null;
        return {
          tag: target.tagName,
          id: target.id,
          className: String(target.className || '').slice(0, 120),
        };
      };
      const bounds = (element) => {
        if (!element?.getBoundingClientRect) return null;
        const rect = element.getBoundingClientRect();
        return Object.fromEntries(
          ['x', 'y', 'top', 'right', 'bottom', 'left', 'width', 'height'].map((key) => [
            key,
            Math.round(rect[key] * 100) / 100,
          ]),
        );
      };
      const record = (type, event) => {
        if (trace.length >= 1200) return;
        const selection = window.getSelection();
        const host = window.FreeBbsLearningReader?.getScrollHost?.();
        const paragraph = [...document.querySelectorAll('#knowledge-body p')].find((item) =>
          item.textContent.includes('UNIQUE LOCAL PUBLIC QUOTE'),
        );
        const hasPointer = typeof event?.clientX === 'number';
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        trace.push({
          time: Math.round(performance.now() * 100) / 100,
          type,
          trusted: event?.isTrusted,
          x: hasPointer ? event.clientX : null,
          y: hasPointer ? event.clientY : null,
          buttons: event?.buttons,
          pointerId: event?.pointerId,
          target: describe(event?.target),
          hit: hasPointer
            ? describe(document.elementFromPoint(event.clientX, event.clientY))
            : null,
          active: describe(document.activeElement),
          selection: selection?.toString() || '',
          collapsed: selection?.isCollapsed,
          anchor: describe(selection?.anchorNode),
          anchorOffset: selection?.anchorOffset,
          focus: describe(selection?.focusNode),
          focusOffset: selection?.focusOffset,
          range: bounds(range),
          paragraph: bounds(paragraph),
          toolbar: bounds(document.getElementById('learning-annotation-toolbar')),
          host: {
            kind: host === window ? 'window' : 'element',
            element: describe(host),
            scrollTop: host === window ? window.scrollY : host?.scrollTop,
            clientHeight: host?.clientHeight,
            scrollHeight: host?.scrollHeight,
            bounds: bounds(host),
          },
          documentScrollTop: document.scrollingElement?.scrollTop,
          windowScroll: { x: window.scrollX, y: window.scrollY },
          fontStatus: document.fonts.status,
        });
      };
      window.learningAnnotationNativeObserve = (type) => record(type);
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'mousedown',
        'mousemove',
        'mouseup',
        'selectionchange',
        'scroll',
        'focusin',
        'focusout',
      ])
        document.addEventListener(type, (event) => record(type, event), {
          capture: true,
          passive: true,
        });
    });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol)) {
        report.blockedExternal.push(request.url());
        request.abort();
      } else if (url.pathname.startsWith('/api/ai/')) {
        report.blockedAI.push(url.pathname);
        request.abort();
      } else {
        if (url.pathname.startsWith('/api/learning/'))
          report.requests.push({
            path: `${url.pathname}${url.search}`,
            method: request.method(),
            ...(['POST', 'PUT'].includes(request.method())
              ? { body: JSON.parse(request.postData()) }
              : {}),
          });
        request.continue();
      }
    });
    const click = async (selector) => {
      const control = await page.waitForSelector(selector, { visible: true });
      try {
        await control.evaluate((item) =>
          item.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await page.waitForFunction(
          (item) => {
            const rect = item.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return !item.disabled && rect.width > 0 && (hit === item || item.contains(hit));
          },
          {},
          control,
        );
        await control.click();
      } finally {
        await control.dispose();
      }
    };
    const observe = () =>
      page.$eval('#learning-annotation-comment', (item) => ({
        value: item.value,
        disabled: item.disabled,
        connected: item.isConnected,
        active: document.activeElement === item,
        selectionStart: item.selectionStart,
        selectionEnd: item.selectionEnd,
        selectionDirection: item.selectionDirection,
        hidden: item.closest('label').hidden,
        quote: document.getElementById('learning-annotation-selection').textContent,
        status: document.getElementById('learning-annotation-status').textContent,
      }));
    const screenshot = async (name) => {
      const file = path.join(output, name);
      await page.screenshot({ path: file, fullPage: true });
      report.screenshots.push(file);
    };
    await page.goto(`${base}/knowledge?course=signals&point=SS-01-01&as=student&view=reading`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningAssessment?.getSnapshot().loaded &&
        document.getElementById('learning-annotation-toolbar') &&
        !document.getElementById('learning-annotation-toolbar').hidden,
    );
    // This is an editor acknowledgement probe, not a font/layout-race probe.
    // Wait for naturally loaded local fonts before deriving native drag geometry.
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    report.localFontStatus = await page.evaluate(() => document.fonts.status);
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await click('#knowledge-chat-close');
    await page.evaluate(() => {
      window.learningAnnotationInterruptionAudit = [];
      document
        .querySelector('[data-knowledge-page]')
        .addEventListener('knowledge:annotation-saved', (event) => {
          // Observer only: never dispatch an event, move focus or mutate the editor.
          window.learningAnnotationInterruptionAudit.push({ detail: event.detail || null });
        });
    });
    const selectQuote = async (selectedQuote = quote) => {
      const geometry = await page.evaluate((value) => {
        const paragraph = [...document.querySelectorAll('#knowledge-body p')].find(
          (item) => item.textContent === value,
        );
        paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const rect = range.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + 0.2, rect.top + rect.height / 2);
        if (!paragraph.contains(hit))
          throw new Error(
            'Native selection source is obscured; no synthetic selection or assertion retry is allowed',
          );
        window.learningAnnotationNativeObserve('derived-quote-geometry');
        const sourceBounds = paragraph.getBoundingClientRect();
        const style = getComputedStyle(paragraph);
        return {
          x: rect.left + 0.2,
          end: rect.right - 0.2,
          y: rect.top + rect.height / 2,
          time: performance.now(),
          quote: value,
          paragraph: {
            x: sourceBounds.x,
            y: sourceBounds.y,
            width: sourceBounds.width,
            height: sourceBounds.height,
          },
          font: { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight },
        };
      }, selectedQuote);
      report.nativeSelectionGeometries.push(geometry);
      await page.mouse.move(geometry.x, geometry.y);
      await page.mouse.down();
      await page.mouse.move(geometry.end, geometry.y, { steps: 8 });
      await page.mouse.up();
      assert.equal(
        await page.evaluate(() => {
          window.learningAnnotationNativeObserve('before-selection-assert');
          return window.getSelection().toString();
        }),
        selectedQuote,
      );
    };
    await selectQuote();
    await click('[data-annotation-action="comment"]');
    await click('#learning-annotation-comment');
    assert.equal((await observe()).active, true);
    await page.keyboard.type('A: submitted local thought');
    await click('[data-annotation-action="comment"]');
    await entered.promise;
    assert.equal(preview.store.rows.length, 1);
    assert.equal(preview.store.rows[0].content, 'A: submitted local thought');
    report.pending = await observe();
    assert.equal(report.pending.disabled, false);
    await click('#learning-annotation-comment');
    assert.equal((await observe()).active, true);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type('B: new unsubmitted local thought');
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    report.beforeReceipt = await observe();
    assert.equal(report.beforeReceipt.value, 'B: new unsubmitted local thought');
    assert.ok(report.beforeReceipt.selectionEnd > report.beforeReceipt.selectionStart);
    const originalComment = await page.$('#learning-annotation-comment');
    await screenshot('native-before-old-ack.png');
    receipt.resolve();
    await page.waitForFunction(() => window.learningAnnotationInterruptionAudit.length === 1);
    report.afterReceipt = await observe();
    report.afterReceipt.sameNode = await originalComment.evaluate(
      (item) => item === document.getElementById('learning-annotation-comment'),
    );
    await originalComment.dispose();
    await screenshot('native-after-old-ack.png');
    report.confirmed = report.afterReceipt.value !== report.beforeReceipt.value;
    if (expectedFixed) {
      assert.equal(
        report.afterReceipt.value,
        report.beforeReceipt.value,
        'Old A acknowledgement must preserve native newly typed B',
      );
      assert.equal(report.afterReceipt.sameNode, true);
      assert.equal(report.afterReceipt.connected, true);
      assert.equal(report.afterReceipt.active, true);
      assert.equal(report.afterReceipt.hidden, false);
      for (const key of ['selectionStart', 'selectionEnd', 'selectionDirection'])
        assert.equal(
          report.afterReceipt[key],
          report.beforeReceipt[key],
          `${key} must remain unchanged by the old acknowledgement`,
        );
    } else
      assert.equal(
        report.afterReceipt.value,
        '',
        'Baseline finding: old A acknowledgement clears native newly typed B; a fixed UI must fail this diagnostic, not silently turn green',
      );
    assert.equal(preview.store.rows.length, 1);
    assert.equal(
      report.requests.filter((item) => item.method === 'POST' && item.path.endsWith('/entries'))
        .length,
      1,
    );
    if (expectedFixed) {
      await click('[data-annotation-action="comment"]');
      await page.waitForFunction(() => window.learningAnnotationInterruptionAudit.length === 2);
      report.bSaved = await observe();
      assert.equal(report.bSaved.value, '');
      assert.equal(report.bSaved.hidden, true);
      assert.ok(
        preview.store.rows.some((item) => item.content === 'B: new unsubmitted local thought'),
      );
      const secondWrites = report.requests.filter((item) => ['POST', 'PUT'].includes(item.method));
      assert.equal(secondWrites.length, 2);
      assert.equal(secondWrites[1].body.content, 'B: new unsubmitted local thought');
      assert.notEqual(secondWrites[1].body.requestKey, secondWrites[0].body.requestKey);
      report.secondSave = {
        method: secondWrites[1].method,
        stored: preview.store.rows.map(({ id, content, revision }) => ({ id, content, revision })),
      };
      await screenshot('native-b-actively-saved.png');
      pauseNext = { receipt: unchangedReceipt, entered: unchangedEntered };
      // Actual successful saves open the annotation directory. Close its real summary
      // before selecting unobscured source; never bypass the overlay with DOM input.
      if (await page.$eval('#learning-annotation-directory', (item) => item.open))
        await click('#learning-annotation-directory > summary');
      await page.waitForFunction(
        () => !document.getElementById('learning-annotation-directory').open,
      );
      // This independent unchanged-save control uses an unmarked paragraph; the
      // same-quote A -> B preservation and second native save are checked above.
      report.unchangedControlQuote = '本段只用于软件输入与延迟回执诊断。';
      await selectQuote(report.unchangedControlQuote);
      await click('[data-annotation-action="comment"]');
      await click('#learning-annotation-comment');
      assert.equal((await observe()).active, true);
      await page.keyboard.type('A: unchanged final local thought');
      await click('[data-annotation-action="comment"]');
      await unchangedEntered.promise;
      report.unchangedPending = await observe();
      assert.equal(report.unchangedPending.value, 'A: unchanged final local thought');
      unchangedReceipt.resolve();
      await page.waitForFunction(() => window.learningAnnotationInterruptionAudit.length === 3);
      report.unchangedAfterReceipt = await observe();
      assert.equal(report.unchangedAfterReceipt.value, '');
      assert.equal(report.unchangedAfterReceipt.hidden, true);
      assert.ok(!report.unchangedAfterReceipt.quote.includes('已选原文'));
      assert.ok(
        preview.store.rows.some((item) => item.content === 'A: unchanged final local thought'),
      );
      assert.equal(
        report.requests.filter((item) => ['POST', 'PUT'].includes(item.method)).length,
        3,
      );
      await screenshot('native-unchanged-a-cleared.png');
    }
    report.acknowledgements = await page.evaluate(() => window.learningAnnotationInterruptionAudit);
    report.stored = preview.store.rows.map(({ id, content, user, revision }) => ({
      id,
      content,
      user,
      revision,
    }));
  } catch (error) {
    report.error = error.stack || error.message;
    if (error.portSelection) report.portSelection = error.portSelection;
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({
          path: path.join(output, 'native-diagnostic-failure.png'),
          fullPage: true,
        });
      } catch {
        /* Preserve original diagnostic failure. */
      }
    }
    process.exitCode = 1;
  } finally {
    if (page && !page.isClosed()) {
      try {
        report.nativeTrace = await page.evaluate(() => window.learningAnnotationNativeTrace || []);
      } catch (error) {
        report.nativeTraceError = error.message;
      }
    }
    receipt.resolve();
    unchangedReceipt.resolve();
    try {
      await browser?.close();
      report.browserClosed = true;
    } catch (error) {
      report.cleanupError = error.message;
    } finally {
      preview.server.closeAllConnections?.();
      if (preview.server.listening)
        await new Promise((resolve) => {
          preview.server.close(resolve);
        });
      report.serverClosed = !preview.server.listening;
      report.aiRequests = preview.requests.length;
    }
    report.finishedAt = new Date().toISOString();
    report.passed =
      !report.error &&
      !report.cleanupError &&
      report.pageErrors.length === 0 &&
      report.blockedAI.length === 0 &&
      report.aiRequests === 0 &&
      report.serverClosed &&
      report.browserClosed;
    if (!report.passed) process.exitCode = 1;
    const file = path.join(
      output,
      expectedFixed ? 'interruption-browser-fixed.json' : 'interruption-browser-baseline.json',
    );
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          report: file,
          confirmed: report.confirmed,
          expectedFixed,
          passed: report.passed,
          beforeReceipt: report.beforeReceipt,
          afterReceipt: report.afterReceipt,
          pageErrors: report.pageErrors,
          aiRequests: report.aiRequests,
          serverClosed: report.serverClosed,
          browserClosed: report.browserClosed,
          error: report.error,
        },
        null,
        2,
      ),
    );
  }
}

if (require.main === module) main();

module.exports = { main };
