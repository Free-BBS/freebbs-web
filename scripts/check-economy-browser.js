const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  const { server, store } = createEconomyPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    const checkTheme = async (mode, selectors) => {
      await page.evaluate((theme) => {
        if (!document.body.classList.contains(`theme-${theme}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      assert.equal(
        await page.locator('body.theme-light.theme-dark').count(),
        0,
        'mutually exclusive theme classes',
      );
      assert.equal(await page.evaluate(() => localStorage.getItem('free_bbs_theme_mode')), mode);
      for (const selector of selectors) {
        const contrast = await page
          .locator(selector)
          .first()
          .evaluate((el) => {
            const rgb = (value) => value.match(/[\d.]+/g)?.map(Number) || [];
            const color = rgb(getComputedStyle(el).color);
            let node = el;
            let bg = [];
            while (node) {
              bg = rgb(getComputedStyle(node).backgroundColor);
              if (bg.length === 3 || bg[3] === 1) break;
              node = node.parentElement;
            }
            const luminance = (values) =>
              values
                .slice(0, 3)
                .map((v) => v / 255)
                .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
            const c = luminance(color);
            const b = luminance(bg);
            return (Math.max(c, b) + 0.05) / (Math.min(c, b) + 0.05);
          });
        assert.ok(contrast >= 4.5, `${mode} ${selector} contrast ${contrast.toFixed(2)} < 4.5`);
      }
    };
    const buyItem = async (key) => {
      await page.goto(`${base}/electromagnetic`);
      await page.locator(`[data-action="inspect-item"][data-item-key="${key}"]`).click();
      await page.locator('#shop-inspect-modal [data-action="purchase-item"]').click();
      await page.waitForFunction(() =>
        document.querySelector('#shop-inspect-message').textContent.includes('已到账'),
      );
    };
    await page.goto(`${base}/electromagnetic`);
    await page.locator('.shop-item-card').nth(7).waitFor();
    await page.locator('[data-preview-theme]').evaluate((el) => {
      el.closest('details').open = true;
    });
    await page.locator('[data-preview-theme]').click();
    assert.equal(
      await page.locator('body.theme-dark:not(.theme-light)').count(),
      1,
      'preview toggle uses the real theme handler',
    );
    await page.locator('[data-preview-theme]').evaluate((el) => {
      el.closest('details').open = false;
    });
    await page.reload();
    await page.locator('body.theme-dark:not(.theme-light) .shop-item-card').first().waitFor();
    for (const route of ['inventory', 'electromagnetic']) {
      await page.goto(`${base}/${route}`);
      for (const mode of ['light', 'dark', 'light']) {
        await checkTheme(mode, ['.economy-inventory-link span']);
        const icon = page.locator('.economy-inventory-link img');
        await icon.evaluate(async (el) => {
          await el.decode();
        });
        assert.equal(
          await icon.evaluate((el) => getComputedStyle(el).filter),
          mode === 'dark' ? 'brightness(0) invert(0.93)' : 'none',
          `${route} navigation icon must follow ${mode} theme`,
        );
        if (process.env.ECONOMY_SCREENSHOT_DIR) {
          await page.locator('.economy-inventory-link').screenshot({
            path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `${route}-nav-${mode}.png`),
          });
        }
      }
    }
    for (const mode of ['dark', 'light']) {
      await checkTheme(mode, [
        '.shop-item-copy h2',
        '.shop-item-copy p',
        '.shop-item-price',
        '.shop-item-card button',
      ]);
      assert.equal(
        await page
          .locator('.shop-item-image img[src$="/frame_orbit.svg"]')
          .evaluate((el) => getComputedStyle(el).filter),
        'none',
      );
      assert.ok(
        await page
          .locator('.shop-item-image img[src$="/frame_orbit.svg"]')
          .evaluate((el) => el.complete && el.naturalWidth > 0),
      );
      if (process.env.ECONOMY_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `shop-${mode}.png`),
          fullPage: true,
        });
    }
    await page.locator('[data-action="inspect-item"][data-item-key="laser"]').click();
    await page.locator('#shop-inspect-modal [data-action="purchase-item"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message').textContent.includes('已到账'),
    );
    assert.equal(store.account().assets.laser, 1);
    await page.goto(`${base}/inventory`);
    await page.locator('[data-action="inspect-inventory-item"][data-asset-key="laser"]').click();
    await page.locator('[data-action="charge-laser"][data-days="1"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message').textContent.includes('充值成功'),
    );
    assert.equal(store.account().electric, 9989);
    await page.goto(`${base}/discussion`);
    await page.locator('.discussion-post-card').nth(2).waitFor();
    assert.equal(await page.locator('.discussion-post-card.has-laser-glow').count(), 1);
    store.account().expiresAtMs = Date.now() + 1000;
    await page.reload();
    await page.locator('.discussion-post-card.has-laser-glow').waitFor();
    await page
      .locator('.discussion-post-card.has-laser-glow')
      .waitFor({ state: 'detached', timeout: 5000 });
    await page.goto(`${base}/electromagnetic`);
    await page.locator('[data-action="inspect-item"][data-item-key="maxwell_spectacles"]').click();
    const buy = page.locator('#shop-inspect-modal [data-action="purchase-item"]');
    assert.equal(await buy.count(), 1);
    assert.match(await buy.textContent(), /120 电元 ＋ 600 磁元/);
    assert.doesNotMatch(await page.locator('#shop-inspect-desc').textContent(), /支付|购买|限购/);
    await buy.click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message').textContent.includes('已到账'),
    );
    assert.equal(store.account().electric, 9869);
    assert.equal(store.account().magnetic, 9400);
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('#public-profile-collectibles figure').waitFor();
    assert.match(await page.locator('#public-profile-collectibles').textContent(), /麦克斯韦/);
    for (const key of [
      'frame_orbit',
      'frame_aurora',
      'plate_maxwell',
      'plate_observer',
      'card_blueprint',
      'card_twilight',
      'fish',
      'fish',
    ])
      await buyItem(key);
    await page.goto(`${base}/inventory`);
    await page
      .locator('[data-action="inspect-inventory-item"][data-asset-key="frame_orbit"]')
      .click();
    await page.locator('[data-extra-action="equip"][data-item="frame_orbit"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#shop-inspect-message').textContent.includes('已佩戴'),
    );
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('#public-profile-wardrobe:not([hidden])').waitFor();
    for (const key of ['plate_maxwell', 'card_blueprint']) {
      await page.locator(`[data-extra-action="equip"][data-item="${key}"]`).click();
      await page.waitForFunction(
        (item) =>
          document.querySelector(`[data-item="${item}"]`).getAttribute('aria-pressed') === 'true',
        key,
      );
    }
    await page.locator('[data-extra-action="adopt"]').click();
    await page.locator('[data-max-actor] svg').waitFor();
    await page.locator('[data-extra-action="feed"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message').textContent.includes('金色'),
    );
    await page.locator('[data-extra-action="feed"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message').textContent.includes('小纪念'),
    );
    assert.equal(store.account().assets.fish, 0);
    assert.equal(store.account().assets.golden_fishbone, 1);
    assert.equal(store.account().assets.fishbone, 3);
    assert.equal(
      await page.locator('.public-profile-avatar').getAttribute('data-avatar-frame'),
      'frame_orbit',
      'public avatar displays the owner-selected frame',
    );
    assert.equal(await page.locator('#profile-decoration-preview').count(), 0);
    assert.equal(
      await page.locator('.public-profile-shell').getAttribute('data-profile-card'),
      'card_blueprint',
    );
    for (const mode of ['light', 'dark']) {
      await checkTheme(mode, ['.profile-ranch h2', '.ranch-intro', '.profile-wardrobe h2']);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (process.env.ECONOMY_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `profile-${mode}.png`),
          fullPage: true,
        });
    }
    await page.locator('[data-ranch-pause]').click();
    assert.equal(await page.locator('[data-max-actor]').getAttribute('data-paused'), 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('[data-max-actor]').getAttribute('data-paused'), 'true');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${base}/settings`);
    await page.locator('[data-extra-action="feed"]').waitFor();
    const originalAvatarSrc = await page.locator('#settings-avatar-image').getAttribute('src');
    await page
      .locator('#settings-avatar-input')
      .setInputFiles(path.join(__dirname, '../public/assets/avatar_placeholder.webp'));
    await page.locator('[data-avatar-preview]:not([hidden])').waitFor();
    await page.locator('[data-avatar-action="cancel"]').click();
    assert.equal(
      await page.locator('#settings-avatar-image').getAttribute('src'),
      originalAvatarSrc,
      'original avatar choose/cancel remains intact',
    );
    await page.locator('#settings-font-preset').selectOption('zhongsong-study');
    const avatarBox = await page.locator('#settings-avatar-editor').boundingBox();
    const ranchBox = await page.locator('#public-profile-ranch').boundingBox();
    assert.ok(ranchBox.x >= avatarBox.x + avatarBox.width, 'desktop ranch is right of avatar');
    const originalControls = [
      '#settings-avatar-editor h2',
      '#settings-avatar-help',
      '#settings-full-name',
      '#settings-website-url',
      '#settings-bio',
      '#settings-font-preset',
    ];
    const readStyles = async () =>
      page.evaluate(
        (selectors) =>
          selectors.map((s) => {
            const style = getComputedStyle(document.querySelector(s));
            return [
              style.fontFamily,
              style.fontSize,
              style.fontWeight,
              style.lineHeight,
              style.color,
            ];
          }),
        originalControls,
      );
    const originalStyles = await readStyles();
    await page.locator('link[href="/profile-extras.css"]').evaluate((el) => {
      el.disabled = true;
    });
    assert.deepEqual(
      await readStyles(),
      originalStyles,
      'new stylesheet leaves original fonts and colors unchanged',
    );
    await page.locator('link[href="/profile-extras.css"]').evaluate((el) => {
      el.disabled = false;
    });
    await page.locator('#settings-bio').fill('未保存的个人简介');
    await page.locator('#settings-website-url').fill('https://example.com/draft');
    // An interrupted fortune request must not spend food; retry then creates today's fortune.
    store.account().assets.fish = 1;
    store.account().fortunes = {};
    await page.reload();
    await page.locator('#settings-bio').fill('未保存的个人简介');
    await page.locator('#settings-website-url').fill('https://example.com/draft');
    await page.route(
      '**/api/fortune',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"模拟运势暂时失败"}',
        }),
      { times: 1 },
    );
    await page.locator('[data-extra-action="feed"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message').textContent.includes('可重试'),
    );
    assert.equal(store.account().assets.fish, 1);
    await page.locator('[data-extra-action="feed"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message').textContent.includes('小纪念'),
    );
    assert.equal(store.account().assets.fish, 0);
    assert.equal(await page.locator('#settings-bio').inputValue(), '未保存的个人简介');
    assert.equal(
      await page.locator('#settings-website-url').inputValue(),
      'https://example.com/draft',
    );
    // Both GET and POST failure paths have working retry controls.
    await page.route(
      '**/api/checkin',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"模拟签到查询失败"}',
        }),
      { times: 1 },
    );
    await page.locator('[data-ranch-fortune]').click();
    await page.locator('#fortune-checkin-button').filter({ hasText: '重试' }).click();
    await page.waitForFunction(
      () => document.querySelector('#fortune-checkin-button').textContent === '签到领取电元',
    );
    await page.route(
      '**/api/checkin',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"模拟签到提交失败"}',
        }),
      { times: 1 },
    );
    await page.locator('#fortune-checkin-button').click();
    await page.locator('#fortune-checkin-button').filter({ hasText: '重试签到' }).click();
    await page.waitForFunction(
      () => document.querySelector('#fortune-checkin-button').textContent === '今日已签到',
    );
    assert.equal(
      await page.locator('#settings-bio').inputValue(),
      '未保存的个人简介',
      'check-in keeps profile drafts',
    );
    assert.equal(
      await page.locator('#settings-website-url').inputValue(),
      'https://example.com/draft',
    );
    await page.locator('#fortune-modal .fortune-close').click();
    // Walk, greet, pause and reduced-motion are actual articulated SVG states.
    await page.locator('[data-max-actor]').scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => document.querySelector('[data-max-actor]').dataset.pose === 'walk',
      { timeout: 10000 },
    );
    const moving = await page.locator('[data-max-actor]').innerHTML();
    await page.waitForTimeout(250);
    assert.notEqual(await page.locator('[data-max-actor]').innerHTML(), moving);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (process.env.ECONOMY_SCREENSHOT_DIR)
      await page
        .locator('.ranch-scene')
        .screenshot({ path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, 'max-walking.png') });
    await page.locator('[data-ranch-greet]').click();
    await page.waitForTimeout(1750);
    for (const i of [0, 1, 2, 3])
      assert.equal(
        Number(await page.locator(`[data-leg="${i}"]`).getAttribute('data-foot-y')),
        164,
      );
    if (process.env.ECONOMY_SCREENSHOT_DIR)
      await page
        .locator('.ranch-scene')
        .screenshot({ path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, 'max-greeting.png') });
    await page.locator('[data-ranch-pause]').click();
    const frozen = await page.locator('[data-max-actor]').innerHTML();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-max-actor]').innerHTML(), frozen);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    const reduced = await page.locator('[data-max-actor]').innerHTML();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-max-actor]').innerHTML(), reduced);
    for (const mode of ['light', 'dark']) {
      await checkTheme(mode, ['.profile-ranch h2', '.ranch-intro', '.profile-wardrobe h2']);
      assert.equal(
        await page
          .locator('.ranch-bone.is-golden ellipse')
          .first()
          .evaluate((el) => getComputedStyle(el).fill),
        'rgb(255, 219, 117)',
        'golden bone retains gold inside the settings form',
      );
      assert.equal(
        await page
          .locator('.ranch-bone:not(.is-golden) ellipse')
          .first()
          .evaluate((el) => getComputedStyle(el).fill),
        'rgb(255, 245, 215)',
        'ordinary bones retain their ivory palette',
      );
      if (process.env.ECONOMY_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `settings-ranch-${mode}.png`),
          fullPage: true,
        });
    }
    await page.goto(`${base}/profile?uid=u_preview02`);
    await page.waitForFunction(
      () => document.getElementById('public-profile-name').textContent === 'another_student',
    );
    assert.equal(
      await page.locator('[data-extra-action]').count(),
      0,
      'visitor has no owner controls',
    );
    await page.goto(`${base}/discussion`);
    await page.locator('.discussion-post-card').nth(2).waitFor();
    assert.equal(await page.locator('.discussion-post-card .cosmetic-nameplate').count(), 1);
    assert.equal(
      await page.locator('.discussion-post-card [data-avatar-frame="frame_orbit"]').count(),
      1,
    );
    // Earn, rather than inject, the new non-sale title in the isolated browser account.
    for (let i = 0; i < 10; i += 1) await buyItem('fishbone');
    assert.equal(store.account().assets.plate_fishbone_master, 1);
    await page.goto(`${base}/inventory`);
    await page.locator('#inventory-profile-link').click();
    await page.waitForURL('**/profile?uid=u_preview01');
    await page.locator('[data-extra-action="equip"][data-item="plate_fishbone_master"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#public-profile-nameplate')?.textContent.includes('鱼骨达人'),
    );
    for (const mode of ['light', 'dark']) {
      await checkTheme(mode, ['.nameplate-label', '.cosmetic-nameplate small']);
      if (process.env.ECONOMY_SCREENSHOT_DIR)
        await page.locator('.public-profile-header').screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `fishbone-namecard-${mode}.png`),
        });
    }
    await page.locator('.profile-wardrobe a[href="/electromagnetic"]').click();
    await page.waitForURL('**/electromagnetic');
    await page.locator('.economy-inventory-link').click();
    await page.waitForURL('**/inventory');
    await page
      .locator('[data-action="inspect-inventory-item"][data-asset-key="plate_fishbone_master"]')
      .click();
    assert.match(await page.locator('#shop-inspect-modal').textContent(), /鱼骨达人/);
    assert.equal(
      await page.locator('#shop-inspect-modal [data-action="gift-inventory-item"]').count(),
      0,
    );
    await page.goto(`${base}/discussion`);
    await page.locator('.discussion-post-card .plate_fishbone_master').waitFor();
    assert.equal(await page.locator('.discussion-post-card .plate_fishbone_master').count(), 1);
    assert.match(await page.locator('.plate_fishbone_master small').textContent(), /成就/);
    if (process.env.ECONOMY_SCREENSHOT_DIR)
      await page
        .locator('.discussion-post-card')
        .first()
        .screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, 'fishbone-discussion.png'),
        });
    for (const route of [
      '/electromagnetic',
      '/inventory',
      '/discussion',
      '/profile?uid=u_preview01',
      '/settings',
    ]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(base + route);
      await page.waitForFunction(() => !document.body.textContent.includes('正在加载商店...'));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      assert.equal(overflow, false, `${route} mobile overflow`);
      if (route === '/settings') {
        await page.locator('[data-extra-action="feed"]').waitFor();
        const left = await page.locator('#settings-avatar-editor').boundingBox();
        const right = await page.locator('#public-profile-ranch').boundingBox();
        assert.ok(
          right.y >= left.y + left.height,
          'mobile ranch stacks after original avatar controls',
        );
        if (process.env.ECONOMY_SCREENSHOT_DIR)
          await page.screenshot({
            path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, 'settings-ranch-mobile.png'),
            fullPage: true,
          });
      }
      await page.evaluate(() => window.freeBbsApp.toggleThemeMode());
      assert.equal(await page.locator('body.theme-light.theme-dark').count(), 0);
      if (process.env.ECONOMY_SCREENSHOT_DIR && route.startsWith('/profile'))
        await page.screenshot({
          path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, 'profile-mobile.png'),
          fullPage: true,
        });
    }
    assert.deepEqual(errors, [], 'browser JavaScript exceptions');
    if (process.env.ECONOMY_SCREENSHOT)
      await page.screenshot({ path: process.env.ECONOMY_SCREENSHOT, fullPage: true });
    console.log(
      'Browser QA passed: purchase, recharge, expiry, theme contrast, colored icons, cosmetics, anonymous privacy, ranch adoption/feeding, visitor controls, reduced motion, 390px layouts.',
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
