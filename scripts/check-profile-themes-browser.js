const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  const { server, store } = createEconomyPreview();
  const visitorTarget = store.account(2);
  Object.assign(visitorTarget.assets, {
    frame_aurora: 1,
    plate_observer: 1,
    card_blueprint: 1,
    card_twilight: 1,
    fishbone: 10,
    golden_fishbone: 1,
    maxwell_spectacles: 1,
  });
  visitorTarget.adopted = true;
  visitorTarget.equipped = { frame: 'frame_aurora', nameplate: 'plate_observer' };
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/profile?uid=u_preview02`);
    await page.locator('.ranch-scene').waitFor();
    assert.equal(await page.locator('.public-profile-header #public-profile-website').count(), 1);
    assert.equal(await page.locator('.public-profile-grid .public-profile-field').count(), 1);
    const baselineFont = await page
      .locator('#public-profile-bio')
      .evaluate((el) => getComputedStyle(el).font);
    const palettes = new Set();
    for (const card of ['card_blueprint', 'card_twilight']) {
      visitorTarget.equipped.card = card;
      for (const theme of ['light', 'dark']) {
        await page.reload();
        await page.locator(`.public-profile-shell[data-profile-card="${card}"]`).waitFor();
        await page.evaluate((mode) => {
          if (!document.body.classList.contains(`theme-${mode}`))
            window.freeBbsApp.toggleThemeMode();
        }, theme);
        assert.equal(await page.locator('[data-extra-action], [data-ranch-fortune]').count(), 0);
        assert.equal(await page.locator('#public-profile-wardrobe:visible').count(), 0);
        assert.equal(await page.locator('#profile-decoration-preview').count(), 0);
        assert.equal(
          await page.locator('#public-profile-avatar').getAttribute('data-avatar-frame'),
          'frame_aurora',
        );
        assert.equal(
          await page.locator('#public-profile-bio').evaluate((el) => getComputedStyle(el).font),
          baselineFont,
        );
        const palette = await page
          .locator('.ranch-scene')
          .evaluate((el) => getComputedStyle(el).backgroundImage);
        palettes.add(palette);
        assert.equal(await page.locator('body').getAttribute('data-public-profile-theme'), card);
        const bioWidth = await page
          .locator('#public-profile-bio')
          .evaluate((el) => el.getBoundingClientRect().width);
        const gridWidth = await page
          .locator('.public-profile-grid')
          .evaluate((el) => el.getBoundingClientRect().width);
        assert.ok(Math.abs(bioWidth - gridWidth) < 3, 'bio fills the entire former two-column row');
        // Check text against its actual solid ancestor background in each owner skin / visitor mode.
        for (const selector of [
          '#public-profile-name',
          '#public-profile-bio',
          '#public-profile-website',
          '.ranch-heading h2',
        ]) {
          const contrast = await page.locator(selector).evaluate((el) => {
            const rgb = (v) => v.match(/[\d.]+/g).map(Number);
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
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          });
          assert.ok(contrast >= 4.5, `${card}/${theme} ${selector} contrast ${contrast}`);
        }
        if (process.env.ECONOMY_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.ECONOMY_SCREENSHOT_DIR, { recursive: true });
          // Hide fixed chrome only for the cropped component capture, not for interaction checks.
          await page.addStyleTag({
            content: 'body .main-content::before { display: none !important; }',
          });
          await page.evaluate(() => {
            const shell = document.querySelector('.public-profile-shell');
            for (const element of document.querySelectorAll('*')) {
              if (
                ['fixed', 'sticky'].includes(getComputedStyle(element).position) &&
                !shell.contains(element) &&
                !element.contains(shell)
              )
                element.style.visibility = 'hidden';
            }
          });
          await page.locator('.public-profile-shell').screenshot({
            path: path.join(process.env.ECONOMY_SCREENSHOT_DIR, `visitor-${card}-${theme}.png`),
          });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
        );
        await page.setViewportSize({ width: 1440, height: 1100 });
      }
    }
    assert.equal(palettes.size, 4, 'both public skins have distinct day/night ranch palettes');
    await page.evaluate(() => {
      document.getElementById('public-profile-website').textContent =
        `https://example.com/${'long-path-'.repeat(35)}`;
      document.getElementById('public-profile-bio').textContent =
        `第一行个人简介。\n第二行学习经历。${'长内容'.repeat(100)}`;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
      'long website and bio wrap on mobile',
    );
    assert.equal(
      await page.locator('#public-profile-bio').evaluate((el) => getComputedStyle(el).whiteSpace),
      'pre-wrap',
    );
    delete visitorTarget.equipped.card;
    await page.reload();
    await page.locator('.ranch-scene').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-public-profile-theme'), null);
    Object.assign(store.account().assets, {
      frame_orbit: 1,
      frame_aurora: 1,
      card_blueprint: 1,
      card_twilight: 1,
      plate_observer: 1,
      plate_fishbone_master: 1,
      plate_maxwell: 1,
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('#public-profile-wardrobe:visible').waitFor();
    assert.equal(
      await page.locator('body').getAttribute('data-public-profile-theme'),
      null,
      'other owner skin does not leak',
    );
    assert.equal(await page.locator('#settings-form, #settings-font-preset').count(), 0);
    const ownerFont = await page
      .locator('#public-profile-bio')
      .evaluate((el) => getComputedStyle(el).font);
    for (const frame of ['frame_orbit', 'frame_aurora', '']) {
      await page
        .locator(`[data-extra-action="equip"][data-slot="frame"][data-item="${frame}"]`)
        .click();
      await page.waitForFunction(
        (expected) =>
          document.querySelector('#public-profile-avatar').dataset.avatarFrame === expected,
        frame,
      );
      assert.equal(
        await page.locator('#public-profile-bio').evaluate((el) => getComputedStyle(el).font),
        ownerFont,
      );
    }
    await page
      .locator('[data-extra-action="equip"][data-slot="card"][data-item="card_blueprint"]')
      .click();
    await page.waitForFunction(() => document.body.dataset.publicProfileTheme === 'card_blueprint');
    await page.locator('[data-extra-action="equip"][data-slot="card"][data-item=""]').click();
    await page.waitForFunction(() => !document.body.dataset.publicProfileTheme);
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      for (const frame of ['frame_orbit', 'frame_aurora']) {
        await page.locator(`[data-slot="frame"][data-item="${frame}"]`).click();
        await page.waitForFunction(
          (value) => document.querySelector('#public-profile-avatar').dataset.avatarFrame === value,
          frame,
        );
        const outline = await page.locator('#public-profile-avatar').evaluate((el) => {
          const css = getComputedStyle(el);
          return [css.borderTopWidth, css.outlineStyle];
        });
        assert.deepEqual(outline, ['3px', 'solid']);
      }
      for (const plate of ['plate_observer', 'plate_fishbone_master', 'plate_maxwell']) {
        await page.locator(`[data-slot="nameplate"][data-item="${plate}"]`).click();
        await page.locator(`#public-profile-nameplate .${plate}`).waitFor();
        const ratio = await page
          .locator('#public-profile-nameplate .cosmetic-nameplate')
          .evaluate((el) => {
            const lum = (value) =>
              value
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number)
                .map((v) => v / 255)
                .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const foreground = lum(getComputedStyle(el.querySelector('.nameplate-label')).color);
            const background = lum(getComputedStyle(el).backgroundColor);
            return (
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
            );
          });
        assert.ok(ratio >= 4.5, `${mode}/${plate} contrast ${ratio}`);
      }
      await page.locator('[data-slot="nameplate"][data-item=""]').click();
      await page.waitForFunction(
        () => !document.querySelector('#public-profile-nameplate .cosmetic-nameplate'),
      );
      for (const card of ['card_blueprint', 'card_twilight', '']) {
        await page.locator(`[data-slot="card"][data-item="${card}"]`).click();
        await page.waitForFunction(
          (value) => (document.body.dataset.publicProfileTheme || '') === value,
          card,
        );
        assert.equal(
          await page.locator('#public-profile-bio').evaluate((el) => getComputedStyle(el).font),
          ownerFont,
        );
      }
    }
    assert.equal(
      await page
        .locator('[data-ranch-fortune], .economy-shortcut-checkin, .fortune-link:visible')
        .count(),
      0,
    );
    await page.locator('.settings-nav-link:visible').first().click();
    await page.waitForURL('**/settings');
    await page.locator('#settings-form').waitFor();
    assert.equal(
      await page
        .locator('#public-profile-wardrobe, #public-profile-ranch, #public-profile-collectibles')
        .count(),
      0,
    );
    assert.equal(await page.locator('body').getAttribute('data-public-profile-theme'), null);
    assert.equal(await page.locator('#profile-decoration-preview').count(), 0);
    await page.locator('.avatar').first().click();
    await page.waitForURL('**/profile?uid=u_preview01');
    await page.waitForFunction(
      () => document.querySelector('#public-profile-avatar').dataset.avatarFrame === 'frame_aurora',
    );
    assert.equal(await page.locator('#settings-form, #settings-font-preset').count(), 0);
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
      const trigger = page.locator('#user-status [data-currency-guide]').first();
      await trigger.click();
      await page.locator('#electromagnetic-modal:not(.hidden)').waitFor();
      assert.match(await page.locator('.currency-guide-panel').textContent(), /电磁场系统/);
      assert.match(await page.locator('.currency-guide-panel').textContent(), /热力值每天减半/);
      assert.match(
        await page.locator('.currency-guide-panel').textContent(),
        /收到“有启发性”时帖子作者获得2磁元/,
      );
      assert.equal(await page.locator('#electromagnetic-assets').count(), 0);
      assert.equal(
        await page
          .locator('#electromagnetic-balances')
          .evaluate((el) => getComputedStyle(el).justifyContent),
        'center',
      );
      for (const section of await page
        .locator('.currency-guide-panel .electromagnetic-section')
        .all()) {
        assert.equal(await section.evaluate((el) => getComputedStyle(el).textAlign), 'left');
      }
      assert.match(await page.locator('.currency-guide-panel').textContent(), /5–50电元/);
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
      await trigger.click();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page
          .locator('.currency-guide-panel')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 1100 });
    }
    for (const width of [1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1100 });
      const geometry = await page.locator('.public-profile-shell').evaluate((el) => {
        const main = document.querySelector('.main-content');
        const style = getComputedStyle(main);
        return {
          actual: el.getBoundingClientRect().width,
          expected:
            main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        };
      });
      assert.ok(
        Math.abs(geometry.actual - geometry.expected) < 3,
        JSON.stringify({ width, ...geometry }),
      );
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal(
      await page
        .locator('.public-profile-avatar-wrap')
        .evaluate((el) => getComputedStyle(el, '::before').animationName),
      'aurora-curtain',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.public-profile-avatar-wrap')
        .evaluate((el) => getComputedStyle(el, '::before').animationName),
      'none',
    );
    assert.deepEqual(errors, []);
    console.log(
      'Public profile skins passed: owner vs visitor, 4 palettes, font preservation, contrast, mobile, reset and settings isolation.',
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
