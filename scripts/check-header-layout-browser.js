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
    const desktopTitle = document.querySelector('.desktop-header-title');
    const titleElement = desktopTitle?.getBoundingClientRect().width ? desktopTitle : null;
    const heading = titleElement
      ? getComputedStyle(titleElement)
      : getComputedStyle(headerMain, '::before');
    const titleBounds = titleElement?.getBoundingClientRect();
    const numeric = (value) => parseFloat(value) || 0;
    let title = titleElement?.textContent || headerMain.dataset.pageTitle;
    if (!titleElement && heading.content.startsWith('"')) title = JSON.parse(heading.content);
    if (!titleElement && ['none', 'normal'].includes(heading.content)) title = '';
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
    const titleLeft = titleBounds
      ? titleBounds.left + numeric(heading.borderLeftWidth) + numeric(heading.paddingLeft)
      : numeric(heading.left) + numeric(heading.marginLeft) + numeric(heading.paddingLeft);
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
    const balances = [...document.querySelectorAll('#user-status .currency-value')].map((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      let insideClippingAncestors = true;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (!['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX))
          continue;
        const parentBounds = parent.getBoundingClientRect();
        if (
          parentBounds.width > 0 &&
          (bounds.left < parentBounds.left - 1 || bounds.right > parentBounds.right + 1)
        )
          insideClippingAncestors = false;
      }
      return {
        value: node.textContent,
        size: style.fontSize,
        family: style.fontFamily,
        weight: style.fontWeight,
        line: style.lineHeight,
        numeric: style.fontVariantNumeric,
        rect: bounds.toJSON(),
        insideClippingAncestors,
      };
    });
    const controls = [
      ...document.querySelectorAll(
        '.mobile-theme-toggle, .desktop-header-tools .sidebar-theme-toggle, .notification-bell',
      ),
    ]
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

async function measureEconomy(page) {
  return page.evaluate(() => {
    const stack = document.querySelector('.user-economy-stack');
    return {
      stack: {
        rect: stack.getBoundingClientRect().toJSON(),
        clientWidth: stack.clientWidth,
        scrollWidth: stack.scrollWidth,
        scrollLeft: stack.scrollLeft,
        overflow: getComputedStyle(stack).overflowX,
      },
      shortcuts: [...stack.querySelectorAll('.economy-shortcut')].map((link) => ({
        label: link.getAttribute('aria-label'),
        text: link.querySelector('span').textContent.trim(),
        rect: link.getBoundingClientRect().toJSON(),
      })),
      values: [...document.querySelectorAll('#user-status .currency-value')].map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          value: node.textContent,
          rect: node.getBoundingClientRect().toJSON(),
          textRect: range.getBoundingClientRect().toJSON(),
          textOverflow: getComputedStyle(node).textOverflow,
        };
      }),
    };
  });
}

async function saveWorkbenchScreenshot(page, output, filename) {
  const companionVisible = await page.$eval('#workbench-companion-hide', (button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
  if (companionVisible) await page.locator('#workbench-companion-hide').click();
  await measure(page);
  await page.screenshot({ path: path.join(output, filename) });
}

async function runBoundaryChecks({ page, base, store, output, snapshots, setStage }) {
  const client = await page.createCDPSession();
  try {
    for (const mode of ['regular', 'long']) {
      const balances =
        mode === 'regular'
          ? { electric: 120, magnetic: 86, heat: 24 }
          : { electric: 987654321, magnetic: 876543210, heat: 765432109 };
      Object.assign(store.account(), balances);
      setStage(`boundary ${mode} initialization`);
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(
        (expected) =>
          [...document.querySelectorAll('#user-status .currency-value')]
            .map((node) => node.textContent.trim())
            .join(',') === expected,
        {},
        Object.values(balances).join(','),
      );
      await page.evaluate(() => window.freeBbsMaxGuide?.pause());
      for (const width of [320, 359, 360, 361, 374, 375, 376]) {
        await page.setViewport({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          for (const typeScale of ['standard', 'large']) {
            const stage = `boundary ${mode} ${width}px ${theme} ${typeScale}`;
            setStage(stage);
            await page.evaluate(
              (currentTheme, scale) => {
                document.body.classList.toggle('theme-light', currentTheme === 'light');
                document.body.classList.toggle('theme-dark', currentTheme === 'dark');
                window.freeBbsTypography.applyPreferences({
                  fontPreset: scale === 'large' ? 'zhongsong-study' : 'transistor-lab',
                  typeScale: scale,
                });
                document.querySelector('.user-economy-stack').scrollLeft = 0;
              },
              theme,
              typeScale,
            );
            const initial = await measure(page);
            const economy = await measureEconomy(page);
            const { nodes } = await client.send('Accessibility.getFullAXTree');
            const accessibleLinks = nodes
              .filter((node) => !node.ignored && node.role?.value === 'link')
              .map((node) => node.name?.value);
            snapshots.push({ stage, initial, economy, accessibleLinks });
            assert.equal(initial.balances.length, 3, `${stage}: missing balances`);
            assert.equal(economy.shortcuts.length, 3, `${stage}: missing shortcuts`);
            assert.deepEqual(
              economy.shortcuts.map(({ text }) => text),
              ['签到', '仓库', '商店'],
              `${stage}: shortcut labels changed`,
            );
            for (const shortcut of economy.shortcuts) {
              assert.equal(shortcut.label, shortcut.text, `${stage}: shortcut loses aria-label`);
              assert.ok(
                accessibleLinks.includes(shortcut.text),
                `${stage}: ${shortcut.text} is absent from Chrome's accessible link names`,
              );
              assert.ok(
                shortcut.rect.width >= 44 && shortcut.rect.height >= 32,
                `${stage}: shortcut target shrank ${JSON.stringify(shortcut)}`,
              );
            }
            assert.ok(
              initial.scrollWidth <= width + 1,
              `${stage}: page overflow must not replace the dedicated economy scroll`,
            );
            for (const value of economy.values)
              assert.ok(
                value.textRect.width <= value.rect.width + 1 && value.textOverflow !== 'ellipsis',
                `${stage}: balance text is internally truncated ${JSON.stringify(value)}`,
              );
            if (mode === 'regular') {
              assert.ok(
                initial.balances.every(
                  ({ rect, insideClippingAncestors }) =>
                    rect.width > 0 &&
                    rect.left >= -1 &&
                    rect.right <= width + 1 &&
                    insideClippingAncestors,
                ),
                `${stage}: regular balances need scrolling ${JSON.stringify(initial.balances)}`,
              );
              assert.equal(economy.stack.scrollLeft, 0, `${stage}: initial row is scrolled`);
              if (width === 320 && theme === 'light' && typeScale === 'standard')
                await saveWorkbenchScreenshot(page, output, 'boundary-workbench-mobile.png');
            } else {
              assert.ok(
                economy.stack.scrollWidth > economy.stack.clientWidth &&
                  ['auto', 'scroll'].includes(economy.stack.overflow),
                `${stage}: exceptionally long balances must retain horizontal scrolling`,
              );
              await page.evaluate(() => {
                const stack = document.querySelector('.user-economy-stack');
                stack.scrollLeft = stack.scrollWidth;
              });
              const scrolled = await measure(page);
              const scrolledEconomy = await measureEconomy(page);
              Object.assign(snapshots.at(-1), { scrolled, scrolledEconomy });
              const last = scrolled.balances.at(-1);
              assert.ok(
                scrolledEconomy.stack.scrollLeft > 0 &&
                  last.rect.width > 0 &&
                  last.rect.left >= -1 &&
                  last.rect.right <= width + 1 &&
                  last.insideClippingAncestors,
                `${stage}: scrolling cannot fully reveal the final balance ${JSON.stringify(last)}`,
              );
              assert.equal(
                last.value.trim(),
                String(balances.heat),
                `${stage}: last balance lost digits`,
              );
            }
          }
        }
      }
    }
    setStage('boundary representative desktop screenshot');
    Object.assign(store.account(), { electric: 120, magnetic: 86, heat: 24 });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${base}/workbench`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => document.querySelector('#user-status .currency-value')?.textContent.trim() === '120',
    );
    await page.evaluate(() => {
      window.freeBbsMaxGuide?.pause();
      document.body.classList.add('theme-light');
      document.body.classList.remove('theme-dark');
      window.freeBbsTypography.applyPreferences({
        fontPreset: 'transistor-lab',
        typeScale: 'standard',
      });
    });
    await measure(page);
    await saveWorkbenchScreenshot(page, output, 'boundary-workbench-desktop.png');
    console.log(
      `Passed ${snapshots.length} compact boundary layouts, accessible shortcuts and long-balance scrolling.`,
    );
  } finally {
    await client.detach();
  }
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
  const boundarySnapshots = [];
  const boundaryOnly = process.env.HEADER_QA_BOUNDARY_ONLY === '1';
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
    if (!boundaryOnly) {
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
          () => document.querySelectorAll('#user-status .currency-value').length === 3,
        );
        await page.evaluate(() => window.freeBbsMaxGuide?.pause());
        if (route.startsWith('/course')) {
          // Enter the real mandatory course flow before checking shell shortcuts.
          await page.waitForSelector('.learning-start-dialog[open] select[name="level"]');
          const level = await page.$eval(
            '.learning-start-dialog select[name="level"]',
            (select) => [...select.options].find((option) => option.value).value,
          );
          await page.select('.learning-start-dialog select[name="level"]', level);
          await page.click('.learning-start-dialog .learning-start-apply');
          await page.waitForSelector('.learning-start-dialog[open]', { hidden: true });
        }
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
              assert.equal(result.balances.length, 3, `${stage}: missing one or more balances`);
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
                result.balances.every(
                  ({ rect, insideClippingAncestors }) =>
                    rect.width > 0 &&
                    rect.left >= -1 &&
                    rect.right <= width + 1 &&
                    insideClippingAncestors,
                ),
                `${stage}: balance outside viewport ${JSON.stringify(result.balances)}`,
              );
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
        stage = `${route} search pointer and keyboard interactions`;
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
        document.querySelector('.main-content').dataset.pageTitle =
          '个人工作台 / 本周课程与实验安排';
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
    }
    guest = false;
    await runBoundaryChecks({
      page,
      base,
      store,
      output,
      snapshots: boundarySnapshots,
      setStage: (value) => {
        stage = value;
      },
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(rejected, []);
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ boundaryOnly, snapshots, boundarySnapshots, errors, rejected }, null, 2),
    );
    console.log(
      `Passed ${snapshots.length} main and ${boundarySnapshots.length} boundary header layouts; no external requests or business writes.`,
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          boundaryOnly,
          snapshots,
          boundarySnapshots,
          errors,
          rejected,
          failedStage: stage,
          failure: error.message,
        },
        null,
        2,
      ),
    );
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
