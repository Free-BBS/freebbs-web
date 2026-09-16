const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

function contrast(a, b) {
  const luminance = (rgb) => {
    const values = rgb
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((v) => {
        const c = Number(v) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

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
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 2560, height: 1080 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Use actual page HTML/CSS/JS with the isolated memory API, never production accounts.
    for (const name of ['workbench', 'aichat', 'world']) {
      await page.route(`${base}/${name}`, (route) => {
        const html = fs.readFileSync(path.join(__dirname, '../public', `${name}.html`), 'utf8');
        return route.fulfill({
          contentType: 'text/html',
          body: html.replace('</head>', "<script>window.FREEBBS_API_BASE='/api';</script></head>"),
        });
      });
    }
    await page.route(`${base}/api/discussion/posts?*`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.posts?.length)
        body.posts = [
          ...Array.from({ length: 12 }, (_, index) => ({
            ...body.posts[1],
            id: String(100 + index),
          })),
          ...body.posts,
        ];
      await route.fulfill({ response, json: body });
    });
    const theme = (mode) =>
      page.evaluate((value) => {
        if (!document.body.classList.contains(`theme-${value}`))
          window.freeBbsApp.toggleThemeMode();
      }, mode);
    for (const mode of ['light', 'dark']) {
      await page.goto(`${base}/discussion`);
      const laser = page.locator('.discussion-post-card[data-post-id="1"]');
      const ordinary = page.locator('.discussion-post-card[data-post-id="2"]');
      await laser.waitFor();
      await theme(mode);
      for (const [card, kind] of [
        [laser, 'laser'],
        [ordinary, 'normal'],
      ]) {
        assert.equal(
          await card.evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--discussion-surface-mode').trim(),
          ),
          `${kind}-${mode}`,
        );
        const reaction = card.locator('.discussion-reaction-button').first();
        for (const selected of [false, true]) {
          await reaction.evaluate(
            (el, active) => el.classList.toggle('is-reacted', active),
            selected,
          );
          const colors = await reaction.evaluate((el) => ({
            text: getComputedStyle(el.querySelector('strong')).color,
            buttonText: getComputedStyle(el).color,
            background: getComputedStyle(el).backgroundColor,
          }));
          assert.equal(colors.text, colors.buttonText, JSON.stringify(colors));
          assert.ok(contrast(colors.text, colors.background) >= 4.5, JSON.stringify(colors));
        }
        await reaction.evaluate((el) => el.classList.remove('is-reacted'));
      }
      for (const width of [2560, 1440, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        const sizes = await page.locator('.settings-shell').evaluate((el) => {
          const main = document.querySelector('.main-content');
          const css = getComputedStyle(main);
          return {
            shell: el.getBoundingClientRect().width,
            available:
              main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        assert.ok(Math.abs(sizes.shell - sizes.available) < 3, JSON.stringify(sizes));
        assert.ok(sizes.overflow <= 1, JSON.stringify(sizes));
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await laser.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy({ top: -60, behavior: 'instant' }));
      const before = await page.evaluate(() => window.scrollY);
      assert.ok(before > 500);
      await laser.locator('.discussion-post-title').click();
      await page.locator('#comment-1001').waitFor();
      for (const id of [1001, 1002]) {
        const reply = page.locator(`#comment-${id}`);
        const expected = id === 1001 ? 'laser' : 'normal';
        assert.equal(
          await reply.evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--discussion-surface-mode').trim(),
          ),
          `${expected}-${mode}`,
        );
      }
      await page.locator('#discussion-detail [data-action="close-detail"]').click();
      await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 3, before);
      const after = await page.evaluate(() => window.scrollY);
      assert.ok(Math.abs(after - before) < 3, `scroll ${before} -> ${after}`);
      if (process.env.UI_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
        await laser.screenshot({
          path: path.join(process.env.UI_SCREENSHOT_DIR, `laser-${mode}.png`),
        });
        await ordinary.screenshot({
          path: path.join(process.env.UI_SCREENSHOT_DIR, `normal-${mode}.png`),
        });
      }
    }
    for (const name of ['workbench', 'aichat']) {
      await page.goto(`${base}/${name}`);
      await page.locator(`.${name}-shell`).waitFor();
      for (const width of [2560, 1440, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        const sizes = await page.locator(`.${name}-shell`).evaluate((el) => {
          const main = document.querySelector('.main-content');
          const css = getComputedStyle(main);
          return {
            shell: el.getBoundingClientRect().width,
            available:
              main.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
            overflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        });
        assert.ok(Math.abs(sizes.shell - sizes.available) < 3, `${name}: ${JSON.stringify(sizes)}`);
        assert.ok(sizes.overflow <= 1, JSON.stringify(sizes));
      }
    }
    await page.goto(`${base}/world`);
    for (const mode of ['light', 'dark']) {
      await theme(mode);
      const colors = await page.evaluate(() => {
        const left = getComputedStyle(document.getElementById('world-enter-island'));
        const right = getComputedStyle(document.getElementById('world-discussion-link'));
        return { left: left.backgroundColor, right: right.backgroundColor, text: left.color };
      });
      assert.notEqual(colors.left, colors.right);
      assert.ok(contrast(colors.text, colors.left) >= 4.5, JSON.stringify(colors));
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: four discussion palettes, readable reaction counts, reply isolation, scroll restoration, responsive three-page widths, world primary action (both themes).',
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
