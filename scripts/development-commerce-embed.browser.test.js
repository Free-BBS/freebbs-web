const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('../development/node_modules/@playwright/test');

const publicRoot = path.resolve(__dirname, '../public');
const origin = 'http://development-embed.test';
const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function localPage(browser, omitEmbedStyles = false) {
  const page = await browser.newPage();
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (omitEmbedStyles && url.pathname === '/development-commerce-embed.css') {
      return route.fulfill({ contentType: 'text/css', body: '' });
    }
    // Run the real embed activation, but isolate layout from account/API scripts.
    if (url.pathname.endsWith('.js') && url.pathname !== '/development-commerce-embed.js') {
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    }
    const pathname = url.pathname === '/ranch-gallery' ? '/ranch-gallery.html' : url.pathname;
    const file = path.resolve(publicRoot, `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file)) {
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({
      contentType: contentTypes[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });
  return page;
}

async function layout(page, width, embedded) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/ranch-gallery${embedded ? '?embed=development' : ''}`, {
    waitUntil: 'load',
  });
  return page.evaluate(() => {
    const main = document.querySelector('.main-content');
    const scene = document.querySelector('.community-pasture');
    const style = getComputedStyle(main);
    return {
      embedded: document.documentElement.classList.contains('development-embedded'),
      position: style.position,
      height: style.height,
      main: main.getBoundingClientRect().toJSON(),
      scene: scene.getBoundingClientRect().toJSON(),
    };
  });
}

test('embedded gallery reserves desktop/mobile scene height with the complete page CSS', async () => {
  const launchOptions = { headless: true };
  if (process.env.CHROME_PATH) launchOptions.executablePath = process.env.CHROME_PATH;
  else if (process.env.PLAYWRIGHT_CHANNEL || process.platform === 'win32')
    launchOptions.channel = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await localPage(browser);
    const standaloneBaseline = await localPage(browser, true);
    const embeddedCases = [];
    for (const width of [1200, 761, 760, 500]) {
      const actual = await layout(page, width, true);
      console.log(`Gallery ${width}px: main=${actual.main.height}, scene=${actual.scene.height}`);
      embeddedCases.push({ width, actual });
    }
    for (const { width, actual } of embeddedCases) {
      const expectedHeight = width <= 760 ? 640 : 760;
      const label = `embedded gallery, ${width}px: ${JSON.stringify(actual)}`;
      assert.equal(actual.embedded, true, label);
      assert.equal(actual.position, 'relative', label);
      assert.equal(actual.height, `${expectedHeight}px`, label);
      assert.equal(actual.main.height, expectedHeight, label);
      assert.equal(actual.scene.height, expectedHeight, label);
      assert.equal(actual.scene.top, actual.main.top, label);
      assert.equal(actual.scene.bottom, actual.main.bottom, label);
    }
    for (const width of [1200, 500]) {
      const actual = await layout(page, width, false);
      const baseline = await layout(standaloneBaseline, width, false);
      assert.deepEqual(actual, baseline, `standalone gallery, ${width}px`);
      assert.equal(actual.embedded, false);
      assert.equal(actual.position, 'fixed');
      assert.ok(actual.scene.height > 0);
      console.log(`Standalone gallery ${width}px: original layout retained (${actual.height})`);
    }
  } finally {
    await browser.close();
  }
});
