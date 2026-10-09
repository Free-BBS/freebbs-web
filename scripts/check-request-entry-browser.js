// Actual raw-preview entry points: mock credentials and in-memory economy only.
const assert = require('node:assert/strict');
const path = require('node:path');
// Playwright is installed by the development workspace's existing lockfile.
// eslint-disable-next-line import/no-dynamic-require
const { chromium } = require(
  require.resolve('playwright', {
    paths: [path.join(__dirname, '../development'), __dirname],
  }),
);
const { createEconomyPreview, TOKEN } = require('./preview-economy');

async function main() {
  const { server, store } = createEconomyPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const errors = [];
  const purchases = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    page.on('request', (request) => {
      if (request.url().endsWith('/api/electromagnetic/shop/frame_orbit/purchase'))
        purchases.push(request);
    });
    await page.goto(`${origin}/electromagnetic`);
    await page.waitForFunction(() => window.freeBbsApp?.userState.isLoggedIn);
    assert.deepEqual(
      await page.evaluate(async () => {
        await window.freeBbsApp.sessionReady;
        return {
          token: window.freeBbsApp.userState.token,
          uid: window.freeBbsApp.userState.uid,
          runtime: typeof window.freeBbsRequests?.request,
          scripts: document.querySelectorAll('script[src="/request-runtime.js"]').length,
        };
      }),
      { token: TOKEN, uid: 'u_preview01', runtime: 'function', scripts: 1 },
    );
    await page.locator('[data-action="inspect-item"][data-item-key="frame_orbit"]').click();
    await page.locator('#shop-inspect-modal [data-action="purchase-item"]').first().click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message')?.textContent.includes('已到账'),
    );
    assert.equal(store.account().assets.frame_orbit, 1);
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].headers().authorization, `Bearer ${TOKEN}`);
    await page.goto(`${origin}/inventory`);
    await page
      .locator('[data-asset-key="frame_orbit"][data-action="inspect-inventory-item"]')
      .waitFor();
    await page.goto(`${origin}/ranch`);
    await page.waitForFunction(() => window.freeBbsApp?.userState.isLoggedIn);
    assert.equal(
      await page.evaluate(
        async () => (await window.freeBbsApp.callApi('/electromagnetic')).user.uid,
      ),
      'u_preview01',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: raw shop/inventory/ranch entries load one shared runtime, restore auth, purchase once with Bearer credentials and serve authenticated data without page errors.',
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
