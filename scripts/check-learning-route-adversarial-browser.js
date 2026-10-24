// Independent adversarial user flows. One local memory service and one serial Chrome.
/* global studyWorlds */
/* The per-scene `result` parameter is the owned mutable QA report, not application input. */
/* eslint no-param-reassign: ["warn", {"props": true, "ignorePropertyModificationsFor": ["result"]}] */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createLearningPreview, createLearningFixture } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const argumentsMap = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  argumentsMap.set(process.argv[index], process.argv[index + 1]);
const puppeteerPath = argumentsMap.get('--puppeteer') || process.env.PUPPETEER_CORE_MODULE;
if (!puppeteerPath) throw new Error('Supply an explicit --puppeteer module path');
// Explicit module supplied by the local QA operator, not by page content.
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(puppeteerPath);
const output = path.resolve(
  argumentsMap.get('--output') || path.join(__dirname, '../output/learning-adversarial'),
);
fs.mkdirSync(output, { recursive: true });
const files = [
  'public/course-map.js',
  'public/course-structure.js',
  'public/course-learning-route.js',
  'public/course-catalog.js',
  'public/course-navigation.js',
  'public/knowledge.js',
  'public/knowledge-overview.js',
  'public/learning-guide.js',
  'public/world.js',
  'public/world.html',
  'public/world-course-directory.css',
];
const repo = path.resolve(__dirname, '..');
const hashes = () =>
  Object.fromEntries(
    files.map((file) => [
      file,
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(repo, file)))
        .digest('hex'),
    ]),
  );
const fixture = createLearningFixture();
const snapshot = argumentsMap.get('--snapshot');
let sourceBoundary = 'authoring demo';
if (snapshot) {
  const map = JSON.parse(fs.readFileSync(path.join(snapshot, 'signals/map-response.json'), 'utf8'));
  fixture.nodes = map.nodes.map((item) => {
    const detail = JSON.parse(
      fs.readFileSync(
        path.join(snapshot, 'signals/nodes', item.id, 'public-response.json'),
        'utf8',
      ),
    );
    return { ...item, ...detail.node, markdown: detail.node.sections?.knowledgeMarkdown || '' };
  });
  fixture.edges = map.edges;
  fixture.contextRows = fixture.nodes.map((item) => ({
    slug: 'signals',
    course_id: 1,
    course_name: '信号与系统',
    node_id: item.id,
    title: item.title,
    basic_info_markdown: item.sections?.basicInfoMarkdown || '',
    applications_markdown: item.sections?.applicationsMarkdown || '',
    knowledge_markdown: item.sections?.knowledgeMarkdown || '',
    document_markdown: item.sections?.knowledgeMarkdown || '',
    is_active: 1,
  }));
  sourceBoundary = 'captured public signals snapshot, no production connection';
}
const complete = argumentsMap.get('--complete') === 'true';
const chosenCases = argumentsMap.get('--only') || '';
if (complete && snapshot)
  throw new Error(
    'Choose captured --snapshot or --complete true, never mix the fixture identities',
  );
if (
  !snapshot &&
  (!complete || !chosenCases || !chosenCases.split(',').every((part) => part.startsWith('world-')))
)
  throw new Error(
    'Supply --snapshot for captured-course flows, or --complete true --only world-... for world navigation',
  );
const preview = complete
  ? require('./preview-learning-complete').createCompleteLearningPreview()
  : createLearningPreview({
      mapNodes: fixture.nodes,
      mapEdges: fixture.edges,
      contextRows: fixture.contextRows,
    });

if (complete)
  sourceBoundary =
    'complete local demo with current real world orbit and static three-course catalogue';
const report = {
  boundary: `${
    sourceBoundary
  }; actual current scripts, isolated local memory and synthetic identity only. No production or real AI requests.`,
  startedAt: new Date().toISOString(),
  cases: [],
};
let browser;
let previewOrigin;
async function waitReady(page) {
  await page.waitForFunction(() =>
    Boolean(
      document.getElementById('course-map-canvas')?.courseStructureController?.getRouteState(),
    ),
  );
  await page.evaluate(() => document.fonts.ready);
}
async function fill(page, selector, value) {
  await page.locator(selector).fill(value);
}
async function openOverview(page, selector) {
  await page.locator(selector).click();
  await page.waitForFunction(() => document.getElementById('course-knowledge-overview')?.open);
}
async function studyReturn(page) {
  await page.locator('.knowledge-overview-study').click();
  await page.waitForFunction(
    () => document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
  );
  const href = await page.$eval('#knowledge-course-link', (e) => e.getAttribute('href'));
  await page.locator('#knowledge-course-link').click();
  await waitReady(page);
  return href;
}
async function execute(key, width, callback, blocked = '') {
  const only = argumentsMap.get('--only');
  if (only && !only.split(',').some((part) => key.includes(part))) return;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height: width === 390 ? 760 : 900 });
  page.setDefaultTimeout(10000);
  const result = {
    key,
    sourceBefore: hashes(),
    pageErrors: [],
    requests: [],
    writes: [],
    externalBlocked: [],
  };
  report.cases.push(result);
  page.on('pageerror', (e) => result.pageErrors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== previewOrigin && !['data:', 'blob:'].includes(url.protocol)) {
      result.externalBlocked.push(url.origin + url.pathname);
      return request.respond({ status: 403, body: 'External services disabled' });
    }
    result.requests.push(url.pathname);
    if (!['GET', 'HEAD'].includes(request.method()))
      result.writes.push(`${request.method()} ${url.pathname}`);
    if (blocked && url.pathname === blocked)
      return request.respond({ status: 503, body: 'Local forced asset failure' });
    return request.continue();
  });
  try {
    await callback(page, result);
    result.status = 'observed';
  } catch (error) {
    result.status = 'harness-or-flow-failure';
    result.error = error.stack;
  } finally {
    result.url = page.url();
    result.screenshot = path.join(output, `${key}.png`);
    await page.screenshot({ path: result.screenshot }).catch(() => {});
    result.sourceAfter = hashes();
    result.sourceChangedDuringRun =
      JSON.stringify(result.sourceBefore) !== JSON.stringify(result.sourceAfter);
    await context.close();
    fs.writeFileSync(path.join(output, 'adversarial-report.json'), JSON.stringify(report, null, 2));
    console.log(`${key}: ${result.status}`);
  }
}
const controllerState = (page) =>
  page.evaluate(() =>
    document.getElementById('course-map-canvas').courseStructureController.getNavigationState(),
  );
async function main() {
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  previewOrigin = base;
  report.base = base;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        argumentsMap.get('--chrome') || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    for (const width of [1440, 390]) {
      await execute(`catalog-research-return-${width}`, width, async (page, result) => {
        await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
        await waitReady(page);
        if (!(await page.$eval('.course-catalog-dialog', (element) => element.open)))
          await page.locator('.course-catalog-open').click();
        await page.waitForFunction(() => document.querySelector('.course-catalog-dialog')?.open);
        const desired =
          fixture.nodes.find((node) => node.title.includes('卷积')) || fixture.nodes.at(-1);
        await fill(page, '.course-catalog-search', desired.id);
        result.before = {
          query: await page.$eval('.course-catalog-search', (e) => e.value),
          status: await page.$eval('.course-catalog-status', (e) => e.textContent),
        };
        await openOverview(page, `[data-catalog-node-id="${desired.id}"]`);
        result.returnQuery = await page.$eval('.knowledge-overview-study', (e) =>
          new URL(e.href).searchParams.get('returnTo'),
        );
        await studyReturn(page);
        result.catalogReopened = await page.$eval(
          '.course-catalog-dialog',
          (element) => element.open,
        );
        if (!result.catalogReopened) await page.locator('.course-catalog-open').click();
        result.after = {
          query: await page.$eval('.course-catalog-search', (e) => e.value),
          status: await page.$eval('.course-catalog-status', (e) => e.textContent),
        };
        result.geometry = await page.evaluate(() =>
          [...document.querySelectorAll('.course-catalog-result')].slice(0, 8).map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              title: element.querySelector('strong')?.textContent,
              height: rect.height,
              computedHeight: style.height,
              minHeight: style.minHeight,
              maxHeight: style.maxHeight,
              overflow: style.overflow,
              grid: style.gridTemplateRows,
              childBounds: [...element.children].map((child) => ({
                tag: child.tagName,
                top: child.getBoundingClientRect().top - rect.top,
                bottom: child.getBoundingClientRect().bottom - rect.top,
                height: child.getBoundingClientRect().height,
              })),
            };
          }),
        );
        result.contextPreserved = result.before.query === result.after.query;
        assert.equal(
          result.contextPreserved,
          true,
          'Expanded catalogue query must survive a body roundtrip',
        );
      });
    }
    await execute(
      'missing-layout-helper-beginner',
      390,
      async (page, result) => {
        await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
        result.ui = await page.evaluate(() => ({
          controller: Boolean(
            document.getElementById('course-map-canvas')?.courseStructureController,
          ),
          routePoints: document.querySelectorAll('[data-course-route-node-id]').length,
          directPoints: document.querySelectorAll('[data-course-point-id]').length,
          search: document.querySelector('.course-structure-toolbar input')?.disabled,
          error: document.getElementById('course-map-status')?.textContent,
          body: document.getElementById('course-map-canvas')?.textContent.slice(0, 450),
        }));
        assert.equal(
          result.ui.controller,
          true,
          'Optional graph helper must not remove course controller',
        );
        assert.ok(
          result.ui.routePoints > 0,
          'Route remains usable when auxiliary graph cannot load',
        );
        assert.ok(
          result.ui.directPoints > 0,
          'Direct point selection remains usable when graph cannot load',
        );
        assert.ok(
          !String(result.ui.error).includes('TypeError') &&
            !String(result.ui.error).includes('undefined'),
          'No raw optional-helper exception',
        );
      },
      '/learning-graph-layout.js',
    );
    await execute('continue-reading-context-basis', 1440, async (page, result) => {
      const desired = fixture.nodes.find((n) => n.title.includes('卷积')) || fixture.nodes.at(-1);
      await page.goto(
        `${base}/knowledge?course=signals&point=${desired.id}&view=reading&as=student`,
        { waitUntil: 'networkidle0' },
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
      );
      await page.locator('#knowledge-course-link').click();
      await waitReady(page);
      const search = '.course-structure-toolbar input[type="search"]';
      await fill(page, search, `  ${desired.id}  `);
      result.before = await controllerState(page);
      const link = '.course-structure-resume a';
      result.studyHref = await page.$eval(link, (e) => e.href);
      await page.locator(link).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
      );
      await page.locator('#knowledge-course-link').click();
      await waitReady(page);
      result.after = await controllerState(page);
      result.contextPreserved = result.before.find === result.after.find;
      assert.equal(
        result.contextPreserved,
        true,
        'Recent reading link captures the current search context',
      );
    });
    await execute('keyboard-route-choice-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.focus('[data-course-route-node-id]');
      result.before = await page.evaluate(() => ({
        id: document.activeElement.dataset.courseRouteNodeId,
      }));
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.getElementById('course-knowledge-overview').open);
      result.open = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        label: document.activeElement.getAttribute('aria-label'),
      }));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('course-knowledge-overview').open);
      result.after = await page.evaluate(() => ({
        id: document.activeElement.dataset.courseRouteNodeId,
      }));
      assert.equal(
        result.before.id,
        result.after.id,
        'Closing a route overview restores the actual route entry',
      );
      assert.ok(
        !result.writes.some((request) => request.includes('/learning-')),
        'Looking at route summaries does not create learning progress',
      );
    });
    await execute('catalog-close-keyboard-position-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.locator('.course-catalog-open').click();
      await page.locator('.course-catalog-next').click();
      await page.locator('.course-catalog-next').click();
      const cards = await page.$$eval('.course-catalog-result', (elements) =>
        elements.map((element) => element.dataset.catalogNodeId),
      );
      const selected = cards.at(-2);
      const selector = `[data-catalog-node-id="${selected}"]`;
      await page.focus(selector);
      await page.$eval(selector, (element) => element.scrollIntoView({ block: 'nearest' }));
      result.before = await page.evaluate(() => ({
        id: document.activeElement.dataset.catalogNodeId,
        page: document.querySelector('.course-catalog-count')?.textContent,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
      }));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('course-knowledge-overview').open);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('course-knowledge-overview').open);
      await page.waitForFunction(
        (id) =>
          document.querySelector('.course-catalog-dialog').open &&
          document.activeElement.dataset.catalogNodeId === id,
        {},
        selected,
      );
      result.closed = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        className: document.activeElement.className,
        id: document.activeElement.dataset.catalogNodeId,
        catalogOpen: document.querySelector('.course-catalog-dialog').open,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
        nav: document
          .getElementById('course-map-canvas')
          .courseStructureController.getNavigationState(),
      }));
      result.restoredScreenshot = path.join(output, 'catalog-restored-card-390.png');
      await page.screenshot({ path: result.restoredScreenshot });
      if (!result.closed.catalogOpen) await page.locator('.course-catalog-open').click();
      result.reopened = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        className: document.activeElement.className,
        id: document.activeElement.dataset.catalogNodeId,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
        page: document.querySelector('.course-catalog-count')?.textContent,
        ids: [...document.querySelectorAll('.course-catalog-result')].map(
          (element) => element.dataset.catalogNodeId,
        ),
      }));
      result.samePage = result.reopened.ids.includes(selected);
      result.sameReadingPosition = result.reopened.scroll === result.before.scroll;
      assert.equal(
        result.sameReadingPosition,
        true,
        'The same-size catalogue returns to its exact saved reading position',
      );
      assert.equal(
        result.closed.catalogOpen,
        true,
        'Cancelling the overview returns to the parent catalogue',
      );
      assert.equal(
        result.closed.id,
        selected,
        'Cancelling restores the chosen card rather than the global search',
      );
      result.reopenedKeyboard = [];
      for (let step = 0; step < 3; step += 1) {
        await page.keyboard.press('Tab');
        result.reopenedKeyboard.push(
          await page.evaluate(() => ({
            tag: document.activeElement.tagName,
            className: document.activeElement.className,
            id: document.activeElement.dataset.catalogNodeId,
            scroll: document.querySelector('.course-catalog-results').scrollTop,
          })),
        );
      }
      assert.equal(
        result.samePage,
        true,
        'Reopening the catalogue must preserve the chosen segment',
      );
    });
    for (const large of [false, true])
      await execute(
        `catalog-responsive-dismiss-${large ? 'large' : 'normal'}`,
        1440,
        async (page, result) => {
          await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
          await waitReady(page);
          await page.locator('.course-catalog-open').click();
          const ids = await page.$$eval('.course-catalog-result', (elements) =>
            elements.map((element) => element.dataset.catalogNodeId),
          );
          const selected = ids.includes('SS-07-02') ? 'SS-07-02' : ids[35];
          const selector = `[data-catalog-node-id="${selected}"]`;
          await page.focus(selector);
          await page.$eval(selector, (element) => element.scrollIntoView({ block: 'nearest' }));
          result.before = await page.evaluate(() => ({
            id: document.activeElement.dataset.catalogNodeId,
            scroll: document.querySelector('.course-catalog-results').scrollTop,
            page: document.querySelector('.course-catalog-page-count').textContent,
          }));
          await page.keyboard.press('Enter');
          await page.waitForFunction(
            () => document.getElementById('course-knowledge-overview').open,
          );
          await page.setViewport({ width: 390, height: 760 });
          if (large)
            await page.evaluate(() =>
              document.documentElement.style.setProperty('--type-scale-rem', '200%'),
            );
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.querySelector('.course-catalog-dialog').open);
          await page.evaluate(
            () =>
              new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              }),
          );
          result.after = await page.evaluate(() => {
            const row = document.activeElement.getBoundingClientRect();
            const results = document.querySelector('.course-catalog-results');
            const region = results.getBoundingClientRect();
            const body = document.querySelector('.course-catalog-body').getBoundingClientRect();
            return {
              id: document.activeElement.dataset.catalogNodeId,
              row: { top: row.top, bottom: row.bottom, height: row.height },
              region: { top: region.top, bottom: region.bottom },
              body: { top: body.top, bottom: body.bottom },
              scroll: results.scrollTop,
              page: document.querySelector('.course-catalog-page-count').textContent,
              root: getComputedStyle(document.documentElement).fontSize,
            };
          });
          assert.equal(result.after.id, selected);
          assert.equal(result.after.page, result.before.page);
          assert.ok(
            result.after.row.bottom <=
              Math.min(result.after.region.bottom, result.after.body.bottom) + 1,
            'The returned card is not below the real scroll port after reflow',
          );
          assert.ok(
            result.after.row.top >= Math.max(result.after.region.top, result.after.body.top) - 1,
            'The returned card is not above the real scroll port after reflow',
          );
        },
      );
    await execute('catalog-relations-leave-parent-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.locator('.course-catalog-open').click();
      await fill(page, '.course-catalog-search', 'SS-04-09');
      await openOverview(page, '[data-catalog-node-id="SS-04-09"]');
      await page.locator('.knowledge-overview-drawer-footer button').click();
      await page.waitForFunction(() => !document.getElementById('course-knowledge-overview').open);
      result.closed = await page.evaluate(() => ({
        catalogOpen: document.querySelector('.course-catalog-dialog').open,
        nav: document
          .getElementById('course-map-canvas')
          .courseStructureController.getNavigationState(),
        active: document.activeElement.className,
      }));
      assert.equal(
        result.closed.catalogOpen,
        false,
        'Choosing relationships leaves both drawers closed',
      );
      assert.equal(result.closed.nav.focus, 'SS-04-09');
      await page.locator('.course-catalog-open').click();
      assert.equal(
        await page.$eval('.course-catalog-search', (element) => element.value),
        'SS-04-09',
      );
    });
    await execute('catalog-body-return-position-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.locator('.course-catalog-open').click();
      await page.locator('.course-catalog-next').click();
      await page.locator('.course-catalog-next').click();
      const selected = await page.$$eval(
        '.course-catalog-result',
        (elements) => elements.at(-2).dataset.catalogNodeId,
      );
      await page.focus(`[data-catalog-node-id="${selected}"]`);
      await page.$eval(`[data-catalog-node-id="${selected}"]`, (element) =>
        element.scrollIntoView({ block: 'nearest' }),
      );
      result.before = await page.evaluate(() => ({
        id: document.activeElement.dataset.catalogNodeId,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
        page: document.querySelector('.course-catalog-page-count').textContent,
      }));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('course-knowledge-overview').open);
      await studyReturn(page);
      result.returned = await page.evaluate(() => ({
        id: document.activeElement.dataset.catalogNodeId,
        className: document.activeElement.className,
        catalogOpen: document.querySelector('.course-catalog-dialog').open,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
        page: document.querySelector('.course-catalog-page-count').textContent,
      }));
      await page.keyboard.press('Tab');
      result.nextTab = await page.evaluate(() => ({
        id: document.activeElement.dataset.catalogNodeId,
        className: document.activeElement.className,
        scroll: document.querySelector('.course-catalog-results').scrollTop,
      }));
      assert.equal(
        result.returned.id,
        result.before.id,
        'An article roundtrip locates the same catalogue card after a full reload',
      );
      assert.equal(
        result.nextTab.id,
        'SS-05-14',
        'Tab advances from the restored 39th card, not the first result',
      );
      await page.locator('.course-catalog-close').click();
      assert.equal(
        await page.evaluate(() => document.activeElement.className),
        'course-catalog-open',
        'Closing the complete directory restores its entry control',
      );
    });
    await execute('teacher-id-independent-tabs-1440', 1440, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await fill(page, '.course-structure-toolbar input[type="search"]', 'SS-04-09');
      await openOverview(page, '.course-structure-search-results button');
      const study = await page.$eval('.knowledge-overview-study', (element) => ({
        href: element.href,
        tag: element.tagName,
        target: element.target,
      }));
      const popup = await page.browserContext().newPage();
      await popup.setRequestInterception(true);
      popup.on('request', (request) => {
        const url = new URL(request.url());
        if (!['GET', 'HEAD'].includes(request.method()))
          result.writes.push(`new-tab ${request.method()} ${url.pathname}`);
        if (url.origin !== base && !['data:', 'blob:'].includes(url.protocol))
          return request.respond({ status: 403, body: 'External services disabled' });
        return request.continue();
      });
      result.boundary =
        'Public-material navigation under one consistent synthetic identity, not teacher-specific authorization. The actual anchor destination is opened in a new tab after its auxiliary-click handler, with request interception installed before navigation; this is not a claim about browser OS shortcut handling.';
      await page.$eval('.knowledge-overview-study', (element) =>
        element.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 })),
      );
      await popup.goto(study.href, { waitUntil: 'networkidle0' });
      await popup.waitForFunction(
        () =>
          document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
      );
      result.study = study;
      result.original = await page.evaluate(() => ({
        url: window.location.href,
        overviewOpen: document.getElementById('course-knowledge-overview').open,
        query: document.querySelector('.course-structure-toolbar input[type="search"]').value,
      }));
      result.newTab = {
        url: popup.url(),
        courseLink: await popup.$eval('#knowledge-course-link', (element) =>
          element.getAttribute('href'),
        ),
        title: await popup.$eval('#knowledge-title', (element) => element.textContent),
      };
      assert.equal(result.original.query, 'SS-04-09');
      assert.equal(result.original.overviewOpen, true);
      assert.equal(new URL(result.newTab.url).searchParams.get('point'), 'SS-04-09');
      await popup.close();
      await page.bringToFront();
      await page.keyboard.press('Escape');
      await fill(page, '.course-structure-toolbar input[type="search"]', 'SS-02-11');
      assert.ok(
        (
          await page.$$eval('.course-structure-search-results button', (elements) =>
            elements.map((element) => element.textContent),
          )
        ).some((text) => text.includes('SS-02-11')),
      );
    });
    await execute('phone-route-scroll-chaining-390', 390, async (page, result) => {
      await page.setViewport({ width: 390, height: 760, isMobile: true, hasTouch: true });
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.locator('.course-learning-entry-links button:nth-child(1)').click();
      const metrics = () =>
        page.evaluate(() => {
          const element = document.querySelector('.course-route-viewport');
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            outer: window.scrollY,
            inner: element.scrollTop,
            innerRange: element.scrollHeight - element.clientHeight,
            height: element.clientHeight,
            top: box.top,
            bottom: box.bottom,
            overscroll: style.overscrollBehaviorY,
            overflow: style.overflowY,
            directTop: document.querySelector('.course-direct-find').getBoundingClientRect().top,
          };
        });
      result.before = await metrics();
      const x = 195;
      const y = Math.max(140, Math.min(result.before.top + 190, 590));
      await page.mouse.move(x, y);
      await page.mouse.wheel({ deltaY: 3000 });
      await new Promise((resolve) => {
        setTimeout(resolve, 350);
      });
      result.atEnd = await metrics();
      await page.mouse.wheel({ deltaY: 600 });
      await new Promise((resolve) => {
        setTimeout(resolve, 350);
      });
      result.afterExtraWheel = await metrics();
      assert.ok(
        result.before.innerRange <= 1,
        'The phone route is in normal page flow, not a nested scroll port',
      );
      assert.ok(
        result.afterExtraWheel.outer > result.before.outer,
        'Wheel gestures can continue down the page past the route',
      );
      await page.locator('.course-learning-entry-links button:nth-child(1)').click();
      result.touchStart = await metrics();
      result.touchTarget = await page.evaluate(
        (coordinates) => {
          let element = document.elementFromPoint(coordinates.x, coordinates.y);
          const chain = [];
          while (element) {
            const style = getComputedStyle(element);
            chain.push({
              tag: element.tagName,
              className: element.className,
              touchAction: style.touchAction,
              overflow: style.overflowY,
            });
            element = element.parentElement;
          }
          return chain;
        },
        { x, y },
      );
      result.touchSteps = [];
      for (let step = 0; step < 8; step += 1) {
        const finger = await page.touchscreen.touchStart(x, y);
        for (let move = 1; move <= 12; move += 1) {
          await finger.move(x, y - move * 25);
          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });
        }
        await finger.end();
        await new Promise((resolve) => {
          setTimeout(resolve, 150);
        });
        result.touchSteps.push(await metrics());
        if (result.touchSteps.at(-1).directTop < 620) break;
      }
      result.afterEmulatedTouch = await metrics();
      assert.ok(
        result.afterEmulatedTouch.outer > result.touchStart.outer,
        'Emulated touch advances the external page, not only an inner route',
      );
      assert.ok(
        result.afterEmulatedTouch.directTop < 620,
        'Normal scrolling can reach the direct-finding area',
      );
      result.boundary =
        'Actual Chromium wheel plus Puppeteer touchscreen touchStart/move/end (trusted CDP touch-event emulation) at a mobile viewport; not a physical touchscreen test. No scrollTop values were set by this scene.';
    });
    for (const width of [390, 320])
      await execute(`phone-route-paging-large-${width}`, width, async (page, result) => {
        await page.setViewport({ width, height: 760, isMobile: true, hasTouch: true });
        await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
        await waitReady(page);
        await page.evaluate(() =>
          document.documentElement.style.setProperty('--type-scale-rem', '200%'),
        );
        await page.locator('.course-route-next').click();
        const paint = () =>
          page.evaluate(
            () =>
              new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              }),
          );
        const inspect = () =>
          page.evaluate(() => {
            const active = document.activeElement;
            const box = active.getBoundingClientRect();
            const text = active.querySelector('.course-route-node-copy')?.getBoundingClientRect();
            const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
            return {
              id: active.dataset.courseRouteNodeId,
              firstId: document
                .getElementById('course-map-canvas')
                .courseStructureController.getRouteState().steps[0].id,
              top: box.top,
              bottom: box.bottom,
              left: box.left,
              right: box.right,
              textTop: text?.top,
              textBottom: text?.bottom,
              copyParts: [...active.querySelectorAll('.course-route-node-copy > *')].map(
                (element) => ({
                  tag: element.tagName,
                  text: element.textContent,
                  top: element.getBoundingClientRect().top,
                  bottom: element.getBoundingClientRect().bottom,
                }),
              ),
              root: getComputedStyle(document.documentElement).fontSize,
              pageWidth: document.documentElement.scrollWidth,
              viewport: window.innerWidth,
              bottomNavTop: nav?.top,
              topBarBottom: Math.max(
                0,
                ...[...document.querySelectorAll('.topbar,.mobile-header-backdrop')].map(
                  (element) => element.getBoundingClientRect().bottom,
                ),
              ),
              focusVisible: active.matches(':focus-visible'),
              outer: window.scrollY,
            };
          });
        await paint();
        result.afterPaging = await inspect();
        assert.equal(
          result.afterPaging.id,
          result.afterPaging.firstId,
          'Phone paging places focus at the first new point',
        );
        assert.equal(result.afterPaging.pageWidth, width, 'Large text does not widen the page');
        const expected = await page.evaluate(() =>
          document
            .getElementById('course-map-canvas')
            .courseStructureController.getRouteState()
            .steps.map((step) => step.id),
        );
        const safelyVisible = (entry) => {
          assert.equal(entry.pageWidth, width);
          assert.ok(
            entry.textBottom <= entry.bottomNavTop - 6,
            `Focused ${entry.id} title clears the bottom navigation`,
          );
          assert.ok(
            entry.textTop >= entry.topBarBottom + 6,
            `Focused ${entry.id} title clears the top bar`,
          );
        };
        result.forward = [result.afterPaging];
        for (let index = 1; index < expected.length; index += 1) {
          await page.keyboard.press('Tab');
          await paint();
          const entry = await inspect();
          safelyVisible(entry);
          result.forward.push(entry);
        }
        assert.deepEqual(
          result.forward.map((entry) => entry.id),
          expected,
          'All six native Tab stops follow actual cards without clipping or skipping',
        );
        const [, second] = result.forward;
        result.afterTab = second;
        result.reverse = [];
        for (let index = expected.length - 2; index >= 0; index -= 1) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Tab');
          await page.keyboard.up('Shift');
          await paint();
          const entry = await inspect();
          safelyVisible(entry);
          assert.equal(entry.id, expected[index]);
          result.reverse.push(entry);
        }
        result.afterBackTab = result.reverse.at(-1);
        assert.equal(
          result.afterBackTab.id,
          result.afterPaging.firstId,
          'Keyboard movement can return to the new segment start',
        );
        result.beforePointer = await inspect();
        const clickBox = await page.$eval(
          `[data-course-route-node-id="${expected[1]}"]`,
          (element) => {
            const box = element.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          },
        );
        await page.mouse.move(clickBox.x, clickBox.y);
        await page.mouse.down();
        await paint();
        result.afterPointerDown = await inspect();
        assert.equal(
          result.afterPointerDown.outer,
          result.beforePointer.outer,
          'Pointer down does not move the pending click target',
        );
        assert.equal(
          result.afterPointerDown.focusVisible,
          false,
          'Pointer focus does not invoke keyboard scrolling',
        );
        await page.mouse.up();
        await page.waitForFunction(() => document.getElementById('course-knowledge-overview').open);
        assert.equal(
          await page.$eval('.knowledge-overview-study', (element) =>
            new URL(element.href).searchParams.get('point'),
          ),
          expected[1],
          'The unchanged pointer target opens the intended overview',
        );
        await page.keyboard.press('Escape');
        await paint();
      });
    await execute('phone-route-secondary-keyboard-320', 320, async (page, result) => {
      await page.setViewport({ width: 320, height: 760, isMobile: true, hasTouch: true });
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.evaluate(() =>
        document.documentElement.style.setProperty('--type-scale-rem', '200%'),
      );
      await page.locator('.course-route-next').click();
      await page.keyboard.press('Tab');
      const last = await page.evaluate(
        () =>
          document
            .getElementById('course-map-canvas')
            .courseStructureController.getRouteState()
            .steps.at(-1).id,
      );
      const paint = () =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        );
      const inspect = () =>
        page.evaluate(() => {
          const active = document.activeElement;
          const box = active.getBoundingClientRect();
          const nav = document.querySelector('.mobile-nav').getBoundingClientRect();
          return {
            tag: active.tagName,
            className: active.className,
            id: active.dataset.courseRouteNodeId,
            exit: active.dataset.courseRouteExitId,
            text: active.textContent,
            top: box.top,
            bottom: box.bottom,
            bottomNavTop: nav.top,
            outer: window.scrollY,
          };
        });
      await page.focus(`[data-course-route-node-id="${last}"]`);
      await paint();
      result.baseline = [];
      for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press('Tab');
        await paint();
        await new Promise((resolve) => {
          setTimeout(resolve, 700);
        });
        result.baseline.push(await inspect());
      }
      result.probeBoundary =
        'The following second traversal changes only the current DOM scroll-padding-bottom, never saved styles or progress.';
      await page.evaluate(() => {
        document.documentElement.style.scrollPaddingBottom = '80px';
      });
      await page.focus(`[data-course-route-node-id="${last}"]`);
      await paint();
      result.paddingProbe = [];
      for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press('Tab');
        await paint();
        await new Promise((resolve) => {
          setTimeout(resolve, 700);
        });
        result.paddingProbe.push(await inspect());
      }
      await page.evaluate(() =>
        document.documentElement.style.removeProperty('scroll-padding-bottom'),
      );
    });
    await execute('five-minute-topic-help-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await page.locator('.course-learning-entry-links button:nth-child(2)').click();
      result.directEntry = await page.evaluate(() => ({
        active: document.activeElement.getAttribute('aria-label'),
        visible:
          document.activeElement.getBoundingClientRect().top >= 0 &&
          document.activeElement.getBoundingClientRect().bottom <= window.innerHeight,
      }));
      await fill(page, '.course-structure-toolbar input[type="search"]', '卷积');
      result.choices = await page.$$eval('.course-structure-search-results button', (elements) =>
        elements.map((element) => element.textContent),
      );
      await page
        .locator('.course-structure-search-results button')
        .filter((element) => element.textContent.startsWith('SS-02-11 '))
        .click();
      await page.waitForFunction(() => document.getElementById('course-knowledge-overview').open);
      result.overview = await page.$eval(
        '.knowledge-overview-drawer-body',
        (element) => element.textContent,
      );
      await page.locator('.knowledge-overview-study').click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
      );
      result.reading = await page.evaluate(() => ({
        title: document.getElementById('knowledge-title').textContent,
        visible: Boolean(document.getElementById('knowledge-reading').getClientRects().length),
        openDialogs: [...document.querySelectorAll('dialog[open]')].map(
          (element) => element.className,
        ),
        preference: window.FreeBbsLearningStart.currentPreference(),
      }));
      const open = await page.$eval(
        '#knowledge-chat-toggle',
        (element) => element.getAttribute('aria-expanded') === 'true',
      );
      if (!open) await page.locator('#knowledge-chat-toggle').click();
      const draft = '我今天只有 5 分钟，想先理解卷积的直观含义。请先给我一个够得着的小步骤。';
      await fill(page, '#knowledge-chat-input', draft);
      await page.locator('[data-chat-prompt="用直觉解释这个知识点"]').click();
      result.help = await page.evaluate(() => ({
        draft: document.getElementById('knowledge-chat-input').value,
        status: document.getElementById('knowledge-chat-draft-status').textContent,
        context: document.getElementById('knowledge-chat-context').textContent,
      }));
      result.openHelpScreenshot = path.join(output, 'five-minute-max-draft-390.png');
      await page.screenshot({ path: result.openHelpScreenshot });
      assert.equal(
        result.help.draft,
        draft,
        'The explicit five-minute need is not overwritten by a generic quick prompt',
      );
      assert.ok(
        !result.writes.some((request) => request.includes('companion')),
        'Choosing help prepares a draft, not an automatic AI request',
      );
      await page.locator('#knowledge-chat-close').click();
      assert.equal(
        await page.$eval('#knowledge-chat-input', (element) => element.value),
        draft,
        'Pausing the help panel keeps the unsent question',
      );
    });
    for (const [key, asset] of [
      ['missing-catalog-module-390', '/course-catalog.js'],
      ['missing-route-model-390', '/learning-route.js'],
    ]) {
      await execute(
        key,
        390,
        async (page, result) => {
          await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
          await page.waitForFunction(() =>
            Boolean(document.getElementById('course-map-canvas')?.courseStructureController),
          );
          result.before = await page.evaluate(() => ({
            routeNodes: document.querySelectorAll('[data-course-route-node-id]').length,
            directNodes: document.querySelectorAll('[data-course-point-id]').length,
            routeText: document.querySelector('.course-learning-route')?.textContent,
            catalogButton: {
              hidden: document.querySelector('.course-catalog-open')?.hidden,
              disabled: document.querySelector('.course-catalog-open')?.disabled,
            },
            error: document.getElementById('course-map-status').textContent,
          }));
          await fill(page, '.course-structure-toolbar input[type="search"]', '卷积');
          result.searchResults = await page.$$eval(
            '.course-structure-search-results button',
            (elements) => elements.map((element) => element.textContent),
          );
          assert.ok(
            result.searchResults.length > 0,
            'Optional route/catalog failure must not break direct search',
          );
        },
        asset,
      );
    }
    await execute('input-width-ime-discovery-390', 390, async (page, result) => {
      await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      const selector = '.course-structure-toolbar input[type="search"]';
      const desired =
        fixture.nodes.find((node) => node.title.includes('卷积')) || fixture.nodes.at(-1);
      result.queries = [];
      for (const query of [
        desired.id,
        desired.id.replace(/[!-~]/g, (character) =>
          String.fromCharCode(character.charCodeAt(0) + 0xfee0),
        ),
        '拉氏',
      ]) {
        await fill(page, selector, query);
        result.queries.push(
          await page.evaluate(() => ({
            query: document.querySelector('.course-structure-toolbar input[type="search"]').value,
            count: document.querySelectorAll('.course-structure-search-results button').length,
            status: document.querySelector('.course-structure-search-summary')?.textContent,
          })),
        );
      }
      await page.evaluate(() => {
        const input = document.querySelector('.course-structure-toolbar input[type="search"]');
        input.focus();
        input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        input.value = '拉氏';
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, data: '氏', isComposing: true }),
        );
        input.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: '拉氏' }),
        );
      });
      result.ime = await page.evaluate(() => ({
        value: document.activeElement.value,
        active: document.activeElement.matches('.course-structure-toolbar input'),
        count: document.querySelectorAll('.course-structure-search-results button').length,
      }));
      assert.equal(result.ime.active, true, 'Updating results does not steal input-method focus');
      assert.equal(result.ime.value, '拉氏', 'Composition text is not cleared or trimmed');
      await page.locator('.course-catalog-open').click();
      await fill(page, '.course-catalog-search', result.queries[1].query);
      result.catalogFullwidth = await page.evaluate(() => ({
        count: document.querySelectorAll('.course-catalog-result').length,
        status: document.querySelector('.course-catalog-status').textContent,
      }));
    });
    for (const width of [1440, 390, 320]) {
      await execute(`font-route-catalog-${width}`, width, async (page, result) => {
        await page.goto(`${base}/course?course=signals&as=guest`, { waitUntil: 'networkidle0' });
        await waitReady(page);
        result.before = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).fontSize,
          entries: [...document.querySelectorAll('.course-route-node')].map((element) => {
            const r = element.getBoundingClientRect();
            const s = getComputedStyle(element);
            return {
              id: element.dataset.courseRouteNodeId,
              height: r.height,
              computedHeight: s.height,
              padding: s.padding,
              circleHeight: element.querySelector('.course-route-medallion').getBoundingClientRect()
                .height,
              copyBottom:
                element.querySelector('.course-route-node-copy').getBoundingClientRect().bottom -
                r.top,
              circleBottom:
                element.querySelector('.course-route-medallion').getBoundingClientRect().bottom -
                r.top,
            };
          }),
        }));
        await page.evaluate(() =>
          document.documentElement.style.setProperty('--type-scale-rem', '200%'),
        );
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        );
        result.large = await page.evaluate(() => ({
          root: getComputedStyle(document.documentElement).fontSize,
          scrollWidth: document.documentElement.scrollWidth,
          width: window.innerWidth,
          entries: [...document.querySelectorAll('.course-route-node')].map((element) => {
            const r = element.getBoundingClientRect();
            const s = getComputedStyle(element);
            return {
              id: element.dataset.courseRouteNodeId,
              height: r.height,
              computedHeight: s.height,
              left: r.left,
              right: r.right,
              circleHeight: element.querySelector('.course-route-medallion').getBoundingClientRect()
                .height,
              copyBottom:
                element.querySelector('.course-route-node-copy').getBoundingClientRect().bottom -
                r.top,
              circleBottom:
                element.querySelector('.course-route-medallion').getBoundingClientRect().bottom -
                r.top,
            };
          }),
        }));
        await page.locator('.course-catalog-open').click();
        result.catalog = await page.evaluate(() => ({
          bodyHeight: document.querySelector('.course-catalog-results').clientHeight,
          rows: [...document.querySelectorAll('.course-catalog-result')]
            .slice(0, 5)
            .map((element) => {
              const r = element.getBoundingClientRect();
              const s = getComputedStyle(element);
              return {
                height: r.height,
                computedHeight: s.height,
                padding: s.padding,
                bottom: Math.max(
                  ...[...element.children].map(
                    (child) => child.getBoundingClientRect().bottom - r.top,
                  ),
                ),
              };
            }),
        }));
        result.heightSources = await page.evaluate(() => {
          const element = document.querySelector('.course-catalog-result');
          const sources = [];
          const walk = (rules, sheet) => {
            for (const rule of rules) {
              if (
                rule.selectorText &&
                rule.style &&
                (rule.style.height || rule.style.blockSize || rule.style.maxHeight)
              ) {
                try {
                  if (element.matches(rule.selectorText))
                    sources.push({
                      sheet,
                      selector: rule.selectorText,
                      height: rule.style.height,
                      blockSize: rule.style.blockSize,
                      maxHeight: rule.style.maxHeight,
                      important: rule.style.getPropertyPriority('height'),
                    });
                } catch {
                  /* A cross-origin or unsupported selector is not relevant to this local probe. */
                }
              }
              if (rule.cssRules) walk(rule.cssRules, sheet);
            }
          };
          for (const sheet of document.styleSheets) {
            try {
              walk(sheet.cssRules, sheet.href);
            } catch {
              /* Browser-owned inaccessible sheets are not source layout rules. */
            }
          }
          return { className: element.className, style: element.getAttribute('style'), sources };
        });
        result.layoutProbes = await page.evaluate(() => {
          const results = document.querySelector('.course-catalog-results');
          const rows = [...results.querySelectorAll('.course-catalog-result')].slice(0, 5);
          const geometry = () =>
            rows.map((element) => {
              const r = element.getBoundingClientRect();
              return {
                height: r.height,
                bottom: Math.max(
                  ...[...element.children].map(
                    (child) => child.getBoundingClientRect().bottom - r.top,
                  ),
                ),
              };
            });
          const styles = {
            gridTemplateRows: getComputedStyle(results).gridTemplateRows,
            gridAutoRows: getComputedStyle(results).gridAutoRows,
            alignContent: getComputedStyle(results).alignContent,
          };
          rows.forEach((element) => {
            const probe = element;
            probe.style.height = 'auto';
          });
          const heightAuto = geometry();
          rows.forEach((element) => element.style.removeProperty('height'));
          results.style.gridAutoRows = 'max-content';
          const maxContent = geometry();
          results.style.removeProperty('grid-auto-rows');
          return {
            boundary: 'Temporary local DOM style probes only; saved stylesheet untouched.',
            styles,
            heightAuto,
            maxContent,
          };
        });
      });
    }
    await execute('native-back-preserves-return-context', 390, async (page, result) => {
      const desired = fixture.nodes.find((n) => n.title.includes('卷积')) || fixture.nodes.at(-1);
      await page.evaluateOnNewDocument(() => {
        window.qaPageShowEvents = [];
        window.addEventListener('pageshow', (event) =>
          window.qaPageShowEvents.push({ persisted: event.persisted }),
        );
      });
      await page.goto(`${base}/course?course=signals&as=student`, { waitUntil: 'networkidle0' });
      await waitReady(page);
      await fill(page, '.course-structure-toolbar input[type="search"]', `  ${desired.id}  `);
      await openOverview(page, '.course-structure-search-results button');
      result.before = await controllerState(page);
      result.sourceUrl = page.url();
      await page.locator('.knowledge-overview-study').click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-knowledge-page]')?.getAttribute('aria-busy') === 'false',
      );
      result.knowledgeUrl = page.url();
      await page.goBack({ waitUntil: 'networkidle0' });
      await waitReady(page);
      result.after = await controllerState(page);
      result.pageShow = await page.evaluate(() => ({
        events: window.qaPageShowEvents,
        navigation: performance.getEntriesByType('navigation').map((item) => item.type),
        modal: document.getElementById('course-knowledge-overview')?.open,
      }));
      result.contextPreserved = result.before.find === result.after.find;
      assert.equal(
        result.contextPreserved,
        true,
        'Native back without bfcache restores the previous query',
      );
    });
    if (complete)
      for (const width of [1440, 390, 320]) {
        await execute(`world-direct-course-${width}`, width, async (page, result) => {
          await page.goto(`${base}/world`, { waitUntil: 'networkidle0' });
          await page.waitForFunction(
            () => document.querySelectorAll('.world-course-directory-link').length === 3,
          );
          try {
            await page.waitForSelector('dialog.max-tour[open]', { visible: true, timeout: 3000 });
            await page.locator('dialog.max-tour[open] .max-tour-controls .max-tour-later').click();
            await page.waitForFunction(() => !document.querySelector('dialog.max-tour[open]'));
          } catch {
            /* No automatic introduction is active. */
          }
          result.geometry = await page.evaluate(() => ({
            viewport: window.innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            orbitOffset: document.querySelector('#world-orbit').dataset.orbitOffset,
            links: [...document.querySelectorAll('.world-course-directory-link')].map((element) => {
              const box = element.getBoundingClientRect();
              return {
                slug: element.dataset.courseSlug,
                text: element.textContent,
                href: element.getAttribute('href'),
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                height: box.height,
              };
            }),
          }));
          assert.equal(
            result.geometry.pageWidth,
            width,
            'Direct course links do not create horizontal page scrolling',
          );
          assert.equal(result.geometry.orbitOffset, '0', 'No island rotation is needed');
          assert.deepEqual(
            result.geometry.links.map((link) => link.slug),
            ['math', 'circuits', 'signals'],
          );
          assert.ok(
            result.geometry.links.every(
              (link) => link.height >= 44 && link.left >= 0 && link.right <= width,
            ),
          );
          result.directoryScreenshot = path.join(output, `world-direct-initial-${width}.png`);
          await page.screenshot({ path: result.directoryScreenshot });
          await page
            .locator('.world-course-directory-link')
            .filter((element) => element.dataset.courseSlug === 'math')
            .wait();
          await page.focus('.world-course-directory-link[data-course-slug="math"]');
          await page.keyboard.press('Tab');
          result.keyboard = await page.evaluate(() => ({
            tag: document.activeElement.tagName,
            slug: document.activeElement.dataset.courseSlug,
            href: document.activeElement.getAttribute('href'),
          }));
          assert.equal(
            result.keyboard.slug,
            'circuits',
            'Native Tab order reaches the otherwise hidden electric course',
          );
          await page.keyboard.press('Enter');
          await waitReady(page);
          assert.equal(new URL(page.url()).searchParams.get('course'), 'circuits');
          assert.ok(
            !result.writes.some((request) => request.includes('/learning-')),
            'Opening a catalogue course does not fabricate learning progress',
          );
        });
      }
    if (complete)
      await execute('world-direct-large-dark-320', 320, async (page, result) => {
        await page.goto(`${base}/world`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(
          () => document.querySelectorAll('.world-course-directory-link').length === 3,
        );
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--type-scale-rem', '200%');
          window.freeBbsTheme.applyMode('dark');
        });
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        );
        result.geometry = await page.evaluate(() => ({
          boundary:
            'Text-size preference set to 200% (32px root), not a claim of native browser zoom.',
          root: getComputedStyle(document.documentElement).fontSize,
          pageWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          theme: window.freeBbsTheme.getCurrentMode(),
          overlays: [...document.querySelectorAll('dialog[open]')].map(
            (element) => element.className,
          ),
          backgroundLayers: document.elementsFromPoint(150, 200).map((element) => ({
            tag: element.tagName,
            class: element.className,
            color: getComputedStyle(element).color,
            background: getComputedStyle(element).backgroundColor,
            image: getComputedStyle(element).backgroundImage,
            uiPage: getComputedStyle(element).getPropertyValue('--ui-page'),
          })),
          links: [...document.querySelectorAll('.world-course-directory-link')].map((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              left: box.left,
              right: box.right,
              height: box.height,
              text: element.textContent,
              color: style.color,
              background: style.backgroundColor,
            };
          }),
        }));
        assert.equal(result.geometry.pageWidth, 320);
        assert.ok(
          result.geometry.links.every(
            (link) => link.height >= 44 && link.left >= 0 && link.right <= 320,
          ),
        );
      });
    if (complete)
      for (const width of [390, 320]) {
        await execute(`world-orbit-discovery-${width}`, width, async (page, result) => {
          await page.goto(`${base}/world`, { waitUntil: 'networkidle0' });
          await page.waitForFunction(
            () => document.querySelector('#world-orbit')?.dataset.orbitOffset === '0',
          );
          try {
            await page.waitForSelector('dialog.max-tour[open]', { visible: true, timeout: 3000 });
            await page.locator('dialog.max-tour[open] .max-tour-controls .max-tour-later').click();
            await page.waitForFunction(() => !document.querySelector('dialog.max-tour[open]'));
            result.introduction =
              'Explicitly deferred via the real later control; this test checks unguided course discovery.';
          } catch {
            result.introduction = 'No active automatic introduction';
          }
          result.before = await page.evaluate(() => ({
            active: studyWorlds
              .filter((world) => world.status === 'active')
              .map((world) => ({
                id: world.id,
                courses: world.courses.map((course) => ({ slug: course.slug, name: course.name })),
              })),
            initialCourseLinks: [...document.querySelectorAll('main a[href^="/course?"]')].map(
              (element) => ({
                href: element.getAttribute('href'),
                visible: Boolean(element.getClientRects().length),
              }),
            ),
            islands: [...document.querySelectorAll('.island-orbit-item')].map((element) => {
              const box = element.getBoundingClientRect();
              return {
                name: element.getAttribute('aria-label'),
                index: element.dataset.worldIndex,
                state: element.dataset.worldState,
                hidden: element.dataset.hidden,
                tabIndex: element.tabIndex,
                inert: element.hasAttribute('inert'),
                top: box.top,
                left: box.left,
                right: box.right,
                bottom: box.bottom,
              };
            }),
            pageWidth: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
          }));
          result.firstScreenshot = path.join(output, `world-initial-${width}.png`);
          await page.screenshot({ path: result.firstScreenshot });
          await page.locator('[data-orbit-step="-1"]').click();
          await page.waitForFunction(
            () =>
              document.querySelector('.island-orbit-item[data-world-index="2"]').dataset.hidden ===
              'false',
          );
          await page.locator('.island-orbit-item[data-world-index="2"]').click();
          await page.waitForFunction(() => document.getElementById('world-modal').open);
          await page.locator('#world-enter-island').click();
          await page.waitForFunction(() => !document.getElementById('island-course-stage').hidden);
          result.courseStage = await page.evaluate(() =>
            [...document.querySelectorAll('[data-course-slug]')].map((element) => {
              const box = element.getBoundingClientRect();
              return {
                slug: element.dataset.courseSlug,
                text: element.textContent,
                href: element.getAttribute('href'),
                top: box.top,
                left: box.left,
                right: box.right,
                bottom: box.bottom,
              };
            }),
          );
        });
      }
    report.finishedAt = new Date().toISOString();
  } finally {
    if (browser) await browser.close();
    preview.server.closeAllConnections?.();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    fs.writeFileSync(path.join(output, 'adversarial-report.json'), JSON.stringify(report, null, 2));
    console.log(`Report: ${path.join(output, 'adversarial-report.json')}`);
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
