// Local fixed prose only: no API, real account, preference writes or outside traffic.
const assert = require('node:assert/strict');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPreviewServer } = require('./preview-knowledge-typography');

async function main() {
  const server = createPreviewServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  const failedAssets = [];
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith(origin) || request.url().startsWith('data:')) request.continue();
      else request.abort();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && /\.(?:js|css|otf|woff2?)(?:\?|$)/.test(response.url()))
        failedAssets.push(response.url());
    });
    await page.goto(`${origin}/knowledge-typography`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#knowledge-body .katex'));
    const choices = await page.evaluate(() => ({
      presets: Object.keys(window.freeBbsTypography.presets),
      scales: Object.keys(window.freeBbsTypography.typeScalePresets),
    }));
    let checked = 0;
    for (const fontPreset of choices.presets) {
      for (const typeScale of choices.scales) {
        const result = await page.evaluate(
          async (choice) => {
            const contract = window.freeBbsTypographyPreferences;
            const api = window.freeBbsTypography;
            api.applyPreferences(choice);
            await document.fonts.ready;
            const normalizedFamily = (family) => {
              const sample = document.createElement('span');
              sample.style.fontFamily = family;
              return sample.style.fontFamily;
            };
            const style = (selector) => getComputedStyle(document.querySelector(selector));
            const fonts = contract.presets[choice.fontPreset].fonts;
            return {
              ordinary: style('#knowledge-body > p').fontFamily,
              bodyWeight: style('#knowledge-body > p').fontWeight,
              strongWeight: style('#knowledge-body strong').fontWeight,
              code: style('#knowledge-body pre code').fontFamily,
              math: style('#knowledge-body .katex').fontFamily,
              expectedBody: normalizedFamily(
                choice.fontPreset === 'zhongsong-study'
                  ? contract.knowledgeBody.family
                  : fonts.zhBody,
              ),
              expectedCode: normalizedFamily(fonts.code),
              expectedMath: normalizedFamily(fonts.math),
              rootSize: style('html').fontSize,
              expectedRootSize: contract.mainSiteVariables(choice)['--main-site-ui-size'],
              dataScripts: document.querySelectorAll('script[src="/typography-preferences.js"]')
                .length,
              controllerScripts: document.querySelectorAll('script[src="/typography.js"]').length,
            };
          },
          { fontPreset, typeScale },
        );
        assert.equal(result.ordinary, result.expectedBody, `${fontPreset}/${typeScale}: body role`);
        assert.equal(result.bodyWeight, '400', `${fontPreset}/${typeScale}: regular prose`);
        assert.equal(result.strongWeight, '700', `${fontPreset}/${typeScale}: semantic emphasis`);
        assert.equal(result.code, result.expectedCode, `${fontPreset}/${typeScale}: code role`);
        assert.equal(result.math, result.expectedMath, `${fontPreset}/${typeScale}: math role`);
        assert.equal(result.rootSize, result.expectedRootSize, `${fontPreset}/${typeScale}: scale`);
        assert.equal(result.dataScripts, 1);
        assert.equal(result.controllerScripts, 1);
        checked += 1;
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(failedAssets, []);
    console.log(
      JSON.stringify({
        checked,
        roles: ['prose', 'emphasis', 'code', 'math'],
        errors,
        failedAssets,
      }),
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
