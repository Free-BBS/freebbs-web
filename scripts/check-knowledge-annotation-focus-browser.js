// Isolated native Chrome keyboard and small-viewport hit-target regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createCompleteLearningPreview } = require('./preview-learning-complete');
const { listenAllowedLoopback } = require('./fixtures/allowed-loopback');

const toolbar = '#learning-annotation-toolbar';
async function assertFocus(page, selector) {
  const focus = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      active: document.activeElement === element,
      visible: !element.closest('[hidden],.hidden'),
      hit: element === hit || element.contains(hit),
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      activeName:
        document.activeElement?.id ||
        document.activeElement?.getAttribute('aria-label') ||
        document.activeElement?.tagName,
    };
  });
  assert.ok(
    focus.active && focus.visible && focus.hit,
    `${selector} is the visible hit-testable focus target: ${JSON.stringify(focus)}`,
  );
  return focus;
}

async function run(browser, scenario) {
  const preview = createCompleteLearningPreview();
  await listenAllowedLoopback(preview.server);
  const base = `http://127.0.0.1:${preview.server.address().port}`;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  const observations = [];
  let layout;
  try {
    page.setDefaultTimeout(15000);
    await page.setViewport(scenario);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(
      (theme) => localStorage.setItem('free_bbs_theme_mode', theme),
      scenario.theme,
    );
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) request.continue();
      else {
        blocked.push(url.origin + url.pathname);
        request.abort('blockedbyclient');
      }
    });
    await page.goto(`${base}/world?guideTour=1`, { waitUntil: 'domcontentloaded' });
    await page.locator('.max-tour[open] .max-tour-controls > .max-tour-later').click();
    await page.goto(`${base}/knowledge?course=signals&point=SS-02-01&view=reading`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#knowledge-reading:not(.hidden) #knowledge-body > p', {
      visible: true,
    });
    await page.waitForFunction(
      () => window.freeBbsKnowledge?.getLearningContext()?.node?.documentVersion,
    );
    const maxOpen = await page.$eval(
      '#knowledge-chat-panel',
      (element) => !element.hidden && !element.closest('[hidden],.hidden'),
    );
    if (maxOpen) await page.locator('#knowledge-chat-close').click();
    await page.locator('#knowledge-reading [data-learning-go="notes"]').click();
    await page.waitForSelector(`${toolbar}:not([hidden])`, { visible: true });
    layout = await page.$eval(toolbar, (element) => {
      const box = element.getBoundingClientRect();
      const items = [
        ...element.querySelectorAll(
          ':scope > .learning-annotation-icon,:scope > .learning-annotation-split',
        ),
      ].map((item) => {
        const rect = item.getBoundingClientRect();
        return { top: rect.top, right: rect.right };
      });
      return {
        width: box.width,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        oneRow: items.every((item) => Math.abs(item.top - items[0].top) <= 1),
        within: items.every((item) => item.right <= box.right + 1),
        count: items.length,
      };
    });
    assert.equal(layout.count, 7);
    assert.ok(
      layout.oneRow && layout.within && layout.scrollWidth <= layout.clientWidth + 1,
      'single compact toolbar fits without clipping',
    );
    for (const type of ['highlight', 'underline']) {
      const menu = `${toolbar} [data-annotation-menu="${type}"]`;
      await page.focus(menu);
      await page.keyboard.press('Enter');
      const selectedColor = `${toolbar} [data-annotation-palette="${type}"][aria-pressed="true"]`;
      await assertFocus(page, selectedColor);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      const afterColor = await assertFocus(page, menu);
      assert.equal(
        await page.$eval(menu, (element) => element.getAttribute('aria-expanded')),
        'false',
      );
      await page.keyboard.press('Enter');
      await assertFocus(page, selectedColor);
      await page.keyboard.press('Escape');
      const afterEscape = await assertFocus(page, menu);
      assert.equal(
        await page.$eval(menu, (element) => element.getAttribute('aria-expanded')),
        'false',
      );
      if (scenario.width <= 620)
        assert.ok(
          afterEscape.width >= 24 && afterEscape.height >= 36,
          'narrow menu has a real >=24x36 target',
        );
      // Native corner click proves the enlarged box is interactive, not padding
      // around an unreachable child or an overlap with the neighbouring icon.
      const corner = await page.$eval(menu, (element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left + 2, y: rect.top + 2 };
      });
      await page.mouse.click(corner.x, corner.y);
      assert.equal(
        await page.$eval(menu, (element) => element.getAttribute('aria-expanded')),
        'true',
      );
      await page.keyboard.press('Escape');
      await assertFocus(page, menu);
      observations.push({ type, afterColor, afterEscape, cornerHit: true });
    }
    assert.equal(
      preview.learning.store.rows.filter((row) => row.annotation).length,
      0,
      'UI-only selection makes no annotation write',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    return { scenario, passed: true, layout, observations, errors, blocked };
  } catch (error) {
    return {
      scenario,
      passed: false,
      error: error.stack,
      layout,
      observations,
      errors,
      blocked,
      page: await page
        .evaluate(() => ({
          url: window.location.href,
          documentTitle: document.title,
          responseText: document.body?.innerText?.slice(0, 450),
          responseHead: document.documentElement?.outerHTML?.slice(0, 250),
          dialogs: [...document.querySelectorAll('dialog[open]')].map(
            (node) => node.id || node.className,
          ),
          title: document.querySelector('#knowledge-title')?.textContent,
          reading: document.querySelector('#knowledge-reading')?.className,
          body: document.querySelector('#knowledge-body')?.textContent?.slice(0, 180),
        }))
        .catch(() => null),
    };
  } finally {
    await context.close();
    await new Promise((resolve) => {
      preview.server.close(resolve);
      preview.server.closeAllConnections();
    });
  }
}

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-annotation-focus-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const results = [];
  try {
    for (const scenario of [
      { width: 1440, height: 900, theme: 'light' },
      { width: 390, height: 844, theme: 'dark' },
      { width: 320, height: 700, theme: 'light' },
      { width: 320, height: 500, theme: 'dark' },
    ]) {
      const result = await run(browser, scenario);
      results.push(result);
      console.log(JSON.stringify(result));
    }
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          boundary:
            'Isolated native Chrome keyboard/pointer; not physical touch, screen-reader, real account, formal learning evidence, or real AI testing.',
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Annotation focus browser QA: ${output}`);
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
