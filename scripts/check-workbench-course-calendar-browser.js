// Local-only browser coverage for explicit imports and frozen personal course copies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEditableCalendarPreview } = require('./preview-editable-calendar');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-course-import-browser-'));
  const preview = await createEditableCalendarPreview();
  preview.workbench.requireCourseConfirmation();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  let browser;
  let page;
  let stage = 'launch';
  const errors = [];
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH,
      userDataDir: path.join(output, 'browser'),
    });
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === base) request.continue();
      else request.respond({ status: 204 });
    });
    await page.evaluateOnNewDocument(() => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : ['2026-09-29T02:00:00Z']));
        }

        static now() {
          return NativeDate.parse('2026-09-29T02:00:00Z');
        }
      };
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    stage = 'automatic first preview';
    await page.waitForSelector('#workbench-course-import-dialog[open]');
    assert.equal(await page.$('#workbench-course-calendar-form'), null);
    assert.equal(preview.workbench.courseProjection().events.length, 0);
    await page.click('#workbench-course-import-dialog button[type="submit"]');
    const later = await page.$('.max-tour-later');
    if (later) await later.click();
    await page.$eval('#workbench-course-import-open', (el) => el.click());
    await page.waitForSelector('#workbench-course-import-dialog[open]');
    await page.click('#workbench-course-import-confirm');
    await page.waitForFunction(
      () => !document.querySelector('#workbench-course-import-dialog').open,
    );
    await page.waitForSelector('.workbench-week-event[data-public-id^="cs_"]');
    const saved = structuredClone(preview.workbench.courseProjection().events);
    assert.ok(saved.length > 0);
    stage = 'normal sync and reload preserve saved copy';
    preview.workbench.campusCourses[0].title = '重新读取后的中文写作';
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#workbench-course-import-dialog', (el) => el.open), false);
    assert.deepEqual(preview.workbench.courseProjection().events, saved);
    const reimport = async () => {
      await page.$eval('#workbench-course-import-open', (el) => el.click());
      await page.waitForSelector('#workbench-course-import-dialog[open]');
    };
    stage = 're-import preview and cancel are read-only';
    await reimport();
    assert.match(
      await page.$eval('#workbench-course-import-list', (el) => el.textContent),
      /重新读取后的中文写作/,
    );
    assert.deepEqual(preview.workbench.courseProjection().events, saved);
    await page.click('#workbench-course-import-dialog button[type="submit"]');
    assert.deepEqual(preview.workbench.courseProjection().events, saved);
    stage = 'stale preview rejects confirmation';
    await reimport();
    preview.workbench.campusCourses[0].title = '最后确认的中文写作';
    await page.click('#workbench-course-import-confirm');
    await page.waitForFunction(() =>
      document.getElementById('workbench-course-import-status').textContent.includes('重新预览'),
    );
    assert.deepEqual(preview.workbench.courseProjection().events, saved);
    await page.click('#workbench-course-import-dialog button[type="submit"]');
    await reimport();
    for (const width of [1440, 390]) {
      for (const light of [true, false]) {
        await page.setViewport({ width, height: 1000 });
        await page.evaluate((isLight) => {
          document.body.classList.toggle('theme-light', isLight);
          document.body.classList.toggle('theme-dark', !isLight);
        }, light);
        assert.equal(
          await page.$eval('#workbench-course-import-dialog', (el) => {
            const bounds = el.getBoundingClientRect();
            return (
              bounds.left >= 0 &&
              bounds.right <= window.innerWidth + 1 &&
              el.scrollWidth <= el.clientWidth + 1
            );
          }),
          true,
        );
        await page.screenshot({
          path: path.join(output, `import-${width}-${light ? 'light' : 'dark'}.png`),
        });
      }
    }
    stage = 'explicit confirmation replaces source without duplicates';
    await page.click('#workbench-course-import-confirm');
    await page.waitForFunction(
      () => !document.querySelector('#workbench-course-import-dialog').open,
    );
    const updated = preview.workbench.courseProjection().events;
    assert.equal(updated.length, saved.length);
    assert.equal(new Set(updated.map((item) => item.publicId)).size, updated.length);
    assert.equal(
      updated
        .filter((item) => item.courseReference === 'demo:weeks:0')
        .every((item) => item.title === '最后确认的中文写作'),
      true,
    );
    stage = 'logout dismisses sensitive preview';
    await reimport();
    await page.evaluate(() => {
      window.freeBbsApp.userState.isLoggedIn = false;
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    assert.equal(await page.$eval('#workbench-course-import-dialog', (el) => el.open), false);
    assert.equal(await page.$eval('#workbench-course-calendar', (el) => el.hidden), true);
    assert.deepEqual(errors, []);
    console.log(`Confirmed course import browser checks passed: ${output}`);
  } catch (error) {
    console.error({ stage, errors, output });
    if (page) {
      console.error(await page.$eval('#workbench-course-calendar-status', (el) => el.textContent));
      await page.screenshot({ path: path.join(output, 'failure.png') });
    }
    throw error;
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
