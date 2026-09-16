const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  const { server } = createEconomyPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage();
    const records = [
      { date: '2026-09-16', streak: 4, rewardMagnetic: 3 },
      { date: '2026-09-15', streak: 3, rewardElectrons: 3 },
      { date: '2026-09-14', streak: 2, rewardElectrons: 2 },
      { date: '2026-09-13', streak: 1, rewardElectrons: 1 },
    ];
    await page.route('**/api/checkin', (route) =>
      route.fulfill({
        json: { checkedInToday: true, today: records[0], records },
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/profile?uid=u_preview01`);
    await page.locator('.economy-shortcut-checkin').click();
    await page.locator('.fortune-record-row').last().waitFor();
    assert.equal(await page.locator('.fortune-record-row').count(), 4);
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      for (const width of [1440, 820, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        const rows = await page.locator('.fortune-record-row').evaluateAll((elements) =>
          elements.map((el) => ({
            right: el.getBoundingClientRect().right,
            cells: Array.from(el.children).map((cell) => ({
              left: cell.getBoundingClientRect().left,
              right: cell.getBoundingClientRect().right,
              align: getComputedStyle(cell).textAlign,
              overflow: cell.scrollWidth - cell.clientWidth,
            })),
          })),
        );
        for (const row of rows) {
          row.cells.forEach((cell, index) => {
            assert.equal(cell.align, 'left');
            assert.ok(Math.abs(cell.left - rows[0].cells[index].left) < 1);
            assert.ok(cell.right <= row.right + 1);
            assert.ok(cell.overflow <= 1);
          });
        }
      }
    }
    console.log(
      'PASS: current/legacy check-in columns align left in both themes at 1440/820/390/320px.',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
