const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  const { server, store } = createEconomyPreview({
    showcase: true,
    extraPages: { '/aichat': 'aichat.html' },
  });
  store.account().assets.ordinary_fishbone = 10;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/ai/models', (route) =>
      route.fulfill({
        json: {
          defaultModel: 'qa-text',
          models: [
            {
              id: 'qa-text',
              label: '文本模型',
              efforts: ['high'],
              defaultEffort: 'high',
              vision: false,
            },
            {
              id: 'qa-vision',
              label: '视觉模型',
              efforts: ['low', 'high'],
              defaultEffort: 'high',
              vision: true,
            },
          ],
        },
      }),
    );
    await page.route('**/api/ai/dialogs', (route) => route.fulfill({ json: { dialogs: [] } }));
    await page.goto(`${base  }/aichat`);
    await page.locator('.max-composer-tools').waitFor();
    await page.waitForFunction(
      () => document.querySelector('[data-max-model]')?.options.length === 2,
    );
    const fold = page.locator('.max-composer-tools');
    assert.equal(await fold.getAttribute('open'), null);
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${  value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      for (const [width, height] of [
        [1920, 1080],
        [1440, 900],
        [1024, 768],
        [390, 844],
        [320, 740],
      ]) {
        await page.setViewportSize({ width, height });
        const geometry = await page.evaluate(() => {
          const rect = (s) => {
            const {
              x,
              y,
              width: w,
              height: h,
              bottom,
            } = document.querySelector(s).getBoundingClientRect();
            return { x, y, w, h, bottom };
          };
          return {
            cells: [
              ...document.querySelectorAll(
                '.economy-shortcuts > *, .user-economy-stack .user-status > *',
              ),
            ].map((e) => {
              const { x, y, width: w, height: h } = e.getBoundingClientRect();
              return { x, y, w, h };
            }),
            chat: rect('.aichat-main'),
            dialogs: rect('.aichat-dialogs'),
            input: rect('#aichat-input'),
            thread: rect('.aichat-thread'),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        assert.equal(geometry.cells.length, 6);
        for (let i = 0; i < 3; i += 1) {
          assert.ok(
            Math.abs(geometry.cells[i].x - geometry.cells[i + 3].x) < 2,
            JSON.stringify(geometry),
          );
          assert.ok(Math.abs(geometry.cells[i].w - geometry.cells[i + 3].w) < 2);
          assert.ok(geometry.cells[i].h >= 39 && geometry.cells[i + 3].h >= 39);
        }
        assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
        assert.ok(geometry.thread.h >= 90, JSON.stringify(geometry));
        assert.ok(geometry.input.bottom < height, JSON.stringify(geometry));
        if (width > 900) {
          assert.ok(Math.abs(geometry.chat.y - geometry.dialogs.y) < 2);
          assert.ok(Math.abs(geometry.chat.bottom - geometry.dialogs.bottom) < 2);
          assert.ok(height - geometry.chat.bottom <= 16, JSON.stringify(geometry));
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const closedHeight = await page.locator('.aichat-thread').evaluate((e) => e.clientHeight);
      await fold.locator('summary').click();
      assert.ok(await page.locator('[data-max-model]').isVisible());
      await page.locator('[data-max-model]').selectOption('qa-vision');
      await page.locator('[data-max-effort]').selectOption('low');
      if (await page.locator('[data-image-input]').count()) {
        await page.locator('[data-image-input]').setInputFiles({
          name: 'test.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            await page.evaluate(() => {
              const canvas = document.createElement('canvas');
              canvas.width = 32;
              canvas.height = 32;
              canvas.getContext('2d').fillRect(0, 0, 32, 32);
              return canvas.toDataURL('image/png').split(',')[1];
            }),
            'base64',
          ),
        });
        await page.locator('[data-image-previews] img').waitFor();
      }
      const openHeight = await page.locator('.aichat-thread').evaluate((e) => e.clientHeight);
      assert.ok(closedHeight - openHeight >= 40);
      await fold.locator('summary').click();
      assert.equal(await page.locator('[data-max-model]').inputValue(), 'qa-vision');
      assert.equal(await page.locator('[data-max-effort]').inputValue(), 'low');
      if (await page.locator('[data-image-input]').count()) {
        assert.match(await fold.locator('summary').textContent(), /已附加 1 张图片/);
        assert.equal(await page.evaluate(() => window.FreeBbsMaxImages.snapshot().length), 1);
      }
      if (process.env.HEADER_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.HEADER_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.HEADER_SCREENSHOT_DIR, `max-header-${  mode  }.png`),
        });
      }
      await fold.locator('summary').click();
      if (await page.locator('.max-image-remove').count())
        await page.locator('.max-image-remove').click();
      await fold.locator('summary').click();
    }
    await page.locator('.economy-shortcut-shop').click();
    await page.waitForURL(`${base  }/electromagnetic`);
    await page.locator('.economy-shortcut-inventory').click();
    await page.waitForURL(`${base  }/inventory`);
    await page.waitForFunction(
      () => !document.getElementById('inventory-message').textContent.includes('加载'),
    );
    assert.equal(await page.locator('[data-asset-key="ordinary_fishbone"]').count(), 0);
    assert.equal(store.account().assets.ordinary_fishbone, 10);
    await page.locator('.economy-shortcut-checkin').click();
    await page.locator('#fortune-modal:not(.hidden)').waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'PASS: aligned 2x3 header, shop/inventory/checkin links, chat height, folding preserves model/images, ordinary bones hidden, light/dark and 1920/1440/1024/390/320 widths.',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
