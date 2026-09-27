// Local-only visual matrix for the rebuilt handbook and its welcome card.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const { GUIDE_VERSION, LATEST_RELEASE } = require('../public/max-guide-releases');
const { STATIONS } = require('../public/max-guide-stations');

(async () => {
  const { server } = createOnboardingPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-guide-layout-'));
  let browser;
  try {
    for (const version of [GUIDE_VERSION, LATEST_RELEASE.id]) {
      const response = await fetch(`${origin}/api/onboarding`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ version }),
      });
      assert.equal(response.status, 200);
    }
    browser = await puppeteer.launch({
      executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROME_PATH,
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith(`${origin}/`) || /^(data:|blob:)/.test(request.url()))
        request.continue();
      else request.abort();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${origin}/guide`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => Boolean(window.freeBbsMaxGuide));
    await page.evaluate(() => window.freeBbsApp.sessionReady);
    assert.deepEqual(
      await page.$$eval('[data-guide-station]', (nodes) =>
        nodes.map((node) => node.dataset.guideStation),
      ),
      STATIONS.map((station) => station.id),
    );
    let checked = 0;
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
        }, theme);
        for (const fontPreset of [
          'transistor-lab',
          'zhongsong-study',
          'quantum-board',
          'night-oscilloscope',
        ]) {
          for (const typeScale of ['standard', 'large']) {
            const label = `${width} ${theme} ${fontPreset} ${typeScale}`;
            await page.evaluate(
              async (preferences) => {
                window.freeBbsTypography.applyPreferences(preferences);
                await document.fonts.ready;
                await new Promise((resolve) => {
                  setTimeout(resolve, 150);
                });
              },
              { fontPreset, typeScale },
            );
            const handbook = await page.evaluate(() => ({
              fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
              cardsFit: [...document.querySelectorAll('.guide-station-link')].every(
                (node) =>
                  node.scrollWidth <= node.clientWidth + 1 &&
                  node.getBoundingClientRect().right <= window.innerWidth + 1,
              ),
              valuesFit: [...document.querySelectorAll('.guide-values article')].every(
                (node) => node.scrollWidth <= node.clientWidth + 1,
              ),
              atlasFit: [...document.querySelectorAll('.guide-place')].every(
                (node) => node.scrollWidth <= node.clientWidth + 1,
              ),
            }));
            assert.equal(handbook.fits, true, `${label}: handbook overflow`);
            assert.equal(handbook.cardsFit, true, `${label}: chapter card overflow`);
            assert.equal(handbook.valuesFit, true, `${label}: three FREE statements overflow`);
            assert.equal(handbook.atlasFit, true, `${label}: feature card overflow`);
            await page.evaluate(() => window.freeBbsMaxGuide.start());
            await page.waitForSelector('.max-tour[open] .guide-primary');
            await page.evaluate(
              () =>
                new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                }),
            );
            const modal = await page.evaluate(() => {
              const card = document.querySelector('.max-tour-card');
              const rect = card.getBoundingClientRect();
              return {
                horizontalFit:
                  card.scrollWidth <= card.clientWidth + 1 &&
                  rect.left >= 0 &&
                  rect.right <= window.innerWidth + 1,
                verticalFit: rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
              };
            });
            assert.equal(modal.horizontalFit, true, `${label}: welcome overflow`);
            assert.equal(modal.verticalFit, true, `${label}: welcome outside viewport`);
            if (fontPreset === 'transistor-lab' && typeScale === 'standard')
              await page.screenshot({ path: path.join(output, `${width}-${theme}-welcome.png`) });
            await page.evaluate(() => window.freeBbsMaxGuide.pause());
            checked += 1;
          }
        }
        if (width === 1440 || width === 390) {
          await page.$eval('.guide-manifesto', (node) => node.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: path.join(output, `${width}-${theme}-principles.png`) });
          await page.$eval('#guide-stations', (node) => node.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: path.join(output, `${width}-${theme}-chapters.png`) });
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      `Guide layout: ${checked} handbook/welcome combinations passed. Screenshots: ${output}`,
    );
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
