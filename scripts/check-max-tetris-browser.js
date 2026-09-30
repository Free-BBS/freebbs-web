// Local rendering/interaction fixtures only. Never requests a real image from AI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createEconomyPreview } = require('./preview-economy');
const { COLORS } = require('../public/max-tetris');

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-max-tetris-'));
  const { server } = createEconomyPreview({
    showcase: true,
    extraPages: { '/aichat': 'aichat.html' },
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  const results = [];
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin && !/^(data|blob):/.test(url.protocol))
        return request.respond({ status: 204 });
      if (url.pathname.startsWith('/api/ai/'))
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ models: [], dialogs: [] }),
        });
      return request.continue();
    });
    for (const route of ['/aichat', '/discussion']) {
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.FreeBbsMaxImageResults && window.FreeBbsMaxTetris);
      await page.evaluate(() => window.freeBbsApp.sessionReady);
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          document.body.classList.toggle('theme-light', mode === 'light');
          document.body.classList.toggle('theme-dark', mode === 'dark');
        }, theme);
        for (let index = 0; index < 7; index += 1) {
          await page.evaluate((piece) => {
            const previous = document.getElementById('tetris-qa');
            if (previous) {
              window.FreeBbsMaxTetris.dispose(previous);
              previous.remove();
            }
            const article = document.createElement('article');
            article.id = 'tetris-qa';
            article.className = 'aichat-message aichat-message-assistant';
            article.innerHTML =
              '<div class="aichat-avatar" aria-hidden="true"></div><div class="aichat-bubble"></div>';
            (
              document.querySelector('.aichat-thread') ||
              document.querySelector('.discussion-feed') ||
              document.querySelector('main')
            ).append(article);
            const random = Math.random;
            try {
              Math.random = () => (piece + 0.5) / 7;
              window.FreeBbsMaxImageResults.showProgress(article, '正在生成图片');
              article.querySelector('.max-image-placeholder-activate').click();
              article.querySelector('[data-tetris-action="pause"]').click();
            } finally {
              Math.random = random;
            }
          }, index);
          const pixels = await page.$eval('#tetris-qa canvas', (canvas) => {
            const context = canvas.getContext('2d');
            const colors = new Set();
            for (let y = 12; y < canvas.height; y += 24)
              for (let x = 12; x < canvas.width; x += 24) {
                const rgba = context.getImageData(x, y, 1, 1).data;
                colors.add(
                  `#${[...rgba]
                    .slice(0, 3)
                    .map((byte) => byte.toString(16).padStart(2, '0'))
                    .join('')}`,
                );
              }
            return {
              colors: [...colors],
              background: getComputedStyle(canvas).getPropertyValue('--tetris-empty').trim(),
              filter: getComputedStyle(canvas).filter,
            };
          });
          assert.equal(pixels.filter, 'none');
          assert.ok(pixels.colors.includes(COLORS[index + 1]), JSON.stringify(pixels));
          assert.ok(pixels.colors.includes(pixels.background), JSON.stringify(pixels));
          assert.equal(pixels.background, theme === 'dark' ? '#101f28' : '#f3f6f7');
        }
        for (const width of [1440, 390]) {
          await page.setViewport({ width, height: 1000 });
          await page.$eval('#tetris-qa', (node) => node.scrollIntoView({ block: 'center' }));
          const contrast = await page.$eval('#tetris-qa', (article) => {
            const rgb = (value) =>
              value
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number);
            const luma = (channels) =>
              channels.reduce((sum, byte, index) => {
                const c = byte / 255;
                return (
                  sum +
                  (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
                    [0.2126, 0.7152, 0.0722][index]
                );
              }, 0);
            const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            const panel = article.querySelector('.max-image-placeholder');
            const background = luma(rgb(getComputedStyle(panel).backgroundColor));
            const copy = article.querySelector('[data-tetris-message]');
            const button = article.querySelector('[data-tetris-action="pause"]');
            return {
              text: ratio(background, luma(rgb(getComputedStyle(copy).color))),
              button: ratio(
                luma(rgb(getComputedStyle(button).backgroundColor)),
                luma(rgb(getComputedStyle(button).color)),
              ),
            };
          });
          assert.ok(contrast.text >= 4.5, JSON.stringify({ route, theme, width, contrast }));
          assert.ok(contrast.button >= 4.5, JSON.stringify({ route, theme, width, contrast }));
          results.push({ route, theme, width, contrast });
          await page.screenshot({
            path: path.join(output, `${route.slice(1)}-${theme}-${width}.png`),
          });
        }
        // A paused board must repaint as soon as the page theme changes.
        await page.evaluate(() => {
          document.body.classList.toggle('theme-light');
          document.body.classList.toggle('theme-dark');
        });
        await page.waitForFunction(() => {
          const canvas = document.querySelector('#tetris-qa canvas');
          const color = getComputedStyle(canvas).getPropertyValue('--tetris-empty').trim();
          const pixel = canvas.getContext('2d').getImageData(12, 36, 1, 1).data;
          return (
            `#${[...pixel]
              .slice(0, 3)
              .map((byte) => byte.toString(16).padStart(2, '0'))
              .join('')}` === color
          );
        });
        await page.click('#tetris-qa [data-tetris-action="pause"]');
        await page.click('#tetris-qa [data-tetris-action="drop"]');
        const interaction = await page.$eval('#tetris-qa', (node) => {
          const button = node.querySelector('[data-tetris-action="drop"]');
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return {
            route: window.location.pathname,
            paused: node.querySelector('[data-tetris-action="pause"]').textContent,
            score: node.querySelector('[data-tetris-score]').textContent,
            hit: hit?.outerHTML.slice(0, 400),
            message: node.querySelector('[data-tetris-message]').textContent,
          };
        });
        assert.ok(
          Number(await page.$eval('#tetris-qa [data-tetris-score]', (node) => node.textContent)) >
            0,
          JSON.stringify(interaction),
        );
      }
      await page.evaluate(() =>
        window.FreeBbsMaxTetris.dispose(document.getElementById('tetris-qa')),
      );
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ output, results, errors }));
  } finally {
    await browser?.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
