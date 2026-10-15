// Current source + isolated published-edge fixtures; no personal browser profile or external service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLearningPreview } = require('./preview-learning-workspace');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');
const { createCourseRelationsMap } = require('./fixtures/course-relations-map');

async function pointerClick(page, selector) {
  await page.$eval(selector, (item) =>
    item.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.waitForFunction(
    (value) => {
      const item = document.querySelector(value);
      const rect = item?.getBoundingClientRect();
      if (!rect || item.disabled) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === item || item.contains(hit);
    },
    {},
    selector,
  );
  await page.click(selector);
}

async function verifyPagination(browser, count, portSelections) {
  const fixture = createCourseRelationsMap({ pointsPerChapter: Math.ceil(count / 2) });
  let retained = 0;
  fixture.nodes = fixture.nodes.filter((node) => {
    if (node.id.endsWith('-00')) return true;
    retained += 1;
    return retained <= count;
  });
  for (const node of fixture.nodes) {
    if (!node.id.endsWith('-00')) node.title = `分页夹具 ${node.id}`;
  }
  const preview = createLearningPreview({ mapNodes: fixture.nodes, mapEdges: [] });
  try {
    portSelections[`pagination-${count}`] = await listenAllowedLoopback(preview.server);
  } catch (error) {
    if (error.portSelection) portSelections[`pagination-${count}`] = error.portSelection;
    throw error;
  }
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  let page;
  try {
    page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
        return request.continue();
      return request.respond({ status: 403, body: 'External services disabled' });
    });
    await page.goto(`${base}/course?course=signals&as=student`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.course-structure-chapters');
    await pointerClick(page, '[data-course-chapter-id="SS-01"]');
    await page.type('.course-structure-picker-search', '分页夹具');
    const priorPicker = await page.evaluate(() =>
      document.getElementById('course-map-canvas').courseStructureController.getPickerState(),
    );
    await page.type('.course-structure-toolbar input[type="search"]', '分页夹具');
    const seen = [];
    const pages = Math.ceil(count / 40);
    for (let index = 0; index < pages; index += 1) {
      const ids = await page.$$eval('.course-structure-search-results > button', (items) =>
        items.map((item) => item.textContent.split(' · ')[0]),
      );
      assert.equal(ids.length, Math.min(40, count - index * 40));
      seen.push(...ids);
      assert.equal(
        await page.$eval('.course-structure-search-summary', (item) => item.textContent),
        `共 ${count} 个结果 · 显示 ${index * 40 + 1}–${Math.min(count, (index + 1) * 40)}`,
      );
      assert.match(
        await page.$eval('.course-structure-search-paging', (item) => item.textContent),
        new RegExp(`${index + 1} / ${pages}`),
      );
      if (index < pages - 1) await pointerClick(page, '.course-structure-search-next');
    }
    assert.equal(new Set(seen).size, count, 'Every actual match is reachable once');
    const finalId = seen[seen.length - 1];
    await pointerClick(page, '.course-structure-search-results > button:last-child');
    const owner = finalId.split('-').slice(0, 2).join('-');
    const ownerPage = Math.floor((Number(finalId.split('-').pop()) - 1) / 40);
    assert.deepEqual(
      await page.evaluate(() =>
        document.getElementById('course-map-canvas').courseStructureController.getPickerState(),
      ),
      { chapterId: owner, query: '分页夹具', page: ownerPage },
    );
    assert.equal(await page.$eval('.course-structure-graph-area', (item) => item.open), false);
    await pointerClick(page, '.course-structure-back');
    assert.deepEqual(
      await page.evaluate(() =>
        document.getElementById('course-map-canvas').courseStructureController.getPickerState(),
      ),
      priorPicker,
    );
    assert.match(
      await page.$eval('.course-structure-search-paging', (item) => item.textContent),
      new RegExp(`${pages} / ${pages}`),
    );
    assert.equal(await page.$eval('.course-structure-search-panel', (item) => item.hidden), false);
    assert.deepEqual(errors, []);
    return {
      count,
      pages,
      finalId,
      ownerPage,
      historyRestored: true,
      graphStayedCollapsed: true,
      portSelection: portSelections[`pagination-${count}`],
    };
  } finally {
    try {
      await page?.close();
    } finally {
      preview.server.closeAllConnections();
      await new Promise((resolve) => {
        preview.server.close(resolve);
      });
    }
  }
}

async function main() {
  const fixture = createCourseRelationsMap({ pointsPerChapter: 45 });
  fixture.edges = [
    { source: 'SS-01-00', target: 'SS-02-00', type: 'ordered' },
    { source: 'SS-01-02', target: 'SS-01-01', type: 'ordered' },
    { source: 'SS-01-01', target: 'SS-01-03', type: 'ordered' },
    { source: 'SS-02-01', target: 'SS-01-01', type: 'related', note: '本地夹具：跨章补充联系。' },
    { source: 'SS-02-01', target: 'SS-02-02', type: 'ordered' },
  ];
  const preview = createLearningPreview({ mapNodes: fixture.nodes, mapEdges: fixture.edges });
  let base = '';
  const output =
    process.env.COURSE_STRUCTURE_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-readable-structure-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    status: 'running',
    notice: 'Isolated local fixtures, not formal course materials or live AI.',
    scenes: [],
    pagination: [],
    portSelections: {},
    pageErrors: [],
  };
  let browser;
  try {
    report.portSelections.main = await listenAllowedLoopback(preview.server);
    base = `http://127.0.0.1:${preview.server.address().port}`;
    report.base = base;
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH }
        : {}),
    });
    for (const width of [1440, 390, 320]) {
      for (const typeScale of ['standard', 'comfortable', 'large']) {
        const page = await browser.newPage();
        page.setDefaultTimeout(15000);
        await page.setViewport({ width, height: width < 600 ? 844 : 1000 });
        page.on('pageerror', (error) => report.pageErrors.push(error.message));
        await page.evaluateOnNewDocument(() =>
          document.addEventListener('DOMContentLoaded', () =>
            document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important'),
          ),
        );
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = new URL(request.url());
          if (['data:', 'blob:'].includes(url.protocol) || url.origin === base)
            return request.continue();
          return request.respond({ status: 403, body: 'External services disabled' });
        });
        try {
          await page.goto(`${base}/course?course=signals&as=student`, {
            waitUntil: 'domcontentloaded',
          });
          await page.waitForSelector('.course-structure-chapters');
          await page.evaluate(
            (scale) =>
              window.freeBbsTypography.applyPreferences({
                fontPreset: 'transistor-lab',
                typeScale: scale,
              }),
            typeScale,
          );
          assert.equal(
            await page.$eval('.course-structure-graph-area', (item) => item.open),
            false,
          );
          assert.match(
            await page.$eval('.course-structure-chapters', (item) => item.textContent),
            /本地演示板块一包含 45 个知识点/,
          );
          await pointerClick(page, '[data-course-chapter-id="SS-01"]');
          assert.equal(
            await page.$$eval('.course-structure-node.is-knowledge', (items) => items.length),
            0,
          );
          await page.focus('[data-course-point-id="SS-01-01"]');
          await page.keyboard.press('Enter');
          await page.waitForFunction(
            () =>
              document.getElementById('course-map-canvas').courseStructureController.getState()
                .focusedNodeId === 'SS-01-01',
          );
          const groups = await page.$$eval('[data-relation-group]', (items) =>
            items.map((item) => [
              item.dataset.relationGroup,
              [...item.querySelectorAll('[data-course-related-id]')].map(
                (entry) => entry.dataset.courseRelatedId,
              ),
            ]),
          );
          assert.deepEqual(groups, [
            ['incoming', ['SS-01-02']],
            ['outgoing', ['SS-01-03']],
            ['related', ['SS-02-01']],
          ]);
          assert.match(
            await page.$eval('.course-structure-details', (item) => item.textContent),
            /所属章节：本地演示板块一/,
          );
          assert.match(
            await page.$eval('[data-relation-group="related"]', (item) => item.textContent),
            /所属章节：本地演示板块二/,
          );
          const textSize = await page.$eval('.course-structure-relations button', (item) =>
            parseFloat(getComputedStyle(item).fontSize),
          );
          assert.ok(textSize >= 16);
          assert.equal(
            await page.$eval('.course-structure-information', (item) => item.open),
            false,
          );
          await page.$eval('.course-structure-current', (item) =>
            item.scrollIntoView({ block: 'start', behavior: 'instant' }),
          );
          await page.screenshot({
            path: path.join(output, `text-${width}-${typeScale}.png`),
            fullPage: false,
          });
          await page.focus('.course-structure-graph-area > summary');
          await page.keyboard.press('Enter');
          await page.waitForFunction(
            () => document.querySelector('.course-structure-graph-area').open,
          );
          const graphMetric = await page.$eval(
            '.course-structure-node.is-selected .course-structure-node-title',
            (item) => {
              const matrix = item.getScreenCTM();
              return {
                declared: parseFloat(getComputedStyle(item).fontSize),
                scale: Math.hypot(matrix.a, matrix.b),
              };
            },
          );
          assert.ok(graphMetric.declared * graphMetric.scale >= 16);
          assert.equal(await page.$$eval('.course-structure-region', (items) => items.length), 0);
          assert.equal(
            await page.$$eval('.course-structure-link text', (items) => items.length),
            0,
            'Labels stay outside nodes, not hidden behind them',
          );
          const transform = await page.$eval('.course-structure-viewer svg > g', (item) =>
            item.getAttribute('transform'),
          );
          await page.focus('.course-structure-picker-search');
          await page.keyboard.press('ArrowDown');
          assert.equal(
            await page.$eval('.course-structure-viewer svg > g', (item) =>
              item.getAttribute('transform'),
            ),
            transform,
          );
          await page.$eval('.course-structure-graph-area', (item) =>
            item.scrollIntoView({ block: 'start', behavior: 'instant' }),
          );
          await page.screenshot({
            path: path.join(output, `graph-${width}-${typeScale}.png`),
            fullPage: false,
          });
          await page.focus('.course-structure-graph-area > summary');
          await page.keyboard.press('Enter');
          await page.type('.course-structure-toolbar input[type="search"]', 'SS-02-01');
          await pointerClick(page, '.course-structure-search-results > button');
          await page.waitForFunction(
            () =>
              document.getElementById('course-map-canvas').courseStructureController.getState()
                .focusedNodeId === 'SS-02-01',
          );
          assert.equal(
            await page.$eval('.course-structure-graph-area', (item) => item.open),
            false,
          );
          await pointerClick(page, '.course-structure-back');
          assert.equal(
            await page.evaluate(
              () =>
                document.getElementById('course-map-canvas').courseStructureController.getState()
                  .focusedNodeId,
            ),
            'SS-01-01',
          );
          await page.$eval('.course-structure-toolbar input', (item) => {
            item.value = 'SS-01-45';
            item.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await pointerClick(page, '.course-structure-search-results > button');
          assert.match(
            await page.$eval('.course-structure-relations', (item) => item.textContent),
            /尚未发布直接关系/,
          );
          assert.equal(
            await page.$$eval('.course-structure-node.is-knowledge', (items) => items.length),
            1,
          );
          await pointerClick(page, '.course-structure-primary');
          await page.waitForFunction(() =>
            document
              .querySelector('#course-knowledge-overview .knowledge-overview-identity h2')
              ?.textContent.includes('SS-01-45'),
          );
          await pointerClick(page, '#course-knowledge-overview button[aria-label="关闭学习概览"]');
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          );
          report.scenes.push({
            width,
            typeScale,
            textSize,
            graphMetric,
            keyboardUsable: true,
            emptyRelationshipHonest: true,
            historyWorksCollapsed: true,
            overviewOpens: true,
          });
        } finally {
          await page.close();
        }
      }
    }
    for (const count of [55, 1000])
      report.pagination.push(await verifyPagination(browser, count, report.portSelections));
    assert.deepEqual(report.pageErrors, []);
    report.status = 'passed';
    console.log(
      JSON.stringify({
        status: report.status,
        scenes: report.scenes.length,
        pagination: report.pagination,
        portSelections: report.portSelections,
        output,
      }),
    );
  } catch (error) {
    if (error.portSelection && !report.portSelections.main)
      report.portSelections.main = error.portSelection;
    report.status = 'failed';
    report.failure = { message: error.message, portSelection: error.portSelection || null };
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'structure-report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    preview.server.closeAllConnections();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
