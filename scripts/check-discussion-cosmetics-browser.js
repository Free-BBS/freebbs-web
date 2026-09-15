const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  const { server, store } = createEconomyPreview({ showcase: true });
  store.account().assets.laser = 1;
  store.account().expiresAtMs = Date.now() + 3600000;
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
    page.on('pageerror', (e) => errors.push(e.message));
    for (const mode of ['light', 'dark']) {
      await page.goto(`${base}/discussion`);
      const card = page.locator('.discussion-post-card[data-post-id="1"]');
      await card.waitFor();
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      for (const frame of ['frame_aurora', 'frame_orbit']) {
        const wrapper = page.locator(`.discussion-avatar-frame[data-frame="${frame}"]`);
        assert.ok(await wrapper.isVisible(), frame);
        assert.equal(
          await wrapper.evaluate((el) => getComputedStyle(el, '::before').animationName),
          frame === 'frame_aurora' ? 'aurora-curtain' : 'profile-orbit',
        );
        assert.equal(
          await wrapper.evaluate((el) => getComputedStyle(el, '::after').pointerEvents),
          'none',
        );
      }
      const anonymous = page.locator('.discussion-post-card[data-post-id="3"]');
      assert.equal(
        await anonymous
          .locator('.discussion-avatar-frame, .cosmetic-nameplate, [data-avatar-frame]')
          .count(),
        0,
      );
      assert.equal(await anonymous.getAttribute('data-laser-expires'), null);
      assert.equal(
        await card.evaluate((el) => getComputedStyle(el).animationName),
        'laser-halo-flow',
      );
      const shadow = await card.evaluate((el) => getComputedStyle(el).boxShadow);
      assert.ok(shadow.includes('inset') && shadow !== 'none', shadow);
      assert.match(
        await card.evaluate((el) => getComputedStyle(el).backgroundImage),
        /laser-starlight/,
      );
      assert.match(
        await card.evaluate((el) => getComputedStyle(el).backgroundImage),
        /linear-gradient/,
      );
      for (const wrapper of await card.locator('.discussion-avatar-frame').all()) {
        assert.match(
          await wrapper.evaluate((el) => getComputedStyle(el, '::after').backgroundImage),
          /aurora-crown/,
        );
      }
      const flow = await card.evaluate((el) => {
        const animation = el
          .getAnimations()
          .find((item) => item.animationName === 'laser-halo-flow');
        animation.pause();
        animation.currentTime = 0;
        const first = getComputedStyle(el).boxShadow;
        animation.currentTime = 3000;
        const second = getComputedStyle(el).boxShadow;
        animation.play();
        return [first, second];
      });
      assert.notEqual(
        flow[0],
        flow[1],
        'yellow halo actually travels, not just an animation label',
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(
        await card
          .locator('.discussion-avatar-frame')
          .evaluate((el) => getComputedStyle(el, '::before').animationName),
        'none',
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
        );
        if (process.env.COSMETIC_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.COSMETIC_SCREENSHOT_DIR, { recursive: true });
          await card.screenshot({
            path: path.join(process.env.COSMETIC_SCREENSHOT_DIR, `discussion-${mode}-${width}.png`),
          });
          if (width === 1440)
            await page.screenshot({
              path: path.join(process.env.COSMETIC_SCREENSHOT_DIR, `discussion-page-${mode}.png`),
              fullPage: true,
            });
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await card.locator('[data-action="open-post"]').click();
      const detail = page.locator('#discussion-detail');
      await page.locator('#discussion-markdown-body').waitFor();
      assert.equal(
        await detail.evaluate((el) => getComputedStyle(el).animationName),
        'laser-halo-flow',
      );
      assert.equal(await detail.locator('.discussion-detail-head[data-laser-expires]').count(), 0);
      if (process.env.COSMETIC_SCREENSHOT_DIR) {
        await detail.screenshot({
          path: path.join(process.env.COSMETIC_SCREENSHOT_DIR, `detail-${mode}.png`),
        });
        await page.screenshot({
          path: path.join(process.env.COSMETIC_SCREENSHOT_DIR, `detail-page-${mode}.png`),
          fullPage: true,
        });
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await detail.evaluate((el) => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({ forcedColors: 'active' });
      assert.equal(await detail.evaluate((el) => getComputedStyle(el).boxShadow), 'none');
      assert.equal(await detail.evaluate((el) => getComputedStyle(el).backgroundImage), 'none');
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      await detail.evaluate((el) => {
        el.dataset.laserExpires = '1';
        window.FreeBbsPostLaser.refresh();
      });
      assert.equal(await detail.evaluate((el) => el.classList.contains('has-laser-glow')), false);
      assert.doesNotMatch(
        await detail.evaluate((el) => getComputedStyle(el).backgroundImage),
        /laser-starlight/,
      );
      await detail.locator('[data-action="close-detail"]').click();
      await card.locator('.discussion-author-link-avatar').click();
      await page.waitForURL('**/profile?uid=u_preview01');
      await page.locator('#public-profile-avatar[data-avatar-frame="frame_aurora"]').waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(
      'Discussion cosmetics passed: two frames, list/detail yellow flow, themes, mobile, anonymous privacy, navigation, expiry and motion/contrast fallbacks.',
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
