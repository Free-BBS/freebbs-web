// Merged ranch features exercised only with a local, memory-only fake account.
const assert = require('node:assert/strict');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');

async function clickVisible(page, selector) {
  await page.$eval(selector, (node) =>
    node.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const reachable = await page.$eval(selector, (node) => {
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      reachable: node === hit || node.contains(hit),
      disabled: node.disabled,
      hit: hit?.outerHTML.slice(0, 200),
    };
  });
  assert.equal(
    reachable.reachable && !reachable.disabled,
    true,
    `${selector}: ${JSON.stringify(reachable)}`,
  );
  await page.click(selector);
}

async function main() {
  const { server, store } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === origin)
        return request.continue();
      return request.abort('blockedbyclient');
    });
    let cases = 0;
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.goto(`${origin}/ranch-dye`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#dye-center:not([disabled])');
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          true,
          `dye overflow: ${width} ${theme}`,
        );
        const before = structuredClone(store.account());
        await clickVisible(page, '#dye-center');
        await clickVisible(page, '#dye-save');
        await page.waitForFunction(() =>
          document.querySelector('#dye-status').textContent.startsWith('已保存'),
        );
        assert.deepEqual(store.account(), before, 'dye save must not affect wool or balances');
        await page.goto(`${origin}/ranch-gallery`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.community-sheep');
        assert.equal(await page.$$eval('.community-sheep', (nodes) => nodes.length), 2);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          true,
          `gallery overflow: ${width} ${theme}`,
        );
        await page.goto(`${origin}/ranch?uid=u_preview01`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-max-actor] [data-ranch-dye-layer] g');
        if (width > 900) {
          // Exercise fallback explicitly; the native entry uses the same state and DOM.
          await page.$eval('#public-profile-ranch', (node) => {
            Object.defineProperty(node, 'requestFullscreen', {
              value: () => Promise.reject(new Error('QA fallback')),
              configurable: true,
            });
          });
          await page.click('[data-study-enter]');
          await page.waitForSelector('.is-study-mode');
          if (await page.$eval('[data-study-focus]', (node) => node.hidden))
            await page.click('[data-study-toggle-focus]');
          await page.click('[data-study-start]');
          await page.waitForFunction(
            () => document.querySelector('[data-study-start]').textContent === '暂停',
          );
          await page.click('[data-study-exit]');
          await page.waitForFunction(() => !document.body.classList.contains('ranch-study-open'));
          assert.match(
            await page.$eval('[data-study-enter]', (node) => node.textContent),
            /专注中/,
          );
          await page.click('[data-study-enter]');
          await page.click('[data-study-reset]');
          await page.keyboard.press('Escape');
          assert.deepEqual(store.account(), before, 'study timer is not an economy action');
        } else {
          assert.equal(
            await page.$eval('[data-study-enter]', (node) => getComputedStyle(node).display),
            'none',
          );
        }
        cases += 1;
        console.log(`Merged ranch: ${width} ${theme}, dye/gallery/study OK`);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    const before = structuredClone(store.account());
    const action = async (name) => {
      await page.locator(`[data-extra-action="${name}"]:not([disabled])`).click();
      await page.waitForFunction(
        () => !document.querySelector('.profile-extras')?.getAttribute('aria-busy'),
      );
      await page.waitForSelector(`[data-extra-action="feed"]:not([disabled])`);
      await page.waitForSelector('[data-max-actor] [data-ranch-dye-layer] g');
    };
    await action('feed');
    assert.equal(store.account().assets.fish, before.assets.fish - 1);
    assert.ok(store.account().woolReady >= before.woolReady);
    const ready = store.account().woolReady;
    await page.click('[data-ranch-open="ranch-wool-dialog"]');
    await action('shear');
    assert.equal(store.account().woolReady, ready - 1);
    assert.equal(store.account().woolStored, before.woolStored + 1);
    await action('rub_wool');
    assert.equal(store.account().woolStored, before.woolStored);
    assert.equal(store.account().electric, before.electric + 2);
    assert.equal(store.account().assets.rubber_rod, before.assets.rubber_rod);
    assert.deepEqual(errors, []);
    console.log(
      `Merged ranch compatibility OK: ${cases} cases; dyed sheep survives feed/shear/rub; rewards unchanged`,
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
