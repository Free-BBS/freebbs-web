// Memory-only demo with real UI; database progression is checked by circuit-progress.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCourseThreadsPreview } = require('./preview-course-threads');
const { FISHBONE_MASTER } = require('../backend/economy-achievements');

async function main() {
  const { server, store } = createCourseThreadsPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-circuit-achievement-'));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) {
        external.push(url.href);
        return request.abort('blockedbyclient');
      }
      return request.continue();
    });
    await page.setViewport({ width: 1440, height: 960 });
    for (const route of ['/workbench', '/electromagnetic']) {
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.desktop-assets [data-currency-guide]');
      assert.equal(await page.$('#workbench-session-state, #economy-balance-row'), null);
      assert.equal(
        await page.$$eval('.desktop-assets [data-currency-guide]', (nodes) => nodes.length),
        1,
      );
      assert.match(
        await page.$eval('.desktop-assets [data-currency-guide]', (node) =>
          node.getAttribute('aria-label'),
        ),
        /电元 120，磁元 86，热力 24/,
      );
    }
    assert.equal(store.account().assets.plate_circuit_master, undefined);
    await page.goto(`${origin}/circuit-challenge`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.achievement-toast');
    assert.match(await page.$eval('.achievement-toast h2', (node) => node.textContent), /电路达人/);
    assert.equal(store.account().assets.plate_circuit_master, 1);
    assert.equal(store.account().notifications.length, 1);
    assert.equal(store.account().equipped.nameplate, 'plate_observer');

    let cases = 0;
    for (const width of [1440, 390, 360]) {
      await page.setViewport({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        for (const fontPreset of ['quantum-board', 'zhongsong-study', 'transistor-lab']) {
          for (const typeScale of ['standard', 'large']) {
            await page.evaluate(
              (prefs) => {
                if (document.body.classList.contains('theme-light') !== (prefs.theme === 'light'))
                  window.freeBbsApp.toggleThemeMode();
                window.freeBbsTypography.applyPreferences(prefs);
              },
              { theme, fontPreset, typeScale },
            );
            await page.evaluate(() => document.fonts.ready);
            const bounds = await page.$eval('.achievement-toast', (node) => {
              const rect = node.getBoundingClientRect();
              return {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                overflow: node.scrollWidth > node.clientWidth + 1,
                imageLoaded: node.querySelector('img').naturalWidth > 0,
              };
            });
            assert.ok(
              bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 960,
            );
            assert.equal(bounds.overflow, false);
            assert.equal(bounds.imageLoaded, true);
            cases += 1;
          }
        }
        await (
          await page.$('.achievement-toast')
        ).screenshot({ path: path.join(output, `notice-${width}-${theme}.png`) });
      }
    }
    // A second award waits instead of covering the first one.
    await store.transaction(async (tx) => {
      await tx.deliver(1, FISHBONE_MASTER);
      await tx.notifyAchievement(1, FISHBONE_MASTER);
    });
    await page.evaluate(() => {
      const { uid, token } = window.freeBbsApp.userState;
      window.dispatchEvent(
        new CustomEvent('freebbs:achievement-unlocked', {
          detail: { key: 'plate_fishbone_master', uid, token },
        }),
      );
    });
    assert.match(await page.$eval('.achievement-toast h2', (node) => node.textContent), /电路达人/);
    await page.click('.achievement-toast-close');
    assert.match(await page.$eval('.achievement-toast h2', (node) => node.textContent), /鱼骨达人/);
    await page.click('.achievement-toast-close');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$('.achievement-toast'), null);
    assert.equal(store.account().notifications.length, 2);

    await page.goto(`${origin}/profile?uid=u_preview01#public-profile-wardrobe`, {
      waitUntil: 'networkidle0',
    });
    for (const key of [
      'plate_circuit_master',
      'plate_fishbone_master',
      'plate_observer',
      'plate_circuit_master',
    ]) {
      const selector = `[data-extra-action="equip"][data-item="${key}"]`;
      await page.waitForSelector(selector);
      await page.$eval(selector, (node) => node.click());
      await page.waitForFunction(
        (item) =>
          document
            .querySelector(`[data-extra-action="equip"][data-item="${item}"]`)
            ?.getAttribute('aria-pressed') === 'true',
        {},
        key,
      );
      assert.equal(store.account().equipped.nameplate, key);
    }
    for (const theme of ['light', 'dark']) {
      await page.evaluate((mode) => {
        if (document.body.classList.contains('theme-light') !== (mode === 'light'))
          window.freeBbsApp.toggleThemeMode();
      }, theme);
      const plate = await page.$('#public-profile-nameplate .plate_circuit_master');
      assert.ok(plate);
      await plate.screenshot({ path: path.join(output, `plate-${theme}.png`) });
    }
    await page.goto(`${origin}/inventory`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(
      '[data-action="inspect-inventory-item"][data-asset-key="plate_circuit_master"]',
    );

    // Recover a missed popup via persistent notification, then discard it on logout.
    await page.evaluate(() =>
      localStorage.removeItem('free_bbs_achievement_seen:u_preview01:plate_circuit_master'),
    );
    await page.goto(`${origin}/laboratory`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.achievement-toast');
    assert.match(await page.$eval('.achievement-toast h2', (node) => node.textContent), /电路达人/);
    await page.evaluate(() => {
      localStorage.removeItem('free_bbs_auth_token');
      window.dispatchEvent(new StorageEvent('storage', { key: 'free_bbs_auth_token' }));
    });
    await page.waitForFunction(() => !document.querySelector('.achievement-toast'));
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('freebbs:achievement-unlocked', {
          detail: { key: 'plate_circuit_master', uid: 'another-user', token: 'expired' },
        }),
      ),
    );
    assert.equal(await page.$('.achievement-toast'), null);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      `Circuit achievement OK: ${cases} layouts, sidebar balances, backfill, notice queue/recovery, wardrobe/inventory, stale session. Screenshots: ${output}`,
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
