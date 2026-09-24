import { expect, test } from '@playwright/test';

test('shows a private growth summary in the main-site styled sidebar', async ({ page }) => {
  await page.goto('./growth');

  await expect(
    page.getByRole('heading', { name: '个人成长档案', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('已结束的活动报名', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '成就称号' })).toBeVisible();
  await expect(page.locator('.sidebar .brand-name')).toHaveText('FREE-BBS');
  await expect(page.locator('.sidebar .module-nav a[href="/development/growth"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    page.locator('.sidebar .module-nav a[href="/development/interest-groups"]'),
  ).toHaveCount(0);

  await page.getByRole('button', { name: '切换到明亮模式' }).click();
  await expect(page.locator('body')).toHaveClass(/theme-light/);
  await expect(page.getByRole('button', { name: '切换到暗色模式' })).toBeVisible();
});
