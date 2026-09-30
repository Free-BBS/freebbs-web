const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createDashboardUsabilityPreview } = require('./preview-dashboard-usability');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-overview-refinements-'));
  const preview = await createDashboardUsabilityPreview();
  preview.workbench.events.push(
    {
      publicId: 'ws_group_before_long',
      title: '五分钟交接',
      startAt: '2026-10-02T03:00:00Z',
      endAt: '2026-10-02T03:05:00Z',
      description: '只在显示上与后续长事件接触',
      kind: 'event',
      sourceType: 'manual',
      status: 'confirmed',
      version: 1,
      allDay: false,
    },
    {
      publicId: 'ws_group_long',
      title: '后续长事件',
      startAt: '2026-10-02T03:10:00Z',
      endAt: '2026-10-02T04:10:00Z',
      kind: 'event',
      sourceType: 'manual',
      status: 'confirmed',
      version: 1,
      allDay: false,
    },
  );
  const { server } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  let stage = 'setup';
  const errors = [];
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
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) =>
      new URL(request.url()).origin === origin || /^(data|blob):/.test(request.url())
        ? request.continue()
        : request.respond({ status: 204 }),
    );
    const settle = () =>
      page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      });
    const preferences = async (width, theme) => {
      await page.setViewport({ width, height: 1050 });
      await page.evaluate((mode) => {
        document.body.classList.toggle('theme-dark', mode === 'dark');
        document.body.classList.toggle('theme-light', mode === 'light');
        window.freeBbsTypography?.applyPreferences({
          fontPreset: 'zhongsong-study',
          typeScale: 'large',
        });
      }, theme);
      await settle();
    };
    stage = 'four boards and aligned feed';
    await page.setViewport({ width: 1440, height: 1050 });
    await page.goto(origin, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.home-board-item');
    for (const width of [1440, 1000, 390])
      for (const theme of ['light', 'dark']) {
        await preferences(width, theme);
        const geometry = await page.evaluate(() => {
          const boards = document.querySelector('.home-board-activity');
          boards.scrollTop = 0;
          const rect = boards.getBoundingClientRect();
          const rows = [...boards.children].map((node) => node.getBoundingClientRect());
          const feed = document.querySelector('.home-feed-panel').getBoundingClientRect();
          const heat = document.querySelector('.home-heat-panel').getBoundingClientRect();
          const list = document.querySelector('.home-heat-list');
          return {
            visible: rows.filter((row) => row.top >= rect.top - 1 && row.bottom <= rect.bottom + 1)
              .length,
            overflow: boards.scrollHeight > boards.clientHeight,
            aligned: Math.abs(feed.bottom - heat.bottom) < 2,
            feedScroll:
              document.querySelector('.home-feed-list').scrollHeight >
              document.querySelector('.home-feed-list').clientHeight,
            heatRows: list.children.length,
            heatHeight: list.clientHeight,
            firstHeatHeight: list.firstElementChild.getBoundingClientRect().height,
            pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        });
        assert.equal(geometry.visible, 4, JSON.stringify({ width, theme, geometry }));
        assert.equal(geometry.overflow, true);
        assert.equal(geometry.heatRows, 10);
        assert.ok(Math.abs(geometry.heatHeight - 5 * geometry.firstHeatHeight) <= 1);
        if (width > 900) assert.equal(geometry.aligned, true, JSON.stringify(geometry));
        assert.equal(geometry.feedScroll, true);
        assert.equal(geometry.pageOverflow, false);
        await page.$eval('.home-board-panel', (node) =>
          node.scrollIntoView({ block: 'start', behavior: 'instant' }),
        );
        await page.screenshot({ path: path.join(output, `home-${width}-${theme}.png`) });
      }
    stage = 'important editor and short cards';
    await page.setViewport({ width: 1440, height: 1050 });
    await page.goto(`${origin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-public-id="ws_short"]');
    await page.click('#workbench-companion-collapse');
    const navigation = await page.evaluate(() => {
      const tabs = document.querySelector('.workbench-view-switch').getBoundingClientRect();
      const links = document.querySelector('.workbench-section-links').getBoundingClientRect();
      return {
        rightOfTabs: links.left > tabs.right,
        aligned: Math.abs(links.top + links.height / 2 - tabs.top - tabs.height / 2) < 2,
      };
    });
    assert.deepEqual(navigation, { rightOfTabs: true, aligned: true });
    await page.click('#workbench-notifications-tab');
    assert.equal(await page.$eval('[data-workbench-links="plan"]', (node) => node.hidden), true);
    await page.click('#workbench-plan-tab');
    assert.equal(await page.$eval('[data-workbench-links="plan"]', (node) => node.hidden), false);
    assert.equal(
      await page.$('#workbench-priority-list [data-workbench-action="delete-important"]'),
      null,
    );
    assert.equal(
      await page.$eval('.workbench-source-card', (node) => getComputedStyle(node).display),
      'none',
    );
    await page.click('#workbench-priority-list [data-workbench-action="edit-important"]');
    await page.waitForSelector('#workbench-important-dialog[open]');
    assert.equal(await page.$eval('#workbench-important-delete', (node) => node.hidden), false);
    const count = preview.workbench.importantItems.length;
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.click('#workbench-important-delete');
    assert.equal(preview.workbench.importantItems.length, count);
    assert.equal(await page.$eval('#workbench-important-dialog', (node) => node.open), true);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#workbench-important-delete');
    await page.waitForFunction(() => !document.querySelector('#workbench-important-dialog').open);
    assert.equal(preview.workbench.importantItems.length, count - 1);
    await page.click('#workbench-add-important');
    assert.equal(await page.$eval('#workbench-important-delete', (node) => node.hidden), true);
    await page.click('#workbench-important-dialog [data-workbench-dialog-close]');
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await preferences(width, theme);
        for (const id of ['ws_short_midnight']) {
          const selector = `.workbench-week-timeline [data-public-id="${id}"]`;
          const card = await page.$eval(selector, (node) => ({
            height: node.getBoundingClientRect().height,
            label: node.getAttribute('aria-label'),
            titleVisible: !node.querySelector('strong').hidden,
            conflict: node.classList.contains('has-time-conflict'),
            fits: node.offsetTop + node.offsetHeight <= node.parentElement.clientHeight + 1,
          }));
          assert.equal(card.height, 24, JSON.stringify(card));
          assert.equal(card.titleVisible, true);
          assert.equal(card.conflict, false);
          assert.equal(card.fits, true);
          assert.match(card.label, /为方便显示已加长/);
        }
        assert.equal(
          await page.$eval(
            '.workbench-week-timeline [data-public-id="ws_short"]',
            (node) => node.hidden,
          ),
          true,
        );
        assert.equal(
          await page.$eval(
            '.workbench-week-timeline [data-public-id="ws_short_touching"]',
            (node) => node.hidden,
          ),
          true,
        );
        assert.match(
          await page.$eval('.workbench-event-group strong', (node) => node.textContent),
          /此处有 2 个事件/,
        );
        await page.$eval('.workbench-event-group', (node) =>
          node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
        );
        await settle();
        await page.screenshot({ path: path.join(output, `short-${width}-${theme}.png`) });
      }
    await page.click('.workbench-event-group');
    await page.waitForSelector('.workbench-event-group-dialog[open]');
    assert.match(
      await page.$eval('.workbench-event-group-list', (node) => node.textContent),
      /短时碰头[\s\S]*领取材料/,
    );
    await page.click('.workbench-event-group-list [data-public-id="ws_short"]');
    assert.equal(
      await page.$eval('#workbench-schedule-display-note', (node) => node.hidden),
      false,
    );
    assert.equal(
      await page.$eval('#workbench-schedule-start', (node) => node.value),
      '2026-09-29T17:20',
    );
    assert.equal(
      await page.$eval('#workbench-schedule-end', (node) => node.value),
      '2026-09-29T17:25',
    );
    await page.click('#workbench-schedule-dialog [data-workbench-dialog-close]');
    await page.keyboard.press('Escape');

    stage = 'aggregate stays clickable after hovering a neighbouring long event';
    await preferences(1440, 'light');
    const aggregate = '.workbench-event-group[data-group-key*="ws_group_before_long"]';
    await page.$eval(aggregate, (node) =>
      node.scrollIntoView({ block: 'center', inline: 'center' }),
    );
    await page.hover('.workbench-week-timeline [data-public-id="ws_group_long"]');
    await page.click(aggregate);
    await page.waitForSelector('.workbench-event-group-dialog[open]');
    assert.match(
      await page.$eval('.workbench-event-group-list', (node) => node.textContent),
      /五分钟交接[\s\S]*后续长事件/,
    );
    await page.keyboard.press('Escape');

    stage = 'knowledge right drawer';
    await page.setViewport({ width: 1440, height: 1050 });
    await page.goto(`${origin}/course?course=math`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-reader-node-id]');
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await preferences(width, theme);
        const canvasWidth = await page.$eval(
          '#course-map-canvas',
          (node) => node.getBoundingClientRect().width,
        );
        await page.click('[data-reader-node-id]');
        await page.waitForFunction(() =>
          document.querySelector('.knowledge-overview-people')?.textContent.includes('演示同学丙'),
        );
        assert.match(page.url(), /\/course\?course=math$/);
        assert.equal(
          await page.$eval('#course-map-canvas', (node) => node.getBoundingClientRect().width),
          canvasWidth,
        );
        const drawer = await page.$eval('#course-knowledge-overview', (node) => ({
          x: node.getBoundingClientRect().x,
          width: node.getBoundingClientRect().width,
          originalOpen: node.querySelector('details').open,
          people: [...node.querySelectorAll('.knowledge-overview-people li')].map(
            (li) => li.textContent,
          ),
          overflow: node.scrollWidth > node.clientWidth,
          facts: node.querySelectorAll('dl > div').length,
        }));
        assert.ok(
          Math.abs(drawer.width - (width >= 900 ? width * 0.46 : width - 24)) < 1,
          JSON.stringify(drawer),
        );
        assert.ok(Math.abs(drawer.x + drawer.width - (width - (width >= 900 ? 24 : 12))) < 1);
        assert.equal(drawer.originalOpen, false);
        assert.equal(drawer.facts, 5);
        assert.deepEqual(drawer.people, ['演示同学甲', '演示同学乙', '演示同学丙']);
        assert.equal(drawer.overflow, false);
        await page.screenshot({ path: path.join(output, `overview-${width}-${theme}.png`) });
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.querySelector('#course-knowledge-overview').open,
        );
        assert.ok(
          await page.evaluate(() => document.activeElement.hasAttribute('data-reader-node-id')),
        );
      }
    await page.setViewport({ width: 1440, height: 1050 });
    assert.equal(await page.$('.course-map-directory-current-actions a'), null);
    await page.waitForSelector('.course-map-directory-current');
    assert.equal(await page.$('.is-knowledge-map'), null);
    await page.screenshot({ path: path.join(output, 'knowledge-map.png') });
    await page.click('[data-reader-node-id]');
    await page.click('.knowledge-overview-drawer-footer button');
    await page.waitForSelector('.course-map-focused-chapter');
    assert.equal(await page.$eval('#course-knowledge-overview', (node) => node.open), false);
    await page.click('.course-map-focus-center [data-reader-node-id]');
    await page.waitForFunction(() =>
      document.querySelector('.knowledge-overview-people')?.textContent.includes('演示同学丙'),
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('.knowledge-overview-study'),
    ]);
    await page.waitForSelector('#knowledge-reading:not(.hidden)');
    assert.equal(await page.$eval('#knowledge-basic-info-card', (node) => node.open), false);
    await page.click('#knowledge-return-overview');
    await page.waitForSelector('#knowledge-overview:not(.hidden)');
    assert.match(
      await page.$eval('#knowledge-overview-brief', (node) => node.textContent),
      /演示同学丙/,
    );
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output, errors }));
  } catch (error) {
    console.error(stage, error);
    await page?.screenshot({ path: path.join(output, 'failure.png') });
    console.error(output);
    throw error;
  } finally {
    await browser?.close();
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
