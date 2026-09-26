// Loopback-only navigation checks; no production accounts, AI generation or writes.
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
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-navigation-'));
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage();
    const errors = [];
    const unexpected = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return request.abort('blockedbyclient');
      }
      requests.push(url.pathname);
      return request.continue();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    for (const width of [390, 360]) {
      await page.setViewport({ width, height: 740 });
      await page.goto(`${origin}/pbl`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => window.freeBbsApp.sessionReady);
      assert.equal(await page.$$eval('.mobile-nav > *', (nodes) => nodes.length), 5);
      assert.equal(
        await page.$eval('.mobile-tools-toggle', (node) => node.classList.contains('is-active')),
        true,
      );
      assert.equal(await page.$('#mobile-learning-menu [href="/pbl"]'), null);
      await page.click('.mobile-learning-toggle');
      assert.deepEqual(
        await page.$$eval('#mobile-learning-menu a', (nodes) =>
          nodes.map((node) => node.getAttribute('href')),
        ),
        ['/world', '/laboratory', '/creative-workshop'],
      );
      await page.focus('.mobile-tools-toggle');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.$eval('#mobile-learning-menu', (node) => node.hidden), true);
      assert.equal(await page.$eval('#mobile-tools-menu', (node) => node.hidden), false);
      assert.equal(
        await page.$eval('#mobile-tools-menu [href="/pbl"]', (node) =>
          node.getAttribute('aria-current'),
        ),
        'page',
      );
      await page.keyboard.press('Escape');
      assert.equal(
        await page.$eval('.mobile-tools-toggle', (node) => document.activeElement === node),
        true,
      );
      await page.click('.mobile-learning-toggle');
      // Opening another menu using the keyboard must close the first one as well.
      await page.focus('.mobile-publish');
      await page.keyboard.press('Enter');
      assert.equal(await page.$eval('#mobile-learning-menu', (node) => node.hidden), true);
      assert.equal(await page.$eval('#mobile-create-menu', (node) => node.hidden), false);
      await page.keyboard.press('Escape');
      await page.click('.mobile-tools-toggle');
      const bounds = await page.$eval('#mobile-tools-menu', (node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          viewport: window.innerWidth,
        };
      });
      assert.ok(
        bounds.top >= 0 && bounds.right <= bounds.viewport + 1 && bounds.bottom <= 740,
        JSON.stringify(bounds),
      );
      await page.click('#mobile-tools-menu [href="/pbl"]');
      await page.waitForFunction(() => window.location.pathname === '/pbl' && window.freeBbsApp);
      await page.click('.mobile-learning-toggle');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('#mobile-learning-menu [href="/laboratory"]'),
      ]);
      assert.equal(new URL(page.url()).pathname, '/laboratory');
      assert.equal(await page.$$eval('.laboratory-enter', (nodes) => nodes.length), 4);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('.laboratory-enter[href="/tool-workshop"]'),
      ]);
      assert.equal(new URL(page.url()).pathname, '/tool-workshop');
      await page.waitForSelector('#tool-gallery-status');
      await page.click('#tool-create-toggle');
      assert.equal(await page.$eval('#tool-studio', (node) => node.hidden), false);
      await page.click('.mobile-learning-toggle');
      assert.equal(
        await page.$eval('#mobile-learning-menu [href="/laboratory"]', (node) =>
          node.getAttribute('aria-current'),
        ),
        'page',
      );
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('#mobile-learning-menu [href="/creative-workshop"]'),
      ]);
      assert.equal(await page.$eval('time', (node) => node.getAttribute('datetime')), '2026-10');
      assert.match(await page.$eval('.development-hero-copy', (node) => node.textContent), /V1.2/);
      // PBL must not reuse the privileged development-entry redirect script.
      assert.equal(requests.includes('/api/development/entry'), false);
    }
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${origin}/pbl`, { waitUntil: 'networkidle0' });
    const menu = await page.$$eval('.nav-actions > .nav-link', (nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().height > 0)
        .map((node) => ({ href: node.getAttribute('href'), y: node.getBoundingClientRect().y })),
    );
    assert.deepEqual(
      menu.map((node) => node.href),
      [
        '/',
        '/world',
        '/discussion',
        '/workbench',
        '/laboratory',
        '/creative-workshop',
        '/pbl',
        '/aichat',
        '/surveys',
      ],
    );
    assert.ok(menu.every((node, index) => index === 0 || node.y > menu[index - 1].y));
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 1440 ? 960 : 844 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
        }, theme);
        await page.$eval('.development-scene img', (node) => node.decode());
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.$eval('.development-scene-label', (node) => getComputedStyle(node).color),
          'rgb(255, 255, 255)',
          'artwork caption must remain readable on its dark scrim',
        );
        if (width <= 900) {
          assert.equal(
            await page.$$eval('.mobile-primary > span, .mobile-tool-link > span', (nodes) =>
              nodes.every(
                (node) =>
                  getComputedStyle(node).color === getComputedStyle(node.parentElement).color,
              ),
            ),
            true,
            'mobile labels must follow their themed navigation controls',
          );
        }
        await page.screenshot({
          path: path.join(output, `pbl-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    console.log(
      `Navigation OK: desktop order; five mobile slots; PBL in Tools; keyboard menu exclusivity; real lab/workshop navigation; no writes. Screenshots: ${output}`,
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
