// End-to-end against the real isolated runtime; accounts, posts and snapshots remain in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createLabPreview } = require('./preview-language-lab');

async function main() {
  const { server, rows, posts } = createLabPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = path.join(__dirname, '..', 'output', 'playwright');
  fs.mkdirSync(output, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1050 });
    for (const language of ['c', 'cpp', 'python', 'matlab', 'verilog']) {
      await page.goto(`${origin}/code-lab?language=${language}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => !document.getElementById('lab-run').disabled, {
        timeout: 20000,
      });
      if (language === 'python')
        await page.$eval('#lab-speed', (element) => {
          element.value = '0.01';
          element.dispatchEvent(new Event('change'));
        });
      await page.click('#lab-run');
      await page.waitForFunction(
        () =>
          !document.getElementById('lab-run').disabled &&
          document.getElementById('lab-result-state').textContent.includes('退出码'),
        { timeout: 60000 },
      );
      assert.equal(
        await page.$eval('#lab-result-state', (element) => element.textContent),
        '退出码 0',
        await page.$eval('#lab-console', (element) => element.textContent),
      );
      if (['c', 'cpp'].includes(language)) {
        for (const target of ['mips', 'riscv', 'x86']) {
          await page.click(`[data-result-tab="${target}"]`);
          assert.match(await page.$eval('.lab-assembly', (element) => element.textContent), /main/);
        }
      } else if (language === 'python')
        assert.match(
          await page.$eval('.lab-variables', (element) => element.textContent),
          /total.*int.*20/s,
        );
      else if (language === 'matlab')
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.lab-figure img')].some(
            (img) => img.complete && img.naturalWidth > 0,
          ),
        );
      else assert.ok(await page.$('.lab-wave'));
      await page.screenshot({ path: path.join(output, `lab-${language}.png`), fullPage: true });
      await page.click('#lab-share');
      await page.waitForFunction(
        () =>
          location.pathname === '/publish' &&
          document
            .getElementById('discussion-compose-content')
            ?.value.includes('/code-lab?experiment='),
      );
      const content = await page.$eval('#discussion-compose-content', (element) => element.value);
      const id = content.match(/experiment=(e_[a-f0-9]{32})/)[1];
      assert.ok(rows.has(id));
      await page.click('.publish-submit');
      await page.waitForFunction(() => location.pathname === '/discussion', { timeout: 15000 });
      assert.equal(posts[0].preview.type, 'lab');
      await page.waitForSelector('.lab-embed .lab-preview', { timeout: 15000 });
      await page.screenshot({
        path: path.join(output, `lab-${language}-discussion.png`),
        fullPage: true,
      });
      await page.goto(`${origin}/code-lab?experiment=${id}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() =>
        document.getElementById('lab-result-state').textContent.includes('快照'),
      );
      assert.ok((await page.$eval('#lab-source', (element) => element.value)).length > 20);
      await page.setViewport({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.screenshot({
        path: path.join(output, `lab-${language}-mobile.png`),
        fullPage: true,
      });
      await page.setViewport({ width: 1440, height: 1050 });
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: five languages, assembly tabs, live variables, real plots/waveforms, share/publish/preview/reopen, mobile overflow.',
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
