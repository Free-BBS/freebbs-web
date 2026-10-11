// Local Chrome interaction evidence only. SS-02-01 is an unreviewed authoring
// example in an isolated memory preview, not formal course material or outcomes.
// Actual bundled OTF requests are held; document.fonts.ready is never replaced.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const reader = require('../public/learning-reader');
const progress = require('../public/learning-progress');

const POINT = 'SS-02-01';
const repo = path.resolve(__dirname, '..');
function deterministicSizeControls() {
  // Separate normal unit controls: inert DOM and explicitly stepped RAFs. These
  // never count as real Chrome/native input coverage and do not modify a page.
  const results = [];
  for (const transition of ['none', 'account-change', 'token-rotation', 'tool-change']) {
    const framesQueue = [];
    const created = [];
    const element = () => ({
      hidden: false,
      children: [],
      listeners: new Map(),
      dataset: {},
      classList: { contains: () => false },
      addEventListener(name, callback) {
        this.listeners.set(name, callback);
      },
      removeEventListener() {},
      setAttribute() {},
      prepend() {},
      append(...items) {
        this.children.push(...items);
      },
    });
    const page = { ...element(), dataset: { learningTool: 'content' } };
    const reading = { ...element(), querySelector: () => element() };
    const scroller = {
      ...element(),
      scrollHeight: 2000,
      clientHeight: 300,
      scrollTop: 0,
      parentElement: null,
      getBoundingClientRect: () => ({ top: 0 }),
      scrollBy({ top }) {
        this.scrollTop += top;
      },
    };
    const block = {
      textContent: '单元对照段落，不是正式课程材料',
      getBoundingClientRect: () => ({
        top: 400 - scroller.scrollTop,
        bottom: 450 - scroller.scrollTop,
      }),
    };
    const body = {
      parentElement: scroller,
      querySelectorAll: (selector) => (selector === reader.BLOCKS ? [block] : []),
    };
    const app = { userState: { isLoggedIn: true, uid: 'unit-user', token: 'unit-token' } };
    const stored = new Map([
      [
        progress.scopedKey(reader.BASE, app.userState),
        JSON.stringify({
          '["signals","SS-02-01"]': {
            index: 0,
            fingerprint: reader.fingerprint(block.textContent),
            offset: -8,
            version: 'a'.repeat(64),
          },
        }),
      ],
    ]);
    const browser = {
      ...element(),
      FreeBbsLearningProgress: progress,
      location: { search: '' },
      localStorage: {
        getItem: (key) => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
      },
      getComputedStyle: () => ({ overflowY: 'auto' }),
      requestAnimationFrame: (callback) => framesQueue.push(callback),
      clearTimeout() {},
      setTimeout() {},
      freeBbsTypography: {
        typeScalePresets: { standard: { name: '标准' }, large: { name: '大字' } },
        getCurrentPreferences: () => ({ typeScale: 'standard' }),
        applyPreferences() {},
        savePreferences: () => true,
      },
    };
    const dom = {
      ...element(),
      querySelector: () => page,
      getElementById: (id) =>
        ({ 'knowledge-body': body, 'knowledge-reading': reading })[id] || null,
      createElement: () => {
        const item = element();
        created.push(item);
        return item;
      },
      createTextNode: (textContent) => ({ textContent }),
    };
    reader.install(browser, dom, app);
    page.listeners.get('knowledge:loaded')({
      detail: { course: { slug: 'signals' }, node: { id: POINT, documentVersion: 'a'.repeat(64) } },
    });
    while (framesQueue.length) framesQueue.shift()();
    assert.equal(scroller.scrollTop, 392, 'Positive control restores the original bookmark');
    const select = created.find((item) => item.children.length === 2);
    assert.ok(select, 'The actual installed reader creates its shared-size select');
    select.value = 'large';
    select.listeners.get('change')();
    framesQueue.shift()();
    assert.equal(framesQueue.length, 1, 'Transition is placed strictly between the two size RAFs');
    if (transition === 'account-change') {
      Object.assign(app.userState, { uid: 'other-unit-user', token: 'other-unit-token' });
      browser.listeners.get('freebbs:session-change')();
    } else if (transition === 'token-rotation') app.userState.token = 'rotated-unit-token';
    else if (transition === 'tool-change') {
      page.listeners.get('knowledge:tool-select')();
      page.dataset.learningTool = 'resources';
      reading.hidden = true;
    }
    scroller.scrollTop = 100;
    while (framesQueue.length) framesQueue.shift()();
    assert.equal(scroller.scrollTop, transition === 'none' ? 392 : 100);
    results.push({
      transition,
      passed: true,
      evidence:
        'Deterministic unit double: production reader.install, inert DOM, stepped RAF; NOT real Chrome or human input.',
    });
  }
  return results;
}
const sourceHashes = () =>
  Object.fromEntries(
    ['public/learning-reader.js', 'public/knowledge.js', 'public/knowledge-workspace.js'].map(
      (file) => [
        file,
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(repo, file)))
          .digest('hex'),
      ],
    ),
  );
const pause = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
async function until(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(10);
  }
  throw new Error(`Missing test precondition: ${label}`);
}
async function frames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}
async function waitForScrollIdle(page) {
  // Native PageDown uses a smooth scrolling animation. Compare its final user
  // destination, not an intermediate animation frame, while fonts stay held.
  const deadline = Date.now() + 4000;
  let previous = null;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const position = await page.evaluate(() => {
      const host = window.FreeBbsLearningReader.getScrollHost();
      return host === window ? window.scrollY : host.scrollTop;
    });
    if (position !== previous) {
      previous = position;
      stableSince = Date.now();
    }
    if (Date.now() - stableSince >= 200) return;
    await pause(20);
  }
  throw new Error('Native scroll did not settle; semantic comparison would be premature');
}
async function metrics(page, anchor = null) {
  return page.evaluate((saved) => {
    const api = window.FreeBbsLearningReader;
    const body = document.getElementById('knowledge-body');
    const host = api.getScrollHost();
    const bounds =
      host === window
        ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
        : host.getBoundingClientRect();
    const sticky = ['knowledge-history', 'learning-annotation-toolbar']
      .map((id) => document.getElementById(id))
      .filter((item) => item && !item.hidden && !item.classList.contains('hidden'));
    const stickyTop =
      parseFloat(getComputedStyle(sticky[0] || document.getElementById('knowledge-reading')).top) ||
      0;
    const boundary =
      bounds.top +
      16 +
      stickyTop +
      sticky.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    const blocks = api.readableBlocks(body);
    const currentIndex = blocks.findIndex((item) => item.getBoundingClientRect().bottom > boundary);
    const index = saved
      ? blocks.findIndex((item) => api.fingerprint(item.textContent) === saved.fingerprint)
      : currentIndex;
    const item = blocks[index];
    const rect = item?.getBoundingClientRect();
    const text = item?.textContent.replace(/\s+/g, ' ').trim();
    const key = window.FreeBbsLearningProgress.scopedKey(api.BASE, window.freeBbsApp.userState);
    const bookmark =
      JSON.parse(localStorage.getItem(key) || '{}')[JSON.stringify(['signals', 'SS-02-01'])] ||
      null;
    return {
      index,
      currentIndex,
      fingerprint: item ? api.fingerprint(item.textContent) : null,
      text,
      currentText: blocks[currentIndex]?.textContent.replace(/\s+/g, ' ').trim(),
      top: rect?.top,
      bottom: rect?.bottom,
      boundary,
      viewportBottom: bounds.bottom,
      visible: Boolean(rect && rect.bottom > boundary && rect.top < bounds.bottom),
      scrollTop: host === window ? window.scrollY : host.scrollTop,
      lineHeight: parseFloat(getComputedStyle(body).lineHeight),
      fontSize: getComputedStyle(body).fontSize,
      fontsStatus: document.fonts.status,
      fontFaces: [...document.fonts]
        .filter((face) => face.family.includes('FREEBBS Knowledge'))
        .map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
      tool: document.querySelector('[data-knowledge-page]').dataset.learningTool,
      readingVisible:
        !document.getElementById('knowledge-reading').hidden &&
        !document.getElementById('knowledge-reading').classList.contains('hidden'),
      bookmark,
    };
  }, anchor);
}
async function pointerPoint(page, selector = '#knowledge-body') {
  return page.$eval(selector, (item) => {
    const rect = item.getBoundingClientRect();
    const x = Math.max(20, Math.min(window.innerWidth - 20, rect.left + rect.width * 0.6));
    const y = Math.max(200, Math.min(window.innerHeight - 120, 620));
    const hit = document.elementFromPoint(x, y);
    const api = window.FreeBbsLearningReader;
    return {
      x,
      y,
      usable: Boolean(hit && api.scrollHost(hit) === api.getScrollHost()),
      hit: hit?.tagName,
      boundary: 'Same real reading scroll host, including its origin/header above prose',
    };
  });
}
async function wheel(page, amount) {
  const point = await pointerPoint(page);
  assert.ok(
    point.usable,
    `Actual pointer target must belong to the reading scroll host: ${JSON.stringify(point)}`,
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel({ deltaY: amount });
}
async function visibleClick(page, selector, { reveal = false } = {}) {
  await page.waitForSelector(selector, { visible: true });
  if (reveal)
    await page.$eval(selector, (item) =>
      item.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
  const point = await page.$eval(selector, (item) => {
    const rect = item.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      usable:
        x > 0 &&
        x < window.innerWidth &&
        y > 0 &&
        y < window.innerHeight &&
        (hit === item || item.contains(hit)),
    };
  });
  assert.ok(point.usable, `Real click must reach ${selector}: ${JSON.stringify(point)}`);
  await page.mouse.click(point.x, point.y);
}
async function main() {
  const preview = createLearningPreview();
  let base = '';
  const output =
    process.env.LEARNING_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'human-reader-races-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Loopback memory preview; actual unreviewed SS-02-01 authoring example and bundled OTFs; no production users, AI, grades or effectiveness inference.',
    base,
    output,
    sourceHashesBefore: sourceHashes(),
    scenes: [],
    blockedExternal: [],
    pageErrors: [],
    delayedFontRequests: [],
    screenshots: [],
    deterministicUnitControls: [],
    browserClosed: false,
    serverClosed: false,
  };
  let browser;
  const pages = [];
  const screenshot = async (page, name) => {
    const filename = path.join(output, `${name}.png`);
    await page.screenshot({ path: filename });
    report.screenshots.push(filename);
    return filename;
  };
  const newPage = async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    pages.push(page);
    await page.setViewport({ width: 1440, height: 960 });
    await page.setCacheEnabled(false);
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    await page.evaluateOnNewDocument(() => {
      window.readerRaceEvents = [];
      window.readerRaceSize = [];
      window.readerRaceScrolls = [];
      for (const type of ['wheel', 'keydown', 'resize'])
        window.addEventListener(
          type,
          (event) =>
            window.readerRaceEvents.push({
              type,
              trusted: event.isTrusted,
              time: performance.now(),
              key: event.key,
              deltaY: event.deltaY,
            }),
          { capture: true, passive: true },
        );
      window.addEventListener(
        'scroll',
        (event) =>
          window.readerRaceScrolls.push({ time: performance.now(), trusted: event.isTrusted }),
        { capture: true, passive: true },
      );
      document.addEventListener(
        'change',
        (event) => {
          if (!event.target.matches('.learning-reading-size select')) return;
          const record = {
            time: performance.now(),
            value: event.target.value,
            trusted: event.isTrusted,
            secondFrame: null,
          };
          window.readerRaceSize.push(record);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              record.secondFrame = performance.now();
            }),
          );
        },
        true,
      );
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      });
    });
    const delay = { enabled: false, held: [] };
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== base) {
        report.blockedExternal.push(`${url.origin}${url.pathname}`);
        return request.respond({ status: 403, body: 'External services disabled in race QA' });
      }
      if (delay.enabled && /^\/assets\/fonts\/source-han-serif-sc\/.*\.otf$/.test(url.pathname)) {
        const record = {
          path: url.pathname,
          resourceType: request.resourceType(),
          heldAt: Date.now(),
          releasedAt: null,
        };
        report.delayedFontRequests.push(record);
        delay.held.push({ request, record });
        return undefined;
      }
      return request.continue();
    });
    const release = async () => {
      delay.enabled = false;
      const pending = delay.held.splice(0);
      await Promise.all(
        pending.map(async ({ request, record }) => {
          record.releasedAt = Date.now();
          record.delayMs = record.releasedAt - record.heldAt;
          await request.continue();
        }),
      );
    };
    return { page, context, delay, release };
  };
  const visit = async (page) => {
    await page.goto(`${base}/knowledge?course=signals&point=${POINT}&as=student`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(
      () =>
        window.FreeBbsLearningReader?.getScrollHost && document.querySelector('#knowledge-body p'),
    );
    await page.evaluate(() => document.fonts.ready);
    if (await page.$('.learning-start-dialog[open]')) await page.keyboard.press('Escape');
    if (await page.$eval('#knowledge-chat-panel', (item) => !item.classList.contains('hidden')))
      await visibleClick(page, '#knowledge-chat-close');
    await frames(page);
  };
  const deep = async (page) => {
    await wheel(page, 2100);
    await pause(240);
    const value = await metrics(page);
    assert.ok(
      value.currentIndex > 8 && value.scrollTop > 1000,
      `Use actual deep prose: ${JSON.stringify(value)}`,
    );
    return value;
  };
  const run = async (name, task) => {
    const result = { name, passed: false, stage: 'precondition' };
    report.scenes.push(result);
    const view = await newPage();
    try {
      await task(view, result);
      result.passed = true;
      console.log(`PASS ${name}`);
    } catch (error) {
      result.failure = error.stack || String(error);
      result.snapshot = await metrics(view.page).catch(() => null);
      result.events = await view.page
        .evaluate(() => ({
          actions: window.readerRaceEvents,
          sizes: window.readerRaceSize,
          scrolls: window.readerRaceScrolls,
        }))
        .catch(() => null);
      result.screenshot = await screenshot(view.page, `${name}-failure`).catch(() => null);
      console.log(`FAIL ${name}: ${error.message}`);
    } finally {
      await view.release().catch(() => {});
      await view.context.close();
    }
  };
  try {
    report.portSelection = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    report.deterministicUnitControls = deterministicSizeControls();
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    for (const input of ['wheel', 'keyboard'])
      await run(`delayed-real-font-${input}`, async ({ page, delay, release }, result) => {
        await visit(page);
        await page.evaluate(() => {
          const preference = {
            ...window.freeBbsTypography.getCurrentPreferences(),
            fontPreset: 'zhongsong-study',
          };
          window.freeBbsTypography.applyPreferences(preference);
          window.freeBbsTypography.savePreferences(preference);
        });
        await page.evaluate(() => document.fonts.ready);
        const saved = await deep(page);
        result.saved = saved;
        delay.enabled = true;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () =>
            window.FreeBbsLearningReader?.getScrollHost &&
            document.querySelector('#knowledge-body p'),
        );
        await until(() => delay.held.length > 0, 'real OTF request held');
        await frames(page);
        result.beforeInput = await metrics(page, saved);
        assert.equal(
          result.beforeInput.fontsStatus,
          'loading',
          'Actual font loading remains pending before user acts',
        );
        if (input === 'wheel') await wheel(page, 1400);
        else {
          const point = await pointerPoint(page);
          assert.ok(point.usable);
          await page.mouse.click(point.x, point.y);
          await page.keyboard.press('PageDown');
          await page.keyboard.press('PageDown');
        }
        if (input === 'keyboard') await waitForScrollIdle(page);
        else await pause(70);
        const user = await metrics(page);
        result.user = user;
        assert.ok(
          user.currentIndex > saved.currentIndex + 2,
          'User must actually move to a different semantic passage',
        );
        assert.equal(user.fontsStatus, 'loading');
        result.stage = 'behavior';
        await release();
        await page.evaluate(() => document.fonts.ready);
        await frames(page);
        const after = await metrics(page, user);
        result.after = after;
        result.oldAfter = await metrics(page, saved);
        assert.equal(after.fontsStatus, 'loaded');
        assert.equal(
          after.visible,
          true,
          `Current user paragraph remains visible after actual font reflow: ${JSON.stringify({ user, after })}`,
        );
        assert.equal(result.oldAfter.visible, false, 'Do not teleport to old saved passage');
        result.events = await page.evaluate(() => window.readerRaceEvents);
        assert.ok(
          result.events.some(
            (event) => event.trusted && event.type === (input === 'wheel' ? 'wheel' : 'keydown'),
          ),
        );
        await screenshot(page, `delayed-real-font-${input}-success`);
      });

    await run('wheel-resize-before-debounce', async ({ page }, result) => {
      await visit(page);
      result.saved = await deep(page);
      await wheel(page, 1000);
      await page.setViewport({ width: 1440, height: 900 });
      await pause(230);
      result.after = await metrics(page);
      result.oldAfter = await metrics(page, result.saved);
      result.events = await page.evaluate(() => window.readerRaceEvents);
      const resize = result.events.filter((event) => event.type === 'resize').at(-1);
      const recentWheel = result.events
        .filter((event) => event.type === 'wheel' && event.time < resize?.time)
        .at(-1);
      result.windowMs = resize && recentWheel ? resize.time - recentWheel.time : null;
      assert.ok(
        result.windowMs >= 0 && result.windowMs < 180,
        `Race must occur before the real 180ms debounce: ${result.windowMs}`,
      );
      result.stage = 'behavior';
      assert.ok(
        result.after.currentIndex > result.saved.currentIndex + 2,
        'Recent user passage wins over older bookmark',
      );
      assert.equal(result.oldAfter.visible, false, 'Resize must not restore the old passage');
      await screenshot(page, 'wheel-resize-success');
    });

    await run('shared-size-immediate-wheel', async ({ page }, result) => {
      await visit(page);
      await page.evaluate(() => {
        const preference = {
          ...window.freeBbsTypography.getCurrentPreferences(),
          typeScale: 'standard',
        };
        window.freeBbsTypography.applyPreferences(preference);
        window.freeBbsTypography.savePreferences(preference);
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.learning-reading-size select');
      await visibleClick(page, '.learning-reading-size select', { reveal: true });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Home');
      const point = await pointerPoint(page);
      assert.ok(point.usable);
      await page.mouse.move(point.x, point.y);
      // Explicit local low-end-device fixture; real Chrome scheduling and input
      // remain intact. No RAF or DOM event is replaced/held by the test.
      const session = await page.createCDPSession();
      const slowdown = Number(process.env.LEARNING_READER_CPU_SLOWDOWN || 1);
      if (slowdown > 1) {
        await session.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
        result.cpuFixture = `Chrome target-only ${slowdown}x CPU slowdown during the native select/wheel gesture`;
      }
      // Same-session native CDP input queue. KeyDown is enqueued first and wheel
      // immediately after it, without a tool/DOM round trip or synthetic Event.
      result.inputBoundary =
        'One Chrome CDP session, native keyDown + mouseWheel queued without awaiting either; actual DOM change/wheel isTrusted and RAF timing still required.';
      const key = { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 };
      await Promise.all([
        session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key }),
        session.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: point.x,
          y: point.y,
          deltaX: 0,
          deltaY: 1400,
          button: 'none',
          buttons: 0,
          modifiers: 0,
          pointerType: 'mouse',
        }),
      ]);
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      await pause(230);
      result.after = await metrics(page);
      result.events = await page.evaluate(() => ({
        actions: window.readerRaceEvents,
        sizes: window.readerRaceSize,
      }));
      const change = result.events.sizes.at(-1);
      const input = result.events.actions.find(
        (event) => event.type === 'wheel' && event.time > change?.time,
      );
      result.windowMs = input && change ? input.time - change.time : null;
      assert.equal(change?.value, 'large');
      assert.equal(change?.trusted, true, 'Use actual native keyboard selection');
      result.gestureKeptUserPassage = result.after.currentIndex > 5 && result.after.scrollTop > 500;
      assert.equal(
        result.gestureKeptUserPassage,
        true,
        'The actual select/wheel gesture must keep the later prose visible',
      );
      assert.ok(
        input?.trusted && input.time < change.secondFrame,
        `Wheel must preempt the second real RAF, not happen after it: ${JSON.stringify({ change, input })}`,
      );
      result.stage = 'behavior';
      assert.ok(
        result.after.currentIndex > 5 && result.after.scrollTop > 500,
        'User wheel remains in deeper prose instead of the select anchor',
      );
      await screenshot(page, 'shared-size-wheel-success');
    });

    await run('deep-reading-overview-reading', async ({ page }, result) => {
      await visit(page);
      const before = await deep(page);
      result.before = before;
      result.controlGeometry = await page.$eval('#knowledge-return-overview', (item) => {
        const rect = item.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          visibleAtDeep: rect.bottom > 0 && rect.top < window.innerHeight,
        };
      });
      await screenshot(page, 'deep-before-overview');
      // The repaired sticky toolbar exposes a directly reachable human path.
      // No off-screen focus setup or fake knowledge/view event is used here.
      result.stickyControlGeometry = await page.$eval('#learning-reader-overview', (item) => {
        const rect = item.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          visibleAtDeep: rect.bottom > 0 && rect.top < window.innerHeight,
        };
      });
      assert.equal(result.stickyControlGeometry.visibleAtDeep, true);
      await visibleClick(page, '#learning-reader-overview');
      await page.waitForFunction(
        () => !document.getElementById('knowledge-overview').classList.contains('hidden'),
      );
      await pause(900);
      await visibleClick(page, '#knowledge-start-reading', { reveal: true });
      await pause(900);
      result.after = await metrics(page, before);
      result.stage = 'behavior';
      assert.equal(
        result.after.visible,
        true,
        `Return from overview must restore the semantic passage, not start prose over: ${JSON.stringify({ before, after: result.after })}`,
      );
      await screenshot(page, 'overview-return-success');
    });
    report.noAutomaticAI = preview.requests.length === 0;
    report.noSubmittedAttempts = preview.assessmentStore.rows.length === 0;
    report.noStars = preview.starsStore.rows.length === 0;
  } catch (error) {
    if (error.portSelection) report.portSelection = error.portSelection;
    report.failure = error.stack || String(error);
  } finally {
    if (browser) {
      await browser.close();
      report.browserClosed = true;
    }
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections?.();
    });
    report.serverClosed = true;
    report.sourceHashesAfter = sourceHashes();
    report.ok =
      !report.failure &&
      report.deterministicUnitControls.length === 4 &&
      report.scenes.length === 5 &&
      report.scenes.every((item) => item.passed) &&
      report.pageErrors.length === 0;
    const filename = path.join(output, 'reader-races-report.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        report: filename,
        passed: report.scenes.filter((item) => item.passed).length,
        failed: report.scenes.filter((item) => !item.passed).map((item) => item.name),
        ok: report.ok,
      }),
    );
    if (!report.ok) process.exitCode = 1;
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main, deterministicSizeControls };
