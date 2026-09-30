const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-week-overview-'));
  const preview = await createDashboardUsabilityPreview();
  preview.workbench.events.push(
    ...[
      ['ws_early', '早班出发', '2026-09-28T08:00:00+08:00', '2026-09-28T09:00:00+08:00'],
      ['ws_saturday', '周六阅读', '2026-10-03T09:00:00+08:00', '2026-10-03T11:00:00+08:00'],
      ['ws_sunday', '周日回顾', '2026-10-04T19:00:00+08:00', '2026-10-04T20:30:00+08:00'],
      ['ws_overlap', '项目交流', '2026-09-29T12:30:00+08:00', '2026-09-29T13:30:00+08:00'],
      ['ws_allday', '全天活动', '2026-10-01T00:00:00+08:00', '2026-10-02T00:00:00+08:00'],
      ['ws_deadline', '提交报告', '2026-10-01T19:59:00+08:00', '2026-10-01T20:00:00+08:00'],
    ].map(([publicId, title, startAt, endAt]) => ({
      publicId,
      title,
      startAt,
      endAt,
      description: '本地模拟 · 阅览室',
      kind: publicId === 'ws_deadline' ? 'deadline' : 'event',
      sourceType: 'manual',
      status: 'confirmed',
      version: 1,
      allDay: publicId === 'ws_allday',
    })),
  );
  const before = structuredClone(preview.workbench.events);
  const { server } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  const errors = [];
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id])
      await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) =>
      new URL(request.url()).origin === origin || /^(data|blob):/.test(request.url())
        ? request.continue()
        : request.respond({ status: 204 }),
    );
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });
      });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${origin}/workbench?calendar=overview`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.workbench-week-overview-dialog[open] [data-public-id="ws_early"]');
    await page.waitForSelector('.workbench-week-all-day [data-public-id="ws_allday"]');
    await page.waitForSelector('.workbench-week-all-day [data-public-id="ws_deadline"]');
    assert.equal(await page.$eval('#workbench-time-conflicts', (node) => node.hidden), false);
    const originalHours = await page.$eval('#workbench-hours-form', (form) =>
      [...form.querySelectorAll('select')].map((select) => select.value),
    );
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [1024, 768],
      [390, 844],
    ])
      for (const theme of ['light', 'dark']) {
        await page.setViewport({ width, height });
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-dark', mode === 'dark');
          document.body.classList.toggle('theme-light', mode === 'light');
          window.freeBbsTypography?.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        await settle();
        const geometry = await page.evaluate(() => {
          const dialog = document.querySelector('.workbench-week-overview-dialog');
          const scroll = document.querySelector('.workbench-week-scroll');
          const rect = scroll.getBoundingClientRect();
          const days = [...document.querySelectorAll('.workbench-week-day')];
          const cards = [
            ...dialog.querySelectorAll('.workbench-week-timeline .workbench-week-event'),
          ].filter((card) => !card.hidden);
          return {
            dialogWidth: dialog.getBoundingClientRect().width,
            dialogHeight: dialog.getBoundingClientRect().height,
            columns: days.length,
            scrollX: scroll.scrollWidth - scroll.clientWidth,
            scrollY: scroll.scrollHeight - scroll.clientHeight,
            allDaysVisible: days.every(
              (day) => day.getBoundingClientRect().right <= rect.right + 1,
            ),
            allDayFits: [...dialog.querySelectorAll('.workbench-week-all-day')].every(
              (node) => node.scrollHeight <= node.clientHeight + 1,
            ),
            ranges: days.map((day) =>
              day.querySelector('.workbench-week-timeline').getAttribute('aria-label'),
            ),
            cards: cards.map((card) => ({
              id: card.dataset.publicId,
              titleVisible: !card.querySelector('strong').hidden,
              height: card.getBoundingClientRect().height,
              top: card.getBoundingClientRect().top,
              bottom: card.getBoundingClientRect().bottom,
            })),
            top: rect.top,
            bottom: rect.bottom,
            hours: [
              ...document.querySelector('#workbench-hours-form').querySelectorAll('select'),
            ].map((select) => select.value),
          };
        });
        assert.ok(geometry.dialogWidth <= width - 24);
        assert.ok(geometry.dialogHeight <= height - 24);
        assert.equal(geometry.columns, 7);
        assert.ok(geometry.scrollX <= 1, JSON.stringify({ width, height, theme, geometry }));
        assert.ok(geometry.scrollY <= 1, JSON.stringify({ width, height, theme, geometry }));
        assert.equal(geometry.allDaysVisible, true);
        assert.equal(geometry.allDayFits, true);
        assert.ok(geometry.ranges.every((range) => range === '08:00–24:00'));
        assert.deepEqual(geometry.hours, originalHours);
        assert.ok(
          geometry.cards.every(
            (card) =>
              card.height >= 23.9 &&
              card.titleVisible &&
              card.top >= geometry.top &&
              card.bottom <= geometry.bottom + 1,
          ),
          JSON.stringify({ width, height, theme, geometry }),
        );
        for (const id of ['ws_early', 'ws_saturday', 'ws_sunday', 'ws_short_midnight'])
          assert.ok(geometry.cards.some((card) => card.id === id));
        await page.screenshot({ path: path.join(output, `week-${width}-${height}-${theme}.png`) });
      }
    await page.setViewport({ width: 1440, height: 900 });
    await settle();
    await page.click('#workbench-time-conflicts-summary');
    await settle();
    assert.ok(
      await page.$eval(
        '.workbench-week-scroll',
        (node) => node.scrollHeight <= node.clientHeight + 1,
      ),
    );
    await page.click('#workbench-time-conflicts-summary');
    await settle();
    await page.click('[data-public-id="ws_early"]');
    await page.waitForSelector('#workbench-schedule-dialog[open]');
    assert.equal(
      await page.$eval('#workbench-schedule-start', (node) => node.value),
      '2026-09-28T08:00',
    );
    assert.equal(
      await page.$eval('#workbench-schedule-end', (node) => node.value),
      '2026-09-28T09:00',
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.workbench-week-overview-dialog', (node) => node.open), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.querySelector('.workbench-week-overview-dialog').open,
    );
    await page.waitForFunction(() =>
      document
        .querySelector('#workbench-calendar')
        .parentElement.classList.contains('workbench-dashboard-grid'),
    );
    assert.equal(
      await page.$eval('#workbench-calendar', (node) => node.parentElement.className),
      'workbench-dashboard-grid',
    );
    assert.deepEqual(
      await page.$eval('#workbench-hours-form', (form) =>
        [...form.querySelectorAll('select')].map((select) => select.value),
      ),
      originalHours,
    );
    assert.equal(
      await page.$eval('#workbench-week-overview', (node) => document.activeElement === node),
      true,
    );
    const normalWidth = await page.$eval(
      '#workbench-calendar',
      (node) => node.getBoundingClientRect().width,
    );
    await page.select('#workbench-hours-start', '6');
    await page.click('#workbench-hours-form button');
    await page.click('#workbench-week-overview');
    await settle();
    const applied = await page.$eval('.workbench-week-overview-dialog', (node) => ({
      width: node.getBoundingClientRect().width,
      ranges: [...node.querySelectorAll('.workbench-week-timeline')].map((timeline) =>
        timeline.getAttribute('aria-label'),
      ),
    }));
    assert.ok(Math.abs(applied.width - normalWidth) < 1, JSON.stringify(applied));
    assert.ok(applied.ranges.every((range) => range === '06:00–24:00'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.querySelector('.workbench-week-overview-dialog').open,
    );
    // Entry from list mode returns to that same mode; viewing never saves an event.
    await page.click('#workbench-view-toggle');
    await page.click('#workbench-week-overview');
    await page.waitForSelector('.workbench-week-overview-dialog[open]');
    await page.click('#workbench-week-overview');
    await page.waitForFunction(
      () => !document.querySelector('.workbench-week-overview-dialog').open,
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#workbench-week-overview').getAttribute('aria-expanded') ===
        'false',
    );
    assert.equal(
      await page.$eval('#workbench-view-toggle', (node) => node.getAttribute('aria-pressed')),
      'true',
    );
    assert.deepEqual(preview.workbench.events, before);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output, errors, checkedViewports: 5 }));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') });
    console.error(output);
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
