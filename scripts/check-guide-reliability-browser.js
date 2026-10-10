// Real, loopback-only guide QA. Faults/delays are confined to the memory preview;
// the production UI is operated through pointer clicks, not controller methods.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { STEPS } = require('../public/max-guide-stations');
const { GUIDE_VERSION } = require('../public/max-guide-releases');

const MODULES = [
  '/max-guide-releases.js',
  '/max-guide-stations.js',
  '/max-guide-geometry.js',
  '/max-guide.js',
];
const scenarios = [
  { name: 'desktop-first', width: 1440, height: 900, fullTour: true },
  { name: 'mobile-first', width: 390, height: 844, fullTour: true },
  {
    name: 'desktop-slow-dependencies',
    width: 1440,
    height: 900,
    fullTour: true,
    moduleDelay: 1600,
    mapDelay: 3500,
  },
  { name: 'desktop-module-404-recovery', width: 1440, height: 900, fault: '404' },
  { name: 'mobile-connection-reset-recovery', width: 390, height: 844, fault: 'disconnect' },
  { name: 'desktop-warm-cache-refresh', width: 1440, height: 900, warmCache: true },
];
const networkDelay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function installPreviewTransport(server, scenario, transport) {
  const state = transport;
  const [handle] = server.listeners('request');
  server.removeListener('request', handle);
  server.on('request', async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const module = MODULES.includes(url.pathname);
    if (module) {
      transport.moduleRequests.push({
        path: url.pathname,
        version: url.searchParams.get('v'),
        at: Date.now(),
        fault: transport.fault || null,
      });
      // Only this QA server makes guide modules cacheable, so reload tests can
      // prove real browser cache hits rather than simply assuming a warm cache.
      const writeHead = response.writeHead.bind(response);
      response.writeHead = (status, headers) =>
        writeHead(status, {
          ...headers,
          'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
        });
      if (url.pathname === '/max-guide-stations.js' && transport.fault) {
        if (transport.fault === 'disconnect') return request.socket.destroy();
        response.writeHead(404, { 'Content-Type': 'application/javascript' });
        return response.end('// Intentional first-load QA fault; not a production asset.');
      }
      if (url.pathname === '/max-guide-stations.js' && url.searchParams.get('v') === 'old-qa') {
        response.writeHead(200, { 'Content-Type': 'application/javascript' });
        return response.end('/* old cached asset fixture: never executed */');
      }
      if (url.pathname === '/max-guide-stations.js' && scenario.moduleDelay)
        await networkDelay(scenario.moduleDelay);
    }
    if (url.pathname === '/api/courses/math/map' && scenario.mapDelay) {
      state.mapRequests += 1;
      await networkDelay(scenario.mapDelay);
    }
    if (response.destroyed || request.destroyed) return;
    return handle(request, response);
  });
}

async function pointerClick(page, selector) {
  await page.locator(selector).setTimeout(15000).click();
}

async function waitWelcome(page) {
  await page.waitForFunction(
    () =>
      Boolean(window.freeBbsMaxGuide) &&
      document.querySelector('.max-tour[open] #max-tour-title')?.textContent ===
        '你好呀，我是 Max！',
    { timeout: 20000 },
  );
}

async function snapshot(page) {
  return page.evaluate(() => ({
    url: window.location.pathname + window.location.search,
    controller: Boolean(window.freeBbsMaxGuide),
    activeStep: window.freeBbsMaxGuide?.activeStep,
    progress: window.freeBbsMaxGuide?.snapshot(),
    title: document.querySelector('#max-tour-title')?.textContent,
    body: document.querySelector('#max-tour-body')?.textContent,
    status: document.querySelector('.max-tour-status')?.textContent,
    sync: (
      document.querySelector('#guide-module-status') || document.querySelector('#guide-sync-status')
    )?.textContent,
    dialogs: document.querySelectorAll('.max-tour').length,
    scripts: [...document.querySelectorAll('script[src]')]
      .map((node) => new URL(node.src))
      .filter((url) => url.pathname.startsWith('/max-guide'))
      .map((url) => url.pathname + url.search),
    ids: window.FreeBbsGuideStations?.STEPS.map((step) => step.id),
    version: window.FreeBbsGuideReleases?.GUIDE_VERSION,
  }));
}

async function assertMountedOnce(page, label) {
  const state = await snapshot(page);
  assert.equal(state.controller, true, `${label}: controller absent`);
  assert.equal(state.dialogs, 1, `${label}: duplicate tour dialogs`);
  assert.equal(state.version, GUIDE_VERSION, `${label}: stale release`);
  assert.deepEqual(
    state.ids,
    STEPS.map((step) => step.id),
    `${label}: stale station catalogue`,
  );
  for (const module of MODULES)
    assert.equal(
      state.scripts.filter((source) => source.startsWith(`${module}?`)).length,
      1,
      `${label}: module missing or executed through duplicate script elements: ${module}`,
    );
  assert.ok(
    state.scripts.every((source) => /\?v=20261008-1$/.test(source)),
    `${label}: old module URL`,
  );
  return state;
}

async function waitStep(page, index, step) {
  await page.waitForFunction(
    (expectedIndex) =>
      Boolean(document.querySelector('.learning-start-dialog[open]')) ||
      (window.freeBbsMaxGuide?.activeStep === expectedIndex &&
        Boolean(document.querySelector('.max-tour[open]'))),
    { timeout: 20000 },
    index,
  );
  if (await page.$('.learning-start-dialog[open]')) {
    const before = await page.url();
    const selector = '.learning-start-dialog[open] [data-learning-start-choice="level"]';
    await pointerClick(page, selector);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval(selector, (node) => node.value), 'new');
    await pointerClick(page, '.learning-start-dialog[open] .learning-start-apply');
    await page.waitForFunction(() => !document.querySelector('.learning-start-dialog[open]'));
    assert.equal(page.url(), before, 'learning-start confirmation must not reload the route');
  }
  await page.waitForFunction(
    (expectedIndex, expectedTitle, targetSelector) => {
      const guide = window.freeBbsMaxGuide;
      const target = [...document.querySelectorAll(targetSelector)].find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !node.closest('[hidden], .hidden');
      });
      return (
        guide?.activeStep === expectedIndex &&
        document.querySelector('.max-tour[open] #max-tour-title')?.textContent === expectedTitle &&
        document.querySelector('.max-tour .guide-primary')?.disabled === false &&
        document.querySelector('.max-tour-card')?.getAttribute('aria-busy') !== 'true' &&
        !document.querySelector('.max-tour-status')?.textContent &&
        Boolean(target)
      );
    },
    { timeout: 20000 },
    index,
    step.title,
    step.target,
  );
  const layout = await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const bounds = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      card: bounds('.max-tour-card'),
      next: bounds('.max-tour .guide-primary'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dialogScroll: document.querySelector('.max-tour').scrollTop,
    };
  });
  for (const key of ['card', 'next']) {
    const rect = layout[key];
    assert.ok(
      rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= layout.viewport.width + 1 &&
        rect.bottom <= layout.viewport.height + 1,
      `${step.id}: ${key} cropped: ${JSON.stringify(layout)}`,
    );
  }
  assert.equal(layout.dialogScroll, 0, `${step.id}: guide has unexpected internal page scroll`);
  const state = await assertMountedOnce(page, step.id);
  assert.equal(new URL(page.url()).pathname, step.route, `${step.id}: wrong route`);
  assert.equal(state.body, step.body, `${step.id}: unresolved/loading copy`);
  return state;
}

async function runScenario(browser, scenario, output) {
  const preview = createOnboardingPreview();
  const { server, store, progress } = preview;
  const transport = { fault: scenario.fault, moduleRequests: [], mapRequests: 0 };
  installPreviewTransport(server, scenario, transport);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const unexpectedWrites = [];
  const externalAttempts = [];
  const moduleResponses = [];
  const onboardingWrites = [];
  const rewardWrites = [];
  const before = structuredClone(store.account());
  const record = { name: scenario.name, checks: [], visited: [], passed: false };
  const check = (label) => record.checks.push(label);
  let phase = 'first';
  let lastStep = 'welcome';
  try {
    await page.setViewport({ width: scenario.width, height: scenario.height });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    page.on('pageerror', (error) =>
      errors.push({ phase, url: page.url(), message: error.message }),
    );
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return;
      if (url.origin !== origin)
        externalAttempts.push(`${request.method()} ${url.origin}${url.pathname}`);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        url.pathname.startsWith('/api/')
      ) {
        const entry = `${request.method()} ${url.pathname}`;
        if (url.pathname === '/api/onboarding' && ['POST', 'PATCH'].includes(request.method()))
          onboardingWrites.push(entry);
        else if (url.pathname === '/api/onboarding/reward' && request.method() === 'POST')
          rewardWrites.push(entry);
        else unexpectedWrites.push(entry);
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (MODULES.includes(url.pathname))
        moduleResponses.push({
          phase,
          path: url.pathname,
          version: url.searchParams.get('v'),
          status: response.status(),
          fromCache: response.fromCache(),
        });
    });
    // Prevent business writes in the memory backend without disabling Chromium
    // HTTP caching through request interception. This hook never hits production.
    const [memoryApi] = server.listeners('request');
    server.removeListener('request', memoryApi);
    server.on('request', (request, response) => {
      const url = new URL(request.url, origin);
      if (
        url.pathname.startsWith('/api/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        !(url.pathname === '/api/onboarding' && ['POST', 'PATCH'].includes(request.method)) &&
        !(url.pathname === '/api/onboarding/reward' && request.method === 'POST')
      ) {
        response.writeHead(405, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        return response.end('{"message":"Reliability QA rejects business mutations"}');
      }
      return memoryApi(request, response);
    });
    await page.goto(`${origin}/guide`, { waitUntil: 'domcontentloaded' });
    if (scenario.fault) {
      const retry = '#guide-module-retry';
      await page.waitForFunction(
        () => {
          const button = document.querySelector('#guide-module-retry');
          return (
            button?.textContent === '重新加载导引' &&
            button.disabled === false &&
            !window.freeBbsMaxGuide
          );
        },
        { timeout: 20000 },
      );
      check('failed dependency leaves the page usable with an in-place retry');
      await page.waitForNetworkIdle({ idleTime: 250, timeout: 20000 });
      const successfulBefore = transport.moduleRequests.filter((entry) => !entry.fault);
      assert.equal(successfulBefore.filter((entry) => entry.path === '/max-guide.js').length, 0);
      transport.fault = null;
      // Real pointer double-clicks exercise the busy guard. Only the failed
      // dependency may download again; controller creation happens once.
      await page.locator(retry).click({ clickCount: 2, delay: 20 });
      await waitWelcome(page);
      assert.equal(await page.$(retry), null, 'recovery button must be removed after success');
      await page.waitForNetworkIdle({ idleTime: 250, timeout: 20000 });
      for (const module of MODULES.filter((entry) => entry !== '/max-guide-stations.js'))
        assert.equal(
          transport.moduleRequests.filter((entry) => entry.path === module).length,
          1,
          `successful module must not download twice on recovery: ${module}`,
        );
      assert.equal(
        transport.moduleRequests.filter(
          (entry) => entry.path === '/max-guide-stations.js' && !entry.fault,
        ).length,
        1,
      );
      check(
        'pointer retry recovers without reloading, repeated successful modules, or duplicate controller',
      );
    } else {
      await waitWelcome(page);
      check('first visit loads the new guide without manual retries');
    }
    await assertMountedOnce(page, `${scenario.name}:welcome`);
    check('one controller/dialog and current-version modules/catalogue');
    if (scenario.warmCache) {
      // Seed an older URL through a read-only fetch; do not execute its text.
      await page.evaluate(async () => {
        const response = await fetch('/max-guide-stations.js?v=old-qa');
        await response.text();
      });
      for (let round = 1; round <= 3; round += 1) {
        await pointerClick(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
        const refreshPhase = `warm-refresh-${round}`;
        phase = refreshPhase;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.freeBbsMaxGuide));
        await page.waitForNetworkIdle({ idleTime: 250, timeout: 20000 });
        await pointerClick(page, '.guide-hero [data-guide-start]');
        await waitWelcome(page);
        await assertMountedOnce(page, `${scenario.name}:warm-${round}`);
        for (const module of MODULES)
          assert.ok(
            moduleResponses.some(
              (entry) => entry.phase === refreshPhase && entry.path === module && entry.fromCache,
            ),
            `refresh ${round} must use a demonstrated browser cache hit: ${module}`,
          );
        assert.equal(
          moduleResponses.filter(
            (entry) => entry.phase === refreshPhase && entry.version === 'old-qa',
          ).length,
          0,
        );
        check(
          `warm refresh ${round} has real cache hits and never executes the older cached asset URL`,
        );
      }
    }
    await pointerClick(page, '.max-tour .guide-primary');
    if (scenario.fullTour) {
      for (const [index, step] of STEPS.entries()) {
        lastStep = step.id;
        await waitStep(page, index, step);
        record.visited.push(step.id);
        check(`ready and clickable: ${step.id}`);
        if (
          [
            'discussion',
            'workbench',
            'laboratory',
            'creative',
            'pbl',
            'max',
            'development',
            'shop',
          ].includes(step.station)
        )
          await page.screenshot({
            path: path.join(output, `${scenario.name}-${step.station}.png`),
          });
        await pointerClick(page, '.max-tour .guide-primary');
      }
      await page.waitForFunction(
        () =>
          !document.querySelector('.max-tour[open]') &&
          window.freeBbsMaxGuide?.snapshot().status === 'completed',
        { timeout: 20000 },
      );
      assert.equal(progress(GUIDE_VERSION).status, 'completed');
      assert.deepEqual(
        record.visited,
        STEPS.map((step) => step.id),
      );
      check('all new basic-tour steps complete in order without retry/skip');
    } else {
      await waitStep(page, 0, STEPS[0]);
      await pointerClick(page, '.max-tour[open] .max-tour-controls > .max-tour-later');
      await page.waitForFunction(() => !document.querySelector('.max-tour[open]'));
      check('recovered/refreshed tour proceeds through an actual next-button click');
    }
    await page.waitForNetworkIdle({ idleTime: 300, timeout: 20000 });
    assert.deepEqual(errors, [], 'guide produces no uncaught page errors');
    assert.deepEqual(unexpectedWrites, [], 'guide must not trigger business mutations');
    assert.deepEqual(externalAttempts, [], 'all fixture requests must stay on loopback');
    const after = structuredClone(store.account());
    if (scenario.fullTour) {
      assert.equal(rewardWrites.length, 1, 'completion reward must be claimed exactly once');
      assert.equal(after.electric, before.electric + 10);
      assert.equal(after.magnetic, before.magnetic + 10);
      after.electric = before.electric;
      after.magnetic = before.magnetic;
      delete after.onboardingRewardClaimedAt;
      assert.equal(after.ledger.length, before.ledger.length + 1);
      const rewardLedger = after.ledger.pop();
      assert.equal(rewardLedger.source_key, 'onboarding-reward');
      assert.equal(Number(rewardLedger.electric_after) - Number(rewardLedger.electric_before), 10);
      assert.equal(Number(rewardLedger.magnetic_after) - Number(rewardLedger.magnetic_before), 10);
    } else assert.equal(rewardWrites.length, 0, 'incomplete tour must not claim a reward');
    // The memory preview memoizes the daily fortune during a GET; it is not a
    // submitted account mutation. Existing receipts must still remain intact.
    for (const [day, fortune] of Object.entries(before.fortunes))
      assert.equal(after.fortunes[day], fortune);
    after.fortunes = before.fortunes;
    assert.deepEqual(
      after,
      before,
      'guide must not modify account data beyond the one completion reward',
    );
    assert.ok(
      onboardingWrites.length <= STEPS.length * 5 + 20,
      `onboarding writes must be bounded, not an infinite load/retry loop: ${onboardingWrites.length}`,
    );
    for (const [documentUrl, modules] of Object.entries(
      transport.moduleRequests.reduce((counts, entry) => {
        const key = entry.path;
        return { ...counts, [key]: (counts[key] || 0) + 1 };
      }, {}),
    ))
      assert.ok(modules <= STEPS.length + 10, `unbounded module loading: ${documentUrl}`);
    if (scenario.moduleDelay)
      assert.ok(transport.moduleRequests.some((entry) => entry.path === '/max-guide-stations.js'));
    if (scenario.mapDelay)
      assert.ok(transport.mapRequests >= 1, 'slow map dependency was not exercised');
    check(
      'no uncaught errors, external network, unauthorized writes, account change, or unbounded requests',
    );
    record.passed = true;
    console.log(
      `${scenario.name}: ${record.checks.length} checks passed (${record.visited.length} steps)`,
    );
  } catch (error) {
    record.error = error.message;
    record.lastStep = lastStep;
    record.state = await snapshot(page).catch(() => null);
    await page
      .screenshot({ path: path.join(output, `${scenario.name}-failure.png`) })
      .catch(() => {});
    console.error(`${scenario.name} failed at ${lastStep}: ${error.message}`);
  } finally {
    Object.assign(record, {
      errors,
      unexpectedWrites,
      externalAttempts,
      moduleResponses,
      transport,
      onboardingWrites: onboardingWrites.length,
      rewardWrites: rewardWrites.length,
    });
    fs.writeFileSync(path.join(output, `${scenario.name}.json`), JSON.stringify(record, null, 2));
    await context.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
  return record;
}

async function main() {
  const requested = process.env.GUIDE_RELIABILITY_SCENARIO;
  const selected = requested
    ? scenarios.filter((scenario) => scenario.name === requested)
    : scenarios;
  assert.ok(selected.length, `Unknown GUIDE_RELIABILITY_SCENARIO: ${requested}`);
  const parent =
    process.env.GUIDE_RELIABILITY_OUTPUT ||
    path.resolve(__dirname, '../../../98 临时文件/guide-reliability-20261008-qa');
  fs.mkdirSync(parent, { recursive: true });
  const output = fs.mkdtempSync(path.join(parent, 'run-'));
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH,
    // External traffic cannot leave through this deliberately closed loopback
    // proxy; preview requests bypass it. No personal profile is ever reused.
    args: ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'],
  });
  const records = [];
  console.log(`Guide reliability artifacts: ${output}`);
  try {
    for (const scenario of selected) records.push(await runScenario(browser, scenario, output));
  } finally {
    await browser.close();
  }
  const summary = {
    output,
    scenarios: records.length,
    passed: records.filter((record) => record.passed).length,
    checks: records.reduce((count, record) => count + record.checks.length, 0),
    failures: records
      .filter((record) => !record.passed)
      .map(({ name, error, lastStep }) => ({ name, error, lastStep })),
  };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(summary.passed, summary.scenarios, 'guide reliability scenarios failed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
