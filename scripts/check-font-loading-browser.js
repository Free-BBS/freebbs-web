// Controlled slow-font test. The browser's external font requests are intercepted;
// no traffic leaves localhost. Compare the old blocking link and production transform.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { preparePageShell } = require('../page-shell');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

async function main() {
  const original = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
  const font = original.match(/<link\b[^>]*href="https:\/\/fonts.googleapis.com\/css[^>]*>/)[0];
  const source =
    `<!doctype html><html><head><meta charset="utf-8">${
      font
    }<style>body{font:20px system-ui;background:#133c45;color:white}main{padding:40px}</style></head>` +
    `<body><main><h1>FREE BBS</h1><button>可以操作</button></main><script src="/ready.js"></script></body></html>`;
  const server = http.createServer((req, res) => {
    const js = req.url === '/ready.js';
    res.setHeader('Content-Type', js ? 'text/javascript' : 'text/html');
    res.end(
      js
        ? 'window.refreshReadyAt=performance.now()'
        : req.url === '/before'
          ? source
          : req.url === '/after'
            ? preparePageShell(source)
            : '',
    );
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const delay = 1800;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    let failFont = false;
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (url.hostname === 'fonts.googleapis.com') {
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
        if (failFont) return request.abort('failed');
        return request.respond({
          status: 200,
          contentType: 'text/css',
          body: '/* delayed optional fonts */',
        });
      }
      return url.origin === origin ? request.continue() : request.abort('blockedbyclient');
    });
    const results = [];
    for (const route of ['/before', '/after', '/after']) {
      failFont = results.length === 2;
      await page.goto(origin + route, { waitUntil: 'load' });
      await page.waitForFunction(() => performance.getEntriesByType('paint').length);
      results.push(
        await page.evaluate(() => ({
          ready: Math.round(window.refreshReadyAt),
          paint: Math.round(performance.getEntriesByName('first-contentful-paint')[0].startTime),
          fontMedia: document.querySelector('link[href*="fonts.googleapis"]').media,
        })),
      );
    }
    console.log(
      JSON.stringify({ delay, before: results[0], after: results[1], unreachableFont: results[2] }),
    );
    assert.ok(results[0].ready >= delay, 'baseline reproduces blocking startup');
    for (const result of results.slice(1)) {
      assert.ok(
        result.ready < delay / 2 && result.paint < delay / 2,
        'font latency must not delay controls or paint',
      );
    }
    assert.equal(results[1].fontMedia, 'all', 'successful font CSS still applies');
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
