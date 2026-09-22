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
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-homework-browser-'));
  const homework = {
    sourceReference: 'learn:homework:fixture',
    courseReference: 'learn:course:fixture',
    title: '[电路原理] 第一次作业（模拟）',
    providerCourseId: 'course1',
    providerStudentHomeworkId: 'student1',
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
  const errors = [];
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
      if (url.pathname === '/api/workbench/schedule-items') {
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
          reply({ homework });
          return;
        }
        reply({
          items: emptyPartial ? [] : [homework],
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
    await assertCardLayout(page);
    await page.$eval('#workbench-homework', (element) => element.scrollIntoView());
    await (
      await page.$('#workbench-homework')
    ).screenshot({ path: path.join(directory, 'homework-desktop.png') });
    await page.click('.workbench-homework-item button');
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
    await page.click('.workbench-homework-item button');
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
    assert.equal(writes, 0);
    await page.evaluate(() => window.dispatchEvent(new Event('freebbs:campus-disconnected')));
    assert.equal(await page.$eval('#homework-dialog', (element) => element.open), false);
    assert.equal(await page.$$eval('.workbench-homework-item', (elements) => elements.length), 0);
    assert.deepEqual(errors, []);
    console.log(`Homework browser checks passed. Screenshots: ${directory}`);
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
