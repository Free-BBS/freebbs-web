// Real Chrome UI against an existing local preview. Counts come from the actual
// registered analytics router with synthetic memory rows, not production students.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createMemoryAnalyticsStore,
  createLearningAnalyticsRouter,
} = require('../backend/learning-analytics');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function routerFixture() {
  const common = {
    course_id: '10',
    node_id: 'SS-01-01',
    question_id: 'QA-analytics-fixture',
    document_version: 'a'.repeat(64),
    question_version: '1',
    created_at: '2026-10-10T00:00:00.000Z',
  };
  const businessAttempts = Array.from({ length: 200 }, (_, index) => ({
    ...common,
    id: String(index + 1),
    user_id: '1',
    is_official: 0,
    status: 'graded',
    verdict: 'practice_only',
  }));
  for (const [index, verdict] of ['pass', 'fail', null].entries())
    businessAttempts.push({
      ...common,
      id: String(201 + index),
      user_id: '2',
      is_official: 1,
      status: verdict ? 'graded' : 'pending_review',
      verdict,
    });
  const router = createLearningAnalyticsRouter({
    store: createMemoryAnalyticsStore({
      contexts: [{ course_id: '10', slug: 'signals', node_id: 'SS-01-01' }],
      users: [
        { id: '1', nickname: '只做练习（夹具）' },
        { id: '2', nickname: '正式自测（夹具）' },
      ],
      businessAttempts,
    }),
    requireAuth: async () => ({ id: '9' }),
    requireAdmin: async () => ({ id: '9', is_admin: true }),
  });
  let payload;
  const response = {
    set() {
      return this;
    },
    status(value) {
      assert.equal(value, 200);
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  const route = router.stack.find((item) => item.route?.path === '/admin/overview');
  await route.route.stack[0].handle({ query: { window: 'all' } }, response);
  assert.equal(payload.selftest.practiceAttempts, 200);
  assert.equal(payload.selftest.officialAttempts, 3);
  return payload;
}

function contrast(foreground, background) {
  const luminance = (value) => {
    const channels = value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
    return channels
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  const base = new URL(process.env.LEARNING_PREVIEW_URL || process.argv[2]);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  const output =
    process.env.LEARNING_QA_OUTPUT ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'learning-analytics-table-'));
  fs.mkdirSync(output, { recursive: true });
  const report = {
    boundary:
      'Actual registered admin analytics handler + synthetic memory attempts supplies intercepted GET response to actual local HTML/JS/CSS in real Chrome. No production DB/data, listening service, business writes or AI. Legacy payload test explicitly removes fields as a compatibility fixture, not a live user record.',
    checks: [],
    matrix: [],
    screenshots: [],
    pageErrors: [],
    requests: [],
  };
  const record = (scene, name, pass, details = {}) =>
    report.checks.push({ scene, name, pass: Boolean(pass), ...details });
  const current = await routerFixture();
  let responsePayload = current;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage();
  // Use the application's real theme preference. Not every local fixture
  // interprets the QA-only `theme` query parameter before restoring the shell.
  await page.evaluateOnNewDocument(() => {
    const theme = new URLSearchParams(window.location.search).get('theme');
    if (['light', 'dark'].includes(theme)) localStorage.setItem('free_bbs_theme_mode', theme);
  });
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin && !['data:', 'blob:'].includes(url.protocol))
      return request.respond({
        status: 403,
        body: 'External requests disabled for local acceptance',
      });
    if (url.pathname.startsWith('/api/')) {
      report.requests.push({ method: request.method(), path: url.pathname });
      if (request.method() !== 'GET')
        return request.respond({
          status: 403,
          body: 'Business writes disabled for read-only UI QA',
        });
    }
    if (url.pathname === '/api/learning-analytics/admin/overview')
      return request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify(responsePayload),
      });
    return request.continue();
  });
  const target = '#admin-learning-data .learning-data-users .learning-data-table-scroll';
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  const inspect = () =>
    page.$eval(target, (scroll) => {
      const panel = scroll.closest('.learning-data-panel');
      const details = scroll.closest('details');
      const style = getComputedStyle(panel);
      const table = scroll.querySelector('table');
      return {
        headings: Array.from(table.querySelectorAll('th'), (node) => node.textContent),
        rows: Array.from(table.querySelectorAll('tbody tr'), (row) =>
          Array.from(row.children, (cell) => cell.textContent),
        ),
        caption: details.querySelector('.learning-data-caption').textContent,
        scrollWidth: scroll.scrollWidth,
        clientWidth: scroll.clientWidth,
        overflowX: getComputedStyle(scroll).overflowX,
        documentWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        tableTag: table.tagName,
        textColor: getComputedStyle(table.querySelector('td')).color,
        background: style.backgroundColor,
        fontSize: getComputedStyle(table).fontSize,
        theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      };
    });
  try {
    for (const width of [390, 768, 1440]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        const scene = `${width}-${theme}`;
        await page.goto(`${base.origin}/adminusers?as=admin&theme=${theme}`, {
          waitUntil: 'networkidle0',
        });
        await page.waitForSelector(target);
        await page.click('#admin-learning-data [data-learning-data-view="users"]');
        await page.click('#admin-learning-data .learning-data-users summary');
        await settle();
        const details = await inspect();
        report.matrix.push({ scene, ...details });
        record(
          scene,
          'total, formal and practice columns use actual router counts',
          details.headings[3] === '全部作答（次数）' &&
            details.headings[4] === '正式自测（次数）' &&
            details.headings[5] === '练习（次数）' &&
            details.rows.some(
              (row) =>
                row[0] === '只做练习（夹具）' && row.slice(3).join('|') === '200|0|200|0 / 0|0',
            ) &&
            details.rows.some(
              (row) => row[0] === '正式自测（夹具）' && row.slice(3).join('|') === '3|3|0|1 / 1|1',
            ),
          { headings: details.headings, rows: details.rows },
        );
        record(
          scene,
          'history counts are explicitly not current mastery',
          /含重复作答和历史版本/.test(details.caption) &&
            /不代表当前题库通过或掌握程度/.test(details.caption),
        );
        record(
          scene,
          'table overflow is local, not page-wide',
          details.documentWidth <= details.viewport + 1 &&
            details.clientWidth > 100 &&
            ['auto', 'scroll'].includes(details.overflowX),
          {
            documentWidth: details.documentWidth,
            viewport: details.viewport,
            clientWidth: details.clientWidth,
            scrollWidth: details.scrollWidth,
          },
        );
        const ratio = contrast(details.textColor, details.background);
        record(
          scene,
          'intended theme and readable table text contrast',
          details.theme === theme && ratio >= 4.5,
          {
            theme: details.theme,
            textColor: details.textColor,
            background: details.background,
            contrast: ratio,
            fontSize: details.fontSize,
          },
        );
        const imagePath = path.join(output, `${scene}.png`);
        await (
          await page.$('#admin-learning-data .learning-data-users')
        ).screenshot({ path: imagePath });
        report.screenshots.push(imagePath);
        await page.keyboard.press('Tab');
        const focused = await page.$eval(target, (scroll) => document.activeElement === scroll);
        record(scene, 'native Tab reaches the horizontal scroll container', focused, {
          tableTag: details.tableTag,
        });
        const before = await page.$eval(target, (scroll) => ({
          local: scroll.scrollLeft,
          page: window.scrollX,
        }));
        await page.keyboard.press('ArrowRight');
        if (details.scrollWidth > details.clientWidth)
          await page.waitForFunction(
            (selector) => document.querySelector(selector).scrollLeft > 0,
            { timeout: 2500 },
            target,
          );
        await settle();
        const after = await page.$eval(target, (scroll) => ({
          local: scroll.scrollLeft,
          page: window.scrollX,
        }));
        record(
          scene,
          'ArrowRight only scrolls the focused table when overflow exists',
          after.page === before.page &&
            (details.scrollWidth <= details.clientWidth || after.local > before.local),
          { before, after, overflow: details.scrollWidth > details.clientWidth },
        );
        if (details.scrollWidth > details.clientWidth) {
          // Retain the same native Tab focus and traverse with ArrowRight.
          // The earlier wheel-to-tail diagnostic timed out; that separate
          // report is retained and is not claimed as a successful interaction.
          for (let step = 0; step < 60; step += 1) {
            if (
              await page.$eval(
                target,
                (scroll) => scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 1,
              )
            )
              break;
            await page.keyboard.press('ArrowRight');
            await settle();
          }
          await settle();
        }
        const tail = await page.$eval(target, (scroll) => {
          const cell = scroll.querySelector('tbody tr td:last-child').getBoundingClientRect();
          const box = scroll.getBoundingClientRect();
          return {
            local: scroll.scrollLeft,
            page: window.scrollX,
            tailVisible: cell.left >= box.left - 1 && cell.right <= box.right + 1,
          };
        });
        record(
          scene,
          'last formal-result and pending-review columns remain reachable',
          tail.tailVisible && tail.page === 0,
          tail,
        );
        if (details.scrollWidth > details.clientWidth) {
          const tailImagePath = path.join(output, `${scene}-right.png`);
          await (
            await page.$('#admin-learning-data .learning-data-users')
          ).screenshot({ path: tailImagePath });
          report.screenshots.push(tailImagePath);
        }
      }
    }
    responsePayload = structuredClone(current);
    const legacyUser = responsePayload.users.find((user) => user.id === '1');
    delete legacyUser.selftest.officialAttempts;
    delete legacyUser.selftest.practiceAttempts;
    legacyUser.nickname = '<img src=x onerror="window.analyticsInjectionFixture=true">';
    await page.evaluate(() => window.FreeBbsLearningAnalytics.refresh());
    await page.waitForFunction(
      (selector) => /未分列/.test(document.querySelector(selector)?.textContent || ''),
      {},
      target,
    );
    const legacy = await inspect();
    const row = legacy.rows.find((item) => item[0].startsWith('<img'));
    record(
      'legacy-injection-fixture',
      'missing breakdown is not derived from total and nickname remains plain text',
      row?.slice(3, 6).join('|') === '200|未分列|未分列' &&
        (await page.$eval(
          target,
          (scroll) => !scroll.querySelector('img') && !window.analyticsInjectionFixture,
        )),
      { row },
    );
    record(
      'all',
      'no non-GET business API requests or automatic AI',
      report.requests.every((request) => request.method === 'GET' && !/\/ai\//.test(request.path)),
      { nonGet: report.requests.filter((request) => request.method !== 'GET') },
    );
    record('all', 'no page runtime errors', report.pageErrors.length === 0, {
      errors: report.pageErrors,
    });
  } catch (error) {
    record('runner', 'completed intended matrix', false, { error: error.stack || error.message });
  } finally {
    await browser.close();
    report.passed = report.checks.filter((check) => check.pass).length;
    report.failed = report.checks.filter((check) => !check.pass).length;
    const reportPath = path.join(output, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, passed: report.passed, failed: report.failed }));
    process.exitCode = report.failed ? 1 : 0;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
