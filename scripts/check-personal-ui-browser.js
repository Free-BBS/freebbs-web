// Runs only against this script's isolated, in-memory preview server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-dynamic-require
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const { createPersonalPreview } = require('./preview-personal');

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}
async function geometry(page) {
  return page.evaluate(() => {
    const visible = (node) =>
      node &&
      node.getBoundingClientRect().width > 0 &&
      getComputedStyle(node).visibility !== 'hidden';
    const box = (node) => node.getBoundingClientRect().toJSON();
    const header = document.querySelector('.desktop-header');
    const result = {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      desktop: Boolean(header),
    };
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    result.unique = ids.length === new Set(ids).size;
    if (!header) {
      result.restored = Boolean(
        document.querySelector('.topbar #user-panel .user-economy-stack #user-status'),
      );
      result.labLink = Boolean(document.querySelector('.mobile-tool-link[href="/laboratory"]'));
      return result;
    }
    const title = document.querySelector('.desktop-header-title');
    const controls = document.querySelector('.desktop-header-controls');
    const range = document.createRange();
    range.selectNodeContents(title);
    result.titleFits = [...range.getClientRects()].every(
      (rect) => rect.right <= controls.getBoundingClientRect().left - 3,
    );
    result.headerFits = header.scrollWidth <= header.clientWidth + 1;
    result.controls = [
      ...header.querySelectorAll(
        '.site-search-trigger,.economy-shortcut,.avatar,.desktop-header-tools > .nav-link,.notification-bell',
      ),
    ]
      .filter(visible)
      .map(box);
    result.assetInSidebar = Boolean(document.querySelector('.desktop-sidebar-bottom #user-status'));
    result.mainBelow =
      document.querySelector('.main-content').getBoundingClientRect().top +
        parseFloat(getComputedStyle(document.querySelector('.main-content')).paddingTop) >=
      header.getBoundingClientRect().bottom;
    result.currencyFonts = [...document.querySelectorAll('#user-status .currency-value')].map(
      (e) => `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}`,
    );
    result.titleSize = getComputedStyle(title).fontSize;
    result.nicknameHidden = !visible(document.querySelector('.desktop-header .user-copy'));
    result.rightAligned =
      Math.abs(controls.getBoundingClientRect().right - header.getBoundingClientRect().right) < 2;
    const development = document.querySelector('.desktop-sidebar-bottom > .nav-link');
    result.developmentCentered =
      getComputedStyle(development).justifyContent === 'center' &&
      development.textContent.trim() === '前往发展端';
    result.developmentButton = parseFloat(getComputedStyle(development).borderTopWidth) >= 1;
    result.sharedFooter =
      document.querySelectorAll('[data-shared-footer]').length === 1 &&
      document.querySelectorAll('[data-shared-footer] .footer-links a').length === 4;
    const footerMeta = document.querySelector('[data-shared-footer] .footer-meta');
    result.footerCompact =
      getComputedStyle(footerMeta).borderTopWidth === '0px' &&
      parseFloat(getComputedStyle(document.querySelector('.page-shell')).paddingBottom) <= 12;
    result.menu = [...document.querySelectorAll('.nav-actions > .nav-link')]
      .filter(visible)
      .map((e) => e.textContent.trim());
    return result;
  });
}
(async () => {
  const { server, store } = createPersonalPreview();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output =
    process.env.PERSONAL_QA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'freebbs-personal-qa-'));
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
    page.on('pageerror', (error) => errors.push(error.message));
    let checked = 0;
    const routes = [
      '/',
      '/aichat',
      '/settings',
      '/profile?uid=u_preview01',
      '/laboratory',
      '/pbl',
      '/creative-workshop',
      '/tool-workshop',
      '/electromagnetic',
    ];
    for (const route of process.env.PERSONAL_QA_INTERACTIONS_ONLY ? [] : routes) {
      await page.goto(origin + route, { waitUntil: 'networkidle0' });
      await page.evaluate(() => window.freeBbsApp.sessionReady);
      for (const width of [1440, 1024, 901, 390, 360]) {
        await page.setViewport({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((themeMode) => {
            if (document.body.classList.contains('theme-light') !== (themeMode === 'light'))
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
            for (const typeScale of ['standard', 'large']) {
              await page.evaluate(
                (preferences) => window.freeBbsTypography.applyPreferences(preferences),
                { fontPreset, typeScale },
              );
              await settle(page);
              const data = await geometry(page);
              const label = `${route} ${width} ${theme} ${fontPreset} ${typeScale}`;
              assert.equal(data.overflow, false, `${label} horizontal overflow`);
              assert.equal(data.unique, true, `${label} duplicate ids`);
              assert.equal(data.desktop, width > 900, `${label} breakpoint`);
              if (data.desktop) {
                assert.equal(data.titleFits, true, `${label} title overlaps controls`);
                assert.equal(data.headerFits, true, `${label} header overflow`);
                assert.equal(data.assetInSidebar, true, `${label} asset placement`);
                assert.equal(data.mainBelow, true, `${label} header covers page content`);
                assert.equal(data.nicknameHidden, true, `${label} nickname should be hidden`);
                assert.equal(data.rightAligned, true, `${label} controls should align right`);
                assert.equal(data.developmentCentered, true, `${label} development link`);
                assert.equal(data.developmentButton, true, `${label} development button border`);
                assert.equal(data.sharedFooter, true, `${label} shared footer`);
                assert.equal(data.footerCompact, true, `${label} compact footer`);
                assert.equal(
                  new Set(data.currencyFonts).size,
                  1,
                  `${label} mismatched currency fonts`,
                );
                const centers = data.controls.map((b) => b.y + b.height / 2);
                assert.ok(
                  Math.max(...centers) - Math.min(...centers) < 3,
                  `${label} not a single centered control row`,
                );
                assert.deepEqual(
                  data.menu,
                  [
                    '首页',
                    '学习世界',
                    '讨论区',
                    '我的工作台',
                    '实验室',
                    '创意工坊',
                    'PBL计划',
                    '问问 Max',
                    '活动报名（试用）',
                  ],
                  `${label} menu`,
                );
              } else {
                assert.equal(data.restored, true, `${label} original mobile positions`);
                assert.equal(data.labLink, true, `${label} mobile laboratory entry`);
              }
              checked += 1;
              if (
                fontPreset === 'transistor-lab' &&
                typeScale === 'standard' &&
                [1440, 390].includes(width)
              ) {
                await page.screenshot({
                  path: path.join(
                    output,
                    `${route.split('?')[0].slice(1) || 'home'}-${width}-${theme}.png`,
                  ),
                });
              }
            }
          }
        }
      }
      console.log(`Layout OK: ${route} (${checked} total cases)`);
    }
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/aichat`, { waitUntil: 'networkidle0' });
    await page.setViewport({ width: 1920, height: 1080 });
    await settle(page);
    const wide = await geometry(page);
    assert.equal(wide.nicknameHidden, true);
    assert.equal(wide.rightAligned, true);
    assert.equal(wide.developmentButton, true);
    await page.setViewport({ width: 1440, height: 1000 });
    console.log('Interaction: entire currency area including heat and whitespace');
    for (const target of ['.currency-heat', '.currency-electric', '.currency-magnetic']) {
      await page.click(`#user-status ${target}`);
      await page.waitForFunction(
        () => !document.getElementById('electromagnetic-modal')?.classList.contains('hidden'),
      );
      assert.match(
        await page.$eval('#electromagnetic-modal', (e) => e.textContent),
        /热力 · 你的活跃度/,
      );
      await page.click('#electromagnetic-modal .fortune-close');
    }
    const assetsBox = await page.$eval('#user-status', (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.click(assetsBox.x + assetsBox.width / 2, assetsBox.y + 3);
    await page.waitForFunction(
      () => !document.getElementById('electromagnetic-modal')?.classList.contains('hidden'),
    );
    await page.click('#electromagnetic-modal .fortune-close');
    for (const key of ['Enter', 'Space']) {
      await page.focus('#user-status');
      await page.keyboard.press(key);
      await page.waitForFunction(
        () => !document.getElementById('electromagnetic-modal')?.classList.contains('hidden'),
      );
      await page.click('#electromagnetic-modal .fortune-close');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'user-status');
    }
    await page.evaluate(() => {
      document.activeElement?.blur();
      document
        .querySelector('[data-shared-footer]')
        .scrollIntoView({ block: 'end', behavior: 'instant' });
    });
    await page.screenshot({ path: path.join(output, 'shared-footer-desktop.png') });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    console.log('Interaction: saved conversation');
    await page.click('.aichat-dialog-item');
    await page.waitForFunction(() =>
      document.querySelector('#aichat-thread')?.textContent.includes('不是真实 AI'),
    );
    await page.click('#aichat-new-dialog');
    console.log('Interaction: new conversation and search');
    assert.equal(await page.$eval('#aichat-input', (e) => e.value), '');
    await page.click('.desktop-header .site-search-trigger');
    assert.equal(await page.$eval('dialog.site-search', (e) => e.open), true);
    await page.keyboard.press('Escape');
    console.log('Interaction: notifications');
    await page.click('.notification-bell');
    assert.equal(await page.$eval('#notification-panel', (e) => e.hidden), false);
    await page.click('.notification-close');
    const beforeTheme = await page.$eval('body', (e) => e.classList.contains('theme-light'));
    console.log('Interaction: theme');
    await page.click('.desktop-header-tools [data-theme-toggle]');
    assert.notEqual(
      await page.$eval('body', (e) => e.classList.contains('theme-light')),
      beforeTheme,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 300);
        }),
    );
    await page.screenshot({ path: path.join(output, 'theme-final.png') });
    // Exercise the original role renderer, not a new permission path.
    await page.evaluate(() => {
      window.freeBbsApp.userState.isAdmin = true;
      window.renderAdminSection();
    });
    assert.deepEqual((await geometry(page)).menu, [
      '首页',
      '学习世界',
      '讨论区',
      '我的工作台',
      '实验室',
      '创意工坊',
      'PBL计划',
      '问问 Max',
      '活动报名（试用）',
      '管理员端',
    ]);
    console.log('Interaction: ranch feed, shear, rub and wallet update');
    await page.goto(`${origin}/profile?uid=u_preview01`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-extra-action="feed"]');
    const initialFish = store.account().assets.fish;
    await page.click('[data-extra-action="feed"]');
    await page.waitForFunction(() =>
      /Max 吃饱了|金色的惊喜/.test(document.querySelector('#profile-extras-message')?.textContent),
    );
    assert.equal(store.account().assets.fish, initialFish - 1);
    await page.click('[data-extra-action="shear"]');
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message')?.textContent.includes('羊毛剪好了'),
    );
    assert.equal(await page.$eval('[data-extra-action="shear"]', (e) => e.disabled), true);
    const initialElectric = store.account().electric;
    await page.click('[data-extra-action="rub_wool"]');
    await page.waitForFunction(() =>
      document.querySelector('#profile-extras-message')?.textContent.includes('获得 2 电元'),
    );
    assert.equal(store.account().electric, initialElectric + 2);
    assert.equal(store.account().assets.rubber_rod, 1);
    assert.equal(
      await page.$eval('#user-status .currency-value', (e) => Number(e.textContent.trim())),
      initialElectric + 2,
    );
    await page.screenshot({ path: path.join(output, 'ranch-after-shear.png') });
    console.log('Interaction: equipped profile theme and avatar frame');
    await page.click('.profile-wardrobe-disclosure > summary');
    for (const item of ['card_twilight', 'card_blueprint', 'frame_orbit', 'frame_aurora']) {
      const slot = item.startsWith('card') ? 'card' : 'frame';
      await page.$eval(`[data-extra-action="equip"][data-item="${item}"]`, (node) =>
        node.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await page.click(`[data-extra-action="equip"][data-item="${item}"]`);
      await page.waitForFunction(
        (itemKey) =>
          document.querySelector(`[data-item="${itemKey}"][aria-pressed="true"]`) &&
          document.querySelector('#profile-extras-message')?.textContent.includes('已佩戴'),
        {},
        item,
      );
      assert.equal(store.account().equipped[slot], item);
      if (slot === 'card')
        assert.equal(await page.$eval('body', (e) => e.dataset.publicProfileTheme), item);
    }
    console.log('Interaction: laboratory entry on desktop and mobile');
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(`${origin}/laboratory`, { waitUntil: 'networkidle0' });
      assert.equal(await page.$$eval('.laboratory-status.is-planned', (nodes) => nodes.length), 2);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('.laboratory-enter'),
      ]);
      assert.equal(new URL(page.url()).pathname, '/circuits');
      const activeSelector = width > 900 ? '.nav-link.is-active' : '.mobile-tool-link.is-active';
      assert.equal(
        await page.$$eval(activeSelector, (nodes) =>
          nodes.some((e) => e.getAttribute('href') === '/laboratory'),
        ),
        true,
      );
    }
    // Existing auth UI remains operable after a logout, including restoration on mobile.
    await page.evaluate(() => window.freeBbsApp.clearSession());
    await page.setViewport({ width: 390, height: 844 });
    await settle(page);
    assert.equal((await geometry(page)).restored, true);
    await page.setViewport({ width: 1440, height: 1000 });
    await settle(page);
    assert.equal((await geometry(page)).assetInSidebar, true);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ checked, errors, output }, null, 2),
    );
    console.log(JSON.stringify({ checked, errors, output }));
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
