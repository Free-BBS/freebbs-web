// Loopback-only simulated APIs; no production database or account is used.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

async function main() {
  const preview = createWorkbenchPreviewApi();
  const hour = 3600000;
  const local = new Date(Date.now() + 8 * hour);
  const monday =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - ((local.getUTCDay() + 6) % 7),
    ) -
    8 * hour;
  const fixture = (id, start, end, extra = {}) => ({
    publicId: id,
    title: id,
    description: '',
    startAt: new Date(monday + start * hour).toISOString(),
    endAt: new Date(monday + end * hour).toISOString(),
    allDay: false,
    status: 'confirmed',
    sourceType: 'manual',
    kind: 'event',
    version: 1,
    ...extra,
  });
  preview.events.splice(
    0,
    preview.events.length,
    fixture('notes-main', 10, 12, { description: '六教 101' }),
    fixture('before-range', 4, 5),
    fixture('overnight', 23, 31),
    fixture('all-day', 48, 72, { allDay: true }),
    fixture('early-ddl', 26.99, 27, { kind: 'deadline' }),
  );
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html' },
    previewApiHandler: preview.handle,
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let stage = 'launch Chrome';
  const errors = [];
  try {
    browser = await puppeteer.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    stage = 'open page';
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== base) request.respond({ status: 204 });
      else request.continue();
    });
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (element, next) => {
          Object.assign(element, { value: next });
          element.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    const waitStatus = (selector, text) =>
      page.waitForFunction(
        (target, expected) => document.querySelector(target)?.textContent.includes(expected),
        {},
        selector,
        text,
      );
    const apply = async (start, end) => {
      await page.select('#workbench-hours-start', String(start));
      await page.select('#workbench-hours-end', String(end));
      await page.click('#workbench-hours-form button');
    };
    await page.goto(`${base}/workbench`, { waitUntil: 'domcontentloaded' });
    stage = 'initial schedule';
    await page.waitForSelector('.workbench-week-event[data-public-id="notes-main"]');
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.value), '6');
    assert.equal(
      await page.$eval('.workbench-week-timeline', (element) => element.style.height),
      '720px',
    );
    assert.equal(
      await page.$$eval(
        '.workbench-week-event[data-public-id="before-range"]',
        (entries) => entries.length,
      ),
      0,
    );
    assert.equal(
      await page.$$eval(
        '.workbench-week-event[data-public-id="overnight"]',
        (entries) => entries.length,
      ),
      2,
    );
    assert.equal(
      await page.$eval(
        '.workbench-week-event[data-public-id="notes-main"]',
        (element) => element.style.top,
      ),
      '160px',
    );
    assert.match(
      await page.$eval('#workbench-hours-outside', (element) => element.textContent),
      /1 项日程完全/,
    );
    assert.ok(await page.$('.workbench-week-event[data-public-id="all-day"]'));
    assert.ok(await page.$('.workbench-week-event[data-public-id="early-ddl"]'));
    assert.equal(
      await page.$$eval(
        '.workbench-week-timeline',
        (elements) => new Set(elements.map((element) => element.getBoundingClientRect().top)).size,
      ),
      1,
      'All seven hour axes must align even when only some days have all-day items or DDLs',
    );
    stage = 'hour validation and persistence';
    await apply(11, 10);
    await waitStatus('#workbench-hours-status', '严格晚于');
    assert.equal(
      await page.$eval('.workbench-week-timeline', (element) => element.style.height),
      '720px',
    );
    await apply(10, 10);
    await waitStatus('#workbench-hours-status', '严格晚于');
    await apply(8, 20);
    assert.equal(
      await page.$eval('.workbench-week-timeline', (element) => element.style.height),
      '480px',
    );
    assert.equal(
      await page.$eval(
        '.workbench-week-event[data-public-id="notes-main"]',
        (element) => element.style.top,
      ),
      '80px',
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.workbench-week-event[data-public-id="notes-main"]');
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.value), '8');
    const uid = await page.evaluate(() => window.freeBbsApp.userState.uid);
    stage = 'uid isolation';
    await page.evaluate(() => {
      window.freeBbsApp.userState.uid = 'different-user';
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.value), '6');
    await apply(9, 18);
    await page.evaluate(() => {
      window.freeBbsApp.userState.isLoggedIn = false;
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.value), '6');
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.disabled), true);
    await page.evaluate((owner) => {
      window.freeBbsApp.userState.uid = owner;
      window.freeBbsApp.userState.isLoggedIn = true;
      window.dispatchEvent(new Event('freebbs:session-change'));
    }, uid);
    await page.waitForSelector('.workbench-week-event[data-public-id="notes-main"]');
    assert.equal(await page.$eval('#workbench-hours-start', (element) => element.value), '8');
    await page.click('#workbench-view-toggle');
    assert.match(
      await page.$eval('#workbench-schedule-list', (element) => element.textContent),
      /before-range/,
    );
    await page.click('#workbench-view-toggle');

    const notes = '主楼 101\n<script>window.notesXss=true</script>';
    stage = 'manual notes';
    await page.click('.workbench-week-event[data-public-id="notes-main"]');
    assert.equal(
      await page.$eval('#workbench-schedule-description', (element) => element.value),
      '六教 101',
    );
    await fill('#workbench-schedule-description', notes);
    await page.click('#workbench-schedule-submit');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    assert.equal(preview.events.find((item) => item.publicId === 'notes-main').description, notes);
    await page.waitForFunction(() =>
      document
        .querySelector('.workbench-week-event[data-public-id="notes-main"]')
        ?.title.includes('主楼 101'),
    );
    assert.equal(await page.evaluate(() => window.notesXss), undefined);
    await page.click('.workbench-week-event[data-public-id="notes-main"]');
    await fill('#workbench-schedule-description', '');
    await page.click('#workbench-schedule-submit');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    assert.equal(preview.events.find((item) => item.publicId === 'notes-main').description, '');

    const nextMonday = new Date(monday + (7 * 24 + 8) * hour);
    await fill(
      '#workbench-agent-message',
      `${nextMonday.getUTCFullYear()}年${nextMonday.getUTCMonth() + 1}月${nextMonday.getUTCDate()}日下午5点开会，持续时间2小时，地点/备注：六教 201；带电脑`,
    );
    stage = 'AI notes';
    await page.click('#workbench-agent-generate');
    await page.waitForSelector('.workbench-proposal-description');
    assert.equal(
      await page.$eval('.workbench-proposal-description', (element) => element.value),
      '六教 201；带电脑',
    );
    await fill('.workbench-proposal-description', '线上会议；提前测试麦克风');
    await page.click('#workbench-agent-confirm');
    await waitStatus('#workbench-agent-status', '已加入');
    assert.equal(
      preview.events.find((item) => item.sourceType === 'agent').description,
      '线上会议；提前测试麦克风',
    );

    stage = 'manual creation';
    await page.click('#workbench-add-schedule');
    await fill('#workbench-schedule-title', '手工备注');
    await fill('#workbench-schedule-description', '实验室 301；带记录本');
    const inputTime = (hours) => new Date(monday + (hours + 8) * hour).toISOString().slice(0, 16);
    await fill('#workbench-schedule-start', inputTime(110));
    await fill('#workbench-schedule-end', inputTime(111));
    await page.click('#workbench-schedule-submit');
    await page.waitForFunction(() => !document.querySelector('#workbench-schedule-dialog').open);
    assert.equal(
      preview.events.find((item) => item.title === '手工备注').description,
      '实验室 301；带记录本',
    );
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      assert.equal(
        await page.$eval(
          '#workbench-hours-form',
          (element) => element.scrollWidth > element.clientWidth,
        ),
        false,
      );
      assert.equal(
        await page.$$eval(
          '.workbench-week-timeline',
          (elements) =>
            new Set(elements.map((element) => element.getBoundingClientRect().top)).size,
        ),
        1,
      );
    }
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-notes-hours-mobile.png'),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      'Workbench notes/hour browser checks passed: notes CRUD/AI, safe text, hour validation/clipping, midnight, all-day/DDL, uid isolation/logout, reload and mobile layout.',
    );
  } catch (error) {
    console.error(
      `Workbench browser failed during ${stage}; page errors: ${JSON.stringify(errors)}`,
    );
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
