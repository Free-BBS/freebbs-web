/* eslint-disable max-classes-per-file */
// Account-free integration checks for manual types, per-card confirmation and notice layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const now = Date.parse('2026-09-30T00:00:00Z'); // Wednesday, not Monday.
  const { server, workbench } = createOnboardingPreview({ now: () => now });
  workbench.campusNotices.unshift(
    { title: '缺少时间的公告', publishedAt: null },
    { title: '无效时间的公告', publishedAt: 'not-a-date' },
  );
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-arrangements-'));
  let browser;
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
    }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      return url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
        ? req.continue()
        : req.abort();
    });
    await page.evaluateOnNewDocument((stamp) => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [stamp]));
        }

        static now() {
          return stamp;
        }
      };
    }, now);
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelectorAll('.workbench-campus-notice').length === 10,
    );
    const click = async (selector) => {
      await page.$eval(selector, (node) =>
        node.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await page.click(selector);
    };
    const fill = (selector, value) =>
      page.$eval(
        selector,
        (node, text) => {
          node.value = text;
          node.dispatchEvent(new Event('input', { bubbles: true }));
        },
        value,
      );
    const today = await page.evaluate(() => {
      const scroller = document.querySelector('.workbench-week-scroll');
      const box = document.querySelector('.workbench-week-day.is-today').getBoundingClientRect();
      return {
        scroll: scroller.scrollLeft,
        left: box.left,
        viewport: scroller.getBoundingClientRect().left,
      };
    });
    assert.ok(today.scroll > 0 && Math.abs(today.left - today.viewport) < 4, JSON.stringify(today));
    console.log('Wednesday opens at today');
    for (const width of [1600, 1024, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      for (const dark of [false, true]) {
        for (const typeScale of ['standard', 'large']) {
          await page.evaluate((isDark) => {
            if (document.body.classList.contains('theme-dark') !== isDark)
              window.freeBbsApp.toggleThemeMode();
          }, dark);
          await page.evaluate(
            (scale) =>
              window.freeBbsTypography.applyPreferences({
                fontPreset: scale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                typeScale: scale,
              }),
            typeScale,
          );
          const result = await page.evaluate(() => {
            const cols = [...document.querySelector('.workbench-campus-courses-layout').children];
            const list = document.querySelector('#workbench-campus-notice-list');
            return {
              heights: cols.map((node) => node.getBoundingClientRect().height),
              scroll: list.scrollHeight,
              client: list.clientHeight,
              overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
              titles: [...list.querySelectorAll('strong')].map((node) => node.textContent),
            };
          });
          assert.equal(result.overflow, false, `viewport ${width}`);
          assert.deepEqual(result.titles, [
            ...Array.from({ length: 8 }, (_, index) => `模拟公告 · 第 ${8 - index} 次课程提醒`),
            '缺少时间的公告',
            '无效时间的公告',
          ]);
          if (width > 1200) {
            assert.ok(Math.abs(result.heights[0] - result.heights[1]) < 2);
            assert.ok(result.scroll > result.client);
          }
        }
      }
    }
    await page.setViewport({ width: 1600, height: 1000 });
    await page.evaluate(() =>
      window.freeBbsTypography.applyPreferences({
        fontPreset: 'transistor-lab',
        typeScale: 'standard',
      }),
    );
    await click('#workbench-add-schedule');
    await page.select('#workbench-schedule-kind', 'deadline');
    await fill('#workbench-schedule-title', '科研申请 DDL');
    await fill('#workbench-schedule-end', '2026-10-01T23:59');
    await fill('#workbench-schedule-description', '无需网络学堂作业');
    await click('#workbench-schedule-submit');
    await page.waitForSelector('#workbench-schedule-dialog:not([open])');
    assert.equal(workbench.events.at(-1).kind, 'deadline');
    assert.equal(
      new Date(workbench.events.at(-1).endAt) - new Date(workbench.events.at(-1).startAt),
      60000,
    );
    await click('#workbench-add-schedule');
    await page.select('#workbench-schedule-kind', 'course');
    await fill('#workbench-schedule-title', '旁听 · 最优化');
    await fill('#workbench-schedule-description', '六教6C300');
    await fill('#workbench-schedule-start', '2026-10-02T13:30');
    await fill('#workbench-schedule-end', '2026-10-02T15:05');
    await fill('#workbench-course-count', '3');
    await click('#workbench-schedule-submit');
    await page.waitForSelector('#workbench-schedule-dialog:not([open])');
    assert.equal(workbench.events.filter((item) => item.kind === 'course').length, 3);
    console.log(
      'Unified manual event / DDL / course entry saves independent courses and deadlines',
    );

    await fill(
      '#workbench-agent-message',
      '明天上午8点读书1小时，9点开会1小时，10点讨论1小时，下午2点实验1小时，晚上11点之前提交报告',
    );
    await click('#workbench-agent-generate');
    await page.waitForFunction(
      () => document.querySelectorAll('.workbench-agent-proposal').length === 5,
    );
    const before = workbench.events.length;
    await fill('.workbench-agent-proposal:nth-child(3) .workbench-proposal-title', '');
    await fill(
      '.workbench-agent-proposal:nth-child(5) .workbench-proposal-description',
      '这个修改必须保留',
    );
    await click('.workbench-agent-proposal:first-child .workbench-proposal-confirm');
    await page.waitForFunction(
      () => document.querySelectorAll('.workbench-agent-proposal').length === 4,
    );
    assert.equal(workbench.events.length, before + 1);
    assert.equal(
      await page.$eval(
        '.workbench-agent-proposal:nth-child(2) .workbench-proposal-title',
        (node) => node.value,
      ),
      '',
    );
    assert.equal(
      await page.$eval('.workbench-agent-proposal:last-child textarea', (node) => node.value),
      '这个修改必须保留',
    );
    await fill(
      '.workbench-agent-proposal:nth-child(2) .workbench-proposal-title',
      '独立修改后的讨论',
    );
    await click('#workbench-agent-confirm');
    await page.waitForSelector('#workbench-agent-preview.hidden');
    assert.equal(workbench.events.length, before + 5);
    assert.equal(workbench.events.at(-1).kind, 'deadline');
    assert.equal(workbench.events.at(-1).description, '这个修改必须保留');
    console.log(
      'Five mixed events: individual confirmation preserves other edits; confirm-all does not duplicate',
    );

    // Opening all manual types remains usable on a narrow phone.
    await page.setViewport({ width: 320, height: 800 });
    await click('#workbench-add-schedule');
    for (const kind of ['event', 'deadline', 'course']) {
      await page.select('#workbench-schedule-kind', kind);
      const geometry = await page.$eval('#workbench-schedule-dialog', (node) => ({
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
        overflow: node.scrollWidth > node.clientWidth + 2,
      }));
      assert.ok(
        geometry.left >= 0 && geometry.right <= 321 && !geometry.overflow,
        JSON.stringify(geometry),
      );
    }
    await click('#workbench-schedule-dialog [data-workbench-dialog-close]');
    await page.setViewport({ width: 1600, height: 1000 });

    await page.goto(`${origin}/ranch-dye`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#dye-fieldset:not([disabled])');
    await click('#dye-center');
    await click('#dye-save');
    await page.waitForFunction(() =>
      document.querySelector('#dye-status').textContent.includes('已保存'),
    );
    await click('#dye-reset');
    assert.match(await page.$eval('#dye-status', (node) => node.textContent), /恢复原色.*保存/);
    await click('#dye-undo');
    await click('#dye-reset');
    await click('#dye-save');
    await page.waitForFunction(() =>
      document.querySelector('#dye-status').textContent.includes('已保存'),
    );
    const design = await (
      await fetch(`${origin}/api/ranch-designs/mine`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
    ).json();
    assert.equal(design.design.wool.base, null);
    assert.equal(design.design.wool.layers.length, 0);
    assert.equal(design.design.face.layers.length, 0);
    await page.goto(`${origin}/ranch`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ranch-study-enter', { visible: true });
    const alignment = await page.evaluate(() => {
      const study = document.querySelector('.ranch-study-enter');
      const pause = document.querySelector('.ranch-scene-pause');
      return {
        text: study.textContent,
        study: study.getBoundingClientRect().right,
        pause: pause.getBoundingClientRect().right,
      };
    });
    assert.equal(alignment.text, '学习背景');
    assert.ok(Math.abs(alignment.study - alignment.pause) < 2, JSON.stringify(alignment));
    await page.screenshot({ path: path.join(output, 'ranch-aligned.png') });
    assert.deepEqual(errors, []);
    console.log('Ranch reset persists default appearance; study button aligns without arrow');

    const sunday = Date.parse('2026-10-04T00:00:00Z');
    await page.evaluateOnNewDocument((stamp) => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [stamp]));
        }

        static now() {
          return stamp;
        }
      };
    }, sunday);
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    const sundayView = await page.evaluate(() => {
      const scroll = document.querySelector('.workbench-week-scroll');
      const todayBox = document
        .querySelector('.workbench-week-day.is-today')
        .getBoundingClientRect();
      const frame = scroll.getBoundingClientRect();
      return {
        visible: todayBox.left >= frame.left && todayBox.right <= frame.right + 1,
        scroll: scroll.scrollLeft,
      };
    });
    assert.ok(sundayView.visible && sundayView.scroll > 0, JSON.stringify(sundayView));
    await page.screenshot({ path: path.join(output, 'workbench-today.png'), fullPage: true });
    console.log('Sunday also opens with today visible');
    console.log(output);
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
