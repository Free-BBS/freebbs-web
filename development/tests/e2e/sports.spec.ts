import { expect, test, type Page } from '@playwright/test';

async function switchUser(page: Page, user: string) {
  await page.getByLabel('Demo user').selectOption(user);
  await expect(page.getByLabel('Demo user')).toHaveValue(user);
}

test('sports separates the public directory from scoped team operations', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const studentNumber = `e2e-sports-${testInfo.workerIndex}-${testInfo.retry}`;

  await page.goto('./sports');
  await expect(page.getByRole('heading', { name: '体育代表队', level: 2 })).toBeVisible();
  const card = page.locator('.workbench-card').filter({ hasText: '院篮球队' });
  await expect(card).toContainText('2026秋季');
  await expect(card).toContainText('每周二、四 18:00–20:00，篮球馆');
  await card.getByRole('link', { name: '查看队伍详情' }).click();

  await expect(page).toHaveURL(/\/development\/sports\/team-basketball$/);
  await expect(page.getByRole('heading', { name: '院篮球队', level: 2 })).toBeVisible();
  await expect(page.getByText('训练或比赛安排')).toBeVisible();

  await switchUser(page, 'demo-sports-lead');
  await expect(page.getByRole('button', { name: '编辑队伍信息' })).toBeVisible();
  await page.getByRole('button', { name: '编辑队伍信息' }).click();
  await page.getByLabel('训练或比赛安排').fill('每周二、四 18:00–20:00，篮球馆（详情维护）');
  await page.getByRole('button', { name: '保存队伍信息' }).click();
  await expect(page.getByRole('status')).toContainText('队伍信息已更新');

  const csv = `姓名,学号\n端到端同学,${studentNumber}`;
  await page
    .getByLabel('选择名单 CSV（姓名,学号）')
    .setInputFiles({ name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('table', { name: '名单预览' })).toContainText(studentNumber);
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByRole('status')).toContainText('名单导入完成');
  await expect(page.getByRole('list', { name: '队员列表' })).toContainText(studentNumber);
});
