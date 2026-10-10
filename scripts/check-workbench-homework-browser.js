// Run with an installed Puppeteer module (PUPPETEER_MODULE may specify its location).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

async function main() {
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html' },
    previewApiHandler: createWorkbenchPreviewApi().handle,
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  server.on('connect', (_request, socket) => {
    socket.on('error', () => {});
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--proxy-server=${base}`, '--disable-background-networking'],
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-homework-browser-'));
  const homework = {
    sourceReference: 'learn:homework:fixture',
    courseReference: 'learn:course:fixture',
    title: '[电路原理] 第一次作业（模拟）',
    providerCourseId: 'course1',
    providerStudentHomeworkId: 'student1',
    actionUrl:
      'https://learn.tsinghua.edu.cn/f/wlxt/kczy/zy/student/tijiao?wlkcid=course1&xszyid=student1',
    status: 'unsubmitted',
    submissionType: 2,
    completionType: 1,
    dueAt: '2030-01-01T00:00:00Z',
    description:
      '计算电路中的电流，说明 x < 5 的条件。\n本页为模拟数据。<script>window.homeworkXss=true</script>',
    attachments: [{ id: 'question1', role: 'assignment', name: '作业要求.pdf' }],
    submittedContent: '',
    maxFileBytes: 20 * 1024 * 1024,
    blockedReason: '',
    lastAttempt: null,
  };
  let writes = 0;
  let emptyPartial = false;
  let calendarCompleted = false;
  let lastSuccessfulSyncAt = new Date().toISOString();
  let upstreamPublished = false;
  let importedNewHomework = false;
  let syncRequests = 0;
  let scheduleRequests = 0;
  let detailRequests = 0;
  let holdLiveForStaleList = false;
  let releaseHeldDetail = null;
  let releaseStaleList = null;
  const extraHomework = {
    ...homework,
    sourceReference: 'learn:homework:new',
    title: '无需重登的新作业 DDL',
  };
  const errors = [];
  let failurePage;
  async function clickControl(page, selector) {
    await page.$eval(selector, (element) =>
      element.scrollIntoView({ block: 'center', inline: 'center' }),
    );
    await page.waitForFunction(
      (target) => {
        const element = document.querySelector(target);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      },
      {},
      selector,
    );
    await page.locator(selector).click();
  }
  async function localTab() {
    const tab = await browser.newPage();
    await tab.setRequestInterception(true);
    tab.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === base || url.protocol === 'about:' || url.protocol === 'data:')
        request.continue();
      else request.abort('blockedbyclient');
    });
    return tab;
  }
  async function assertCardLayout(page) {
    const geometry = await page.$eval('#workbench-homework', (element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        viewportWidth: window.innerWidth,
        gridWidth: element.parentElement.getBoundingClientRect().width,
        ancestors: (() => {
          const result = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            result.push([parent.className, parent.getBoundingClientRect().width]);
          }
          return result;
        })(),
        overflow: element.scrollWidth > element.clientWidth,
        filtersFit: [...element.querySelectorAll('select, #homework-refresh')].every((control) => {
          const bounds = control.getBoundingClientRect();
          return bounds.left >= rect.left && bounds.right <= rect.right && bounds.height >= 40;
        }),
      };
    });
    assert.ok(
      Math.abs(geometry.width - geometry.gridWidth) < 2,
      `Homework card must span the dashboard: ${JSON.stringify(geometry)}`,
    );
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.width <= geometry.viewportWidth, JSON.stringify(geometry));
    assert.equal(geometry.filtersFit, true);
  }
  try {
    const page = await browser.newPage();
    failurePage = page;
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const reply = (body) =>
        request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      if (url.origin !== base) {
        request.respond({ status: 204 });
        return;
      }
      if (url.pathname === '/api/workbench/connectors/tsinghua/status') {
        reply({
          connector: {
            configuration: { state: 'direct_cas' },
            connection: { status: 'active_verified', lastSuccessfulSyncAt },
            sync: { available: true, minimumIntervalSeconds: 300 },
            safeguards: {
              acceptsPasswordFromBrowser: true,
              acceptsCookieFromBrowser: false,
              storesPassword: false,
              sessionCookiesEncryptedAtRest: true,
            },
          },
        });
        return;
      }
      if (
        url.pathname === '/api/workbench/connectors/tsinghua/sync-runs' &&
        request.method() === 'POST'
      ) {
        syncRequests += 1;
        importedNewHomework = upstreamPublished;
        lastSuccessfulSyncAt = new Date().toISOString();
        reply({ run: { publicId: 'homework-sync-fixture', status: 'succeeded' } });
        return;
      }
      if (url.pathname === '/api/workbench/connectors/tsinghua/sync-runs/homework-sync-fixture') {
        reply({ run: { publicId: 'homework-sync-fixture', status: 'succeeded' } });
        return;
      }
      if (url.pathname === '/api/workbench/important-items') {
        reply({
          importantItems: calendarCompleted
            ? []
            : [
                {
                  publicId: 'wi_homework',
                  title: homework.title,
                  status: 'confirmed',
                  priority: 'normal',
                  sourceType: 'network_classroom',
                  dueAt: homework.dueAt,
                  actionUrl: homework.actionUrl,
                },
              ],
        });
        return;
      }
      if (url.pathname === '/api/workbench/schedule-items') {
        scheduleRequests += 1;
        const due = new Date(new Date(url.searchParams.get('from')).getTime() + 86400000);
        reply({
          scheduleItems: [
            {
              publicId: 'hw:fixture',
              homeworkReference: 'fixture',
              title: '作业 DDL',
              startAt: new Date(due.getTime() - 60000).toISOString(),
              endAt: due.toISOString(),
              kind: 'deadline',
              sourceType: 'network_classroom',
              completed: calendarCompleted,
              status: calendarCompleted ? 'completed' : 'confirmed',
            },
            ...(importedNewHomework
              ? [
                  {
                    publicId: 'hw:new',
                    homeworkReference: 'new',
                    title: extraHomework.title,
                    startAt: new Date(due.getTime() + 86400000 - 60000).toISOString(),
                    endAt: new Date(due.getTime() + 86400000).toISOString(),
                    kind: 'deadline',
                    sourceType: 'network_classroom',
                    completed: false,
                    status: 'confirmed',
                  },
                ]
              : []),
          ],
        });
        return;
      }
      if (url.pathname === '/api/workbench/homework-deadlines/fixture/completion') {
        calendarCompleted = JSON.parse(request.postData()).completed;
        reply({ completed: calendarCompleted });
        return;
      }
      if (url.pathname === '/api/workbench/campus/semesters') {
        reply({
          currentSemesterId: '2026-2027-1',
          semesters: [{ id: '2026-2027-1', label: '2026 秋', synced: true, courseCount: 1 }],
        });
        return;
      }
      if (url.pathname === '/api/workbench/campus/semesters/2026-2027-1') {
        reply({
          semester: {
            id: '2026-2027-1',
            courses: [
              { sourceReference: homework.courseReference, title: '电路原理', teacher: '模拟教师' },
            ],
            notifications: [],
            fetchedAt: new Date().toISOString(),
          },
        });
        return;
      }
      if (url.pathname.startsWith('/api/workbench/connectors/tsinghua/homework/')) {
        if (!['GET', 'HEAD'].includes(request.method())) {
          writes += 1;
          request.respond({ status: 405 });
          return;
        }
        if (url.pathname.includes('/attachments/')) {
          request.respond({
            status: 200,
            contentType: 'application/octet-stream',
            body: 'fixture attachment',
          });
          return;
        }
        if (url.pathname.includes('/items/')) {
          detailRequests += 1;
          const liveReply = () => {
            if (homework.status === 'submitted' || homework.status === 'graded')
              calendarCompleted = true;
            reply({ homework });
          };
          if (holdLiveForStaleList) releaseHeldDetail = liveReply;
          else liveReply();
          return;
        }
        if (holdLiveForStaleList) {
          holdLiveForStaleList = false;
          const stale = { ...homework, status: 'unsubmitted' };
          releaseStaleList = () =>
            reply({
              items: [stale, extraHomework],
              fetchedAt: '2040-01-01T00:00:00Z',
              syncStatus: 'complete',
            });
          releaseHeldDetail?.();
          return;
        }
        reply({
          items: emptyPartial ? [] : [homework, ...(importedNewHomework ? [extraHomework] : [])],
          fetchedAt: new Date().toISOString(),
          syncStatus: emptyPartial ? 'partial' : 'complete',
        });
        return;
      }
      request.continue();
    });
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.workbench-homework-item');
    const calendarToggle =
      '#workbench-week-grid [data-workbench-action="toggle-homework-completion"]';
    await page.waitForSelector(calendarToggle);
    assert.equal(await page.$$eval(calendarToggle, (entries) => entries.length), 1);
    assert.match(
      await page.$eval(calendarToggle, (entry) =>
        entry.closest('section').getAttribute('aria-label'),
      ),
      /周二/,
    );
    await page.click(calendarToggle);
    await page.waitForSelector(`${calendarToggle}.is-completed`);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector(`${calendarToggle}.is-completed`);
    await page.click(calendarToggle);
    await page.waitForSelector(`${calendarToggle}[aria-pressed="false"]`);
    // Dismiss the floating helper before resizing: its open bubble intentionally
    // overlays the narrow-screen homework controls.
    if (await page.$('#workbench-companion-collapse'))
      await page.click('#workbench-companion-collapse');
    await assertCardLayout(page);
    await page.$eval('#workbench-homework', (element) => element.scrollIntoView());
    await (
      await page.$('#workbench-homework')
    ).screenshot({ path: path.join(directory, 'homework-desktop.png') });
    await clickControl(page, '.workbench-homework-item button');
    await page.waitForFunction(() =>
      document.querySelector('#homework-detail').textContent.includes('计算电路'),
    );
    assert.equal(await page.$('#homework-detail form'), null);
    assert.equal(await page.$('#homework-detail input[type=file]'), null);
    assert.equal(await page.evaluate(() => window.homeworkXss), undefined);
    await page.setViewport({ width: 390, height: 844 });
    await (
      await page.$('#homework-dialog')
    ).screenshot({ path: path.join(directory, 'homework-mobile.png') });
    assert.ok(
      await page.$eval('#homework-dialog', (element) => element.scrollWidth <= element.clientWidth),
    );
    await page.click('#homework-close');
    // A real tab switch, not a synthetic visibilitychange or session reset:
    // upstream publishes while this authenticated workbench is backgrounded.
    const tokenBefore = await page.evaluate(() => window.freeBbsApp.userState.token);
    const tab = await localTab();
    await tab.goto('about:blank');
    await tab.bringToFront();
    await page.waitForFunction(() => document.hidden);
    upstreamPublished = true;
    lastSuccessfulSyncAt = '2000-01-01T00:00:00Z';
    const previousScheduleRequests = scheduleRequests;
    await page.bringToFront();
    await page.waitForSelector('#workbench-week-grid [data-public-id="hw:new"]');
    await page.waitForFunction(() =>
      document.querySelector('#homework-list').textContent.includes('无需重登的新作业'),
    );
    assert.ok(scheduleRequests > previousScheduleRequests);
    assert.equal(syncRequests, 1, 'foreground sync must not loop or require a new login');
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.token), tokenBefore);
    await tab.close();

    // A direct important-item link must also recheck the one clicked homework
    // on return, even when the full sync was just done and no detail is open.
    const directDetailCount = detailRequests;
    const popupTarget = browser.waitForTarget((target) => target.opener() === page.target());
    await page.click('#workbench-priority-list a');
    const directTab = await (await popupTarget).page();
    await directTab.goto(`${base}/electromagnetic`, { waitUntil: 'networkidle0' });
    await directTab.bringToFront();
    await page.waitForFunction(() => document.hidden);
    homework.status = 'submitted';
    holdLiveForStaleList = true;
    await page.bringToFront();
    await page.waitForSelector(`${calendarToggle}[data-public-id="hw:fixture"].is-completed`);
    assert.ok(releaseStaleList, 'the cached list read must precede the verified detail reply');
    releaseStaleList();
    await page.waitForFunction(() =>
      document.querySelector('#homework-message').textContent.includes('2040'),
    );
    await page.waitForFunction(
      () => !document.querySelector('#workbench-priority-list').textContent.includes('第一次作业'),
    );
    assert.equal(await page.$eval('#homework-dialog', (element) => element.open), false);
    assert.equal(detailRequests, directDetailCount + 1);
    assert.equal(syncRequests, 1);
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.token), tokenBefore);
    await directTab.close();
    homework.status = 'unsubmitted';
    calendarCompleted = false;
    await page.click('#homework-refresh');
    await page.waitForFunction(() =>
      document.querySelector('#homework-list').textContent.includes('第一次作业'),
    );
    await page.waitForFunction(() =>
      document.querySelector('#workbench-priority-list').textContent.includes('第一次作业'),
    );

    // The live status check updates both the visible homework list and DDL /
    // important-items projections in this same session, without a page reload.
    await page.setViewport({ width: 1440, height: 1000 });
    await clickControl(page, '.workbench-homework-item button');
    await page.waitForFunction(() =>
      document.querySelector('#homework-detail').textContent.includes('未交'),
    );
    const detailRequestsBefore = detailRequests;
    const submissionTab = await localTab();
    await submissionTab.goto(`${base}/electromagnetic`, { waitUntil: 'networkidle0' });
    await submissionTab.bringToFront();
    await page.waitForFunction(() => document.hidden);
    homework.status = 'submitted';
    await page.bringToFront();
    await page.waitForFunction(() =>
      document.querySelector('#homework-detail').textContent.includes('已交'),
    );
    await page.waitForSelector(`${calendarToggle}[data-public-id="hw:fixture"].is-completed`);
    await page.waitForFunction(
      () => !document.querySelector('#workbench-priority-list').textContent.includes('第一次作业'),
    );
    assert.doesNotMatch(
      await page.$eval('#homework-list', (element) => element.textContent),
      /第一次作业/,
    );
    assert.equal(await page.evaluate(() => window.freeBbsApp.userState.token), tokenBefore);
    assert.equal(
      detailRequests,
      detailRequestsBefore + 1,
      'open detail performs exactly one automatic readonly recheck',
    );
    assert.equal(syncRequests, 1, 'recent full synchronization remains throttled');
    await submissionTab.close();
    await page.click('#homework-close');
    await page.select('#homework-status-filter', '');
    assert.match(await page.$eval('#homework-list', (element) => element.textContent), /已交/);
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.evaluate((value) => {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(value);
        document.querySelector('#homework-course option:last-child').textContent =
          '电路原理与电子系统综合实验课程名称较长的情况';
      }, theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewport({ width, height: 900 });
        await assertCardLayout(page);
      }
    }
    await page.setViewport({ width: 390, height: 844 });
    await (
      await page.$('#workbench-homework')
    ).screenshot({ path: path.join(directory, 'homework-mobile-card.png') });
    homework.deadlineUnverified = true;
    homework.dueAt = null;
    homework.lastAttempt = null;
    homework.blockedReason = '截止时间待核对，请在网络学堂确认并提交。';
    await page.click('#homework-refresh');
    await page.waitForFunction(() =>
      document.querySelector('#homework-list').textContent.includes('待核对'),
    );
    await clickControl(page, '.workbench-homework-item button');
    await page.waitForFunction(() =>
      document.querySelector('#homework-detail').textContent.includes('待核对'),
    );
    assert.equal(await page.$('.workbench-homework-form'), null);
    await page.click('#homework-close');
    emptyPartial = true;
    await page.click('#homework-refresh');
    await page.waitForFunction(() =>
      document.querySelector('#homework-list').textContent.includes('尚未完整同步'),
    );
    await page.select('#homework-status-filter', 'submitted');
    assert.match(
      await page.$eval('#homework-list', (element) => element.textContent),
      /不能确认该学期没有作业/,
    );
    // Header arrival and delayed JSON are separate awaits. Logging out in
    // between must discard the old private body, close the dialog and keep
    // owned homework empty; use the app's real logout/session-change path.
    emptyPartial = false;
    await page.select('#homework-status-filter', '');
    await clickControl(page, '#homework-refresh');
    await page.waitForSelector('.workbench-homework-item button');
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]).includes('/homework/semesters/') && String(args[0]).includes('/items/'))
          return {
            ok: true,
            json: () =>
              new Promise((resolve) => {
                window.homeworkQaLateBodyWaiting = true;
                window.homeworkQaLateReply = () =>
                  resolve({
                    homework: {
                      sourceReference: 'learn:homework:fixture',
                      title: '旧用户私有迟到正文',
                      submittedContent: '旧用户私有迟到正文',
                      status: 'submitted',
                    },
                  });
              }),
          };
        return originalFetch(...args);
      };
    });
    await clickControl(page, '.workbench-homework-item button');
    await page.waitForFunction(() => window.homeworkQaLateBodyWaiting === true);
    await page.evaluate(() => {
      window.freeBbsApp.clearSession();
      window.homeworkQaLateReply();
    });
    await page.waitForFunction(
      () =>
        !document.querySelector('#homework-dialog').open &&
        document.querySelectorAll('.workbench-homework-item').length === 0,
    );
    assert.doesNotMatch(
      await page.$eval('#workbench-homework', (element) => element.textContent),
      /旧用户私有迟到正文/,
    );
    assert.equal(writes, 0);
    await page.evaluate(() => window.dispatchEvent(new Event('freebbs:campus-disconnected')));
    assert.equal(await page.$eval('#homework-dialog', (element) => element.open), false);
    assert.equal(await page.$$eval('.workbench-homework-item', (elements) => elements.length), 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        foregroundSyncRequests: syncRequests,
        detailRequests,
        scheduleRequests,
        pageErrors: errors.length,
      }),
    );
    console.log(`Homework browser checks passed. Screenshots: ${directory}`);
  } catch (error) {
    console.error('Original homework failure', error);
    await failurePage?.screenshot({ path: path.join(directory, 'failure.png') });
    console.error(
      'Homework diagnostic',
      directory,
      await failurePage?.evaluate(() => {
        const button = document.getElementById('homework-refresh');
        if (!button)
          return { url: window.location.href, text: document.body.textContent.slice(0, 400) };
        const rect = button.getBoundingClientRect();
        return {
          message: document.getElementById('homework-message').textContent,
          list: document.getElementById('homework-list').textContent,
          filter: document.getElementById('homework-status-filter').value,
          refreshTarget: document
            .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.outerHTML?.slice(0, 400),
        };
      }),
    );
    throw error;
  } finally {
    await browser.close();
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
