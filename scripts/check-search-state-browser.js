// Real search DOM and shared shell against loopback-only, memory-only responses.
const assert = require('node:assert/strict');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const { server } = createOnboardingPreview({ extraPages: { '/search': 'search.html' } });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  const results = [];
  let mode = 'error';
  let calls = 0;
  let nextPageFails = false;
  let missingUi = false;
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
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) return request.abort();
      if (missingUi && url.pathname === '/ui-state.js')
        return request.respond({ status: 404, contentType: 'application/javascript', body: '' });
      if (url.pathname !== '/api/search') return request.continue();
      calls += 1;
      const offset = Number(url.searchParams.get('offset'));
      const failing = mode === 'error' || (mode === 'pages' && offset === 1 && nextPageFails);
      const payload = failing
        ? { message: '搜索暂时不可用' }
        : {
            results:
              mode === 'empty'
                ? []
                : [
                    {
                      type: 'knowledge',
                      title: offset === 1 ? '第二项知识点' : '第一项知识点',
                      excerpt: '搜索测试内容',
                      url: '/knowledge?course=SS&point=SS-02-01',
                    },
                  ],
            hasMore: mode === 'pages' && offset === 0,
            nextOffset: mode === 'pages' && offset === 0 ? 1 : null,
          };
      const respond = () =>
        request
          .respond({
            status: failing ? 503 : 200,
            contentType: 'application/json',
            body: JSON.stringify(payload),
          })
          .catch(() => {});
      if (mode === 'slow') return setTimeout(respond, 500);
      return respond();
    });
    const waitState = (kind) =>
      page.waitForFunction(
        (value) => document.querySelector('.site-search-results').dataset.uiState === value,
        {},
        kind,
      );
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        mode = 'error';
        await page.goto(`${origin}/search?q=卷积`, { waitUntil: 'networkidle0' });
        await page.evaluate((value) => {
          if (!document.body.classList.contains(`theme-${value}`))
            window.freeBbsApp.toggleThemeMode();
        }, theme);
        await waitState('error');
        assert.ok(await page.$('.site-search-status [role="alert"]'));
        mode = 'pages';
        const beforeRetry = calls;
        await page.click('[data-action="retry-site-search"]');
        await waitState('ready');
        assert.equal(calls, beforeRetry + 1);
        assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 1);
        nextPageFails = true;
        await page.click('.site-search-more');
        await waitState('error');
        assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 1);
        nextPageFails = false;
        await page.click('[data-action="retry-site-search"]');
        await waitState('ready');
        assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 2);
        assert.equal(
          await page.$eval('.site-search-more', (node) => getComputedStyle(node).display),
          'none',
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        mode = 'empty';
        await page.click('.site-search-form [type="submit"]');
        await waitState('empty');
        assert.equal(await page.$('.site-search-status [role="alert"]'), null);
        results.push({ width, theme, flow: 'failure → retry → paginated retry → empty' });
      }
    }
    // Reuse the real deadline implementation with a short test-only budget.
    await page.evaluate(() => {
      const { request } = window.freeBbsRequests;
      window.freeBbsRequests.request = (url, options, consume) =>
        request(url, { ...options, timeoutMs: 80 }, consume);
    });
    mode = 'slow';
    await page.click('.site-search-form [type="submit"]');
    await waitState('error');
    assert.match(await page.$eval('.site-search-status', (node) => node.innerText), /超时/);
    await page.waitForFunction(
      () => document.querySelector('.site-search-results').getAttribute('aria-busy') === 'false',
    );
    mode = 'empty';
    await page.click('[data-action="retry-site-search"]');
    await waitState('empty');
    results.push({ flow: 'shared timeout releases loading and retry works' });

    await page.goto(`${origin}/`, { waitUntil: 'networkidle0' });
    await page.click('.site-search-trigger');
    await page.waitForSelector('dialog.site-search[open]');
    await waitState('empty');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('dialog.site-search', (node) => node.open), false);
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains('site-search-trigger')),
      true,
    );
    results.push({ flow: 'modal Escape closes and restores opener focus' });

    // The second tab is a script-free loopback document. Only its local storage
    // changes; neither logout nor a search touches any real account or service.
    mode = 'pages';
    await page.goto(`${origin}/search?q=private`, { waitUntil: 'networkidle0' });
    await waitState('ready');
    assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 1);
    await page.evaluate(() => {
      window.searchProbeStorageEvents = 0;
      window.addEventListener('storage', (event) => {
        if (event.key === 'free_bbs_auth_token' || event.key === null)
          window.searchProbeStorageEvents += 1;
      });
    });
    const peer = await browser.newPage();
    try {
      await peer.goto(`${origin}/__qa-storage-peer`, { waitUntil: 'domcontentloaded' });
      // Element scrolling can await an animation frame in Puppeteer's isolated
      // world. Keep the page under test foregrounded after opening its peer.
      await page.bringToFront();
      const beforeLogout = calls;
      await peer.evaluate(() => localStorage.removeItem('free_bbs_auth_token'));
      await waitState('error');
      assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 0);
      assert.equal(
        await page.$eval('.site-search-results', (node) => node.getAttribute('aria-busy')),
        'false',
      );
      assert.equal(await page.$('.site-search-status [data-action="retry-site-search"]'), null);
      assert.equal(
        await page.$eval('.site-search-more', (node) => getComputedStyle(node).display),
        'none',
      );
      // The original tab deliberately still has the old in-memory identity.
      assert.equal(await page.evaluate(() => window.freeBbsApp.userState.token), TOKEN);
      await page.click('.site-search-form [type="submit"]');
      assert.equal(calls, beforeLogout);
      assert.match(
        await page.$eval('.site-search-status', (node) => node.innerText),
        /登录状态已变化/,
      );

      const beforeRestore = await page.evaluate(() => window.searchProbeStorageEvents);
      await peer.evaluate((token) => localStorage.setItem('free_bbs_auth_token', token), TOKEN);
      await page.waitForFunction(
        (previous) => window.searchProbeStorageEvents > previous,
        {},
        beforeRestore,
      );
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('freebbs:session-change', {
            detail: { user: window.freeBbsApp.userState },
          }),
        );
      });
      await waitState('ready');
      assert.equal(calls, beforeLogout + 1);

      mode = 'slow';
      await page.click('.site-search-form [type="submit"]');
      await waitState('loading');
      await peer.evaluate(() => localStorage.clear());
      await waitState('error');
      const afterPendingLogout = calls;
      await page.click('.site-search-form [type="submit"]');
      await new Promise((resolve) => {
        setTimeout(resolve, 600);
      });
      assert.equal(calls, afterPendingLogout);
      assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 0);
      assert.equal(
        await page.$eval('.site-search-results', (node) => node.getAttribute('aria-busy')),
        'false',
      );
      assert.equal(await page.$('.site-search-status [data-action="retry-site-search"]'), null);
      results.push({
        flow: 'real second-tab logout/clear removes private rows, blocks old fetches and late repaint; fresh session resumes once',
      });
    } finally {
      await peer.close();
    }
    await page.bringToFront();
    missingUi = true;
    mode = 'error';
    await page.goto(`${origin}/search?q=optional`, { waitUntil: 'networkidle0' });
    await waitState('error');
    assert.equal(await page.evaluate(() => window.freeBbsUiState?.degraded), true);
    assert.ok(await page.$('.site-search-status[role="alert"]'));
    assert.equal(
      await page.$eval('.site-search-status button', (node) => node.textContent),
      '重试',
    );
    mode = 'pages';
    const beforeNativeRetry = calls;
    await page.click('.site-search-status button');
    await waitState('ready');
    assert.equal(calls, beforeNativeRetry + 1);
    assert.equal(await page.$$eval('.site-search-results > li', (nodes) => nodes.length), 1);
    results.push({ flow: 'missing ui-state.js uses a native retry that recovers real search' });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({ passed: true, browser: process.env.CHROME_PATH, results, errors }),
    );
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
