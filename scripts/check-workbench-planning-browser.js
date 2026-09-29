const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEditableCalendarPreview } = require('./preview-editable-calendar');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-planning-preferences-'));
  const preview = await createEditableCalendarPreview();
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
    page.on('request', (request) =>
      new URL(request.url()).origin === base
        ? request.continue()
        : request.respond({ status: 204 }),
    );
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
    await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' });
    stage = 'preferences ready';
    const later = await page.$('.max-tour-later');
    if (later) await later.click();
    await page.waitForFunction(
      () => !document.getElementById('workbench-preferences-fields').disabled,
    );
    await page.waitForFunction(
      () => document.querySelector('#workbench-companion img')?.naturalWidth > 0,
    );
    const count = preview.workbench.events.length;
    stage = 'gaps';
    await page.click('[data-planning-gaps="7"]');
    await page.waitForFunction(
      () => document.getElementById('workbench-planning-gap-list').children.length > 0,
    );
    assert.equal(preview.workbench.events.length, count, 'Availability lookup cannot save events');
    await page.click('.workbench-planning-preferences summary');
    await page.select('#workbench-preferences-form [name="focusMinutes"]', '30');
    await page.select('#workbench-preferences-form [name="breakMinutes"]', '10');
    stage = 'save preferences';
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/schedule-planner/preferences') &&
        response.request().method() === 'PUT',
    );
    await page.click('#workbench-preferences-form button[type="submit"]');
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() =>
      document.getElementById('workbench-preferences-status').textContent.includes('已保存到'),
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => !document.getElementById('workbench-preferences-fields').disabled,
    );
    assert.equal(await page.$eval('[name="focusMinutes"]', (el) => el.value), '30');
    const initialTip = await page.$eval('#workbench-companion-tip', (el) => el.textContent);
    await page.click('#workbench-companion-next');
    assert.notEqual(
      await page.$eval('#workbench-companion-tip', (el) => el.textContent),
      initialTip,
    );
    await page.click('#workbench-companion-hide');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#workbench-companion', (el) => el.hidden), true);
    await page.click('#workbench-companion-show');
    assert.equal(await page.$eval('#workbench-companion', (el) => el.hidden), false);
    await page.waitForFunction(
      () => document.getElementById('workbench-companion').dataset.tip !== 'welcome',
    );
    await page.click('#workbench-companion-avatar');
    assert.equal(await page.$eval('#workbench-companion-bubble', (el) => el.hidden), true);
    await page.click('#workbench-companion-avatar');
    assert.equal(await page.$eval('#workbench-companion-bubble', (el) => el.hidden), false);
    await page.type('#workbench-agent-message', '接下来3天复习数学共2小时');
    stage = 'generate';
    const generated = page.waitForResponse((response) =>
      response.url().endsWith('/schedule-planner/preview'),
    );
    await page.click('#workbench-agent-generate');
    const result = await generated;
    assert.equal(result.status(), 200, await result.text());
    const proposals = (await result.json()).suggestions;
    assert.ok(proposals.length >= 4);
    assert.ok(
      proposals.every((item) => Date.parse(item.endAt) - Date.parse(item.startAt) <= 30 * 60000),
    );
    assert.equal(preview.workbench.events.length, count, 'Preview must remain unconfirmed');
    const screenshots = [];
    for (const width of [1600, 390]) {
      await page.setViewport({ width, height: 1000 });
      for (const light of [true, false]) {
        await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' });
        await page.evaluate((value) => {
          document.body.classList.toggle('theme-light', value);
          document.body.classList.toggle('theme-dark', !value);
          document.querySelector('.workbench-planning-preferences').open = true;
        }, light);
        const metrics = await page.evaluate(() => {
          const els = [
            '#workbench-companion',
            '#workbench-preferences-form',
            '.workbench-planning-preferences',
          ];
          return els.map((selector) => {
            const el = document.querySelector(selector);
            const rect = el.getBoundingClientRect();
            return {
              selector,
              overflow: el.scrollWidth - el.clientWidth,
              right: rect.right,
              left: rect.left,
            };
          });
        });
        assert.ok(
          metrics.every((el) => el.overflow < 3 && el.right <= width + 2 && el.left >= 0),
          JSON.stringify(metrics),
        );
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
        if (await page.$eval('#workbench-companion-bubble', (el) => el.hidden))
          await page.click('#workbench-companion-avatar');
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        );
        const companionShot = path.join(
          output,
          `companion-${width}-${light ? 'light' : 'dark'}.png`,
        );
        await page.screenshot({ path: companionShot });
        await page.click('#workbench-companion-plan');
        await page.waitForFunction(
          () =>
            document.querySelector('#workbench-preferences-form').getBoundingClientRect().height >
            0,
        );
        await page.$eval('.workbench-planning-preferences', (el) =>
          el.scrollIntoView({ block: 'start' }),
        );
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        );
        const preferencesShot = path.join(
          output,
          `preferences-${width}-${light ? 'light' : 'dark'}.png`,
        );
        await page.screenshot({ path: preferencesShot });
        screenshots.push(companionShot, preferencesShot);
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          screenshots,
          errors,
          cases: [
            'owner preferences saved/reloaded',
            'gap lookup read-only',
            'preview read-only and respects saved focus length',
            'tips hide/restore persist',
            'desktop/mobile light/dark layout',
          ],
        },
        null,
        2,
      ),
    );
    console.log(`Planning preferences browser checks passed: ${output}`);
  } catch (error) {
    console.error({ stage, errors, output });
    if (page) {
      console.error(
        await page.evaluate(() => ({
          status: document.getElementById('workbench-preferences-status')?.textContent,
          agent: document.getElementById('workbench-agent-status')?.textContent,
          invalid: [...document.querySelectorAll(':invalid')].map((el) => ({
            tag: el.tagName,
            name: el.name,
            value: el.value,
            message: el.validationMessage,
          })),
        })),
      );
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
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
