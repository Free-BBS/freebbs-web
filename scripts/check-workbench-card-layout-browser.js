// Read-only browser QA against loopback-only fixtures. Never uses production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

const NOW = Date.parse('2026-09-24T06:00:00Z');
const date = (day, time) => new Date(`2026-09-${day}T${time}:00+08:00`).toISOString();
const event = (publicId, day, start, end, title, description, extra = {}) => ({
  publicId,
  title,
  description,
  startAt: date(day, start),
  endAt: date(day, end),
  allDay: false,
  status: 'confirmed',
  sourceType: 'manual',
  kind: 'event',
  version: 1,
  ...extra,
});

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-workbench-card-layout-'));
  const preview = createWorkbenchPreviewApi({ now: () => NOW });
  const fixtures = [
    event('one-hour', 24, '21:02', '22:02', '实验室例会', '罗姆楼 5103\n带电脑和实验记录'),
    event('five-minute', 21, '08:00', '08:05', '领取实验器材', '实验室 301\n核对清单后交接'),
    event('adjacent', 21, '08:05', '08:10', '归还门禁卡', '罗姆楼一层服务台'),
    event('overlap', 21, '08:02', '09:00', '同时进行的实验进度讨论', '六教 6A201\n请带上电路图'),
    event('later', 21, '14:00', '15:00', '下午安排', '线上会议'),
    event(
      'long-text',
      22,
      '17:10',
      '18:45',
      '电子工程系学生自主学习与科研协同平台项目阶段工作交流及下阶段任务安排',
      '罗姆楼 10-206\n请携带电脑、实验记录和上周的问题清单。\n本次交流需要逐项说明进展及后续协作需求。',
    ),
    event(
      'last-minute',
      27,
      '23:59',
      '23:59',
      '日末核对与明日准备',
      '宿舍\n检查数据备份并整理桌面',
    ),
    event('course', 23, '13:30', '15:05', '数字逻辑与处理器', '六教 6A201\n教师甲 · 第 1 教学周', {
      courseScheduleReference: 'course-layout-fixture',
      sourceType: 'network_classroom',
      kind: 'course',
    }),
    event('all-day', 25, '00:00', '23:59', '全天实验安排', '微纳加工中心', { allDay: true }),
    event('deadline', 26, '23:58', '23:59', '提交项目报告', '上传最终 PDF 及源文件', {
      kind: 'deadline',
    }),
  ];
  // The final minute is a valid one-minute interval ending at next midnight.
  fixtures.find((item) => item.publicId === 'last-minute').endAt = date(28, '00:00');
  preview.events.splice(0, preview.events.length, ...fixtures);
  const before = structuredClone(preview.events);
  const errors = [];
  const mutations = [];
  const report = { layouts: [], checks: [], screenshots: [] };
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html' },
    previewApiHandler: async (request) => {
      if (request.route.startsWith('/api/workbench/') && !['GET', 'HEAD'].includes(request.method))
        mutations.push({ route: request.route, method: request.method });
      return preview.handle(request);
    },
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  let stage = 'launch';
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: path.join(directory, 'chrome-profile'),
      ...(process.env.CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
        : {}),
    });
    page = await browser.newPage();
    await page.emulateTimezone('Asia/Shanghai');
    await page.setViewport({ width: 1440, height: 1000 });
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
    await page.goto(`${base}/workbench`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.workbench-week-event[data-public-id="one-hour"]');
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        await Promise.all(
          document.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    const inspect = () =>
      page.evaluate(() => {
        const rect = (element) => {
          const { top, bottom, left, right, width, height } = element.getBoundingClientRect();
          return { top, bottom, left, right, width, height };
        };
        const cards = [...document.querySelectorAll('.workbench-week-event')].map((element) => {
          const box = rect(element);
          const timeline = element.closest('.workbench-week-timeline');
          return {
            id: element.dataset.publicId,
            text: element.textContent,
            box,
            timeline: timeline ? rect(timeline) : null,
            title: element.querySelector('strong')?.textContent,
            description: element.querySelector('.workbench-week-notes')?.textContent,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            runs: [...element.querySelectorAll('strong, .workbench-week-notes')].flatMap(
              (child) => {
                const range = document.createRange();
                range.selectNodeContents(child);
                return [...range.getClientRects()].map((run) => ({
                  top: run.top,
                  bottom: run.bottom,
                  left: run.left,
                  right: run.right,
                }));
              },
            ),
          };
        });
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          cards,
          timelineHeights: [...document.querySelectorAll('.workbench-week-timeline')].map(
            (element) => element.getBoundingClientRect().height,
          ),
        };
      });
    const checkLayout = (layout, label) => {
      assert.ok(layout.overflow <= 2, `${label}: document overflows ${layout.overflow}px`);
      for (const item of fixtures) {
        const card = layout.cards.find((candidate) => candidate.id === item.publicId);
        assert.ok(card, `${label}: missing ${item.publicId}`);
        assert.ok(card.title.includes(item.title), `${label}: incomplete title ${item.publicId}`);
        assert.equal(
          card.description,
          item.description,
          `${label}: incomplete notes ${item.publicId}`,
        );
        assert.ok(
          card.scrollHeight <= card.clientHeight + 1,
          `${label}: clipped height ${item.publicId}`,
        );
        assert.ok(
          card.scrollWidth <= card.clientWidth + 1,
          `${label}: clipped width ${item.publicId}`,
        );
        for (const run of card.runs) {
          assert.ok(
            run.top >= card.box.top - 1 &&
              run.bottom <= card.box.bottom + 1 &&
              run.left >= card.box.left - 1 &&
              run.right <= card.box.right + 1,
            `${label}: actual glyphs outside card ${item.publicId}`,
          );
        }
        if (card.timeline) {
          assert.doesNotMatch(
            card.text,
            /\d{2}:\d{2}/,
            `${label}: ordinary time still consumes card space`,
          );
          assert.ok(
            card.box.bottom <= card.timeline.bottom + 1,
            `${label}: day-end clipping ${item.publicId}`,
          );
          const start = new Date(item.startAt);
          const minute = ((start.getUTCHours() + 8) % 24) * 60 + start.getUTCMinutes();
          const expectedTop = ((minute - 6 * 60) / 60) * 40;
          assert.ok(
            Math.abs(card.box.top - card.timeline.top - expectedTop) <= 2,
            `${label}: shifted true start position ${item.publicId}`,
          );
        }
      }
      const timed = layout.cards.filter((card) => card.timeline);
      for (let first = 0; first < timed.length; first += 1) {
        for (let second = first + 1; second < timed.length; second += 1) {
          const a = timed[first];
          const b = timed[second];
          const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
          const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
          assert.ok(
            overlapX <= 1 || overlapY <= 1,
            `${label}: visible cards overlap ${a.id}/${b.id}`,
          );
        }
      }
      assert.ok(
        Math.max(...layout.timelineHeights) - Math.min(...layout.timelineHeights) <= 1,
        `${label}: day timelines must share height`,
      );
    };

    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        for (const fontPreset of [
          'transistor-lab',
          'zhongsong-study',
          'quantum-board',
          'night-oscilloscope',
        ]) {
          for (const typeScale of ['standard', 'large']) {
            stage = `${width} ${theme} ${fontPreset} ${typeScale}`;
            await page.evaluate(
              (preferences) => {
                document.body.classList.toggle('theme-light', preferences.theme === 'light');
                document.body.classList.toggle('theme-dark', preferences.theme === 'dark');
                window.freeBbsTypography.applyPreferences(preferences);
              },
              { theme, fontPreset, typeScale },
            );
            await settle();
            const layout = await inspect();
            report.layouts.push({ label: stage, ...layout });
            checkLayout(layout, stage);
          }
        }
        await page.$eval('.workbench-week-event[data-public-id="one-hour"]', (element) =>
          element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
        );
        const target = path.join(directory, `cards-${width}-${theme}.png`);
        await page.screenshot({ path: target });
        report.screenshots.push(target);
      }
    }
    report.checks.push(
      '32 viewport/theme/font/scale combinations: complete titles and multiline notes, no card collisions, no document overflow',
    );
    report.checks.push(
      '5-minute, adjacent, overlapping, 21:02 one-hour and 23:59 cards retain real start coordinates and fit equal-height day timelines',
    );

    stage = 'capture dense, multiline and day-end layouts';
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      document.body.classList.add('theme-light');
      document.body.classList.remove('theme-dark');
      window.freeBbsTypography.applyPreferences({
        fontPreset: 'transistor-lab',
        typeScale: 'large',
      });
    });
    await settle();
    for (const id of ['five-minute', 'long-text', 'last-minute']) {
      await page.$eval(`.workbench-week-event[data-public-id="${id}"]`, (element) => {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      });
      const target = path.join(directory, `detail-${id}.png`);
      await page.screenshot({ path: target });
      report.screenshots.push(target);
    }

    stage = 'click manual card shows exact times without writing';
    const clickCentered = async (selector) => {
      await page.$eval(selector, (element) =>
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
      );
      await page.click(selector);
    };
    await clickCentered('.workbench-week-event[data-public-id="one-hour"]');
    await page.waitForSelector('#workbench-schedule-dialog[open]');
    assert.equal(
      await page.$eval('#workbench-schedule-start', (element) => element.value),
      '2026-09-24T21:02',
    );
    assert.equal(
      await page.$eval('#workbench-schedule-end', (element) => element.value),
      '2026-09-24T22:02',
    );
    assert.equal(
      await page.$eval('#workbench-schedule-description', (element) => element.value),
      fixtures[0].description,
    );
    await clickCentered('#workbench-schedule-dialog [data-workbench-dialog-close]');

    stage = 'click fixed course shows read-only time';
    await clickCentered('.workbench-week-event[data-public-id="course"]');
    await page.waitForSelector('#workbench-course-calendar-detail[open]');
    assert.match(
      await page.$eval('#workbench-course-calendar-time', (element) => element.textContent),
      /13:30.*15:05/,
    );
    assert.equal(
      await page.$eval('#workbench-course-calendar-description', (element) => element.textContent),
      fixtures.find((item) => item.publicId === 'course').description,
    );
    await clickCentered('#workbench-course-calendar-close');
    assert.deepEqual(preview.events, before);
    assert.deepEqual(mutations, []);
    assert.deepEqual(errors, []);
    report.checks.push(
      'Manual and fixed-course card clicks show exact times and full notes; no workbench mutation requests or fixture changes',
    );
    report.passed = true;
    console.log(`Workbench card layout browser passed. Artifacts: ${directory}`);
  } catch (error) {
    report.passed = false;
    report.failedStage = stage;
    report.failure = error.stack || error.message;
    if (page)
      await page
        .screenshot({ path: path.join(directory, 'failure.png'), fullPage: true })
        .catch(() => {});
    console.error(`Workbench card layout browser failed at ${stage}. Artifacts: ${directory}`);
    throw error;
  } finally {
    report.pageErrors = errors;
    report.mutations = mutations;
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
