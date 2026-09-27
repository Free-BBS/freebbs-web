// Local, memory-only regression for the merged ranch and shared desktop shell.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');

async function main() {
  const { server } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-ranch-shell-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
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
    for (const [width, height] of [
      [1440, 900],
      [1024, 600],
      [901, 768],
      [390, 844],
      [320, 568],
      [844, 390],
    ]) {
      await page.setViewport({ width, height });
      for (const theme of ['light', 'dark']) {
        for (const fontPreset of ['transistor-lab', 'zhongsong-study']) {
          await page.goto(`${origin}/ranch?uid=u_preview01`, { waitUntil: 'networkidle0' });
          await page.waitForSelector('.ranch-scene-actions');
          await page.evaluate(
            ({ mode, preset }) => {
              window.freeBbsTypography.applyPreferences({ fontPreset: preset, typeScale: 'large' });
              if (document.body.classList.contains('theme-light') !== (mode === 'light'))
                window.freeBbsApp.toggleThemeMode();
            },
            { mode: theme, preset: fontPreset },
          );
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) => {
              setTimeout(resolve, 350);
            });
          });
          const layout = await page.evaluate(() => {
            const rect = (selector) =>
              document.querySelector(selector).getBoundingClientRect().toJSON();
            const scene = rect('.ranch-scene');
            const mainBounds = rect('.main-content');
            const header = document.querySelector('.desktop-header')?.getBoundingClientRect();
            const selectors = [
              '.site-search-trigger',
              '.avatar',
              '[data-ranch-open="ranch-shop-dialog"]',
              '[data-ranch-open="ranch-wool-dialog"]',
              '[data-ranch-pause]',
              '.ranch-scene-picker button',
            ];
            const controls = selectors.map((selector) => {
              const node = document.querySelector(selector);
              const box = node.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { selector, hit: hit === node || node.contains(hit), bottom: box.bottom };
            });
            return {
              scene,
              main: mainBounds,
              headerBottom: header?.bottom,
              controls,
              horizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
              scroll: window.scrollY,
              scenePhoto: getComputedStyle(document.querySelector('.ranch-scenery'))
                .backgroundImage,
              navOverflow:
                document.querySelector('.topbar').scrollWidth >
                document.querySelector('.topbar').clientWidth + 1,
              period: document.querySelector('.ranch-photographic').dataset.ranchPeriod,
              currencies: [...document.querySelectorAll('#user-status .currency-value')].map(
                (node) => getComputedStyle(node).fontSize,
              ),
            };
          });
          const label = `${width}x${height} ${theme} ${fontPreset}`;
          assert.equal(layout.horizontal, false, label);
          assert.equal(layout.navOverflow, false, `${label} sidebar overflow`);
          assert.ok(Math.abs(layout.scene.top - layout.main.top) < 2, `${label} scene inset`);
          assert.ok(
            Math.abs(layout.scene.bottom - layout.main.bottom) < 2,
            `${label} scene clipped`,
          );
          if (width > 900)
            assert.ok(layout.scene.top >= layout.headerBottom - 1, `${label} header overlap`);
          for (const control of layout.controls)
            assert.equal(control.hit, true, `${label}: ${control.selector} unreachable`);
          assert.equal(layout.period, theme === 'light' ? 'day' : 'night');
          assert.equal(new Set(layout.currencies).size, 1, `${label} balance typography`);
          await page.click('[data-ranch-open="ranch-wool-dialog"]');
          await page.waitForSelector('#ranch-wool-dialog[open] .ranch-wool-stages');
          assert.equal(
            await page.$eval(
              '#ranch-wool-dialog',
              (node) => node.clientHeight <= window.innerHeight,
            ),
            true,
            label,
          );
          await page.click('#ranch-wool-dialog [data-ranch-close]');
          await page.click('[data-ranch-open="ranch-shop-dialog"]');
          await page.click('#ranch-shop-dialog [data-item-key="fish"]');
          await page.waitForSelector('#shop-inspect-modal:not(.hidden)');
          await page.click('#shop-inspect-modal .fortune-close');
          if (fontPreset === 'transistor-lab')
            await page.screenshot({ path: path.join(output, `ranch-${width}-${theme}.png`) });
          cases += 1;
        }
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${origin}/profile?uid=u_preview01`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ranch-preview-link');
    assert.equal(
      await page.$eval(
        '.ranch-preview .ranch-scene',
        (node) => node.getBoundingClientRect().height,
      ),
      230,
    );
    assert.equal(await page.$('[data-extra-action="feed"]'), null);
    await page.screenshot({ path: path.join(output, 'profile-preview.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      `Ranch shell OK: ${cases} layout/dialog cases, linked profile preview. Screenshots: ${output}`,
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
