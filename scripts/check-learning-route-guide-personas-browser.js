// Real course/guide UI on a fresh, memory-only complete preview for every persona.
// It never loads a personal browser profile or permits production/business writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { TOKEN } = require('./preview-economy');
const { stepsFor } = require('../public/max-guide');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (
    !['--output', '--playwright', '--chrome', '--phase'].includes(process.argv[index]) ||
    !process.argv[index + 1]
  )
    throw new Error('Use --output, --playwright, --chrome and --phase option/value pairs');
  options.set(process.argv[index], process.argv[index + 1]);
}
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  options.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const root = path.join(__dirname, '..');
const output = path.resolve(
  options.get('--output') || path.join(root, 'output/learning-route-guide-personas-20261016'),
);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const reportFile = path.join(output, `${run}-report.json`);
const sourceFiles = [
  'public/learning-guide.js',
  'public/max-guide-stations.js',
  'public/max-guide.js',
  'public/course-learning-route.js',
  'public/course-learning-route.css',
  'public/course-structure.js',
  'public/course.html',
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  );
const report = {
  boundary:
    'Real current source on isolated loopback complete previews. Synthetic preview account and memory only; no production, private profile, real AI, answer submission, notes writes or rewards. These are usability checks, not evidence of learning effectiveness.',
  startedAt: new Date().toISOString(),
  cases: [],
  errors: [],
};
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const scenes = [
  {
    key: 'newcomer-optional-desktop',
    phase: 'optional',
    width: 1440,
    height: 1000,
    theme: 'light',
  },
  { key: 'keyboard-optional-320', phase: 'optional', width: 320, height: 700, theme: 'dark' },
  {
    key: 'educator-large-text-200',
    phase: 'optional',
    width: 1280,
    height: 900,
    theme: 'light',
    fontSize: 32,
  },
  {
    key: 'mobile-large-text-200',
    phase: 'optional',
    width: 390,
    height: 844,
    theme: 'dark',
    fontSize: 32,
  },
  {
    key: 'optional-controls-arrive-late',
    phase: 'late',
    width: 390,
    height: 844,
    theme: 'light',
    delayMap: 4500,
  },
  {
    key: 'current-tour-resume',
    phase: 'tour',
    version: GUIDE_VERSION,
    width: 1440,
    height: 1000,
    theme: 'light',
  },
  {
    key: 'archived-v4-resume',
    phase: 'tour',
    version: 'max-v4',
    width: 390,
    height: 844,
    theme: 'dark',
  },
  {
    key: 'archived-v3-resume',
    phase: 'tour',
    version: 'max-v3',
    width: 1440,
    height: 1000,
    theme: 'light',
  },
  {
    key: 'guide-save-failure-retry',
    phase: 'failure',
    version: GUIDE_VERSION,
    width: 390,
    height: 844,
    theme: 'light',
  },
  {
    key: 'pause-while-map-arrives-late',
    phase: 'pause',
    version: GUIDE_VERSION,
    width: 390,
    height: 844,
    theme: 'dark',
    delayMap: 6500,
  },
];

async function api(base, endpoint, { method = 'GET', body } = {}) {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  const data = await response.json();
  assert.equal(
    response.status,
    200,
    `Synthetic preview ${method} ${endpoint}: ${JSON.stringify(data)}`,
  );
  return data;
}

async function readyCourse(page) {
  await page.waitForFunction(
    () =>
      document.getElementById('course-map-canvas')?.courseStructureController?.getRouteState()
        ?.total > 0,
  );
  await page.evaluate(() => document.fonts.ready);
}

async function learningState(page) {
  return page.evaluate(() => {
    const controller = document.getElementById('course-map-canvas')?.courseStructureController;
    return {
      structure: controller?.getState(),
      picker: controller?.getPickerState(),
      preference: window.FreeBbsLearningStart?.currentPreference() || null,
      search: document.querySelector('.course-structure-toolbar input[type="search"]')?.value,
      location: window.location.pathname + window.location.search,
    };
  });
}

async function keyboardFocusBounds(page, selector) {
  return page.evaluate((value) => {
    const dialog = document.querySelector(value);
    const active = document.activeElement;
    const outer = dialog.getBoundingClientRect();
    const box = active?.getBoundingClientRect();
    return {
      inside: dialog.contains(active),
      // Native Chrome can put focus in browser chrome between modal Tab cycles;
      // document.body then represents no active page control, not an escaped
      // focusable element in the inert course underneath the modal.
      browserChrome: active === document.body || active === document.documentElement,
      label: (active?.getAttribute('aria-label') || active?.textContent || '').trim().slice(0, 120),
      visible: Boolean(
        box &&
        box.width > 0 &&
        box.height > 0 &&
        box.left >= outer.left - 1 &&
        box.right <= outer.right + 1 &&
        box.top >= outer.top - 1 &&
        box.bottom <= outer.bottom + 1,
      ),
      active: box ? { x: box.x, y: box.y, right: box.right, bottom: box.bottom } : null,
      outer: { x: outer.x, y: outer.y, right: outer.right, bottom: outer.bottom },
    };
  }, selector);
}

async function checkOptional(page, scene, result, check, screenshot) {
  await readyCourse(page);
  const before = await learningState(page);
  await check('No forced optional guide or self-report on course entry', async () => {
    assert.equal(await page.locator('.learning-guide-dialog[open]').count(), 0);
    assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
    assert.equal(before.preference, null);
  });
  const opener = page.locator('#learning-guide-open');
  for (let index = 0; index < 4; index += 1) {
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.learning-guide-dialog[open]');
    for (let step = 0; step < index; step += 1) {
      await page.locator('.learning-guide-dialog footer button:last-child').focus();
      await page.keyboard.press('Enter');
    }
    await check(`Course guide ${index + 1}/4 fits and remains a keyboard modal`, async () => {
      const layout = await page.locator('.learning-guide-dialog').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          width: window.innerWidth,
          height: window.innerHeight,
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
        };
      });
      result.guideLayouts ||= [];
      result.guideLayouts.push({ step: index + 1, ...layout });
      assert.ok(
        layout.x >= -1 &&
          layout.right <= layout.width + 1 &&
          layout.y >= -1 &&
          layout.bottom <= layout.height + 1,
      );
      assert.ok(
        layout.scrollWidth <= layout.clientWidth + 1,
        'No hidden horizontal reading or controls',
      );
      if (scene.fontSize) assert.ok(parseFloat(layout.rootFontSize) >= scene.fontSize - 0.5);
      await page.locator('.learning-guide-dialog [aria-label="关闭学习指南"]').focus();
      for (let tab = 0; tab < 9; tab += 1) {
        await page.keyboard.press('Tab');
        const focused = await keyboardFocusBounds(page, '.learning-guide-dialog[open]');
        assert.equal(focused.inside || focused.browserChrome, true, JSON.stringify(focused));
        if (focused.inside) assert.equal(focused.visible, true, JSON.stringify(focused));
      }
    });
    await screenshot(`guide-${index + 1}`);
    const action = page.locator('.learning-guide-dialog > .learning-primary');
    if (await action.isEnabled()) {
      await action.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.learning-guide-dialog[open]', { state: 'hidden' });
      const target = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        guideOpener: document.activeElement?.id === 'learning-guide-open',
      }));
      await check(`Course guide ${index + 1}/4 only focuses its real entry`, async () => {
        assert.equal(target.guideOpener, false, 'Closing must not steal entry focus back');
        assert.deepEqual(
          await learningState(page),
          before,
          'Guide focus must not select, search or change learning preference',
        );
        assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 0);
      });
    } else {
      await check(
        `Course guide ${index + 1}/4 honestly explains a missing real entry`,
        async () => {
          assert.equal(index, 2, 'Only resume is unavailable in this published local fixture');
          assert.match(
            await page.locator('.learning-guide-dialog > p:not(.learning-caption)').textContent(),
            /还没有/,
          );
        },
      );
      await page.keyboard.press('Escape');
    }
  }
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await check('Escape restores the guide opener and preserves all course choices', async () => {
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'learning-guide-open');
    assert.deepEqual(await learningState(page), before);
  });
}

async function waitTour(page, index) {
  await page.waitForFunction(
    (expected) =>
      window.freeBbsMaxGuide?.activeStep === expected &&
      document.querySelector('.max-tour[open] .max-tour-card')?.getAttribute('aria-busy') !==
        'true' &&
      !document.querySelector('.max-tour-status')?.textContent &&
      document.querySelector('.max-tour .guide-primary')?.disabled === false,
    index,
    { timeout: 18000 },
  );
}

async function runCase(browser, scene) {
  const preview = createCompleteLearningPreview();
  const selection = await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${selection.port}`;
  const result = {
    ...scene,
    base,
    portSelection: selection,
    startedAt: new Date().toISOString(),
    sourceBefore: hashes(),
    status: 'pending',
    checks: [],
    pageErrors: [],
    blockedRequests: [],
    writes: [],
    screenshots: [],
  };
  report.cases.push(result);
  const current = stepsFor(GUIDE_VERSION);
  const currentIndex = current.findIndex((step) => step.id === 'course-directory');
  await api(base, '/api/onboarding', {
    method: 'PATCH',
    body: { version: GUIDE_VERSION, status: 'skipped', step: currentIndex },
  });
  if (LATEST_RELEASE)
    await api(base, '/api/onboarding', {
      method: 'PATCH',
      body: { version: LATEST_RELEASE.id, status: 'skipped', step: 0 },
    });
  const version = scene.version || GUIDE_VERSION;
  const steps = stepsFor(version);
  const index = steps.findIndex((step) => step.id === 'course-directory');
  if (!['optional', 'late'].includes(scene.phase))
    await api(base, '/api/onboarding', {
      method: 'PATCH',
      body: { version, status: 'in_progress', step: index },
    });
  const baseline = preview.progress(GUIDE_VERSION);
  const starBefore = await api(base, '/api/learning-stars/signals');
  const notesBefore = JSON.stringify(preview.learning.store.rows);
  const attemptsBefore = JSON.stringify(preview.learning.assessmentStore.rows);
  const context = await browser.newContext({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  let failGuideSave = false;
  await context.addInitScript(({ theme, fontSize }) => {
    localStorage.setItem('free_bbs_theme_mode', theme);
    if (fontSize)
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          document.documentElement.style.setProperty('font-size', `${fontSize}px`, 'important');
        },
        { once: true },
      );
  }, scene);
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) {
      result.blockedRequests.push({
        method: request.method(),
        origin: url.origin,
        path: url.pathname,
      });
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      result.writes.push({
        method: request.method(),
        path: url.pathname,
        body: request.postData(),
      });
      if (url.pathname !== '/api/onboarding')
        return route.fulfill({
          status: 405,
          contentType: 'application/json',
          body: '{"message":"Isolated guide QA blocks business writes"}',
        });
      if (failGuideSave)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"本地故障测试：暂时无法保存导引"}',
        });
    }
    if (scene.delayMap && url.pathname === '/api/courses/signals/map')
      await new Promise((resolve) => {
        setTimeout(resolve, scene.delayMap);
      });
    return route.continue();
  });
  const check = async (label, action) => {
    try {
      await action();
      result.checks.push({ label, status: 'passed' });
    } catch (error) {
      result.checks.push({ label, status: 'failed', error: error.stack });
      report.errors.push({ scene: scene.key, label, error: error.message });
    }
  };
  const screenshot = async (label) => {
    const file = path.join(output, `${run}-${scene.key}-${label}.png`);
    await page.screenshot({ path: file });
    result.screenshots.push(file);
  };
  try {
    const params = new URLSearchParams({ course: 'signals' });
    if (!['optional', 'late'].includes(scene.phase)) {
      params.set('guideTour', '1');
      params.set('guideVersion', version);
    }
    await page.goto(`${base}/course?${params}`, { waitUntil: 'domcontentloaded' });
    if (scene.phase === 'optional') await checkOptional(page, scene, result, check, screenshot);
    else if (scene.phase === 'late') {
      await page.locator('#learning-guide-open').focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.learning-guide-dialog[open]');
      await check(
        'A guide opens during course loading without selecting a fake first point',
        async () => {
          assert.equal(
            await page.locator('.learning-guide-dialog > .learning-primary').isEnabled(),
            false,
          );
        },
      );
      await readyCourse(page);
      await check(
        'Late real controls enable the same open guide without retry or resetting its step',
        async () => {
          await page.waitForFunction(
            () =>
              document.querySelector('.learning-guide-dialog > .learning-primary')?.disabled ===
              false,
          );
          assert.equal(
            await page.locator('.learning-guide-dialog .learning-caption').textContent(),
            '1 / 4',
          );
          assert.equal((await learningState(page)).preference, null);
          assert.deepEqual(preview.progress(GUIDE_VERSION), baseline);
        },
      );
      await screenshot('controls-arrived');
      await page.keyboard.press('Escape');
    } else if (scene.phase === 'pause') {
      await page.waitForSelector('.max-tour[open]');
      await page.keyboard.press('Escape');
      await readyCourse(page);
      await check(
        'Escape while waiting pauses only the selected tour, and a late map never revives it',
        async () => {
          await page.waitForFunction(() => !document.querySelector('.max-tour[open]'));
          assert.equal(preview.progress(version).status, 'skipped');
          assert.equal(preview.progress(version).step, index);
          assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
          assert.equal((await learningState(page)).preference, null);
        },
      );
      await screenshot('paused-after-load');
    } else {
      await waitTour(page, index);
      await screenshot('resumed');
      await check(
        'Resuming the stored version reaches the correct real course frame without restarting',
        async () => {
          assert.equal(await page.locator('#max-tour-title').textContent(), steps[index].title);
          assert.equal(preview.progress(version).step, index);
          if (version !== GUIDE_VERSION)
            assert.deepEqual(preview.progress(GUIDE_VERSION), baseline);
          assert.equal((await learningState(page)).preference, null);
        },
      );
      if (scene.phase === 'failure') {
        failGuideSave = true;
        const before = preview.progress(version);
        await page.locator('.max-tour .guide-primary').click();
        await page.waitForFunction(() =>
          document.querySelector('.max-tour-status')?.textContent.includes('暂时无法保存'),
        );
        await check(
          'A failed save keeps the acknowledged step, open controls and retry available',
          async () => {
            assert.deepEqual(preview.progress(version), before);
            assert.equal(await page.evaluate(() => window.freeBbsMaxGuide.activeStep), index);
            assert.equal(
              await page.getByRole('button', { name: '重试', exact: true }).isEnabled(),
              true,
            );
            assert.equal(
              await page.getByRole('button', { name: '稍后继续', exact: true }).isEnabled(),
              true,
            );
          },
        );
        await screenshot('save-failed');
        failGuideSave = false;
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await waitTour(page, index + 1);
        await check('Explicit retry advances once without resetting learning choices', async () => {
          assert.equal(preview.progress(version).step, index + 1);
          assert.equal((await learningState(page)).preference, null);
        });
      } else {
        for (let offset = 1; offset <= 2; offset += 1) {
          await page.locator('.max-tour .guide-primary').click();
          await waitTour(page, index + offset);
          await screenshot(`course-frame-${offset + 1}`);
        }
        await check(
          'The tour prepares only a published point overview, never enters reading or submits work',
          async () => {
            assert.equal(new URL(page.url()).pathname, '/course');
            assert.equal(await page.locator('#course-knowledge-overview[open]').count(), 1);
            const href = await page
              .locator('#course-knowledge-overview[open] .knowledge-overview-study')
              .getAttribute('href');
            const destination = new URL(href, base);
            assert.equal(destination.origin, base);
            assert.equal(destination.pathname, '/knowledge');
            assert.equal(destination.searchParams.get('course'), 'signals');
            assert.ok(destination.searchParams.get('point'));
          },
        );
      }
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.max-tour[open]'));
    }
    await check('Reduced motion and page width remain usable', async () => {
      assert.equal(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        true,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        true,
      );
    });
    await check('Guide work never changes stars, answers or private notes', async () => {
      assert.deepEqual(await api(base, '/api/learning-stars/signals'), starBefore);
      assert.equal(JSON.stringify(preview.learning.store.rows), notesBefore);
      assert.equal(JSON.stringify(preview.learning.assessmentStore.rows), attemptsBefore);
      assert.deepEqual(
        result.writes.filter((request) => request.path !== '/api/onboarding'),
        [],
      );
    });
    await check('No browser script errors or external service requests', async () => {
      assert.deepEqual(result.pageErrors, []);
      assert.deepEqual(result.blockedRequests, []);
    });
    result.status = result.checks.some((entry) => entry.status === 'failed') ? 'failed' : 'passed';
  } catch (error) {
    result.status = 'failed';
    result.error = error.stack;
    report.errors.push({ scene: scene.key, error: error.message });
    await screenshot('failure').catch(() => {});
  } finally {
    result.sourceAfter = hashes();
    result.sourceChanged =
      JSON.stringify(result.sourceBefore) !== JSON.stringify(result.sourceAfter);
    result.finishedAt = new Date().toISOString();
    await context.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    save();
    console.log(`${scene.key}: ${result.status}`);
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(options.get('--chrome') || process.env.CHROME_BIN
      ? { executablePath: options.get('--chrome') || process.env.CHROME_BIN }
      : {}),
    args: ['--disable-background-networking'],
  });
  try {
    const phase = options.get('--phase');
    const selected = scenes.filter((scene) => !phase || phase === scene.phase);
    assert.ok(selected.length, 'At least one explicitly selected QA phase exists');
    for (const scene of selected) await runCase(browser, scene);
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    save();
    console.log(`Report: ${reportFile}`);
    if (report.errors.length) process.exitCode = 1;
  }
}
main().catch((error) => {
  fs.mkdirSync(output, { recursive: true });
  report.errors.push({ error: error.message });
  save();
  console.error(error.stack);
  process.exitCode = 1;
});
