// Local fake accounts only. Never connects to real tools, AI or production APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');

const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
async function assertContrast(page, selector) {
  const values = await page.$$eval(selector, (nodes) =>
    nodes.map((node) => {
      const rgb = (color) => color.match(/[\d.]+/g).map(Number);
      const luminance = (color) =>
        color
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const layers = [];
      for (let current = node; current; current = current.parentElement) {
        const color = rgb(getComputedStyle(current).backgroundColor);
        layers.push(color);
        if ((color[3] ?? 1) === 1) break;
      }
      const bg = layers
        .reverse()
        .reduce(
          (base, color) =>
            color
              .slice(0, 3)
              .map((value, index) => value * (color[3] ?? 1) + base[index] * (1 - (color[3] ?? 1))),
          [255, 255, 255],
        );
      const foreground = rgb(getComputedStyle(node).color);
      const a = luminance(
        foreground.map((value, index) =>
          index < 3 ? value * (foreground[3] ?? 1) + bg[index] * (1 - (foreground[3] ?? 1)) : value,
        ),
      );
      const b = luminance(bg);
      return { text: node.textContent, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    }),
  );
  assert.ok(values.length, selector);
  for (const value of values) assert.ok(value.ratio >= 4.5, selector + JSON.stringify(value));
}

async function main() {
  const extraPages = Object.fromEntries(
    fs
      .readdirSync(path.join(__dirname, '../public'))
      .filter(
        (name) =>
          name.endsWith('.html') &&
          ![
            '404.html',
            'circuit-embed.html',
            'login.html',
            'register.html',
            'remake.html',
          ].includes(name),
      )
      .map((name) => [
        name === 'index.html'
          ? '/'
          : `/${name.replace('.html', '').replace('system-settings-', 'system-settings/')}`,
        name,
      ]),
  );
  const { server } = createOnboardingPreview({ extraPages });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-ui-recovery-'));
  const tools = [1, 2].map((id) => ({
    id: `t_${String(id).padStart(16, '0')}`,
    title: `QA tool ${id}`,
    description: 'Local test',
    createdAt: '2026-09-27T08:00:00Z',
    html: `<html><body style="background:#e1f0ef"><h1>TOOL-${id}</h1><button onclick="this.textContent='clicked'">test</button></body></html>`,
    author: { username: 'fixture' },
  }));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    let rejectPurchase = false;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return request.continue();
      if (url.origin !== origin) return request.abort('blockedbyclient');
      // This isolated fixture has no development-center account or SPA.
      if (url.pathname === '/api/development/v1/me')
        return request.respond({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: '模拟账号无发展端权限' }),
        });
      if (url.pathname === '/api/tools')
        return request.respond({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tools }),
        });
      if (rejectPurchase && url.pathname.endsWith('/purchase'))
        return request.respond({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: '余额不足，请刷新后重试' }),
        });
      if (url.pathname.endsWith('/public-profile')) await pause(1400);
      return request.continue();
    });
    await page.goto(`${origin}/circuit-challenge`, { waitUntil: 'networkidle0' });
    const shell = await page.evaluate(() => ({
      active: document.body.classList.contains('desktop-shell-active'),
      title: document.querySelector('.desktop-header-title')?.textContent,
      main: document.querySelector('main').className,
    }));
    console.log('challenge shell', shell);
    assert.equal(shell.active, true);
    assert.equal(shell.title, '电路闯关');
    await page.screenshot({ path: path.join(output, 'challenge.png') });
    await page.goto(`${origin}/tool-workshop`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.tool-card');
    for (const index of [0, 1, 0, 1]) {
      await page.click(`.tool-card[data-tool-id="${tools[index].id}"]`);
      await page.waitForSelector('#tool-viewer[open]');
      await pause(350);
      const frame = await (await page.$('#tool-viewer-frame')).contentFrame();
      const text = await frame.evaluate(() => document.body?.innerText);
      console.log('tool', index, text);
      assert.match(text, new RegExp(`TOOL-${index + 1}`));
      await frame.click('button');
      assert.equal(await frame.$eval('button', (node) => node.textContent), 'clicked');
      assert.equal(
        await page.$eval('#tool-viewer-frame', (node) => node.getAttribute('sandbox')),
        'allow-scripts',
      );
      await page.screenshot({ path: path.join(output, `tool-${index}.png`) });
      await page.click('#tool-viewer [data-tool-close]');
      await pause(50);
    }
    await page.goto(`${origin}/ranch-gallery`, { waitUntil: 'networkidle0' });
    await page.goto(`${origin}/ranch?uid=u_preview01`, { waitUntil: 'domcontentloaded' });
    console.log(
      'ranch loading',
      await page.evaluate(() => ({
        main: document.querySelector('main').getBoundingClientRect().toJSON(),
        text: document.querySelector('#public-profile-message')?.textContent,
        scene: Boolean(document.querySelector('.ranch-scene')),
        body: getComputedStyle(document.body).background,
        image: getComputedStyle(document.body).getPropertyValue('--ranch-photo'),
      })),
    );
    await page.screenshot({ path: path.join(output, 'ranch-loading.png') });
    await page.waitForSelector('.ranch-scene');
    await page.screenshot({ path: path.join(output, 'ranch-ready.png') });
    for (const route of Object.keys(extraPages)) {
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      const layout = await page.evaluate(() => {
        const pageMain = document.querySelector('main');
        return {
          immersive: pageMain?.dataset.shellMode === 'immersive',
          active: document.body.classList.contains('desktop-shell-active'),
          title: document.querySelector('.desktop-header-title')?.textContent,
          nav: Boolean(document.querySelector('.topbar .nav-actions')),
          headerCount: document.querySelectorAll('.desktop-header').length,
        };
      });
      if (!layout.nav) continue;
      assert.equal(layout.active, !layout.immersive, route + JSON.stringify(layout));
      assert.equal(layout.headerCount, layout.immersive ? 0 : 1, route);
      if (!layout.immersive) assert.ok(layout.title && layout.title !== 'FREE-BBS', route);
      console.log('shell contract', route, layout.title || 'immersive');
    }
    for (const width of [1440, 901, 390, 320]) {
      await page.setViewport({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          localStorage.setItem('free_bbs_theme_mode', value);
          window.freeBbsTypography.applyPreferences({
            fontPreset: 'zhongsong-study',
            typeScale: 'large',
          });
        }, theme);
        for (const route of [
          '/circuit-challenge',
          '/publish',
          '/tool-workshop',
          '/ranch-gallery',
          '/ranch?uid=u_preview01',
        ]) {
          await page.goto(origin + route, { waitUntil: 'networkidle0' });
          await page.evaluate(() => document.fonts.ready);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth + 1,
            ),
            true,
            route + width + theme,
          );
          if (width > 900 && route.startsWith('/ranch')) {
            const header = await page.$eval('.desktop-header', (node) => {
              const bounds = node.getBoundingClientRect();
              return {
                left: bounds.left,
                right: bounds.right,
                side: document.querySelector('.topbar').getBoundingClientRect().right,
                bg: getComputedStyle(node).backgroundColor,
              };
            });
            assert.ok(
              Math.abs(header.left - header.side) <= 1 && Math.abs(header.right - width) <= 1,
              JSON.stringify(header),
            );
            assert.ok(!header.bg.endsWith(', 0)'), 'full-width opaque ranch header');
          }
          if (route.startsWith('/ranch?') && width > 900) {
            await page.waitForSelector('[data-study-enter]');
            await assertContrast(page, '[data-study-enter], [data-ranch-pause]');
            await page.$eval('#public-profile-ranch', (node) => {
              Object.defineProperty(node, 'requestFullscreen', {
                configurable: true,
                value: () => Promise.reject(new Error('QA fallback')),
              });
            });
            await page.click('[data-study-enter]');
            await page.waitForSelector('.is-study-mode');
            assert.equal(
              await page.$eval('.desktop-header', (node) => getComputedStyle(node).visibility),
              'hidden',
            );
            await page.keyboard.press('Escape');
            assert.equal(
              await page.$eval('.desktop-header', (node) => getComputedStyle(node).visibility),
              'visible',
            );
          }
          if (width === 1440 && route.startsWith('/ranch'))
            await page.screenshot({
              path: path.join(
                output,
                `${(route.includes('gallery') ? 'gallery-' : 'ranch-') + theme}.png`,
              ),
            });
        }
        await page.goto(`${origin}/electromagnetic`, { waitUntil: 'networkidle0' });
        await page.locator('[data-action="inspect-item"][data-item-key="fish"]').click();
        for (const failure of [false, true]) {
          rejectPurchase = failure;
          await page.locator('#shop-inspect-modal [data-action="purchase-item"]').click();
          await page.waitForFunction(
            (failed) =>
              document
                .querySelector('#shop-inspect-message')
                .textContent.includes(failed ? '余额不足' : '已到账'),
            {},
            failure,
          );
          await assertContrast(page, '#shop-inspect-message');
        }
        rejectPurchase = false;
        if (width === 1440)
          await page.screenshot({ path: path.join(output, `shop-message-${theme}.png`) });
        console.log('responsive + night controls + status contrast', width, theme);
      }
    }
    await page.goto(`${origin}/tool-workshop`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      const cards = document.querySelectorAll('.tool-card');
      for (let i = 0; i < 20; i += 1) {
        cards[i % cards.length].click();
        document.querySelector('#tool-viewer [data-tool-close]').click();
      }
      cards[1].click();
    });
    await page.waitForSelector('#tool-viewer-frame[aria-busy="false"]');
    const finalFrame = await (await page.$('#tool-viewer-frame')).contentFrame();
    assert.match(await finalFrame.evaluate(() => document.body.innerText), /TOOL-2/);
    await page.click('#tool-viewer-reload');
    await page.waitForSelector('#tool-viewer-frame[aria-busy="false"]');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#tool-viewer', (node) => node.open), false);
    assert.deepEqual(errors, []);
    console.log('screenshots', output);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
