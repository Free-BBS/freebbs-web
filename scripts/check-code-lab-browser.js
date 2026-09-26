// Regression for the paused C/C++ lab: no compiler, model calls or production data.
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
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-code-lab-paused-'));
  const requests = [];
  server.on('request', (request) => requests.push(request.url));
  let browser;
  let cases = 0;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const workers = [];
    page.on('workercreated', (worker) => workers.push(worker.url()));
    for (const route of ['/laboratory', '/code-lab']) {
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => window.freeBbsApp && window.freeBbsTypography);
      if (route === '/laboratory') {
        const card = await page.evaluate(() => {
          const node = [...document.querySelectorAll('.laboratory-card')].find((item) =>
            item.textContent.includes('C / C++ 运行环境'),
          );
          return { text: node.textContent, links: node.querySelectorAll('a, button').length };
        });
        assert.match(card.text, /规划中/);
        assert.match(card.text, /稳定服务器/);
        assert.equal(card.links, 0);
        assert.ok(await page.$('a[href="/circuits"]'));
        assert.ok(await page.$('a[href="/tool-workshop"]'));
      } else {
        assert.match(await page.$eval('.site-info-status', (node) => node.textContent), /规划中/);
        assert.equal(await page.$('#code-run, #code-source, [data-code-lab]'), null);
      }
      for (const width of [1440, 1024, 901, 390, 320]) {
        await page.setViewport({ width, height: width > 900 ? 1050 : 850 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate(async (value) => {
            if (document.body.classList.contains('theme-light') !== (value === 'light'))
              window.freeBbsApp.toggleThemeMode();
            await new Promise((resolve) => {
              setTimeout(resolve, 350);
            });
          }, theme);
          for (const fontPreset of [
            'transistor-lab',
            'zhongsong-study',
            'quantum-board',
            'night-oscilloscope',
          ]) {
            for (const typeScale of ['standard', 'large']) {
              await page.evaluate(
                async (preferences) => {
                  window.freeBbsTypography.applyPreferences(preferences);
                  await document.fonts.ready;
                  await new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                  });
                },
                { fontPreset, typeScale },
              );
              const measure = await page.evaluate(() => ({
                width: document.scrollingElement.clientWidth,
                scroll: document.scrollingElement.scrollWidth,
                images: [...document.querySelectorAll('main img')].every(
                  (img) => img.complete && img.naturalWidth > 0,
                ),
                status: [
                  ...document.querySelectorAll('.laboratory-status, .site-info-status'),
                ].every((node) => node.scrollWidth <= node.clientWidth + 2),
              }));
              assert.ok(
                measure.scroll <= measure.width + 2 && measure.images && measure.status,
                JSON.stringify({ route, width, theme, fontPreset, typeScale, measure }),
              );
              cases += 1;
            }
          }
          if ((width === 1440 && theme === 'light') || (width === 390 && theme === 'dark')) {
            await page.screenshot({
              path: path.join(artifacts, `${route.slice(1)}-${width}-${theme}.png`),
              fullPage: true,
            });
          }
        }
      }
    }
    await page.click('a.site-info-primary[href="/laboratory"]');
    await page.waitForFunction(() => window.location.pathname === '/laboratory');
    assert.deepEqual(errors, []);
    assert.deepEqual(workers, []);
    assert.equal(
      requests.some((url) =>
        /code-lab-assets|clang-wasm|code-lab-worker|\/api\/code\/run/.test(url),
      ),
      false,
    );
    console.log(
      JSON.stringify({
        checks: 'planned cards + direct URL + zero compiler requests/workers + return navigation',
        cases,
        artifacts,
      }),
    );
  } finally {
    if (browser) await browser.close();
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
