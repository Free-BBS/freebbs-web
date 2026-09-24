import { expect, test } from '@playwright/test';

test('daily discovery keeps preferences, rotates and targets knowledge', async ({ page }) => {
  await page.goto('./events');
  const discovery = page.getByRole('region', { name: '今日随机发现' });
  await expect(discovery.getByRole('link', { name: '去看看' })).toBeVisible();
  const first = await discovery.getByRole('link', { name: '去看看' }).getAttribute('href');
  await page.reload();
  await expect(discovery.getByRole('link', { name: '去看看' })).toHaveAttribute('href', first!);
  await discovery.getByRole('button', { name: '换一个' }).click();
  await expect(discovery.getByRole('link', { name: '去看看' })).not.toHaveAttribute('href', first!);
  await discovery.getByRole('button', { name: '偏好设置' }).click();
  const drawer = page.getByRole('dialog', { name: '发现偏好' });
  await drawer.getByRole('checkbox', { name: '活动', exact: true }).uncheck();
  await drawer.getByRole('button', { name: '保存偏好' }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(discovery.getByRole('link', { name: '去看看' })).toHaveAttribute(
    'href',
    /knowledge\//,
  );
  const title = await discovery.locator('h4').innerText();
  await discovery.getByRole('link', { name: '去看看' }).click();
  await expect(page).toHaveURL(/knowledge\//);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});

test('mobile map status and preferences remain usable with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./events');
  await page.getByRole('button', { name: /frEE bbs MAP/ }).click();
  await expect(page.getByRole('dialog', { name: 'frEE bbs MAP' })).toContainText('小程序尚未发布');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: '偏好设置' }).click();
  const drawer = page.getByRole('dialog', { name: '发现偏好' });
  for (const name of ['活动', '经验'])
    await drawer.getByRole('checkbox', { name, exact: true }).uncheck();
  await drawer.getByRole('button', { name: '保存偏好' }).click();
  await expect(drawer.getByRole('alert')).toHaveText('请至少选择一种可推荐的内容。');
  await drawer.getByRole('button', { name: '恢复默认' }).click();
  await drawer.getByRole('textbox', { name: '兴趣关键词', exact: true }).fill('不存在的兴趣关键词');
  await drawer.getByRole('checkbox', { name: '也看看兴趣之外的内容' }).uncheck();
  await drawer.getByRole('button', { name: '保存偏好' }).click();
  await expect(page.getByText('暂时没有符合偏好的内容')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
