// Compare startup on the same local fixture; never contacts production services.
const assert = require('node:assert/strict');
const { createPersonalPreview } = require('./preview-personal');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

(async () => {
  const { server } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const client = await page.createCDPSession();
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluateOnNewDocument(() => {
      window.shellLoading = {
        cls: 0,
        shifts: [],
        longTasks: [],
        firstFrame: null,
        entranceAnimation: false,
      };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.shellLoading.cls += entry.value;
            window.shellLoading.shifts.push({
              value: entry.value,
              time: entry.startTime,
              nodes: entry.sources.map((s) => s.node?.className || s.node?.nodeName),
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        window.shellLoading.longTasks.push(...list.getEntries().map((e) => Math.round(e.duration)));
      }).observe({ type: 'longtask', buffered: true });
      function frame() {
        if (document.querySelector('.main-content')) {
          window.shellLoading.firstFrame ||= {
            theme: document.body.classList.contains('theme-light')
              ? 'light'
              : document.body.classList.contains('theme-dark')
                ? 'dark'
                : 'unset',
            typeScale: document.documentElement.dataset.typeScale || 'unset',
          };
          window.shellLoading.entranceAnimation ||= document
            .getAnimations()
            .some((a) => a.animationName === 'desktop-section-enter');
        }
        if (performance.now() < 4000) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    const results = [];
    for (const route of ['/aichat', '/settings', '/laboratory']) {
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => performance.now() > 1800);
      results.push(
        await page.evaluate(
          (path) => ({
            route: path,
            ...window.shellLoading,
            paints: performance
              .getEntriesByType('paint')
              .map((e) => ({ name: e.name, ms: Math.round(e.startTime) })),
          }),
          route,
        ),
      );
    }
    console.log(JSON.stringify(results, null, 2));
    if (!process.env.SHELL_LOADING_BASELINE) {
      for (const result of results) {
        assert.equal(result.entranceAnimation, false, result.route);
        assert.equal(result.firstFrame.theme, 'light', result.route);
        assert.notEqual(result.firstFrame.typeScale, 'unset', result.route);
        assert.ok(result.cls < 0.1, `${result.route}: startup layout shift ${result.cls}`);
      }
    }
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
