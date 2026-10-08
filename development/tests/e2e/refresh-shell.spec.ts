import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`warehouse profile and ranch navigation keep one development shell and user id at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./inventory');
    let frame = page.frameLocator('.development-commerce iframe');
    const profileLink = frame.locator('#inventory-profile-link');
    await expect(profileLink).toBeVisible();
    const uid = new URL(
      (await profileLink.getAttribute('href'))!,
      'http://127.0.0.1:3000',
    ).searchParams.get('uid');
    expect(uid).toBeTruthy();
    await profileLink.click();
    await expect(page).toHaveURL(new RegExp(`/development/profile\\?uid=${uid}`));
    frame = page.frameLocator('.development-commerce iframe');
    await expect(frame.locator('html')).toHaveClass(/development-embedded/);
    await expect(frame.locator('.topbar')).toBeHidden();
    await expect(frame.locator('.desktop-header')).toBeHidden();
    await frame.getByRole('link', { name: '进入电子牧场', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/development/ranch\\?uid=${uid}`));
    frame = page.frameLocator('.development-commerce iframe');
    await expect(frame.locator('html')).toHaveClass(/development-embedded/);
    await expect(frame.locator('.topbar')).toBeHidden();
    await expect(frame.locator('.desktop-header')).toBeHidden();
    await expect(page.locator('.development-commerce iframe')).toHaveCount(1);
    const sceneLayout = await frame.locator('.main-content').evaluate((element) => ({
      x: element.getBoundingClientRect().x,
      width: element.getBoundingClientRect().width,
      viewport: innerWidth,
    }));
    expect(sceneLayout.x).toBe(0);
    expect(sceneLayout.width).toBe(sceneLayout.viewport);
    await expect
      .poll(async () => {
        const innerHeight = await frame.locator('body').evaluate((body) => body.scrollHeight);
        const outerHeight = await page
          .locator('.development-commerce iframe')
          .evaluate((element) => element.clientHeight);
        return outerHeight >= innerHeight;
      })
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('warehouse-ranch.png'), fullPage: true });
    await frame
      .getByRole('link', { name: /个人主页/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/development/profile\\?uid=${uid}`));
    await page.getByRole('button', { name: '返回发展端', exact: true }).click();
    await expect(page).toHaveURL(/\/development\/dashboard$/);
  });
}

test('sports members publish a match and update its live stream in the score card', async ({
  page,
}, testInfo) => {
  await page.goto('./sports/matches');
  await page.getByLabel('Demo user').selectOption('demo-sports-member');
  await page.getByRole('button', { name: '添加比赛', exact: true }).click();
  const title = `赛程验证-${Date.now()}`;
  const localDateTime = (offset: number) => {
    const now = new Date(Date.now() + offset);
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  await page.getByLabel('比赛名称', { exact: true }).fill(title);
  await page.getByLabel('开始时间', { exact: true }).fill(localDateTime(-60000));
  await page.getByLabel('结束时间', { exact: true }).fill(localDateTime(3600000));
  await page.getByLabel('比赛地点', { exact: true }).fill('紫荆篮球场');
  await page.getByLabel('直播链接', { exact: false }).fill('https://example.com/live');
  await page.getByRole('button', { name: '发布比赛', exact: true }).click();
  const match = page.getByRole('article', { name: title, exact: true });
  await expect(match).toBeVisible();
  await expect(match).toContainText('正在进行');
  await match.getByRole('button', { name: '修改直播链接', exact: true }).click();
  await match
    .getByLabel(`${title}直播链接`, { exact: true })
    .fill('https://example.com/updated-live');
  await match.getByRole('button', { name: '保存直播链接', exact: true }).click();
  await expect(match.getByRole('link', { name: '观看直播', exact: true })).toHaveAttribute(
    'href',
    'https://example.com/updated-live',
  );
  await page.screenshot({ path: testInfo.outputPath('live-match.png'), fullPage: true });
  await page.getByLabel('Demo user').selectOption('demo-student');
  await expect(match.getByRole('button', { name: '修改直播链接', exact: true })).toHaveCount(0);
});

test('desk books preserve filters, reading and legacy entry links', async ({ page }) => {
  await page.goto('./desk');
  await page.getByRole('button', { name: '打开通知册', exact: true }).click();
  await expect(page).toHaveURL(/desk\/information\?filter=official/);
  await expect(page.getByRole('tab', { name: /官方发布/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: '打开经验集', exact: true }).click();
  await expect(page).toHaveURL(/desk\/knowledge$/);
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveText('無尽书桌');
  await page.goto('./knowledge');
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveText('無尽书桌');
  await expect(page.getByRole('button', { name: '打开经验集', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('refreshed pages fit desktop, tablet and mobile in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((mode) => localStorage.setItem('free_bbs_theme_mode', mode), theme);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of [
        'community',
        'collections',
        'desk',
        'desk/information?filter=mine',
        'desk/knowledge',
        'sports/matches',
      ]) {
        await page.goto(`./${route}`);
        await expect(page.locator('.development-shell-root')).toBeVisible();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        const typography = await page.locator('.development-shell-root').evaluate((shell) => {
          const headings = Array.from(shell.querySelectorAll('h1,h2,h3'));
          const styles = getComputedStyle(shell);
          return {
            expected: styles
              .getPropertyValue('--font-display')
              .replaceAll('"', '')
              .replace(/\s/g, ''),
            actual: headings
              .filter((heading) => heading.getBoundingClientRect().width > 0)
              .map((heading) =>
                getComputedStyle(heading).fontFamily.replaceAll('"', '').replace(/\s/g, ''),
              ),
          };
        });
        expect(typography.actual.every((font) => font === typography.expected)).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${width}-${route.replace(/[^a-z]+/g, '-')}.png`),
          fullPage: true,
        });
      }
    }
  }
});
