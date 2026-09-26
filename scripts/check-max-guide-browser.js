// Isolated, loopback-only QA of all production guide steps with delayed APIs.
// Reuse an installed Puppeteer via PUPPETEER_MODULE; never use a personal profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { STEPS } = require('../public/max-guide-stations');
const { GUIDE_VERSION } = require('../public/max-guide-releases');

const scenarios = [
  { name: 'desktop-light-slow', width: 1440, height: 900, theme: 'light', mapDelay: 3500 },
  { name: 'mobile-dark-late', width: 390, height: 844, theme: 'dark', mapDelay: 6500 },
  {
    name: 'desktop-dark-large',
    width: 1280,
    height: 900,
    theme: 'dark',
    mapDelay: 3500,
    typeScale: 'large',
    fontPreset: 'zhongsong-study',
  },
];
const sleep = (duration) =>
  new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
const click = (page, selector) => page.locator(selector).setTimeout(10000).click();

async function waitStep(page, index, step, { revealed = false } = {}) {
  const started = Date.now();
  const view = revealed ? { ...step, ...step.reveal } : step;
  const expectedEmpty = step.id === 'activities-receipt';
  await page.waitForFunction(
    (expectedIndex, title, selector, emptyAllowed) => {
      const guide = window.freeBbsMaxGuide;
      const card = document.querySelector('.max-tour[open] .max-tour-card');
      const target = [...document.querySelectorAll(selector)].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !node.closest('[hidden], .hidden');
      });
      const bounds = target?.getBoundingClientRect();
      return (
        guide?.activeStep === expectedIndex &&
        card?.getAttribute('aria-busy') !== 'true' &&
        document.querySelector('#max-tour-title')?.textContent === title &&
        document.querySelector('.max-tour .guide-primary')?.disabled === false &&
        (emptyAllowed ||
          (bounds?.width > 0 &&
            bounds?.height > 0 &&
            !target.closest('[hidden], .hidden') &&
            !document.querySelector('.max-tour-status')?.textContent))
      );
    },
    { timeout: 20000 },
    index,
    view.title,
    view.target,
    expectedEmpty,
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
  const stableFrames = await page.evaluate(async () => {
    let frames = [];
    const deadline = performance.now() + 1500;
    while (performance.now() < deadline) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      const dialog = document.querySelector('.max-tour');
      const frame = {
        scrollTop: dialog.scrollTop,
        scrollLeft: dialog.scrollLeft,
        card: document.querySelector('.max-tour-card').getBoundingClientRect().toJSON(),
        next: document.querySelector('.max-tour .guide-primary').getBoundingClientRect().toJSON(),
      };
      const firstFrame = frames[0];
      if (
        firstFrame &&
        ['card', 'next'].some((name) =>
          ['top', 'left', 'bottom', 'right'].some(
            (side) => Math.abs(frame[name][side] - firstFrame[name][side]) > 1,
          ),
        )
      )
        frames = [];
      frames.push(frame);
      if (frames.length === 3) return frames;
    }
    return frames;
  });
  assert.equal(stableFrames.length, 3, `${step.id}: card did not settle within 1500 ms`);
  for (const frame of stableFrames) {
    assert.equal(frame.scrollTop, 0, `${step.id}: fullscreen guide must not scroll vertically`);
    assert.equal(frame.scrollLeft, 0, `${step.id}: fullscreen guide must not scroll horizontally`);
    for (const name of ['card', 'next']) {
      for (const side of ['top', 'left', 'bottom', 'right']) {
        assert.ok(
          Math.abs(frame[name][side] - stableFrames[0][name][side]) <= 1,
          `${step.id}: ${name} must settle before interaction: ${JSON.stringify(stableFrames)}`,
        );
      }
    }
  }
  const snapshot = await page.evaluate((targetSelector) => {
    const card = document.querySelector('.max-tour-card');
    const rect = card.getBoundingClientRect();
    const next = document.querySelector('.max-tour .guide-primary').getBoundingClientRect();
    const roles = [
      ['#max-tour-body', 'var(--font-body, sans-serif)'],
      ['.max-tour-caption', 'var(--font-body, sans-serif)'],
      ['.max-tour-status', 'var(--font-body, sans-serif)'],
      ['.max-tour .guide-primary', 'var(--font-ui, sans-serif)'],
      ['#max-tour-title', 'var(--font-display, var(--font-body, sans-serif))'],
    ];
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const fonts = roles.map(([selector, token]) => {
      probe.style.fontFamily = token;
      return {
        selector,
        expected: getComputedStyle(probe).fontFamily,
        actual: getComputedStyle(document.querySelector(selector)).fontFamily,
      };
    });
    probe.remove();
    const currencies = [...document.querySelectorAll('#user-status .currency-value')].map(
      (node) => ({
        value: node.textContent,
        weight: getComputedStyle(node).fontWeight,
      }),
    );
    return {
      target: [...document.querySelectorAll(targetSelector)]
        .find((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0 && !node.closest('[hidden], .hidden');
        })
        ?.getBoundingClientRect()
        .toJSON(),
      header: document.querySelector('.desktop-header')?.getBoundingClientRect().toJSON(),
      path: window.location.pathname,
      search: window.location.search,
      title: document.querySelector('#max-tour-title').textContent,
      body: document.querySelector('#max-tour-body').textContent,
      status: document.querySelector('.max-tour-status').textContent,
      card: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      cardStyle: {
        top: card.style.top,
        className: card.className,
        height: getComputedStyle(card).height,
        transform: getComputedStyle(card).transform,
        dialogTop: document.querySelector('.max-tour').getBoundingClientRect().top,
      },
      next: { left: next.left, top: next.top, right: next.right, bottom: next.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fonts,
      currencies,
    };
  }, view.target);
  if (
    snapshot.header &&
    [
      'home-launchpad',
      'settings-reading',
      'settings-security',
      'settings-profile-entry',
      'profile-ranch',
      'profile-wool',
      'inventory-ledger-entry',
      'development-status',
    ].includes(step.id)
  ) {
    assert.ok(
      snapshot.target.top >= snapshot.header.bottom,
      `${step.id}: target hidden by desktop header`,
    );
  }
  assert.equal(snapshot.path, step.route, `${step.id}: wrong page`);
  if (['course', 'knowledge'].includes(step.station)) {
    assert.equal(new URLSearchParams(snapshot.search).get('course'), 'math');
  }
  assert.equal(snapshot.body, expectedEmpty ? view.emptyBody : view.body, step.id);
  for (const font of snapshot.fonts)
    assert.equal(
      font.actual,
      font.expected,
      `${step.id}: ${font.selector} must follow its typography token`,
    );
  assert.equal(
    snapshot.currencies.length,
    3,
    `${step.id}: electric/magnetic/heat values must exist`,
  );
  for (const currency of snapshot.currencies)
    assert.equal(currency.weight, '700', `${step.id}: top-bar value ${currency.value}`);
  for (const [name, rect] of [
    ['card', snapshot.card],
    ['next', snapshot.next],
  ]) {
    assert.ok(
      rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= snapshot.viewport.width + 1 &&
        rect.bottom <= snapshot.viewport.height + 1,
      `${step.id}: ${name} outside viewport: ${JSON.stringify(snapshot)}`,
    );
  }
  return { ...snapshot, readyMs: Date.now() - started };
}

async function runScenario(browser, scenario, directory) {
  const { server, store, progress } = createOnboardingPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const nativeTransitionDiagnostics = [];
  const blockedRequests = [];
  const unexpectedWrites = [];
  const writes = [];
  const visited = [];
  const readyTimings = [];
  const motion = process.env.GUIDE_BROWSER_MOTION || 'reduce';
  const before = structuredClone(store.account());
  let delayedMap = 0;
  let currentStep = 'welcome';
  const pendingRequests = new Set();
  try {
    await page.setViewport({ width: scenario.width, height: scenario.height });
    // Test both the site's supported reduced-motion mode and ordinary animations.
    // Preserve exact native transition diagnostics separately in ordinary mode.
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.evaluateOnNewDocument((preferences) => {
      localStorage.setItem('free_bbs_theme_mode', preferences.theme);
      if (preferences.typeScale)
        localStorage.setItem(
          'free_bbs_typography_preferences',
          JSON.stringify({ typeScale: preferences.typeScale, fontPreset: preferences.fontPreset }),
        );
    }, scenario);
    page.on('pageerror', (error) => {
      const diagnostic = { url: page.url(), message: error.message };
      if (
        motion === 'no-preference' &&
        error.message ===
          'InvalidStateError: Transition was aborted because of invalid state. ViewTransition opt-in disabled'
      ) {
        nativeTransitionDiagnostics.push(diagnostic);
        console.warn('Native cross-document transition diagnostic:', diagnostic);
      } else errors.push(diagnostic);
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const operation = (async () => {
        const url = new URL(request.url());
        if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
        if (url.origin !== base) {
          blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
          return request.abort('blockedbyclient');
        }
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          url.pathname.startsWith('/api/')
        ) {
          writes.push(`${request.method()} ${url.pathname}`);
          const allowed =
            (url.pathname === '/api/onboarding' && ['PATCH', 'POST'].includes(request.method())) ||
            (url.pathname === '/api/onboarding/reward' && request.method() === 'POST');
          if (!allowed) {
            unexpectedWrites.push(`${request.method()} ${url.pathname}`);
            return request.respond({
              status: 405,
              contentType: 'application/json',
              body: '{"message":"Guide QA rejects business writes"}',
            });
          }
        }
        if (
          url.pathname === '/api/courses/math/map' &&
          request.method() === 'GET' &&
          new URL(request.frame()?.url() || base).pathname === '/course'
        ) {
          delayedMap += 1;
          await sleep(scenario.mapDelay);
        }
        return request.continue();
      })();
      pendingRequests.add(operation);
      operation
        .catch((error) => errors.push({ url: request.url(), message: error.message }))
        .finally(() => pendingRequests.delete(operation));
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    if (scenario.typeScale) {
      assert.equal(await page.$eval('html', (node) => node.dataset.typeScale), scenario.typeScale);
      assert.equal(
        await page.$eval('html', (node) => node.dataset.fontPreset),
        scenario.fontPreset,
      );
    }
    await page.waitForFunction(
      () =>
        document.querySelector('.max-tour[open] #max-tour-title')?.textContent ===
        '你好呀，我是 Max！',
    );
    await click(page, '.max-tour .guide-primary');
    for (const [index, step] of STEPS.entries()) {
      currentStep = step.id;
      const snapshot = await waitStep(page, index, step);
      readyTimings.push({ id: step.id, readyMs: snapshot.readyMs });
      if (
        ['world-coming-islands', 'world-mathematics', 'world-island-overview'].includes(step.id)
      ) {
        await page.evaluate(() => window.freeBbsMaxGuide.pause());
        if (step.id === 'world-island-overview')
          await click(page, '#world-modal[open] [data-close-modal]');
        await page.focus('#world-orbit');
        await page.keyboard.press('ArrowRight');
        if (step.id !== 'world-coming-islands') await page.keyboard.press('ArrowRight');
        const concealed = step.id === 'world-coming-islands' ? 'physics' : 'mathematics';
        assert.equal(
          await page.$eval(`.island-orbit-item[data-world-id="${concealed}"]`, (node) =>
            node.getAttribute('aria-hidden'),
          ),
          'true',
        );
        if (step.id === 'world-island-overview') {
          await click(page, '.island-orbit-item[data-world-id="signals"]');
          assert.equal(
            await page.$eval('#world-modal-title', (node) => node.textContent),
            '信号系统',
          );
          // Public manual entry deliberately respects an existing dialog.
          await page.evaluate(() => window.freeBbsMaxGuide.start());
          assert.equal(await page.$('.max-tour[open]'), null);
          await click(page, '#world-modal[open] [data-close-modal]');
        }
        await page.evaluate(() => window.freeBbsMaxGuide.start());
        await page.waitForSelector('.max-tour[open] .guide-primary');
        await click(page, '.max-tour .guide-primary');
        const resumed = await waitStep(page, index, step);
        readyTimings.push({ id: `${step.id}:resume-concealed-orbit`, readyMs: resumed.readyMs });
        if (step.id === 'world-island-overview')
          assert.equal(
            await page.$eval('#world-modal-title', (node) => node.textContent),
            '数学基础',
          );
        else
          assert.equal(
            await page.$eval(`.island-orbit-item[data-world-id="${concealed}"]`, (node) =>
              node.getAttribute('aria-hidden'),
            ),
            null,
          );
      }
      if (step.id === 'world-course-orbit') {
        // Reproduce a user pausing, exploring another island, then resuming.
        // Only read-only view buttons are clicked; the guide must return to math.
        await page.evaluate(() => window.freeBbsMaxGuide.pause());
        await click(page, '#island-course-back');
        // Use the world's documented keyboard controls to hide mathematics.
        // This keeps the fixture independent of 3D orbit button hit-test bounds.
        await page.focus('#world-orbit');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        assert.equal(
          await page.$eval('.island-orbit-item[data-world-id="mathematics"]', (node) =>
            node.getAttribute('aria-hidden'),
          ),
          'true',
        );
        await click(page, '.island-orbit-item[data-world-id="signals"]');
        await click(page, '#world-enter-island');
        assert.equal(
          await page.$eval('#island-course-orbit', (node) => node.dataset.worldId),
          'signals',
        );
        await page.evaluate(() => window.freeBbsMaxGuide.start());
        await page.waitForSelector('.max-tour[open] .guide-primary');
        await click(page, '.max-tour .guide-primary');
        const resumed = await waitStep(page, index, step);
        readyTimings.push({ id: `${step.id}:resume-hidden-math`, readyMs: resumed.readyMs });
        assert.equal(
          await page.$eval('#island-course-orbit', (node) => node.dataset.worldId),
          'mathematics',
        );
      }
      visited.push(step.id);
      console.log(
        `${scenario.name}: ${index + 1}/${STEPS.length} ${step.id} ready ${snapshot.readyMs} ms`,
      );
      if (step.reveal) {
        await click(page, '.max-tour .guide-primary');
        await waitStep(page, index, step, { revealed: true });
        // The actual target hotspot closes back to the entry without advancing.
        await click(page, '.max-tour-target-action:not(.is-alternate)');
        await waitStep(page, index, step);
        await click(page, '.max-tour .guide-primary');
        await waitStep(page, index, step, { revealed: true });
      }
      if (
        [
          'world-course-orbit',
          'course-directory',
          'course-enter-knowledge',
          'activities-receipt',
          'settings-reading',
          'settings-security',
          'development-status',
        ].includes(step.id)
      ) {
        await page.screenshot({ path: path.join(directory, `${scenario.name}-${step.id}.png`) });
      }
      await click(page, '.max-tour .guide-primary');
    }
    await page.waitForFunction(
      () =>
        !document.querySelector('.max-tour[open]') &&
        window.freeBbsMaxGuide?.snapshot().status === 'completed',
    );
    assert.deepEqual(
      visited,
      STEPS.map((step) => step.id),
    );
    assert.equal(progress(GUIDE_VERSION).status, 'completed');
    assert.equal(delayedMap, 1, 'course map must be loaded once without a bounce to /world');
    assert.equal(writes.filter((entry) => entry === 'POST /api/onboarding/reward').length, 1);
    assert.equal(store.account().electric, before.electric + 10);
    assert.equal(store.account().magnetic, before.magnetic + 10);
    assert.equal(store.account().heat, before.heat);
    assert.deepEqual(
      store.account().assets,
      before.assets,
      'guide must not buy, feed, equip, or recycle',
    );
    assert.deepEqual(
      unexpectedWrites,
      [],
      'only guide progress and its once-only reward may write',
    );
    assert.deepEqual(
      blockedRequests,
      [],
      'the preview must never attempt production or external services',
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(directory, `${scenario.name}-report.json`),
      JSON.stringify(
        { scenario, motion, visited, readyTimings, nativeTransitionDiagnostics, errors, writes },
        null,
        2,
      ),
    );
    console.log(
      `${scenario.name}: all ${visited.length} steps passed; map delayed ${scenario.mapDelay} ms; only progress/reward writes; ${nativeTransitionDiagnostics.length} native transition diagnostics.`,
    );
  } catch (error) {
    await page
      .screenshot({ path: path.join(directory, `${scenario.name}-failure.png`) })
      .catch(() => {});
    const state = await page
      .evaluate(() => ({
        url: window.location.href,
        title: document.querySelector('#max-tour-title')?.textContent,
        body: document.querySelector('#max-tour-body')?.textContent,
        status: document.querySelector('.max-tour-status')?.textContent,
        step: window.freeBbsMaxGuide?.activeStep,
        viewport: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY },
        card: document.querySelector('.max-tour-card')?.getBoundingClientRect().toJSON(),
        next: document.querySelector('.max-tour .guide-primary')?.getBoundingClientRect().toJSON(),
        cardStyle: {
          top: document.querySelector('.max-tour-card')?.style.top,
          className: document.querySelector('.max-tour-card')?.className,
          height: getComputedStyle(document.querySelector('.max-tour-card')).height,
          transform: getComputedStyle(document.querySelector('.max-tour-card')).transform,
          dialogTop: document.querySelector('.max-tour')?.getBoundingClientRect().top,
          dialogScrollTop: document.querySelector('.max-tour')?.scrollTop,
          dialogScrollHeight: document.querySelector('.max-tour')?.scrollHeight,
          computedTop: getComputedStyle(document.querySelector('.max-tour-card')).top,
        },
      }))
      .catch(() => ({}));
    state.frames = await page
      .evaluate(async () => {
        const frames = [];
        for (let index = 0; index < 8; index += 1) {
          await new Promise((resolve) => {
            requestAnimationFrame(resolve);
          });
          const card = document.querySelector('.max-tour-card');
          frames.push({
            top: card.getBoundingClientRect().top,
            styleTop: card.style.top,
            height: card.getBoundingClientRect().height,
            className: card.className,
            dialogScrollTop: document.querySelector('.max-tour').scrollTop,
          });
        }
        return frames;
      })
      .catch(() => []);
    console.error(`${scenario.name} at ${currentStep}:`, {
      state,
      errors,
      nativeTransitionDiagnostics,
      blockedRequests,
      unexpectedWrites,
    });
    error.message = `${scenario.name} failed at ${currentStep}: ${error.message}\n${JSON.stringify({ state, errors, blockedRequests, unexpectedWrites })}`;
    throw error;
  } finally {
    await Promise.allSettled([...pendingRequests]);
    await context.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

async function main() {
  const requested = process.env.GUIDE_BROWSER_SCENARIO;
  const selected = requested
    ? scenarios.filter((scenario) => scenario.name === requested)
    : scenarios;
  assert.ok(selected.length, `Unknown GUIDE_BROWSER_SCENARIO: ${requested}`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-guide-browser-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  console.log(`Guide QA screenshots: ${directory}`);
  try {
    for (const scenario of selected) await runScenario(browser, scenario, directory);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
