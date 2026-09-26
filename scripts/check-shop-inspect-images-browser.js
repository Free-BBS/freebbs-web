// Inspect actual shop/inventory artwork using an isolated in-memory account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');
const catalog = require('../public/data/shop-items.json');

async function inspect(page, selector) {
  await page.$eval(selector, (button) => button.click());
  await page.waitForSelector('#shop-inspect-modal:not(.hidden)');
  return page.$eval('.shop-inspect-panel', async (panel) => {
    const image = panel.querySelector('.shop-inspect-image > img');
    await image.decode();
    await document.fonts.ready;
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const box = image.getBoundingClientRect();
    const frame = image.parentElement.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    return {
      image: { width: box.width, height: box.height },
      natural: { width: image.naturalWidth, height: image.naturalHeight },
      fit: getComputedStyle(image).objectFit,
      frame: frame.toJSON(),
      panel: bounds.toJSON(),
      horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
    };
  });
}

(async () => {
  const { server, store } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output =
    process.env.SHOP_INSPECT_QA_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-inspect-images-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    const rejected = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        rejected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return request.abort('blockedbyclient');
      }
      return request.continue();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${origin}/electromagnetic`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-item-key="rubber_rod"] [data-action="inspect-item"]');
    const keys = await page.$$eval(
      '#shop-grid .shop-item-card:has(.shop-item-image > img)',
      (cards) => cards.map((card) => card.dataset.itemKey),
    );
    // Run the reported long-description item first, then every other raster item.
    keys.sort((a, b) => Number(b === 'rubber_rod') - Number(a === 'rubber_rod'));
    assert.ok(keys.includes('rubber_rod') && keys.includes('fish') && keys.includes('laser'));
    let checked = 0;
    const verify = async (selector, label) => {
      const data = await inspect(page, selector);
      const expectedHeight = (data.image.width * data.natural.height) / data.natural.width;
      if (Math.abs(data.image.height - expectedHeight) > 1)
        await page.screenshot({ path: path.join(output, 'distorted.png') });
      assert.ok(
        Math.abs(data.image.height - expectedHeight) <= 1,
        `${label}: distorted image ${JSON.stringify(data)}`,
      );
      assert.equal(data.fit, 'contain', `${label}: never stretch/crop artwork`);
      assert.ok(data.image.width > 0 && data.image.width <= data.frame.width, label);
      assert.equal(data.horizontalOverflow, false, label);
      assert.ok(data.panel.top >= 0 && data.panel.bottom <= 901, `${label}: bounded dialog`);
      checked += 1;
      return data;
    };
    for (const width of [1440, 1024, 600, 390, 360]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-light', mode === 'light');
          document.body.classList.toggle('theme-dark', mode === 'dark');
        }, theme);
        for (const fontPreset of [
          'transistor-lab',
          'zhongsong-study',
          'quantum-board',
          'night-oscilloscope',
        ]) {
          for (const typeScale of ['standard', 'large']) {
            await page.evaluate(
              (preferences) => window.freeBbsTypography.applyPreferences(preferences),
              { fontPreset, typeScale },
            );
            // Every artwork at each width/theme; the reported long-rules item
            // additionally exercises every supported font and both size scales.
            const items =
              fontPreset === 'transistor-lab' && typeScale === 'standard' ? keys : ['rubber_rod'];
            for (const key of items) {
              const data = await verify(
                `[data-item-key="${key}"] [data-action="inspect-item"]`,
                `${width} ${theme} ${fontPreset} ${typeScale} ${key}`,
              );
              if (key === 'rubber_rod') {
                // Expanded and collapsed rules must never control image height.
                const collapsed = await page.$eval('.shop-trade-rules', async (rules) => {
                  rules.removeAttribute('open');
                  await new Promise((resolve) => {
                    requestAnimationFrame(resolve);
                  });
                  return document
                    .querySelector('.shop-inspect-image > img')
                    .getBoundingClientRect()
                    .toJSON();
                });
                assert.ok(Math.abs(collapsed.height - data.image.height) < 1);
                await page.$eval('.shop-trade-rules', (rules) => {
                  rules.setAttribute('open', '');
                });
                if (
                  [1440, 390].includes(width) &&
                  typeScale === 'standard' &&
                  fontPreset === 'transistor-lab'
                )
                  await page.screenshot({ path: path.join(output, `rod-${width}-${theme}.png`) });
              }
              await page.click('#shop-inspect-modal .fortune-close');
            }
          }
        }
      }
    }
    // Inventory reuses the same renderer and modal; no gifting or purchase.
    for (const item of catalog.items.filter((entry) => keys.includes(entry.key)))
      store.account().assets[item.key] = 1;
    await page.goto(`${origin}/inventory`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(
      '[data-asset-key="rubber_rod"][data-action="inspect-inventory-item"]',
    );
    for (const key of keys) {
      await verify(
        `[data-asset-key="${key}"][data-action="inspect-inventory-item"]`,
        `inventory ${key}`,
      );
      await page.click('#shop-inspect-modal .fortune-close');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(rejected, []);
    console.log(JSON.stringify({ checked, keys, errors, rejected, output }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
