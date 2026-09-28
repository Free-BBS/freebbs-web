const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEditableCalendarPreview } = require('./preview-editable-calendar');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-editable-calendar-'));
  const preview = await createEditableCalendarPreview();
  await new Promise((resolve) => {
    preview.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const errors = [];
  const report = { checks: [], screenshots: [], layouts: [] };
  let browser;
  let page;
  let stage = 'launch';
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(output, 'profile'),
      executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH,
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
    await page.setViewport({ width: 1600, height: 1100 });
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    const later = await page.$('.max-tour-later');
    if (later) await later.click();
    await page.waitForFunction(
      () => document.querySelector('#workbench-course-calendar-weeks')?.value === '16',
    );
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (element, next) => {
          Object.assign(element, { value: next });
          element.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    const save = async () => {
      const pending = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/workbench/campus/course-calendar') &&
          response.request().method() === 'PUT',
      );
      await page.click('#workbench-course-calendar-save');
      const response = await pending;
      const body = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(body));
      await page.waitForFunction(
        () => !document.querySelector('#workbench-course-calendar-save').disabled,
      );
      return body;
    };
    const events = () => preview.workbench.courseProjection().events;
    stage = 'calendar default and combined lessons';
    assert.equal(
      await page.$eval('#workbench-date', (el) => el.textContent),
      '9月29日 校历第3周周二',
    );
    assert.equal(
      await page.$eval('#workbench-course-calendar-monday', (el) => el.value),
      '2026-09-14',
    );
    const merged = events().filter(
      (item) => item.courseReference === 'demo:weeks:2' && item.startAt.startsWith('2026-09-30'),
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].endAt, '2026-09-30T08:55:00.000Z');
    assert.doesNotMatch(merged[0].description, /教学周|校历|教师/);
    assert.equal(
      events().some((item) => item.startAt.startsWith('2026-10-01')),
      false,
    );
    report.checks.push(
      'Today-only academic-week label, plain course notes, merged Wednesday course and National Day skip',
    );

    stage = 'per-course section durations and holiday override';
    await page.$eval('.workbench-calendar-options', (el) => {
      el.open = true;
    });
    for (const [number, count] of [
      [2, '2'],
      [5, '1'],
      [6, '2'],
    ]) {
      await page.select(`#workbench-calendar-sections select[data-section="${number}"]`, count);
    }
    await fill('#workbench-calendar-include', '2026-10-01');
    await save();
    const optimization = events().find(
      (item) => item.courseReference === 'demo:weeks:1' && item.startAt.startsWith('2026-10-01'),
    );
    assert.equal(optimization.endAt, '2026-10-01T03:25:00.000Z');
    const five = events().find(
      (item) => item.courseReference === 'demo:variable-sections' && item.sectionStart === 5,
    );
    const six = events().find(
      (item) => item.courseReference === 'demo:variable-sections' && item.sectionStart === 6,
    );
    assert.equal(five.startAt.slice(11, 16), '09:05');
    assert.equal(five.endAt.slice(11, 16), '09:50');
    assert.equal(six.endAt.slice(11, 16), '12:55');
    await fill('#workbench-calendar-include', '');
    await save();
    assert.equal(
      events().some((item) => item.startAt.startsWith('2026-10-01')),
      false,
    );
    report.checks.push(
      '2/5/6 duration controls save independently; holiday inclusion restores only explicitly chosen date',
    );

    stage = 'unified course editor, persist after refresh';
    const original = events().find(
      (item) => item.courseReference === 'demo:weeks:1' && item.startAt.startsWith('2026-09-29'),
    );
    const card = `.workbench-week-event[data-public-id="${original.publicId}"]`;
    await page.$eval(card, (el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.click(card);
    await page.waitForSelector('#workbench-schedule-dialog[open]');
    await fill('#workbench-schedule-title', '最优化方法 · 个人调整');
    await fill('#workbench-schedule-description', '六教6C301');
    await fill('#workbench-schedule-start', '2026-09-29T10:00');
    await fill('#workbench-schedule-end', '2026-09-29T11:00');
    const pending = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/schedule-items/${original.publicId}`) &&
        response.request().method() === 'PATCH',
    );
    await page.click('#workbench-schedule-submit');
    assert.equal((await pending).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    await page.reload({ waitUntil: 'networkidle0' });
    const edited = events().find((item) => item.publicId === original.publicId);
    assert.equal(edited.title, '最优化方法 · 个人调整');
    assert.equal(edited.startAt, '2026-09-29T02:00:00.000Z');
    assert.equal(edited.description, '六教6C301');
    await page.waitForSelector(card);
    assert.match(await page.$eval(card, (el) => el.textContent), /六教6C301/);
    report.checks.push(
      'Imported course edits use normal event form, retain ID/time/location through reload',
    );

    for (const width of [1600, 1024, 390, 320]) {
      for (const theme of ['light', 'dark']) {
        stage = `layout ${width} ${theme}`;
        await page.setViewport({ width, height: 1100 });
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-light', mode === 'light');
          document.body.classList.toggle('theme-dark', mode === 'dark');
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
          document.querySelectorAll('details.personal-fold').forEach((el) => {
            el.open = true;
          });
          document.querySelector('.workbench-calendar-options').open = true;
        }, theme);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          });
        });
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          fieldsFit: [
            ...document.querySelectorAll(
              '#workbench-course-calendar-form select, #workbench-course-calendar-form textarea',
            ),
          ].every((el) => {
            const rect = el.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth + 1;
          }),
          notes: [
            ...document.querySelectorAll(
              '.workbench-week-event[data-public-id="ws_hour_location"] .workbench-week-notes',
            ),
          ].every((el) => !el.hidden),
        }));
        assert.deepEqual(geometry, { overflow: false, fieldsFit: true, notes: true });
        report.layouts.push({ width, theme, ...geometry });
        if ([1600, 390].includes(width)) {
          await page.$eval('#workbench-course-calendar', (el) =>
            el.scrollIntoView({ block: 'start', behavior: 'instant' }),
          );
          const screenshot = path.join(output, `settings-${width}-${theme}.png`);
          await page.screenshot({ path: screenshot });
          report.screenshots.push(screenshot);
          await page.$eval('.workbench-week-event[data-public-id="ws_hour_location"]', (el) =>
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
          );
          const calendarShot = path.join(output, `calendar-${width}-${theme}.png`);
          await page.screenshot({ path: calendarShot });
          report.screenshots.push(calendarShot);
        }
      }
    }
    assert.deepEqual(errors, []);
    report.passed = true;
    console.log(`Editable calendar browser passed: ${output}`);
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
    if (!report.passed) console.error(`Failed at ${stage}: ${output}`);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
