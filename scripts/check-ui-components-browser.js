// Isolated, memory-only regression: never uses real accounts, databases or external APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createHomePreviewServer } = require('./preview-home');
const { createCourseThreadsPreview } = require('./preview-course-threads');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
const originOf = (server) => `http://127.0.0.1:${server.address().port}`;
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-ui-components-'));
  const servers = [];
  const errors = [];
  const results = [];
  let browser;
  try {
    const homeServer = createHomePreviewServer();
    servers.push(homeServer);
    await listen(homeServer);
    const homeOrigin = originOf(homeServer);
    const preview = createCourseThreadsPreview();
    servers.push(preview.server);
    await listen(preview.server);
    const threadOrigin = originOf(preview.server);
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      const response = await fetch(`${threadOrigin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: threadOrigin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
      assert.ok(response.ok);
    }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    let failComments = true;
    let commentRequests = 0;
    let failStateAsset = false;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        ![homeOrigin, threadOrigin].includes(url.origin) &&
        !['data:', 'blob:'].includes(url.protocol)
      )
        return request.abort();
      if (failStateAsset && url.pathname === '/ui-state.js') return request.abort();
      if (
        url.origin === threadOrigin &&
        /\/api\/discussion\/posts\/[^/]+\/comments$/.test(url.pathname)
      ) {
        commentRequests += 1;
        if (failComments)
          return request.respond({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Simulated comment failure' }),
          });
      }
      return request.continue();
    });

    // Real homepage DOM and CSS: each data region has one truthful, accessible state.
    for (const theme of ['light', 'dark']) {
      await page.goto(`${homeOrigin}/?case=error&theme=${theme}`, { waitUntil: 'networkidle0' });
      const ids = ['home-discussion-list', 'home-board-activity', 'landing-heat-list'];
      await page.waitForFunction(
        (keys) => keys.every((id) => document.getElementById(id).dataset.uiState === 'error'),
        {},
        ids,
      );
      const states = await page.evaluate(
        (keys) =>
          keys.map((id) => {
            const node = document.getElementById(id);
            return {
              id,
              kind: node.dataset.uiState,
              busy: node.getAttribute('aria-busy'),
              alerts: node.querySelectorAll('[role="alert"]').length,
              retries: node.querySelectorAll('.bbs-action[data-action]').length,
              fakeEmpty: /还没有|暂时没有/.test(node.innerText),
              messageColor: getComputedStyle(node.querySelector('.ui-state-message')).color,
            };
          }),
        ids,
      );
      assert.ok(
        states.every(
          (item) =>
            item.busy === 'false' && item.alerts === 1 && item.retries === 1 && !item.fakeEmpty,
        ),
      );
      assert.ok(
        states.every(
          (item) =>
            item.messageColor === (theme === 'dark' ? 'rgb(255, 155, 143)' : 'rgb(155, 52, 41)'),
        ),
        'legacy text rules must not override the shared error color',
      );
      await page.screenshot({ path: path.join(output, `home-${theme}-error.png`) });
      // A user-initiated retry can produce successful empty data; it must not retain the error.
      await page.evaluate(() => window.history.replaceState(null, '', '?case=empty'));
      await page.click('[data-action="retry-home-feed"]');
      await page.waitForFunction(
        () => document.getElementById('home-discussion-list').dataset.uiState === 'empty',
      );
      assert.equal(await page.$('#home-discussion-list [role="alert"]'), null);
      assert.match(
        await page.$eval('#home-discussion-list', (node) => node.innerText),
        /暂时没有可显示的帖子/,
      );
      assert.equal(
        await page.$eval('#home-discussion-list .bbs-action', (node) => node.getAttribute('href')),
        '/discussion',
      );
      results.push({ scenario: `homepage ${theme} error → explicit retry → empty`, states });
    }

    // An unsuccessful comment request is not a successful empty discussion.
    const postId = preview.discussion.posts[0].id;
    await page.goto(`${threadOrigin}/discussion?post=${encodeURIComponent(postId)}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('#discussion-comment-list [data-action="retry-comments"]');
    assert.equal(
      await page.$eval('#discussion-comment-list', (node) => node.dataset.uiState),
      'error',
    );
    assert.doesNotMatch(
      await page.$eval('#discussion-comment-list', (node) => node.innerText),
      /还没有评论/,
    );
    failComments = false;
    const beforeRetry = commentRequests;
    await page.click('#discussion-comment-list [data-action="retry-comments"]');
    await page.waitForSelector('#discussion-comment-list .discussion-comment');
    assert.equal(commentRequests, beforeRetry + 1);
    assert.equal(
      await page.$eval('#discussion-comment-list', (node) => node.dataset.uiState),
      'ready',
    );
    assert.equal(
      await page.$eval('#discussion-comment-list', (node) => node.getAttribute('aria-busy')),
      'false',
    );
    results.push({ scenario: 'comments error → explicit retry → ready', commentRequests });

    // Pressing at the circle's edge must not move its hit target between down and up.
    const toggles = await page.$$('.discussion-comment-thread-toggle');
    let toggle;
    for (const candidate of toggles) {
      if (await candidate.boundingBox()) {
        toggle = candidate;
        break;
      }
    }
    assert.ok(toggle);
    const expanded = await toggle.evaluate((node) => node.getAttribute('aria-expanded'));
    await toggle.scrollIntoView();
    const box = await toggle.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    const pressed = await toggle.boundingBox();
    assert.equal(pressed.x, box.x);
    assert.equal(pressed.y, box.y);
    await page.mouse.up();
    assert.notEqual(await toggle.evaluate((node) => node.getAttribute('aria-expanded')), expanded);
    results.push({ scenario: 'thread toggle edge click has a stationary pressed target' });

    // The compact workbench placeholder retains its original geometry and state semantics.
    preview.workbench.importantItems.splice(0);
    await page.goto(`${threadOrigin}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.getElementById('workbench-priority-list').dataset.uiState === 'empty',
    );
    assert.ok(await page.$('#workbench-priority-list .workbench-state-item[role="status"]'));
    results.push({ scenario: 'workbench empty placeholder retains its compact card' });

    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${homeOrigin}/?case=error&theme=dark`, { waitUntil: 'networkidle0' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: path.join(output, 'home-mobile-error.png') });
    results.push({ scenario: 'mobile state messages do not overflow the viewport' });
    failStateAsset = true;
    await page.goto(`${homeOrigin}/?case=error&theme=light`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () =>
        window.freeBbsUiState?.degraded === true &&
        document.getElementById('home-discussion-list').dataset.uiState === 'error',
    );
    await page.evaluate(() => window.history.replaceState(null, '', '?case=empty'));
    await page.click('[data-action="retry-home-feed"]');
    await page.waitForFunction(
      () => document.getElementById('home-discussion-list').dataset.uiState === 'empty',
    );
    results.push({
      scenario: 'failed optional presentation asset retains native messages and retry',
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, output, results, pageErrors: errors }, null, 2));
  } finally {
    await browser?.close();
    await Promise.all(servers.map(close));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
