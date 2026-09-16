// Screenshot real UI components with an explicitly isolated demonstration account.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');

(async () => {
  if (!process.env.ECONOMY_SCREENSHOT_DIR) throw new Error('Set ECONOMY_SCREENSHOT_DIR');
  const output = path.resolve(process.env.ECONOMY_SCREENSHOT_DIR);
  fs.mkdirSync(output, { recursive: true });
  const { server, store } = createEconomyPreview();
  // This is a fresh in-memory account, not the running manual preview or a real user.
  Object.assign(store.account().assets, {
    frame_orbit: 1,
    frame_aurora: 1,
    plate_maxwell: 1,
    plate_observer: 1,
    card_blueprint: 1,
    card_twilight: 1,
    golden_fishbone: 1,
    fishbone: 10,
    fish: 3,
    maxwell_spectacles: 1,
    faraday_ring: 1,
  });
  store.account().counts.fishbone = 10;
  store.account().adopted = true;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1520, height: 1100 },
      deviceScaleFactor: 1.5,
    });
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('[data-item="plate_fishbone_master"]').waitFor();
    assert.equal(store.account().assets.plate_fishbone_master, 1);
    for (const key of ['frame_aurora', 'plate_fishbone_master', 'card_twilight']) {
      await page.locator(`[data-extra-action="equip"][data-item="${key}"]`).click();
      await page.locator(`[data-item="${key}"][aria-pressed="true"]`).waitFor();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      if (!document.body.classList.contains('theme-light')) window.freeBbsApp.toggleThemeMode();
    });
    await page
      .locator('.public-profile-shell')
      .screenshot({ path: path.join(output, 'profile-real-light.png') });
    await page.goto(`${base}/settings`);
    await page.locator('[data-item="plate_fishbone_master"]').waitFor();
    await page
      .locator('.profile-extras-top')
      .screenshot({ path: path.join(output, 'avatar-ranch-real-light.png') });
    await page.goto(`${base}/profile?uid=u_preview01`);
    await page.locator('[data-item="plate_fishbone_master"]').waitFor();
    // A contact sheet reuses the actual badge renderer, frame selectors, card skins and ranch DOM.
    // Only its presentation grid and annotations are fixture styling.
    await page.evaluate(() => {
      const ranch = document.querySelector('.profile-ranch').cloneNode(true);
      ranch
        .querySelectorAll('button, a, details, #profile-extras-message')
        .forEach((el) => el.remove());
      const avatar = document.getElementById('public-profile-avatar').src;
      const designs = [
        [
          'plate_maxwell',
          'frame_orbit',
          'card_blueprint',
          '麦克斯韦亲传',
          '环流轨道 / 未完成的蓝图',
          '电磁波纹 · 青金配色',
          '购买装扮',
        ],
        [
          'plate_observer',
          'frame_aurora',
          'card_twilight',
          '宇宙见习观察员',
          '极光回路 / 暮色实验室',
          '行星轨道 · 雾紫配色',
          '购买装扮',
        ],
        [
          'plate_fishbone_master',
          'frame_orbit',
          'card_blueprint',
          '鱼骨达人',
          '环流轨道 / 未完成的蓝图',
          '金色鱼骨 · 收藏成就',
          '成就获得 · 非卖品',
        ],
      ];
      const sheet = document.createElement('main');
      sheet.id = 'design-sheet';
      sheet.innerHTML = `<header><div><p class="sheet-kicker">FREE BBS / PERSONAL COLLECTION</p><h1>把一点喜欢，佩戴在身上。</h1><p class="sheet-intro">铭牌 · 头像框 · 个人名片 · Max 的小牧场</p></div><span class="sheet-stamp">本地组件实拍<br>未发布 · 模拟账号</span></header><div class="sheet-grid">${designs
        .map(
          ([plate, frame, card, name, combination, story, origin], i) =>
            `<article class="sheet-card"><div class="sheet-card-heading"><span>0${i + 1}</span><span>${origin}</span></div><div class="sheet-emblem"><img src="/assets/icons/${plate}.svg" alt=""><div><h2>${name}</h2><p>${story}</p></div></div><div class="sheet-badge">${window.FreeBbsProfileExtras.badge(plate)}</div><div class="profile-decoration-preview" data-profile-card="${card}"><img src="${avatar}" alt="模拟头像" data-avatar-frame="${frame}"><div><strong>NotingSr</strong><p class="sheet-card-note">今天也有一点新的发现。</p></div></div><p class="sheet-combination">${combination}</p></article>`,
        )
        .join(
          '',
        )}</div><div class="sheet-bottom"><section class="sheet-achievement"><p class="sheet-kicker">A LITTLE ACHIEVEMENT</p><h2>十次收藏，一点金光。</h2><p>商城累计购买 10 个鱼骨<br>并拥有黄金鱼骨<br>自动解锁「鱼骨达人」。</p><p>成就铭牌不可购买、不可赠送。<br>获得后自由佩戴，不替换当前装扮。</p><span class="sheet-footnote">原个人资料与字体设置保持不变</span></section></div>`;
      sheet.querySelector('.sheet-bottom').append(ranch);
      document.body.replaceChildren(sheet);
    });
    await page.addStyleTag({
      content: `
      body { margin: 0; background: #f4f5f1; }
      #design-sheet { --sheet-bg: #fcfdfb; --sheet-ink: #214a50; --sheet-muted: #657674; --sheet-line: #d7e2dc; width: 1520px; padding: 54px 60px 46px; color: var(--sheet-ink); font-family: var(--font-zh-ui, sans-serif); }
      body.theme-dark #design-sheet { --sheet-bg: #132a30; --sheet-ink: #d7e9e4; --sheet-muted: #a4bbb6; --sheet-line: #38515a; background: #0d2026; }
      #design-sheet header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 32px; }
      #design-sheet h1 { font: 600 36px/1.4 var(--font-zh-ui,sans-serif); color: var(--sheet-ink); margin: 10px 0; letter-spacing: .04em; }
      #design-sheet h2 { font: 600 21px/1.5 var(--font-zh-ui,sans-serif); color: var(--sheet-ink); margin: 6px 0; }
      #design-sheet .sheet-kicker { font: 600 11px/1.5 system-ui; letter-spacing: .2em; color: var(--sheet-muted); margin: 0; }
      #design-sheet .sheet-intro { font-size: 17px; color: var(--sheet-muted); margin: 8px 0 0; }
      #design-sheet .sheet-stamp { border: 1px solid var(--sheet-line); padding: 12px 20px; border-radius: 30px; font-size: 12px; line-height: 1.7; color: var(--sheet-muted); text-align: center; }
      .sheet-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 22px; }
      .sheet-card { background: var(--sheet-bg); border: 1px solid var(--sheet-line); border-radius: 22px; padding: 22px; }
      #design-sheet .sheet-card-heading { display: flex; justify-content: space-between; font-size: 11px; color: var(--sheet-muted); margin-bottom: 25px; }
      .sheet-emblem { display: flex; align-items: center; gap: 16px; }
      .sheet-emblem img { width: 74px; height: 74px; filter: none !important; }
      #design-sheet .sheet-emblem p { font-size: 12px; color: var(--sheet-muted); margin: 6px 0; }
      .sheet-badge { min-height: 104px; display: flex; align-items: center; }
      #design-sheet .cosmetic-nameplate { font-size: 16px; }
      #design-sheet .profile-decoration-preview { padding: 20px; gap: 18px; min-height: 130px; }
      #design-sheet .profile-decoration-preview img { width: 62px; height: 62px; }
      #design-sheet .profile-decoration-preview strong { font: 600 19px/1.4 var(--font-zh-ui,sans-serif); }
      #design-sheet .sheet-card-note { font-size: 11px; margin: 8px 0 0; color: inherit; }
      #design-sheet .sheet-combination { font-size: 11px; color: var(--sheet-muted); margin: 16px 0 0; }
      .sheet-bottom { display: grid; grid-template-columns: 390px minmax(0,1fr); gap: 36px; margin-top: 32px; align-items: center; }
      .sheet-achievement { padding: 14px 8px; }
      #design-sheet .sheet-achievement h2 { font-size: 27px; margin: 12px 0 20px; }
      #design-sheet .sheet-achievement > p:not(.sheet-kicker) { font-size: 15px; line-height: 1.9; color: var(--sheet-muted); margin: 18px 0; }
      #design-sheet .sheet-footnote { display: inline-block; font-size: 12px; padding: 10px 14px; border: 1px solid var(--sheet-line); border-radius: 8px; color: var(--sheet-muted); }
      #design-sheet .profile-ranch { margin: 0; padding: 22px; background: var(--sheet-bg); border-color: var(--sheet-line); color: var(--sheet-ink); }
      #design-sheet .profile-ranch h2 { font-size: 23px; }
      #design-sheet .profile-ranch .ranch-scene { height: 240px; }
      #design-sheet .profile-ranch .ranch-inventory { font-size: 12px; margin: 12px 0 0; }
      #design-sheet .ranch-intro { font-size: 13px; }
      #design-sheet .ranch-owner-controls:empty { display:none; }
    `,
    });
    for (const mode of ['light', 'dark']) {
      await page.evaluate(async (theme) => {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add(`theme-${theme}`);
        await document.fonts.ready;
        await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
      }, mode);
      await page
        .locator('#design-sheet')
        .screenshot({ path: path.join(output, `collection-${mode}.png`) });
    }
    console.log(
      `Captured real-component contact sheets and actual profile/settings sections at ${output}`,
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
