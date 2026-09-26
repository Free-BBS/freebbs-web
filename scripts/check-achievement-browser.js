// Isolated fake accounts only: no production network, database, AI or real assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');

async function main() {
  const preview = createPersonalPreview();
  const { server, store } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-achievement-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage();
    const errors = [];
    const external = [];
    let purchaseBody;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) {
        external.push(url.href);
        return request.abort('blockedbyclient');
      }
      if (url.pathname.endsWith('/fishbone/purchase')) purchaseBody = request.postData();
      return request.continue();
    });
    const account = store.account();
    account.counts.fishbone = 9;
    account.assets.golden_fishbone = 3;
    account.assets.ordinary_fishbone = 10;
    account.equipped.nameplate = 'plate_observer';
    await page.setViewport({ width: 1440, height: 960 });
    await page.goto(`${origin}/electromagnetic`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-action="inspect-item"][data-item-key="fishbone"]');
    await page.click('[data-action="inspect-item"][data-item-key="fishbone"]');
    await page.click('#shop-inspect-modal [data-action="purchase-item"][data-currency="electric"]');
    await page.waitForSelector('.achievement-toast');
    assert.equal(account.assets.plate_fishbone_master, 1);
    assert.equal(account.equipped.nameplate, 'plate_observer', 'award must not auto-equip');
    assert.equal(account.notifications.length, 1);
    assert.match(await page.$eval('.achievement-toast', (node) => node.textContent), /鱼骨达人/);
    await page.click('#shop-inspect-modal .fortune-close');
    // Replay the exact successful request, including its idempotency key.
    const replay = await page.evaluate(
      (body) =>
        window.freeBbsApp.callApi('/electromagnetic/shop/fishbone/purchase', {
          method: 'POST',
          body,
        }),
      purchaseBody,
    );
    assert.equal(replay.purchase.replayed, true);
    assert.equal(account.notifications.length, 1);
    for (const width of [1440, 390, 360]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        await page.evaluate(() => document.fonts.ready);
        const bounds = await page.$eval('.achievement-toast', (node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            overflow: node.scrollWidth > node.clientWidth + 1,
          };
        });
        assert.ok(
          bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900,
        );
        assert.equal(bounds.overflow, false);
        await page.screenshot({ path: path.join(output, `award-${width}-${theme}.png`) });
        const toast = await page.$('.achievement-toast');
        await toast.screenshot({ path: path.join(output, `notice-${width}-${theme}.png`) });
      }
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('.achievement-toast-equip'),
    ]);
    await page.waitForSelector('#public-profile-wardrobe:not([hidden])');
    assert.equal(new URL(page.url()).hash, '#public-profile-wardrobe');
    assert.equal(
      await page.$('.achievement-toast'),
      null,
      'reload does not repeat an acknowledged popup',
    );
    for (const key of ['plate_fishbone_master', 'plate_observer']) {
      assert.equal(await page.$eval('.profile-wardrobe-disclosure', (node) => node.open), true);
      await page.$eval(`[data-extra-action="equip"][data-item="${key}"]`, (node) =>
        node.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame(resolve);
          }),
      );
      await page.click(`[data-extra-action="equip"][data-item="${key}"]`);
      await page
        .waitForFunction(
          (item) =>
            document
              .querySelector(`[data-extra-action="equip"][data-item="${item}"]`)
              ?.getAttribute('aria-pressed') === 'true',
          {},
          key,
        )
        .catch(async (error) => {
          await page.screenshot({ path: path.join(output, 'equip-failure.png') });
          console.error(
            'Equipment diagnostics',
            key,
            await page.evaluate(() => ({
              url: window.location.href,
              message: document.querySelector('#profile-extras-message')?.textContent,
            })),
          );
          throw error;
        });
      assert.equal(account.equipped.nameplate, key);
    }
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('freebbs:open-notifications')));
    await page.waitForSelector('.notification-item-button');
    assert.match(
      await page.$eval('.notification-item-button', (node) => node.textContent),
      /鱼骨达人/,
    );
    await page.click('.notification-read-all');
    await page.waitForFunction(() => document.querySelector('.notification-badge').hidden);
    assert.ok(account.notifications[0].readAt);

    // A second, isolated fake award through ranch feeding, not by purchase.
    delete account.assets.plate_fishbone_master;
    account.assets.golden_fishbone = 2;
    account.notifications = [];
    account.rewards = {};
    await page.evaluate(() =>
      localStorage.removeItem('free_bbs_achievement_seen:u_preview01:plate_fishbone_master'),
    );
    await page.goto(`${origin}/profile?uid=u_preview01`, { waitUntil: 'networkidle0' });
    await page.click('[data-extra-action="feed"]');
    await page.waitForSelector('.achievement-toast');
    assert.equal(account.assets.plate_fishbone_master, 1);
    assert.equal(account.notifications.length, 1);
    assert.equal(account.equipped.nameplate, 'plate_observer');
    await page.focus('.achievement-toast-close');
    await page.keyboard.press('Enter');
    assert.equal(await page.$('.achievement-toast'), null);

    // Persisted unread inbox also recovers a lost award success response on the next page.
    await page.evaluate(() =>
      localStorage.removeItem('free_bbs_achievement_seen:u_preview01:plate_fishbone_master'),
    );
    await page.goto(`${origin}/laboratory`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.achievement-toast');
    await page.evaluate(() => {
      localStorage.removeItem('free_bbs_auth_token');
      window.dispatchEvent(new StorageEvent('storage', { key: 'free_bbs_auth_token' }));
    });
    await page.waitForFunction(() => !document.querySelector('.achievement-toast'));
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('freebbs:achievement-unlocked', {
          detail: { key: 'plate_fishbone_master', uid: 'another-user', token: 'expired' },
        }),
      ),
    );
    assert.equal(await page.$('.achievement-toast'), null);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      `Achievement OK: shop/feed awards, idempotent inbox, swappable nameplates, no auto-equip, recovery, logout, mobile/themes. Screenshots: ${output}`,
    );
  } finally {
    await browser?.close();
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
