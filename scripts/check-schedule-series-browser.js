const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createScheduleSeriesPreview } = require('./preview-schedule-series');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-schedule-series-'));
  const preview = await createScheduleSeriesPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  let browser;
  let page;
  const errors = [];
  const report = { checks: [], layouts: [], screenshots: [] };
  let stage = 'start';
  let confirmDelete = false;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => (confirmDelete ? dialog.accept() : dialog.dismiss()));
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.fulfill({ status: 204 }),
    );
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle' });
    const later = await page.$('.max-tour-later');
    if (later) await later.click();
    const card = (id) => `.workbench-week-event[data-public-id="${id}"]`;
    const open = async (id) => {
      await page.waitForSelector(card(id), { state: 'attached' });
      const pendingGuide = page.locator('.max-tour-later:visible').first();
      if (await pendingGuide.isVisible()) await pendingGuide.click();
      await page.$eval(card(id), (element) =>
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
      );
      // Overlapping cards keep an exposed leading edge; click that edge rather than the covered centre.
      await page.click(card(id), { position: { x: 12, y: 8 } });
      await page.waitForSelector('#workbench-schedule-dialog[open]');
      await page.waitForFunction(
        () => !document.querySelector('#workbench-schedule-submit').disabled,
      );
    };
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (element, next) => {
          element.value = next;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    const waitSave = async () => {
      const response = page.waitForResponse(
        (item) =>
          item.request().method() === 'POST' &&
          /\/schedule-items\/[^/]+\/series$/.test(new URL(item.url()).pathname),
      );
      await page.click('#workbench-schedule-submit');
      const first = await response;
      if (first.status() === 409 && (await first.json()).code === 'course_conflict') {
        const second = page.waitForResponse(
          (item) =>
            item.request().method() === 'POST' &&
            /\/schedule-items\/[^/]+\/series$/.test(new URL(item.url()).pathname),
        );
        await page.waitForFunction(
          () => document.querySelector('#workbench-schedule-submit').textContent === '仍然保存',
        );
        await page.click('#workbench-schedule-submit');
        assert.equal((await second).status(), 200);
      } else assert.equal(first.status(), 200);
      await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    };

    stage = 'ordinary event cancellation and deletion';
    await open('ws_hour_location');
    assert.equal(
      await page.$eval('#workbench-schedule-delete', (element) => element.hidden),
      false,
    );
    await page.click('#workbench-schedule-delete');
    assert.equal(await page.$eval('#workbench-schedule-dialog', (element) => element.open), true);
    assert.ok(
      preview.workbench.events.find(
        (item) => item.publicId === 'ws_hour_location' && !item.deleted,
      ),
    );
    confirmDelete = true;
    await page.click('#workbench-schedule-delete');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    await page.waitForFunction(
      () => !document.querySelector('.workbench-week-event[data-public-id="ws_hour_location"]'),
    );
    report.checks.push(
      'Cancel deletion retains event; confirmed deletion closes editor and removes card',
    );

    stage = 'saved recurrence display and following edits';
    const original = preview.workbench.events.find((item) => item.title.includes('可修改重复规则'));
    await open(original.publicId);
    assert.match(
      await page.$eval('#workbench-series-summary', (element) => element.textContent),
      /每 1 周/,
    );
    assert.equal(await page.$eval('#workbench-course-repeat', (element) => element.hidden), true);
    await page.selectOption('#workbench-series-scope', 'following');
    await page.selectOption('#workbench-series-mode', 'replace');
    assert.equal(await page.$eval('#workbench-course-repeat', (element) => element.hidden), false);
    await page.selectOption('#workbench-course-interval', '2');
    await page.selectOption('#workbench-repeat-end-mode', 'count');
    await fill('#workbench-course-count', '3');
    await fill('#workbench-schedule-title', '本地 · 隔周课程');
    await waitSave();
    const replacements = preview.workbench.events.filter(
      (item) => item.title === '本地 · 隔周课程' && !item.deleted,
    );
    assert.equal(replacements.length, 3);
    assert.equal(replacements[1].startAt, '2026-10-13T11:00:00.000Z');
    await page.reload({ waitUntil: 'networkidle' });
    await open(replacements[0].publicId);
    assert.match(
      await page.$eval('#workbench-series-summary', (element) => element.textContent),
      /每 2 周/,
    );
    await page.click('#workbench-schedule-dialog [data-workbench-dialog-close]');
    await page.click('#workbench-week-next');
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('.workbench-week-event')].some((element) =>
          element.textContent.includes('本地 · 隔周课程'),
        ),
    );
    await page.click('#workbench-week-next');
    await page.waitForSelector(card(replacements[1].publicId));
    await page.click('#workbench-week-today');
    await page.waitForSelector(card(replacements[0].publicId));
    report.checks.push(
      'Weekly rule loads, biweekly edit saves and reloads; calendar dates match across weeks',
    );

    stage = 'imported real-date schedules and personal overrides';
    const imported = preview.workbench
      .courseProjection()
      .events.find(
        (item) => item.courseReference === 'demo:weeks:1' && item.startAt.startsWith('2026-09-29'),
      );
    await open(imported.publicId);
    assert.match(
      await page.$eval('#workbench-series-summary', (element) => element.textContent),
      /实际教学日期/,
    );
    await page.selectOption('#workbench-series-scope', 'following');
    assert.equal(await page.$eval('#workbench-series-mode', (element) => element.value), 'keep');
    await fill('#workbench-schedule-title', '本地 · 课程个人系列调整');
    await waitSave();
    const changed = preview.workbench
      .courseProjection()
      .events.find((item) => item.publicId === imported.publicId);
    assert.equal(changed.title, '本地 · 课程个人系列调整');
    await open(imported.publicId);
    await page.selectOption('#workbench-series-scope', 'following');
    await page.click('#workbench-schedule-delete');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      preview.workbench
        .courseProjection()
        .events.some((item) => item.publicId === imported.publicId),
      false,
    );
    report.checks.push(
      'Imported actual dates display; personal following edits and deletion persist through reload',
    );

    stage = 'responsive recurrence controls';
    for (const width of [1600, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-dark', mode === 'dark');
          document.body.classList.toggle('theme-light', mode === 'light');
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        await open(replacements[0].publicId);
        await page.selectOption('#workbench-series-scope', 'following');
        await page.selectOption('#workbench-series-mode', 'replace');
        const fit = await page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '#workbench-schedule-form select, #workbench-schedule-form input:not([type="hidden"])',
            ),
          ]
            .filter((element) => element.getClientRects().length)
            .every((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= window.innerWidth + 1;
            }),
        );
        assert.equal(fit, true);
        report.layouts.push({ width, theme, fit });
        if (width === 390) {
          const shot = path.join(output, `series-${width}-${theme}.png`);
          await page.screenshot({ path: shot });
          report.screenshots.push(shot);
        }
        await page.click('#workbench-schedule-dialog [data-workbench-dialog-close]');
      }
    }
    assert.deepEqual(errors, []);
    report.passed = true;
    console.log(`Schedule series browser passed: ${output}`);
  } catch (error) {
    report.failedStage = stage;
    report.failure = error.stack;
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    report.errors = errors;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
    if (!report.passed) console.error(`Schedule series browser failed at ${stage}: ${output}`);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { main };
