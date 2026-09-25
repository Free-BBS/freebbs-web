// Real shared shell, isolated Chrome and loopback-only APIs. Never uses a real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createOnboardingPreview } = require('./preview-onboarding');

async function measure(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const trigger = document.querySelector('.site-search-trigger');
    const headerMain = document.querySelector('.main-content[data-page-title]');
    const heading = getComputedStyle(headerMain, '::before');
    const numeric = (value) => parseFloat(value) || 0;
    let title = headerMain.dataset.pageTitle;
    if (heading.content.startsWith('"')) title = JSON.parse(heading.content);
    if (['none', 'normal'].includes(heading.content)) title = '';
    const probe = document.createElement('span');
    probe.textContent = title;
    Object.assign(probe.style, {
      position: 'fixed',
      visibility: 'hidden',
      whiteSpace: 'pre',
      fontFamily: heading.fontFamily,
      fontSize: heading.fontSize,
      fontWeight: heading.fontWeight,
      fontStyle: heading.fontStyle,
      letterSpacing: heading.letterSpacing,
    });
    document.body.append(probe);
    const textWidth = probe.getBoundingClientRect().width;
    const titleLeft =
      numeric(heading.left) + numeric(heading.marginLeft) + numeric(heading.paddingLeft);
    const available =
      numeric(heading.width) -
      (heading.boxSizing === 'border-box'
        ? numeric(heading.paddingLeft) +
          numeric(heading.paddingRight) +
          numeric(heading.borderLeftWidth) +
          numeric(heading.borderRightWidth)
        : 0);
    Object.assign(probe.style, {
      display: 'block',
      left: `${titleLeft}px`,
      width: `${Math.max(1, available)}px`,
      whiteSpace: heading.whiteSpace,
      overflowWrap: heading.overflowWrap,
      lineHeight: heading.lineHeight,
    });
    const range = document.createRange();
    range.selectNodeContents(probe);
    const lines = [...range.getClientRects()];
    const titleRight = Math.max(titleLeft, ...lines.map((rect) => rect.right));
    const textHeight = probe.getBoundingClientRect().height;
    probe.remove();
    const balances = [...document.querySelectorAll('.user-economy-stack .currency-value')].map(
      (node) => {
        const style = getComputedStyle(node);
        return {
          value: node.textContent,
          size: style.fontSize,
          family: style.fontFamily,
          weight: style.fontWeight,
          line: style.lineHeight,
          numeric: style.fontVariantNumeric,
          rect: node.getBoundingClientRect().toJSON(),
        };
      },
    );
    const controls = [...document.querySelectorAll('.mobile-theme-toggle, .notification-bell')]
      .map((node) => ({
        rect: node.getBoundingClientRect().toJSON(),
        name: node.className,
        style: getComputedStyle(node),
      }))
      .filter(
        ({ rect, style }) =>
          rect.width > 0 && rect.height > 0 && rect.top < 65 && style.visibility !== 'hidden',
      )
      .map(({ rect, name }) => ({ rect, name }));
    return {
      title,
      titleLeft,
      titleRight,
      titleWidth: textWidth,
      titleAvailable: available,
      titleOverflow: heading.textOverflow,
      titleHeight: textHeight,
      titleAvailableHeight:
        numeric(heading.height) -
        numeric(heading.paddingTop) -
        numeric(heading.paddingBottom) -
        numeric(heading.borderTopWidth) -
        numeric(heading.borderBottomWidth),
      titleClip: heading.overflowX,
      heading: {
        width: heading.width,
        left: heading.left,
        right: heading.right,
        paddingRight: heading.paddingRight,
        fontSize: heading.fontSize,
      },
      titleVisible: numeric(heading.fontSize) > 0 && heading.display !== 'none',
      search: trigger.getBoundingClientRect().toJSON(),
      panel: document.querySelector('.user-panel').getBoundingClientRect().toJSON(),
      expanded: trigger.classList.contains('is-expanded'),
      balances,
      controls,
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function main() {
  const { server, store } = createOnboardingPreview();
  Object.assign(store.account(), { electric: 40, magnetic: 14, heat: 13 });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-header-qa-'));
  const browser = await puppeteer.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const errors = [];
  const rejected = [];
  const snapshots = [];
  const page = await browser.newPage();
  let stage = 'initialization';
  let guest = false;
  console.log(`Header QA artifacts: ${output}`);
  try {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (guest && url.origin === base && url.pathname === '/api/auth/me')
        return request.respond({ status: 401, contentType: 'application/json', body: '{}' });
      if (
        url.origin !== base ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          url.pathname !== '/api/onboarding')
      ) {
        rejected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return request.respond({ status: 403, contentType: 'application/json', body: '{}' });
      }
      return request.continue();
    });
    for (const route of [
      '/circuits',
      '/',
      '/workbench',
      '/world',
      '/course?course=math',
      '/discussion',
      '/settings',
      '/electromagnetic',
      '/inventory',
      '/profile?uid=u_preview01',
      '/guide',
      '/development',
      '/surveys',
      '/aichat',
    ]) {
      stage = `open ${route}`;
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.site-search-trigger');
      await page.waitForFunction(
        () => document.querySelectorAll('.user-economy-stack .currency-value').length === 3,
      );
      await page.evaluate(() => window.freeBbsMaxGuide?.pause());
      for (const width of [1920, 1440, 1024, 901, 900, 768, 390, 320]) {
        await page.setViewport({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          for (const typeScale of ['standard', 'large']) {
            stage = `${route} ${width}px ${theme} ${typeScale}`;
            await page.evaluate(
              (currentTheme, scale) => {
                document.body.classList.toggle('theme-light', currentTheme === 'light');
                document.body.classList.toggle('theme-dark', currentTheme === 'dark');
                window.freeBbsTypography.applyPreferences({
                  fontPreset: scale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                  typeScale: scale,
                });
              },
              theme,
              typeScale,
            );
            const result = await measure(page);
            snapshots.push({ stage, ...result });
            for (const field of ['size', 'family', 'weight', 'line', 'numeric']) {
              assert.equal(
                new Set(result.balances.map((entry) => entry[field])).size,
                1,
                `${stage}: balance ${field} differs ${JSON.stringify(result.balances)}`,
              );
            }
            assert.equal(result.balances[0].weight, '700');
            assert.match(result.balances[0].numeric, /tabular-nums/);
            assert.ok(
              result.search.width >= 36 &&
                result.search.left >= -1 &&
                result.search.right <= width + 1,
              `${stage}: search outside viewport ${JSON.stringify(result)}`,
            );
            if (result.titleVisible) {
              assert.ok(
                result.titleRight - result.titleLeft <= result.titleAvailable + 1 &&
                  result.titleHeight <= result.titleAvailableHeight + 1 &&
                  result.titleOverflow !== 'ellipsis' &&
                  !['hidden', 'clip'].includes(result.titleClip),
                `${stage}: title is truncated ${JSON.stringify(result)}`,
              );
            }
            if (result.titleVisible)
              assert.ok(
                result.titleRight <= result.search.left + 1,
                `${stage}: title/search overlap ${JSON.stringify(result)}`,
              );
            if (result.titleVisible) {
              for (const control of result.controls)
                assert.ok(
                  result.titleRight <= control.rect.left + 1,
                  `${stage}: title/control overlap ${JSON.stringify(result)}`,
                );
            }
            assert.ok(
              result.search.right <= result.panel.left + 1,
              `${stage}: search/account overlap ${JSON.stringify(result)}`,
            );
            if (
              ['/', '/circuits', '/world', '/workbench'].includes(route) &&
              [1440, 1024, 390].includes(width) &&
              typeScale === 'standard'
            ) {
              await page.screenshot({
                path: path.join(
                  output,
                  `${route.replace(/\W/g, '') || 'home'}-${width}-${theme}.png`,
                ),
              });
            }
          }
        }
      }
      // A real pointer and keyboard interaction, not just static rectangles.
      await page.locator('.site-search-trigger').click();
      await page.waitForSelector('dialog.site-search[open]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('dialog.site-search[open]', { hidden: true });
      await page.keyboard.down('Control');
      await page.keyboard.press('k');
      await page.keyboard.up('Control');
      await page.waitForSelector('dialog.site-search[open]');
      await page.keyboard.press('Escape');
      console.log(`${route}: 32 header layouts and search open/close/shortcut passed`);
    }
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      document.querySelector('.main-content').dataset.pageTitle = '个人工作台 / 本周课程与实验安排';
      window.freeBbsTypography.applyPreferences({
        fontPreset: 'zhongsong-study',
        typeScale: 'large',
      });
    });
    for (const width of [1440, 901, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      stage = `long title ${width}px`;
      const result = await measure(page);
      snapshots.push({ stage, ...result });
      assert.ok(
        result.titleRight - result.titleLeft <= result.titleAvailable + 1 &&
          result.titleHeight <= result.titleAvailableHeight + 1 &&
          result.titleOverflow !== 'ellipsis' &&
          !['hidden', 'clip'].includes(result.titleClip),
        `${stage}: wrapped title is not fully visible ${JSON.stringify(result)}`,
      );
      assert.ok(result.titleRight <= result.search.left + 1, `${stage}: title/search overlap`);
      for (const control of result.controls)
        assert.ok(
          result.titleRight <= control.rect.left + 1,
          `${stage}: title/${control.name} overlap`,
        );
      await page.screenshot({ path: path.join(output, `long-title-${width}.png`) });
    }
    guest = true;
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#user-name')?.textContent === '登录/注册',
    );
    await page.evaluate(() => window.freeBbsMaxGuide?.pause());
    for (const width of [1440, 901, 390, 320]) {
      await page.setViewport({ width, height: 1000 });
      stage = `guest home ${width}px`;
      const result = await measure(page);
      snapshots.push({ stage, ...result });
      assert.ok(result.titleRight <= result.search.left + 1, `${stage}: title overlap`);
      assert.ok(result.search.right <= result.panel.left + 1, `${stage}: account overlap`);
      assert.ok(result.search.left >= 0 && result.search.right <= width, `${stage}: viewport`);
      await page.locator('.site-search-trigger').click();
      await page.waitForSelector('dialog.site-search[open]');
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(rejected, []);
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ snapshots, errors, rejected }, null, 2),
    );
    console.log(
      `Passed ${snapshots.length} header layouts; no external requests or business writes.`,
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error(stage, errors, rejected);
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
