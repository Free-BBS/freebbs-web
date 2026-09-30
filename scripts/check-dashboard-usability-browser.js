const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');
const { compareHomework, isPending } = require('../public/workbench-homework');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-dashboard-usability-'));
  const { server, homework } = await createDashboardUsabilityPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let stage = 'setup';
  const errors = [];
  const measurements = [];
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id])
      await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      return url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
        ? request.continue()
        : request.respond({ status: 204 });
    });
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    const preferences = async (width, theme) => {
      await page.setViewport({ width, height: 1000 });
      await page.evaluate((mode) => {
        document.body.classList.toggle('theme-light', mode === 'light');
        document.body.classList.toggle('theme-dark', mode === 'dark');
        window.freeBbsTypography?.applyPreferences({
          fontPreset: 'zhongsong-study',
          typeScale: 'large',
        });
      }, theme);
      await settle();
    };
    stage = 'pressed thread controls';
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`${origin}/discussion?post=101`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#comment-1010 .discussion-comment-thread-toggle');
    for (const width of [1600, 1000]) {
      for (const laser of [false, true]) {
        await preferences(width, laser ? 'dark' : 'light');
        await page.evaluate(
          (value) =>
            document
              .querySelectorAll('.discussion-comment')
              .forEach((element) => element.classList.toggle('has-laser-glow', value)),
          laser,
        );
        for (const id of [1010, 1012])
          for (const expanded of [false, true]) {
            const selector = `#comment-${id} .discussion-comment-thread-toggle`;
            await page.evaluate(
              ({ id: commentId, expanded: shouldExpand }) => {
                for (const parent of [1010, 1011]) {
                  const button = document.querySelector(
                    `#comment-${parent} .discussion-comment-thread-toggle`,
                  );
                  if (parent < commentId && button.getAttribute('aria-expanded') === 'false')
                    button.click();
                }
                const button = document.querySelector(
                  `#comment-${commentId} .discussion-comment-thread-toggle`,
                );
                if (button.getAttribute('aria-expanded') !== String(shouldExpand)) button.click();
                button.scrollIntoView({ block: 'center', behavior: 'instant' });
              },
              { id, expanded },
            );
            await settle();
            const before = await page.$eval(selector, (button) => {
              const rect = button.getBoundingClientRect();
              return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
            });
            // Keep the pointer on the circle's upper-left through the active transition.
            await page.mouse.move(before.x + before.w / 2 - 6, before.y + before.h / 2 - 6);
            await page.mouse.down();
            await new Promise((resolve) => {
              setTimeout(resolve, 300);
            });
            const pressed = await page.$eval(selector, (button) => {
              const rect = button.getBoundingClientRect();
              return { x: rect.x, y: rect.y };
            });
            await page.mouse.up();
            assert.ok(
              Math.abs(pressed.x - before.x) < 0.5 && Math.abs(pressed.y - before.y) < 0.5,
              JSON.stringify({ width, id, expanded, before, pressed }),
            );
            assert.equal(
              await page.$eval(selector, (button) => button.getAttribute('aria-expanded')),
              String(!expanded),
            );
          }
      }
    }
    stage = 'seven-day calendar and homework';
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.workbench-homework-item');
    await page.click('#workbench-companion-collapse');
    const pending = homework
      .filter(isPending)
      .sort(compareHomework)
      .map((item) => item.title);
    const titles = () =>
      page.$$eval('.workbench-homework-item > strong', (nodes) =>
        nodes.map((node) => node.textContent),
      );
    assert.equal(
      await page.$eval('#homework-status-filter', (element) => element.value),
      'pending',
    );
    assert.deepEqual(await titles(), pending);
    for (const width of [1920, 1600, 1440, 1366, 1000, 390])
      for (const theme of ['light', 'dark']) {
        await preferences(width, theme);
        const geometry = await page.evaluate(() => {
          const scroll = document.querySelector('.workbench-week-scroll');
          const cards = [...document.querySelectorAll('.workbench-homework-item')];
          const list = document.getElementById('homework-list');
          return {
            sidebarWidth: document
              .querySelector('.workbench-persistent-column')
              .getBoundingClientRect().width,
            columnGap: getComputedStyle(document.querySelector('.workbench-view-layout')).columnGap,
            calendarWidth: scroll.clientWidth,
            calendarScroll: scroll.scrollWidth,
            columns: [...document.querySelectorAll('.workbench-week-day')].map(
              (day) => day.getBoundingClientRect().width,
            ),
            homeworkRows: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)))
              .size,
            homeworkOverflow: list.scrollWidth > list.clientWidth,
            pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        });
        measurements.push({ width, theme, ...geometry });
        assert.equal(geometry.columns.length, 7);
        if (width >= 1366)
          assert.ok(
            geometry.calendarScroll <= geometry.calendarWidth + 1,
            JSON.stringify(geometry),
          );
        if (width >= 901) {
          assert.ok(geometry.sidebarWidth <= 221, JSON.stringify(geometry));
          assert.equal(geometry.columnGap, '12px');
        }
        assert.equal(geometry.homeworkRows, 1);
        assert.equal(geometry.homeworkOverflow, true);
        assert.equal(geometry.pageOverflow, false);
        if ([1440, 390].includes(width)) {
          await page.$eval('#workbench-calendar', (node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await page.screenshot({
            path: path.join(output, `calendar-${width}-${theme}.png`),
          });
          await page.$eval('#workbench-homework', (node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await page.screenshot({
            path: path.join(output, `homework-${width}-${theme}.png`),
          });
        }
      }
    await page.click('#homework-next');
    await page.waitForFunction(() => document.getElementById('homework-list').scrollLeft > 0);
    await page.select('#homework-status-filter', '');
    assert.deepEqual(
      await titles(),
      [...homework].sort(compareHomework).map((item) => item.title),
    );
    await page.select('#homework-status-filter', 'submitted');
    assert.deepEqual(
      await titles(),
      homework
        .filter((item) => item.status === 'submitted')
        .sort(compareHomework)
        .map((item) => item.title),
    );
    await page.select('#homework-status-filter', 'pending');
    await page.select('#homework-course', 'demo:weeks:1');
    assert.deepEqual(
      await titles(),
      homework
        .filter((item) => isPending(item) && item.courseReference === 'demo:weeks:1')
        .sort(compareHomework)
        .map((item) => item.title),
    );
    await page.select('#homework-course', '');
    await page.click('.workbench-homework-item button');
    await page.waitForSelector('#homework-dialog[open]');
    await page.waitForFunction(() =>
      document.getElementById('homework-detail').textContent.includes('本地模拟作业'),
    );
    await page.click('#homework-close');
    stage = 'top ten heat leaderboard, five visible';
    await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('.home-heat-item').length === 10);
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await preferences(width, theme);
        await page.$eval('#landing-heat-list', (node) => {
          node.scrollTop = 0;
        });
        const geometry = await page.$eval('#landing-heat-list', (node) => {
          const list = node.getBoundingClientRect();
          const rows = [...node.querySelectorAll('.home-heat-item')].map((item) =>
            item.getBoundingClientRect(),
          );
          return {
            height: node.clientHeight,
            scrollHeight: node.scrollHeight,
            visible: rows.filter((row) => row.top >= list.top - 1 && row.bottom <= list.bottom + 1)
              .length,
            widths: rows.map((row) => row.width),
            firstHeight: rows[0].height,
          };
        });
        assert.equal(geometry.visible, 5, JSON.stringify({ width, theme, geometry }));
        assert.ok(geometry.scrollHeight > geometry.height);
        await page.$eval('.home-heat-panel', (node) =>
          node.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        await page.screenshot({ path: path.join(output, `heat-${width}-${theme}.png`) });
        await page.$eval('#landing-heat-list', (node) => {
          node.scrollTop = node.scrollHeight;
        });
        await settle();
        assert.ok(
          await page.$eval('#landing-heat-list', (node) => {
            const list = node.getBoundingClientRect();
            const last = node.lastElementChild.getBoundingClientRect();
            return last.bottom <= list.bottom + 1 && last.top >= list.top;
          }),
        );
      }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify({ output, measurements, errors }));
  } catch (error) {
    console.error(stage, error);
    throw error;
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
