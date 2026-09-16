const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');
const { beijingDay } = require('../backend/economy-policy');
const catalog = require('../public/data/shop-items.json').items.filter((i) => i.enabled !== false);

(async () => {
  const { server, store } = createEconomyPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const out = process.env.ECONOMY_SCREENSHOT_DIR;
  if (out) fs.mkdirSync(out, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (dialog) => dialog.accept());
    const theme = async (mode) =>
      page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
    const contrast = async (selector) => {
      const values = await page.locator(selector).evaluateAll((elements) =>
        elements.map((el) => {
          const rgb = (s) => s.match(/[\d.]+/g).map(Number);
          const lum = (v) =>
            v
              .slice(0, 3)
              .map((x) => x / 255)
              .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
              .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
          let node = el;
          let bg;
          do {
            bg = rgb(getComputedStyle(node).backgroundColor);
            node = node.parentElement;
          } while (node && bg.length > 3 && bg[3] !== 1);
          const a = lum(rgb(getComputedStyle(el).color));
          const b = lum(bg);
          return {
            text: el.textContent.slice(0, 30),
            value: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        }),
      );
      for (const v of values)
        assert.ok(v.value >= 4.5, `${selector} ${v.text} contrast=${v.value}`);
    };
    const buy = async (key, currency) => {
      await page.goto(`${base}/electromagnetic`);
      await page.locator(`[data-action="inspect-item"][data-item-key="${key}"]`).click();
      const selector = `#shop-inspect-modal [data-action="purchase-item"]${currency ? `[data-currency="${currency}"]` : ''}`;
      await page.locator(selector).click();
      await page.waitForFunction(() =>
        document.querySelector('#shop-inspect-message').textContent.includes('已到账'),
      );
    };
    await page.goto(`${base}/electromagnetic`);
    await page
      .locator('.shop-item-card')
      .nth(catalog.length - 1)
      .waitFor();
    assert.equal(await page.locator('.shop-item-card').count(), catalog.length);
    assert.equal(await page.locator('.shop-item-card[data-item-key="plate_maxwell"]').count(), 0);
    assert.deepEqual(await page.locator('.shop-section-heading h2').allTextContents(), [
      '装扮',
      '收藏',
      '消耗品',
      '伙伴',
    ]);
    for (const [section, keys] of Object.entries({
      appearance: [
        'frame_orbit',
        'frame_aurora',
        'card_blueprint',
        'card_twilight',
        'plate_observer',
        'laser',
      ],
      collection: [
        'mysterious_fragment',
        'maxwell_spectacles',
        'faraday_ring',
        'shannon_coin',
        'hertz_resonator',
      ],
      consumables: ['differential_converter', 'fortune_bag'],
      companions: ['max_pet', 'fish', 'fishbone'],
    })) {
      assert.deepEqual(
        await page
          .locator(`[data-shop-section="${section}"] .shop-item-card`)
          .evaluateAll((cards) => cards.map((card) => card.dataset.itemKey)),
        keys,
      );
    }
    for (const mode of ['light', 'dark']) {
      await theme(mode);
      await contrast('.shop-section-heading h2, .shop-section-heading p');
      await contrast('.shop-item-copy h2, .shop-item-copy p, .shop-item-price, .shop-category');
      for (const item of catalog) {
        const card = page.locator(`.shop-item-card[data-item-key="${item.key}"]`);
        if (item.class === 'scholar_relic')
          assert.equal(await card.locator('.shop-category').textContent(), '学者收藏');
        assert.ok(
          await card.locator('img').evaluate(async (el) => {
            await el.decode();
            return el.naturalWidth > 0;
          }),
          `${item.key} image`,
        );
        await card.locator('button').click();
        await contrast(
          '#shop-inspect-title, #shop-inspect-desc, #shop-inspect-price, .shop-trade-rules p',
        );
        assert.equal(await page.locator('.shop-trade-rules').getAttribute('open'), '');
        assert.equal(await page.locator('#shop-inspect-desc').textContent(), item.desc);
        assert.equal(await page.locator('.shop-trade-rules p').textContent(), item.rules);
        if (item.class === 'scholar_relic')
          assert.match(await page.locator('.shop-trade-rules').textContent(), /后续会提供对应实物/);
        await page.keyboard.press('Escape');
      }
      if (out)
        await page.screenshot({
          animations: 'disabled',
          path: path.join(out, `shop-${mode}.png`),
          fullPage: true,
        });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      );
      await page.locator('[data-item-key="maxwell_spectacles"] button').click();
      assert.ok(
        await page
          .locator('.shop-inspect-panel')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      if (out)
        await page.screenshot({
          animations: 'disabled',
          path: path.join(out, `inspect-mobile-${mode}.png`),
        });
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await buy('laser');
    await page.goto(`${base}/inventory`);
    await page.locator('[data-asset-key="laser"][data-action="inspect-inventory-item"]').click();
    await page.locator('[data-action="charge-laser"][data-days="1"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message').textContent.includes('充值成功'),
    );
    assert.equal(store.account().electric, 9974);
    assert.equal(store.account().magnetic, 9999);
    await buy('max_pet');
    await buy('fish');
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('[data-max-actor][data-pose="hungry"]').waitFor();
    assert.equal(await page.locator('.ranch-bone-count').count(), 3);
    await page.locator('[data-extra-action="feed"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message').textContent.includes('金色'),
    );
    assert.equal(store.account().assets.golden_fishbone, 1);
    assert.equal(store.account().assets.ordinary_fishbone, undefined);
    await page
      .locator('[data-max-actor][data-pose="walk"], [data-max-actor][data-pose="greet"]')
      .waitFor();
    Object.assign(store.account().assets, {
      ordinary_fishbone: 99999,
      fishbone: 99999,
      golden_fishbone: 99999,
    });
    for (const mode of ['light', 'dark']) {
      await page.reload();
      await page.locator('.ranch-bone-count').nth(2).waitFor();
      await theme(mode);
      await contrast('.ranch-bone-count, .ranch-satiety');
      assert.equal(await page.locator('.ranch-bone-count').count(), 3);
      if (out)
        await page
          .locator('#public-profile-ranch')
          .screenshot({ animations: 'disabled', path: path.join(out, `ranch-${mode}.png`) });
    }
    await buy('fortune_bag');
    store.account().fortunes[beijingDay()] = 20;
    await page.goto(`${base}/inventory`);
    await page
      .locator('[data-asset-key="fortune_bag"][data-action="inspect-inventory-item"]')
      .click();
    await page.locator('[data-extra-action="use_bag"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message')?.textContent.includes('福袋已生效'),
    );
    assert.equal(store.account().fortunes[beijingDay()], 70);
    assert.equal(store.account().assets.fortune_bag, 0);
    await buy('differential_converter', 'magnetic');
    const before = store.account().electric;
    await page.goto(`${base}/inventory`);
    await page
      .locator('[data-asset-key="differential_converter"][data-action="inspect-inventory-item"]')
      .click();
    await page
      .locator('#shop-inspect-modal [data-action="convert"][data-direction="electric_to_magnetic"]')
      .click();
    await page.waitForFunction(() =>
      document.querySelector('#inventory-message')?.textContent.includes('已转换'),
    );
    assert.equal(store.account().electric, before - 10);
    assert.equal(store.account().assets.differential_converter, 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS: all ${catalog.length} products light/dark contrast + artwork + details; 390px dialogs; dual fee; paid pet hungry/feed; exactly 3 bone counters; bag and converter through actual UI.`,
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
