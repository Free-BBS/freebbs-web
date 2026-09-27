// UI-only regression with local fixtures. Never connects to a compiler or production service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');

async function main() {
  const { server } = createOnboardingPreview({ extraPages: { '/code-lab': 'code-lab.html' } });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-lab-notices-'));
  const snapshotId = `e_${'a'.repeat(32)}`;
  let browser;
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version, status: 'skipped' }),
      });
    }
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || process.env.CHROMIUM_EXECUTABLE,
    });
    const page = await browser.newPage();
    const errors = [];
    const runRequests = [];
    let capabilityMode = 'ready';
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) return request.abort('blockedbyclient');
      if (url.pathname === '/api/labs/capabilities')
        return request.respond({
          status: capabilityMode === 'error' ? 503 : 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ready: capabilityMode === 'ready',
            languages: ['c', 'cpp', 'python', 'matlab', 'verilog'],
          }),
        });
      if (url.pathname === `/api/labs/experiments/${snapshotId}`)
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            experiment: {
              id: snapshotId,
              language: 'matlab',
              title: '本地测试快照',
              source: 'disp(1 + 1);',
              result: null,
            },
          }),
        });
      if (url.pathname.startsWith('/api/labs/') && request.method() !== 'GET') {
        runRequests.push(url.pathname);
        return request.abort('blockedbyclient');
      }
      return request.continue();
    });
    const engines = {
      c: 'GCC · C17',
      cpp: 'GCC · C++17',
      python: 'CPython',
      matlab: 'GNU Octave',
      verilog: 'Icarus Verilog / vvp',
    };
    for (const [language, engine] of Object.entries(engines)) {
      await page.goto(`${origin}/code-lab?language=${language}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !document.getElementById('lab-run').disabled);
      assert.ok(
        (await page.$eval('#lab-runtime-note', (node) => node.textContent)).includes(engine),
      );
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        for (const typeScale of ['standard', 'large']) {
          await page.evaluate(
            async (settings) => {
              if (document.body.classList.contains('theme-light') !== (settings.theme === 'light'))
                window.freeBbsApp.toggleThemeMode();
              window.freeBbsTypography.applyPreferences({
                fontPreset: settings.typeScale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                typeScale: settings.typeScale,
              });
              await document.fonts.ready;
            },
            { theme, typeScale },
          );
          for (const [language, engine] of Object.entries(engines)) {
            await page.$eval(`[data-language="${language}"]`, (node) =>
              node.scrollIntoView({ block: 'center', behavior: 'instant' }),
            );
            await page.click(`[data-language="${language}"]`);
            await page.waitForFunction(
              (expected) =>
                document.querySelector('#lab-runtime-note').textContent.includes(expected),
              {},
              engine,
            );
            const layout = await page.evaluate(() => {
              const notice = document.querySelector('#lab-runtime-note');
              const box = notice.getBoundingClientRect();
              const editor = document.querySelector('#lab-source').getBoundingClientRect();
              return {
                text: notice.textContent,
                overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                fits: box.left >= 0 && box.right <= window.innerWidth + 1,
                aboveEditor: box.bottom < editor.top,
                licenseHidden: document.querySelector('#lab-octave-license-note').hidden,
              };
            });
            assert.ok(layout.text.includes(engine));
            assert.equal(layout.licenseHidden, language !== 'matlab');
            assert.equal(layout.overflow, false, `${width}/${theme}/${typeScale}/${language}`);
            assert.equal(layout.fits && layout.aboveEditor, true);
          }
          await page.$eval('[data-language="matlab"]', (node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await page.click('[data-language="matlab"]');
          await page.$eval('.lab-environment-details', (node) => {
            node.open = true;
          });
          assert.equal(
            await page.$eval(
              '#lab-octave-license-note',
              (node) => node.getBoundingClientRect().height > 0,
            ),
            true,
          );
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
          );
          await page.$eval('.lab-environment', (node) => node.scrollIntoView({ block: 'start' }));
          if (typeScale === 'standard' && width !== 320)
            await page.screenshot({ path: path.join(output, `${width}-${theme}.png`) });
          await page.$eval('.lab-environment-details', (node) => {
            node.open = false;
          });
          console.log('PASS notice layout', width, theme, typeScale, 'five languages');
        }
      }
    }
    for (const mode of ['unavailable', 'error']) {
      capabilityMode = mode;
      await page.goto(`${origin}/code-lab?language=matlab`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() =>
        document.querySelector('#lab-status').classList.contains('is-error'),
      );
      assert.equal(await page.$eval('#lab-run', (node) => node.disabled), true);
      assert.match(
        await page.$eval('#lab-runtime-note', (node) => node.textContent),
        /非 MathWorks MATLAB/,
      );
    }
    await page.goto(`${origin}/code-lab?experiment=${snapshotId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#lab-result-state').textContent === '代码快照',
    );
    assert.match(await page.$eval('#lab-runtime-note', (node) => node.textContent), /GNU Octave/);
    assert.equal(await page.$eval('#lab-source', (node) => node.value), 'disp(1 + 1);');
    assert.equal(new URL(page.url()).searchParams.get('experiment'), snapshotId);
    await page.goto(`${origin}/laboratory`, { waitUntil: 'networkidle0' });
    const card = await page.$eval(
      'a[href="/code-lab?language=matlab"]',
      (node) => node.closest('article').textContent,
    );
    assert.match(card, /Octave · MATLAB 兼容/);
    assert.match(card, /非 MathWorks\s+MATLAB/);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(runRequests, []);
    console.log(
      'PASS: direct links, language switching, unavailable/error states, legacy matlab snapshot; no code execution',
    );
    console.log('screenshots', output);
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
