// Loopback-only course snapshots and calendar settings; no real campus account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

const NOW = Date.parse('2026-09-24T06:00:00Z');
const COURSE_SELECTOR = '.workbench-week-event[data-workbench-action="view-course-schedule"]';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-course-calendar-browser-'));
  const campusCourses = [
    {
      sourceReference: 'learn:course:digital',
      title: '数字逻辑与处理器',
      teacher: '教师甲',
      scheduleText: '第1-3周 周四 第4大节',
      locationText: '六教 6A201',
    },
    {
      sourceReference: 'learn:course:analog',
      title: '模拟电路原理',
      teacher: '教师乙',
      scheduleText: '第1-4周（双周） 周五 第2大节',
      locationText: '六教 6A202',
    },
    {
      sourceReference: 'learn:course:quantum',
      title: '量子与统计',
      teacher: '教师丙',
      scheduleText: '第1-3周 周五 10:00-11:00',
      locationText: '罗姆楼 5103',
    },
    {
      sourceReference: 'learn:course:incomplete',
      title: '待补充周次的课程',
      teacher: '教师丁',
      scheduleText: '周二第1大节',
      locationText: '六教 6A203',
    },
  ];
  const preview = createWorkbenchPreviewApi({ now: () => NOW, campusCourses });
  preview.events.splice(0, preview.events.length);
  const calls = [];
  const errors = [];
  const report = { now: new Date(NOW).toISOString(), checks: [], layouts: [], screenshots: [] };
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html' },
    previewApiHandler: async (request) => {
      const result = await preview.handle(request);
      if (
        request.route === '/api/workbench/campus/course-calendar' ||
        request.route.includes('/schedule-planner/')
      ) {
        calls.push({
          route: request.route,
          method: request.method,
          body: structuredClone(request.body),
          status: result?.status || 200,
        });
      }
      return result;
    },
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  let stage = 'launch isolated Chrome';
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(directory, 'chrome-profile'),
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.emulateTimezone('Asia/Shanghai');
    await page.evaluateOnNewDocument((timestamp) => {
      const NativeDate = Date;
      window.Date = class extends NativeDate {
        constructor(...args) {
          super(...(args.length ? args : [timestamp]));
        }

        static now() {
          return timestamp;
        }
      };
    }, NOW);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).origin === base) request.continue();
      else request.respond({ status: 204 });
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
    const courseCards = () =>
      page.$$eval(COURSE_SELECTOR, (elements) =>
        elements.map((element) => ({
          id: element.dataset.publicId,
          title: element.textContent,
          tooltip: element.title,
        })),
      );
    const courseIds = () =>
      preview
        .courseProjection()
        .events.map((event) => event.publicId)
        .sort();
    const calendarWrites = () =>
      calls.filter(
        (call) => call.route === '/api/workbench/campus/course-calendar' && call.method === 'PUT',
      );
    const saveMonday = async (value) => {
      await fill('#workbench-course-calendar-monday', value);
      const pending = page.waitForResponse(
        (response) =>
          response.url() === `${base}/api/workbench/campus/course-calendar` &&
          response.request().method() === 'PUT',
      );
      await page.click('#workbench-course-calendar-save');
      const response = await pending;
      const body = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(body));
      await waitStatus('#workbench-course-calendar-status', '已设置本学期校历');
      await page.waitForFunction(
        () => !document.querySelector('#workbench-course-calendar-save').disabled,
      );
      return body;
    };
    const refresh = async () => {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('freebbs:workbench-refresh')));
      await waitStatus('#workbench-course-calendar-status', '已设置本学期校历');
    };
    const generate = async (message, expectedStatus) => {
      await fill('#workbench-agent-message', message);
      const pending = page.waitForResponse(
        (response) =>
          response.url() === `${base}/api/workbench/schedule-planner/preview` &&
          response.request().method() === 'POST',
      );
      await page.click('#workbench-agent-generate');
      const response = await pending;
      const body = await response.json();
      assert.equal(response.status(), expectedStatus, JSON.stringify(body));
      await page.waitForFunction(
        () => !document.querySelector('#workbench-agent-generate').disabled,
      );
      return body;
    };
    const screenshot = async (name) => {
      const target = path.join(directory, `${name}.png`);
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
      await page.screenshot({ path: target, fullPage: true });
      report.screenshots.push(target);
    };

    stage = 'no calendar anchor means no guessed lessons';
    await page.goto(`${base}/workbench`, { waitUntil: 'domcontentloaded' });
    await waitStatus('#workbench-course-calendar-status', '请先填写');
    assert.doesNotMatch(
      await page.$eval('#workbench-campus-semester', (element) => element.textContent),
      /undefined/,
    );
    assert.equal(
      await page.$eval('#workbench-course-calendar', (element) => element.hidden),
      false,
    );
    assert.equal((await courseCards()).length, 0);
    assert.equal(preview.courseProjection().events.length, 0);
    assert.match(
      await page.$eval('#workbench-course-calendar-issues', (element) => element.textContent),
      /待补充周次的课程.*教学周/,
    );
    report.checks.push(
      'Synced course metadata is shown; no calendar anchor means no generated lessons',
    );

    stage = 'non-Monday input is rejected before writing';
    await fill('#workbench-course-calendar-monday', '2026-09-22');
    await page.click('#workbench-course-calendar-save');
    await waitStatus('#workbench-course-calendar-status', '必须是周一');
    assert.equal(calendarWrites().length, 0);
    assert.equal(preview.courseProjection().events.length, 0);
    report.checks.push('Tuesday anchor rejected in the browser with zero calendar writes');

    stage = 'valid Monday automatically projects fixed course schedules';
    const saved = await saveMonday('2026-09-21');
    assert.equal(saved.parsedCourses, 3);
    assert.equal(saved.totalCourses, 4);
    assert.equal(saved.scheduledLessons, 8);
    await page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 2,
      {},
      COURSE_SELECTOR,
    );
    const initialIds = courseIds();
    assert.equal(new Set(initialIds).size, 8);
    const digital = preview
      .courseProjection()
      .events.find((event) => event.title === '数字逻辑与处理器');
    assert.equal(digital.startAt, '2026-09-24T07:20:00.000Z');
    assert.equal(digital.endAt, '2026-09-24T08:55:00.000Z');
    assert.equal(digital.description, '六教 6A201 · 教师甲 · 第 1 教学周');
    assert.equal(
      preview.events.length,
      0,
      'Projected lessons must not create manual schedule rows',
    );
    assert.match(
      await page.$eval('#workbench-course-calendar-issues', (element) => element.textContent),
      /待补充周次的课程/,
    );
    report.projectedLessons = preview.courseProjection().events;
    report.checks.push(
      'Monday anchor creates 8 stable lessons for 3/4 courses; only 2 occur this week; incomplete course is reported',
    );

    stage = 'course timeline opens a read-only detail dialog';
    await page.click(`${COURSE_SELECTOR}[data-public-id="${digital.publicId}"]`);
    await page.waitForSelector('#workbench-course-calendar-detail[open]');
    assert.equal(
      await page.$eval('#workbench-course-calendar-title', (element) => element.textContent),
      '数字逻辑与处理器',
    );
    assert.match(
      await page.$eval('#workbench-course-calendar-time', (element) => element.textContent),
      /15:20.*16:55/,
    );
    assert.match(
      await page.$eval('#workbench-course-calendar-description', (element) => element.textContent),
      /六教 6A201.*教师甲.*第 1 教学周/,
    );
    assert.equal(
      await page.$$eval(
        '#workbench-course-calendar-detail input, #workbench-course-calendar-detail textarea',
        (elements) => elements.length,
      ),
      0,
    );
    assert.equal(await page.$eval('#workbench-schedule-dialog', (element) => element.open), false);
    await page.click('#workbench-course-calendar-close');
    await page.click('#workbench-view-toggle');
    const actions = await page.$$eval(
      '#workbench-schedule-list [data-workbench-action]',
      (elements) => elements.map((element) => element.dataset.workbenchAction),
    );
    assert.deepEqual(actions, ['view-course-schedule', 'view-course-schedule']);
    await page.click('#workbench-view-toggle');
    report.checks.push(
      'Timeline and list expose read-only course details, with no manual edit/delete actions',
    );

    stage = 'repeated saves and refreshed rooms retain stable lesson identities';
    await saveMonday('2026-09-21');
    assert.deepEqual(courseIds(), initialIds);
    assert.equal(preview.events.length, 0);
    preview.campusCourses[0].locationText = '六教 6A301（调换教室）';
    await refresh();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`.workbench-week-event[data-public-id="${id}"]`)
          ?.title.includes('6A301'),
      {},
      digital.publicId,
    );
    assert.deepEqual(courseIds(), initialIds);
    assert.equal((await courseCards()).length, 2);
    report.checks.push(
      'Repeated save produces no duplicates; changed room appears after refresh without new lesson IDs',
    );

    stage = 'AI fixed events and flexible plans respect course time';
    await generate('今天下午3点半开组会，持续1小时', 409);
    assert.equal(await page.$$eval('.workbench-agent-proposal', (elements) => elements.length), 0);
    const plan = await generate('接下来1天复习数字逻辑需要4小时', 200);
    assert.ok(plan.suggestions.length > 0);
    const overlap = (left, right) =>
      Date.parse(left.startAt) < Date.parse(right.endAt) &&
      Date.parse(right.startAt) < Date.parse(left.endAt);
    assert.equal(
      plan.suggestions.reduce(
        (total, item) => total + (Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000,
        0,
      ),
      240,
    );
    assert.equal(
      plan.suggestions.some((item) =>
        preview.courseProjection().events.some((course) => overlap(item, course)),
      ),
      false,
    );
    assert.equal(preview.events.length, 0);
    report.plan = plan.suggestions;
    report.checks.push(
      'Fixed event inside class is rejected; 4-hour flexible plan avoids all projected course periods and remains preview-only',
    );

    stage = 'course settings and read-only detail fit desktop/mobile in both themes';
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.body.classList.toggle('theme-light', value === 'light');
        document.body.classList.toggle('theme-dark', value === 'dark');
      }, theme);
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: 1000 });
        const collapsedCourses = await page.$(
          'details.personal-fold:has(#workbench-course-calendar):not([open]) > summary',
        );
        if (collapsedCourses) await collapsedCourses.click();
        const layout = await page.$eval('#workbench-course-calendar', (element) => ({
          width: element.getBoundingClientRect().width,
          fits: element.scrollWidth <= element.clientWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          visible: element.getBoundingClientRect().height > 0,
        }));
        report.layouts.push({ theme, width, ...layout });
        assert.ok(layout.fits && layout.pageFits && layout.visible, JSON.stringify(layout));
        await screenshot(`course-calendar-${theme}-${width}`);
      }
    }
    report.checks.push(
      '1440px/390px, light/dark: expanded calendar settings remain visible and fit the viewport',
    );

    stage = 'read-only course details fit the mobile viewport';
    await page.$eval(`${COURSE_SELECTOR}[data-public-id="${digital.publicId}"]`, (element) =>
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
    );
    await page.click(`${COURSE_SELECTOR}[data-public-id="${digital.publicId}"]`);
    await page.waitForSelector('#workbench-course-calendar-detail[open]');
    report.mobileDialog = await page.$eval('#workbench-course-calendar-detail', (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        fits:
          bounds.left >= 0 &&
          bounds.right <= window.innerWidth &&
          element.scrollWidth <= element.clientWidth,
      };
    });
    assert.ok(report.mobileDialog.fits, JSON.stringify(report.mobileDialog));
    await screenshot('course-detail-dark-390');
    await page.click('#workbench-course-calendar-close');
    report.checks.push('Read-only course detail opens from the mobile timeline and fits 390px');

    stage = 'calendar and dialog clear on logout';
    await page.setViewport({ width: 1440, height: 1000 });
    await page.click(`${COURSE_SELECTOR}[data-public-id="${digital.publicId}"]`);
    await page.waitForSelector('#workbench-course-calendar-detail[open]');
    await page.evaluate(() => {
      window.freeBbsApp.userState.isLoggedIn = false;
      window.dispatchEvent(new Event('freebbs:session-change'));
    });
    assert.equal(await page.$eval('#workbench-course-calendar', (element) => element.hidden), true);
    assert.equal(
      await page.$eval('#workbench-course-calendar-detail', (element) => element.open),
      false,
    );
    assert.equal(
      await page.$eval('#workbench-course-calendar-monday', (element) => element.value),
      '',
    );
    assert.equal((await courseCards()).length, 0);
    report.checks.push(
      'Logout hides the calendar, closes read-only details, clears saved input and projected timeline',
    );
    assert.deepEqual(errors, []);
    report.passed = true;
    console.log(
      `Workbench course calendar browser checks passed. Report and screenshots: ${directory}`,
    );
  } catch (error) {
    report.passed = false;
    report.failedStage = stage;
    report.failure = error.stack || error.message;
    if (page)
      await page
        .screenshot({ path: path.join(directory, 'failure.png'), fullPage: true })
        .catch(() => {});
    console.error(
      `Workbench course calendar browser failed during ${stage}. Artifacts: ${directory}`,
    );
    throw error;
  } finally {
    report.pageErrors = errors;
    report.calls = calls;
    fs.writeFileSync(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
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
