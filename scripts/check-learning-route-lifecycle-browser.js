// Real time, real Chrome, isolated memory-only learning records. No clock overrides.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const root = path.join(__dirname, '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith('--') || !process.argv[index + 1])
    throw new Error('Use option/value pairs');
  args.set(process.argv[index], process.argv[index + 1]);
}
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  args.get('--playwright') || process.env.PLAYWRIGHT_MODULE || 'playwright',
);
const width = Number(args.get('--width') || 1440);
assert.ok([1440, 390, 320].includes(width));
const height = { 1440: 1000, 390: 844, 320: 640 }[width];
const output = path.resolve(
  args.get('--output') || path.join(root, 'output/learning-route-20261016/lifecycle'),
);
fs.mkdirSync(output, { recursive: true });
const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${width}`;
const reportPath = path.join(output, `${run}-report.json`);
const sourceFiles = [
  'public/knowledge.js',
  'public/knowledge-workspace.js',
  'public/learning-analytics.js',
  'public/learning-reader.js',
  'public/learning-guide.js',
  'public/knowledge-workspace.css',
  'public/knowledge.html',
  ...(args.get('--probe') === 'history'
    ? [
        'public/course.html',
        'public/course-map.js',
        'public/course-navigation.js',
        'public/course-structure.js',
        'public/course-learning-route.js',
        'public/course-learning-route.css',
        'public/course-catalog.js',
        'public/course-catalog.css',
      ]
    : []),
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
    'Actual wall-clock observation of 20-second engagement heartbeat and 60-second idle cutoff. Fresh independent Chrome profile, loopback CDP with documented noDefaults=true (no Playwright focus emulation), actual selected/background tabs. Isolated loopback preview, synthetic accounts, in-memory backend, simulated Max. No production requests, real learner data, time mocking or automatic assessment/star completion.',
  viewport: { width, height },
  startedAt: new Date().toISOString(),
  sourceBefore: hashes(),
  phases: [],
  errors: [],
  blockedRequests: [],
  pageErrors: [],
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
async function click(page, selector) {
  const item = page.locator(selector);
  await item.click({ trial: true });
  await item.click();
}
async function ready(page) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false' &&
      window.freeBbsKnowledge?.getLearningContext()?.node?.id === 'SS-02-01',
  );
  await page
    .locator('#knowledge-reading:not(.hidden) #knowledge-body')
    .waitFor({ state: 'visible' });
  assert.equal(await page.locator('.learning-start-dialog[open]').count(), 0);
}
function events(preview, start = 0) {
  return preview.analyticsStore.rows.slice(start).map((row) => ({
    userId: row.user_id,
    nodeId: row.node_id,
    type: row.event_type,
    seconds: row.delta_seconds,
    metadata: row.metadata_json,
    createdAt: row.created_at,
  }));
}
function engagement(rows) {
  return rows.filter((row) => row.type === 'engagement');
}
async function snapshot(page, preview) {
  return {
    at: new Date().toISOString(),
    records: events(preview).length,
    activeSeconds: engagement(events(preview)).reduce((total, row) => total + row.seconds, 0),
    browser: await page.evaluate(() => ({
      visible: document.visibilityState,
      focused: document.hasFocus(),
      uid: window.freeBbsApp?.userState?.uid,
      tool: document.querySelector('[data-knowledge-page]')?.dataset.learningTool || null,
      point: window.freeBbsKnowledge?.getLearningContext()?.node?.id || null,
      planPaused:
        document.getElementById('learning-plan-pause')?.getAttribute('aria-pressed') || null,
    })),
  };
}
async function observe(page, preview, name, seconds) {
  const phase = {
    name,
    seconds,
    startedAt: new Date().toISOString(),
    sourceBefore: hashes(),
    from: preview.analyticsStore.rows.length,
    observations: [],
  };
  report.phases.push(phase);
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    await delay(Math.min(20000, seconds * 1000 - (Date.now() - start)));
    phase.observations.push(await snapshot(page, preview));
    save();
    console.log(
      `${name}: ${Math.round((Date.now() - start) / 1000)} s; rows=${preview.analyticsStore.rows.length}`,
    );
  }
  phase.elapsedMilliseconds = Date.now() - start;
  phase.events = events(preview, phase.from);
  phase.activeSecondsAdded = engagement(phase.events).reduce(
    (total, row) => total + row.seconds,
    0,
  );
  phase.sourceAfter = hashes();
  phase.sourceChangedDuringPhase =
    JSON.stringify(phase.sourceBefore) !== JSON.stringify(phase.sourceAfter);
  phase.finishedAt = new Date().toISOString();
  save();
  return phase;
}
async function scrollReading(page, amount = 80) {
  const point = await page.locator('#knowledge-body').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      x: Math.min(window.innerWidth - 24, Math.max(24, box.left + box.width / 2)),
      y: Math.round(window.innerHeight * 0.6),
    };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, amount);
}
async function ownedState(page) {
  return page.evaluate(() => {
    const user = window.freeBbsApp.userState;
    const progress = window.FreeBbsLearningProgress;
    return {
      uid: user.uid,
      preference: window.FreeBbsLearningStart?.currentPreference(),
      tags: progress.read(localStorage, 'free_bbs_course_progress_v1', user),
      bookmark: progress.read(localStorage, 'free_bbs_reading_bookmark_v1', user),
    };
  });
}
async function nativeBrowser() {
  // Normal Playwright launch forces pages focused/visible. A fresh private
  // default context with noDefaults instead uses Chrome native tab state.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-learning-lifecycle-'));
  const executable = args.get('--chrome') || process.env.CHROME_BIN;
  assert.ok(executable, 'Supply an explicit Chrome executable; never attach a user browser');
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${directory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  try {
    const file = path.join(directory, 'DevToolsActivePort');
    for (let index = 0; !fs.existsSync(file) && index < 100; index += 1) await delay(100);
    const port = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
    assert.match(port, /^\d+$/);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      noDefaults: true,
      timeout: 12000,
    });
    Object.assign(report, {
      browserIsolation: {
        pid: child.pid,
        profile: directory,
        nativeFocus: true,
        debuggingLoopbackOnly: true,
      },
    });
    return { browser, context: browser.contexts()[0], child };
  } catch (error) {
    child.kill();
    throw error;
  }
}
async function historyProbe(page, preview, base) {
  await page.addInitScript(() => {
    window.freeBbsQaPageShowPersisted = null;
    window.addEventListener('pageshow', (event) => {
      window.freeBbsQaPageShowPersisted = event.persisted;
    });
  });
  await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    Boolean(document.getElementById('course-map-canvas')?.courseStructureController),
  );
  await page.locator('.course-structure-toolbar input[type="search"]').fill('ＳＳ－０２－０１');
  await click(page, '.course-structure-search-results button');
  await page.locator('#course-knowledge-overview[open]').waitFor();
  const expected = await page.evaluate(() =>
    document.getElementById('course-map-canvas').courseStructureController.getNavigationState(),
  );
  await click(page, '#course-knowledge-overview[open] .knowledge-overview-study');
  await ready(page);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      document.getElementById('course-map-canvas')?.courseStructureController?.getState()
        ?.focusedNodeId === 'SS-02-01',
  );
  const ordinary = await page.evaluate(() => ({
    context: document
      .getElementById('course-map-canvas')
      .courseStructureController.getNavigationState(),
    overviewOpen: Boolean(document.querySelector('#course-knowledge-overview[open]')),
    persisted: window.freeBbsQaPageShowPersisted,
    href: window.location.href,
  }));
  assert.equal(ordinary.context.find, expected.find);
  assert.equal(ordinary.context.chapter, expected.chapter);
  assert.equal(ordinary.context.focus, 'SS-02-01');
  if (ordinary.overviewOpen) await page.keyboard.press('Escape');
  await click(page, '.course-catalog-open');
  await page.locator('.course-catalog-dialog[open] .course-catalog-search').fill('SS-02-01');
  await click(page, '[data-catalog-node-id="SS-02-01"]');
  await page.locator('#course-knowledge-overview[open]').waitFor();
  await click(page, '#course-knowledge-overview[open] .knowledge-overview-study');
  await ready(page);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      document.getElementById('course-map-canvas')?.courseStructureController?.getState()
        ?.focusedNodeId === 'SS-02-01',
  );
  const catalog = await page.evaluate(() => ({
    overviewOpen: Boolean(document.querySelector('#course-knowledge-overview[open]')),
    catalogOpen: Boolean(document.querySelector('.course-catalog-dialog[open]')),
    persisted: window.freeBbsQaPageShowPersisted,
    href: window.location.href,
  }));
  if (catalog.overviewOpen) await page.keyboard.press('Escape');
  if (!(await page.locator('.course-catalog-dialog[open]').count()))
    await click(page, '.course-catalog-open');
  assert.equal(
    await page.locator('.course-catalog-dialog[open] .course-catalog-search').inputValue(),
    'SS-02-01',
    'Native Back retains the catalog search, even if BFCache restores the actual prior overview',
  );
  await page.screenshot({ path: path.join(output, `${run}-native-back-catalog.png`) });
  Object.assign(report, { nativeBack: { ordinary, catalog }, status: 'passed' });
  assert.equal(preview.requests.length, 0);
  assert.equal(preview.assessmentStore.rows.length, 0);
  assert.equal(preview.starsStore.rows.length, 0);
  assert.deepEqual(report.blockedRequests, []);
  assert.deepEqual(report.pageErrors, []);
}
async function independentIdleProbe(page, preview, base) {
  await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading&as=student`, {
    waitUntil: 'domcontentloaded',
  });
  await ready(page);
  await page.bringToFront();
  await click(page, '[data-knowledge-tool="continue"]');
  assert.equal(await page.locator('#learning-plan-pause').getAttribute('aria-pressed'), 'false');
  await click(page, '[data-knowledge-tool="content"]');
  await scrollReading(page, 80);
  // A heartbeat can legitimately report the last clipped, pre-cutoff seconds
  // at the next 20 s boundary. Drain that tail before measuring a zero window.
  const warmup = await observe(page, preview, 'unpaused-reading-idle-and-heartbeat-tail-drain', 90);
  assert.ok(warmup.activeSecondsAdded > 0, 'The unpaused, initially active control really records');
  const idle = await observe(page, preview, 'unpaused-reading-independent-idle-cutoff', 45);
  assert.equal(idle.activeSecondsAdded, 0);
  for (const phase of [warmup, idle])
    for (const observation of phase.observations) {
      assert.equal(observation.browser.visible, 'visible');
      assert.equal(observation.browser.focused, true);
      assert.equal(observation.browser.tool, 'content');
      assert.notEqual(observation.browser.planPaused, 'true');
    }
  await scrollReading(page, 80);
  const resumed = await observe(page, preview, 'unpaused-reading-input-after-independent-idle', 25);
  assert.ok(resumed.activeSecondsAdded > 0);
  // Capture time is not activity time: the first heartbeat after resuming must
  // not retroactively classify the preceding idle interval as active reading.
  assert.ok(
    resumed.activeSecondsAdded <= Math.ceil(resumed.elapsedMilliseconds / 1000) + 1,
    'Resuming after idle must not count more active seconds than actual elapsed time',
  );
  assert.deepEqual(report.blockedRequests, []);
  assert.deepEqual(report.pageErrors, []);
  Object.assign(report, {
    status: 'passed',
    idleBoundaryIsolated: true,
    simulatedMaxRequests: preview.requests.length,
    assessmentRows: preview.assessmentStore.rows.length,
    starRows: preview.starsStore.rows.length,
  });
}
async function main() {
  const preview = createLearningPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  Object.assign(report, { base });
  const { browser, context, child } = await nativeBrowser().catch(async (error) => {
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections();
    });
    throw error;
  });
  await context.addInitScript(() => localStorage.setItem('free_bbs_theme_mode', 'dark'));
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.blockedRequests.push({
      origin: url.origin,
      path: url.pathname,
      method: request.method(),
    });
    return route.abort('blockedbyclient');
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  try {
    if (args.get('--probe') === 'history') {
      await historyProbe(page, preview, base);
      return;
    }
    if (args.get('--probe') === 'idle') {
      await independentIdleProbe(page, preview, base);
      return;
    }
    await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading&as=student`, {
      waitUntil: 'domcontentloaded',
    });
    await ready(page);
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus());
    await click(page, '.learning-start-adjust');
    await page
      .locator('.learning-start-dialog[open] [data-learning-start-choice="level"]')
      .selectOption('familiar');
    await page
      .locator('.learning-start-dialog[open] [data-learning-start-choice="goal"]')
      .selectOption('practice');
    await click(page, '.learning-start-dialog[open] .learning-start-apply');
    await click(page, '[data-knowledge-tag="important"]');
    await click(page, '[data-knowledge-tool="content"]');
    await scrollReading(page, 160);
    await observe(page, preview, 'reading-active-first-heartbeat', 24);
    await scrollReading(page, 100);
    const active = await observe(page, preview, 'reading-active-second-heartbeat', 24);
    assert.ok(
      active.activeSecondsAdded > 0,
      'Visible and focused real reading with interaction records a bounded time estimate',
    );
    const beforeBackground = await ownedState(page);
    const directory = await context.newPage();
    await directory.goto(`${base}/course?course=signals&as=student`, {
      waitUntil: 'domcontentloaded',
    });
    await directory.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'hidden' || !document.hasFocus());
    const background = await observe(page, preview, 'other-tab-course-directory', 45);
    assert.equal(
      background.activeSecondsAdded,
      0,
      'A background/unfocused reading tab cannot keep accumulating active time',
    );
    await directory.close();
    await page.bringToFront();
    await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus());
    assert.equal((await ownedState(page)).uid, beforeBackground.uid);
    assert.deepEqual((await ownedState(page)).preference, beforeBackground.preference);
    await scrollReading(page, 80);
    const back = await observe(page, preview, 'return-and-continue-reading', 25);
    assert.ok(back.activeSecondsAdded > 0);
    await click(page, '[data-knowledge-tool="continue"]');
    await page.locator('#learning-plan-pause').waitFor();
    await click(page, '#learning-plan-pause');
    assert.equal(await page.locator('#learning-plan-pause').getAttribute('aria-pressed'), 'true');
    const pause = await observe(page, preview, 'explicit-plan-pause-visible', 30);
    assert.equal(
      pause.activeSecondsAdded,
      0,
      'The paused Continue path cannot add an active-time estimate',
    );
    Object.assign(report, {
      pauseObservation: {
        activeSecondsAdded: pause.activeSecondsAdded,
        meaning:
          'The existing button pauses the proposed path. This observation tests whether it also pauses time estimation; no assumption equates time with mastery.',
      },
    });
    await click(page, '[data-knowledge-tool="content"]');
    await scrollReading(page, 60);
    const otherActivity = await observe(
      page,
      preview,
      'read-other-content-while-path-remains-paused',
      25,
    );
    assert.ok(
      otherActivity.activeSecondsAdded > 0,
      'Pausing a proposed path does not turn off recording of other real reading activity',
    );
    await click(page, '[data-knowledge-tool="continue"]');
    assert.equal(await page.locator('#learning-plan-pause').getAttribute('aria-pressed'), 'true');
    await click(page, '#learning-plan-pause');
    assert.equal(await page.locator('#learning-plan-pause').getAttribute('aria-pressed'), 'false');
    await click(page, '[data-knowledge-tool="content"]');
    await scrollReading(page, 80);
    await observe(page, preview, 'no-input-idle-and-heartbeat-tail-drain', 90);
    const idle = await observe(page, preview, 'idle-after-cutoff', 45);
    assert.equal(
      idle.activeSecondsAdded,
      0,
      'No new active-time estimate after the actual 60-second idle window',
    );
    await scrollReading(page, 80);
    const resumed = await observe(page, preview, 'resume-after-idle-by-real-input', 25);
    assert.ok(resumed.activeSecondsAdded > 0);
    assert.ok(
      resumed.activeSecondsAdded <= Math.ceil(resumed.elapsedMilliseconds / 1000) + 1,
      'A real input after idle cannot turn preceding idle time into active reading',
    );
    const beforeExit = await ownedState(page);
    await click(page, '#knowledge-course-link');
    await page.waitForFunction(
      () =>
        document.getElementById('course-map-canvas')?.courseStructureController?.getState()
          ?.focusedNodeId === 'SS-02-01',
    );
    const exit = await observe(page, preview, 'course-directory-same-tab-no-reading', 25);
    assert.equal(
      exit.activeSecondsAdded,
      0,
      'Leaving reading for the course directory stops the old page heartbeat',
    );
    await click(page, '.course-structure-resume-actions a');
    await ready(page);
    const afterReturn = await ownedState(page);
    assert.equal(afterReturn.uid, beforeExit.uid);
    assert.deepEqual(afterReturn.preference, beforeExit.preference);
    assert.deepEqual(afterReturn.tags, beforeExit.tags);
    const markKey = '["signals","SS-02-01"]';
    assert.equal(
      afterReturn.bookmark[markKey]?.fingerprint,
      beforeExit.bookmark[markKey]?.fingerprint,
      'Returning restores the same actual source block, not a fabricated completion marker',
    );
    await scrollReading(page, 40);
    const reentered = await observe(page, preview, 'same-point-resume-heartbeat', 25);
    assert.ok(reentered.activeSecondsAdded > 0);
    const beforeGuide = await ownedState(page);
    await click(page, '#learning-guide-open');
    await page.keyboard.press('Escape');
    await click(page, '#learning-guide-open');
    for (let index = 0; index < 4; index += 1)
      await click(page, '.learning-guide-dialog[open] footer button:last-child');
    await click(page, '.learning-guide-dialog[open] > .learning-primary');
    await page.locator('#knowledge-chat-input').waitFor({ state: 'visible' });
    await observe(page, preview, 'guide-replay-and-max-open-no-question', 25);
    assert.equal(preview.requests.length, 0);
    assert.deepEqual((await ownedState(page)).preference, beforeGuide.preference);
    assert.deepEqual((await ownedState(page)).tags, beforeGuide.tags);
    assert.equal(preview.assessmentStore.rows.length, 0);
    assert.equal(preview.starsStore.rows.length, 0);
    await page.screenshot({ path: path.join(output, `${run}-guide-and-state.png`) });
    const oldUserBoundary = preview.analyticsStore.rows.length;
    const other = await context.newPage();
    await other.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading&as=other`, {
      waitUntil: 'domcontentloaded',
    });
    await ready(other);
    await page.bringToFront();
    // A stale tab must not keep recording as its previous owner even when the
    // learner returns to that tab and really interacts after account switching.
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 80);
    const identity = await observe(
      page,
      preview,
      'other-synthetic-account-no-old-owner-heartbeat',
      35,
    );
    assert.equal(
      events(preview, oldUserBoundary).filter(
        (row) => row.userId === 1 && row.type === 'engagement',
      ).length,
      0,
    );
    assert.equal((await ownedState(other)).uid, 'u_learning02');
    assert.equal(
      (await ownedState(other)).preference,
      null,
      'One account cannot inherit the other account learning preference',
    );
    assert.deepEqual(
      (await ownedState(other)).tags,
      {},
      'Private local markers remain user-scoped',
    );
    Object.assign(report, {
      identityBoundary: {
        oldOwnerActiveSeconds: identity.events
          .filter((row) => row.userId === 1)
          .reduce((total, row) => total + row.seconds, 0),
        newOwnerUid: 'u_learning02',
      },
    });
    assert.deepEqual(report.blockedRequests, []);
    assert.deepEqual(report.pageErrors, []);
    Object.assign(report, {
      status: 'passed',
      simulatedMaxRequests: preview.requests.length,
      assessmentRows: preview.assessmentStore.rows.length,
      starRows: preview.starsStore.rows.length,
    });
  } catch (error) {
    report.errors.push(error.stack);
    Object.assign(report, { status: 'failed', failureUrl: page.url() });
    await page.screenshot({ path: path.join(output, `${run}-failure.png`) }).catch(() => {});
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    Object.assign(report, {
      sourceAfter: hashes(),
      finishedAt: new Date().toISOString(),
      events: events(preview),
    });
    report.sourceChangedDuringRun =
      JSON.stringify(report.sourceBefore) !== JSON.stringify(report.sourceAfter);
    if (report.sourceChangedDuringRun) process.exitCode = 1;
    save();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    child.kill();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections();
    });
    console.log(`Report: ${reportPath}`);
  }
}
main().catch((error) => {
  report.errors.push(error.stack);
  save();
  console.error(error.stack);
  process.exitCode = 1;
});
