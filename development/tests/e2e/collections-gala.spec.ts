import { expect, test } from '@playwright/test';
const featured = Array.from({ length: 4 }, (_, index) => ({
  id: `layout-${index}`,
  source: 'development_activity',
  title: index === 3 ? '电子系校园创意交流与新朋友见面活动' : `校园相遇 ${index + 1}`,
  description: '听歌、交流、一起发现校园中的新鲜事。',
  organizer: '文艺中心',
  coverUrl: null,
  opensAt: null,
  closesAt: index === 3 ? '2026-01-01T08:00:00.000Z' : null,
  location: '活动室',
  capacity: null,
  registrationCount: null,
  registered: false,
  status: index === 3 ? 'closed' : index === 2 ? 'upcoming' : 'open',
}));
async function noOverflow(page: import('@playwright/test').Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
test('existing activity list and details retain the collection header and active navigation', async ({
  page,
}) => {
  await page.goto('./collections');
  await page.getByRole('link', { name: '现有活动', exact: true }).click();
  await expect(page.locator('.main-site-header-title')).toHaveText('萬事屋');
  await expect(page.locator('.module-nav a[aria-current="page"]')).toHaveAttribute(
    'href',
    '/development/collections',
  );
  await page.locator('.event-card-heading h3 a').first().click();
  await expect(page).toHaveURL(/\/events\/[^/]+$/);
  await expect(page.locator('.main-site-header-title')).toHaveText('萬事屋');
  await expect(page.locator('.module-nav a[aria-current="page"]')).toHaveAttribute(
    'href',
    '/development/collections',
  );
});
for (const width of [390, 768, 1440]) {
  test(`collections, Map code and Spring gala fit both themes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/development/v1/collections/dashboard', (route) =>
      route.fulfill({ json: { data: { featured, showcase: [], canCreate: false } } }),
    );
    for (const theme of ['light', 'dark']) {
      await page.goto('./collections');
      await page.evaluate((value) => localStorage.setItem('free_bbs_theme_mode', value), theme);
      await page.reload();
      await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${theme}`));
      await expect(page.locator('.collections-belt-card:visible')).toHaveCount(4);
      await expect(page.getByRole('link', { name: /电子系校园创意交流/ })).toContainText('已结束');
      const heights = await page
        .locator('.collections-belt-card:visible')
        .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`collections-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: /^frEE bbs MAP/ }).click();
      const map = page.getByRole('dialog', { name: 'frEE bbs MAP' });
      await expect(map).toBeVisible();
      const code = map.getByRole('img', { name: 'frEE bbs MAP 小程序码' });
      await expect.poll(() => code.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(978);
      await expect(map.getByRole('link', { name: '保存小程序码' })).toHaveAttribute(
        'download',
        'frEE-bbs-MAP.png',
      );
      await noOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`map-${width}-${theme}.png`) });
      await map.getByRole('button', { name: '关闭编辑器' }).click();
      const board = page.getByRole('button', { name: '打开告示板' });
      await board.click();
      const dialog = page.getByRole('dialog', { name: '今天想从哪里开始？' });
      await expect(dialog.getByRole('link')).toHaveCount(2);
      await page.screenshot({ path: testInfo.outputPath(`board-${width}-${theme}.png`) });
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('link', { name: /内容橱窗/ })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(board).toBeFocused();
      await page.goto('./events/student-festival');
      const invitation = page.getByRole('region', { name: '春节相约，让我们的故事上场' });
      await expect(invitation).toContainText(
        '我们会在春节左右发布电子系春晚，欢迎大家投稿任何题材的素材。',
      );
      await expect(page.locator('.module-nav a[aria-current="page"]')).toHaveAttribute(
        'href',
        '/development/community',
      );
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`gala-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole('link', { name: '开始投稿', exact: true }).click();
      await expect(page).toHaveURL(/#festival-submit-heading$/);
      await expect(page.getByRole('heading', { name: '分享你的作品' })).toBeInViewport();
      await expect(page.getByRole('button', { name: '审核投稿', exact: true })).toHaveCount(0);
    }
  });
}
