// Settings visual/interaction QA uses an isolated in-memory account only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');

(async () => {
  const { server } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output =
    process.env.SETTINGS_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-settings-'));
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    let saves = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        request.url().endsWith('/notifications/email-preferences')
      )
        saves += 1;
    });
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(`${origin}/settings`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => !document.querySelector('[data-notification-preference="weeklyDigest"]').checked,
    );
    const reply = '[data-notification-preference="reply"]';
    await page.click(reply);
    assert.equal(
      await page.$eval('[data-notification-state="reply"]', (e) => e.textContent),
      '已关闭',
    );
    assert.equal(saves, 0, 'toggle is only a draft until Save');
    await page.focus(reply);
    await page.keyboard.press('Space');
    assert.equal(await page.$eval(reply, (e) => e.checked), true);
    await page.keyboard.press('Space');
    await page.click('#settings-notification-form button[type="submit"]');
    await page.waitForFunction(() =>
      document
        .querySelector('[data-notification-preferences-message]')
        .textContent.includes('已保存'),
    );
    assert.equal(saves, 1);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => !document.querySelector('[data-notification-preference="reply"]').checked,
    );
    let checked = 0;
    for (const width of [1440, 1280, 1024, 390, 360]) {
      await page.setViewport({ width, height: 1100 });
      if (width <= 900)
        await page.evaluate(() =>
          document.querySelectorAll('.personal-fold').forEach((e) => {
            e.open = true;
          }),
        );
      for (const theme of ['light', 'dark']) {
        await page.evaluate((mode) => {
          if (document.body.classList.contains('theme-light') !== (mode === 'light'))
            window.freeBbsApp.toggleThemeMode();
          return new Promise((resolve) => {
            setTimeout(resolve, 300);
          });
        }, theme);
        for (const fontPreset of [
          'transistor-lab',
          'zhongsong-study',
          'quantum-board',
          'night-oscilloscope',
        ]) {
          for (const typeScale of ['standard', 'comfortable', 'large']) {
            await page.evaluate(
              async (preferences) => {
                window.freeBbsTypography.applyPreferences(preferences);
                await document.fonts.ready;
                await new Promise((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(resolve));
                });
              },
              { fontPreset, typeScale },
            );
            const data = await page.evaluate(() => {
              const rect = (selector) =>
                document.querySelector(selector).getBoundingClientRect().toJSON();
              return {
                overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                dimensions: {
                  viewport: window.innerWidth,
                  rootScroll: document.documentElement.scrollWidth,
                  bodyScroll: document.body.scrollWidth,
                  scrollX: window.scrollX,
                  root: document.documentElement.getBoundingClientRect().toJSON(),
                },
                overflowing: [...document.querySelectorAll('body *')]
                  .filter((node) => {
                    const bounds = node.getBoundingClientRect();
                    return (
                      bounds.width > 0 &&
                      bounds.right + Math.max(0, node.scrollWidth - node.clientWidth) >
                        window.innerWidth + 1
                    );
                  })
                  .slice(-20)
                  .map((node) => ({
                    name: node.id || node.className || node.tagName,
                    bounds: node.getBoundingClientRect().toJSON(),
                    scrollWidth: node.scrollWidth,
                    clientWidth: node.clientWidth,
                    overflow: getComputedStyle(node).overflowX,
                  })),
                name: rect('#settings-full-name'),
                website: rect('#settings-website-url'),
                mail: rect('#settings-notification-form'),
                password: rect('#settings-password-form'),
                rows: [...document.querySelectorAll('.settings-notification-row')].map((row) => {
                  const input = row.querySelector('input');
                  const track = input.nextElementSibling;
                  return {
                    checked: input.checked,
                    color: getComputedStyle(track).backgroundColor,
                    track: track.getBoundingClientRect().toJSON(),
                    state: row
                      .querySelector('.settings-notification-state')
                      .getBoundingClientRect()
                      .toJSON(),
                  };
                }),
              };
            });
            const label = `${width} ${theme} ${fontPreset} ${typeScale}`;
            if (data.overflow) await page.screenshot({ path: path.join(output, 'overflow.png') });
            assert.equal(
              data.overflow,
              false,
              `${label}: ${JSON.stringify([data.dimensions, data.overflowing])}`,
            );
            // The existing <=1024px form layout stacks these fields.
            if (width > 1024) {
              assert.ok(
                Math.abs(data.name.y - data.website.y) < 1,
                `${label}: input top alignment`,
              );
              assert.ok(
                Math.abs(data.name.height - data.website.height) < 1,
                `${label}: input heights`,
              );
            } else
              assert.ok(data.website.y > data.name.y, `${label}: fields stack on narrow screens`);
            if (width > 1180) {
              assert.ok(
                Math.abs(data.mail.y - data.password.y) < 1,
                `${label}: card top alignment`,
              );
              assert.ok(
                Math.abs(data.mail.height - data.password.height) < 1,
                `${label}: card equal heights`,
              );
              assert.ok(
                Math.abs(data.mail.width - data.password.width) < 1,
                `${label}: equal half width`,
              );
            } else assert.ok(data.password.y > data.mail.y, `${label}: narrow-screen stacking`);
            for (const row of data.rows) {
              assert.equal(
                row.color,
                row.checked ? 'rgb(25, 135, 84)' : 'rgb(132, 145, 152)',
                `${label}: switch color`,
              );
              assert.ok(
                Math.abs(row.state.x - row.track.right - 8) < 1,
                `${label}: switch/status gap`,
              );
              assert.ok(
                Math.abs(row.state.y + row.state.height / 2 - row.track.y - row.track.height / 2) <
                  1,
                `${label}: vertical alignment`,
              );
              assert.ok(
                Math.abs(row.track.x - data.rows[0].track.x) < 1,
                `${label}: common right edge`,
              );
            }
            checked += 1;
            if (
              [1440, 390].includes(width) &&
              fontPreset === 'transistor-lab' &&
              typeScale === 'comfortable'
            ) {
              if (width === 1440) {
                await page.evaluate(() => {
                  window.scrollTo({
                    top:
                      document.getElementById('settings-full-name').getBoundingClientRect().top +
                      window.scrollY -
                      150,
                    behavior: 'instant',
                  });
                });
                await page.screenshot({ path: path.join(output, `profile-fields-${theme}.png`) });
              }
              await page.evaluate(() => {
                const top =
                  document.getElementById('settings-notification-form').getBoundingClientRect()
                    .top +
                  window.scrollY -
                  105;
                window.scrollTo({ top, behavior: 'instant' });
              });
              await page.screenshot({ path: path.join(output, `settings-${width}-${theme}.png`) });
            }
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ checked, saves, errors, output }));
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
