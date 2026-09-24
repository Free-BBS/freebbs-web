import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiRoot = '/api/development/v1';
const headers = (user: string) => ({
  'Content-Type': 'application/json',
  'X-Demo-User': user,
});

async function switchUser(page: Page, user: string) {
  await page.getByLabel('Demo user').selectOption(user);
  await expect(page.getByLabel('Demo user')).toHaveValue(user);
}

async function transition(request: APIRequestContext, id: string, to: string) {
  const response = await request.post(`${apiRoot}/events/activities/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('events covers approval, registration, support and archive lifecycles', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
  const title = `E2E 活动 ${suffix}`;
  const editedTitle = `${title} 已编辑`;
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('./events');
  await switchUser(page, 'demo-admin');
  await page.getByRole('button', { name: '创建活动' }).click();
  const create = page.getByRole('dialog', { name: '创建活动草稿' });
  await create.getByLabel('新活动名称').fill(title);
  await create.getByLabel('新活动介绍').fill('端到端活动草稿。');
  await create.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('活动草稿已创建');

  const card = page.locator('.workbench-card').filter({ hasText: title });
  await card.getByText('管理活动', { exact: true }).click();
  await card.getByRole('button', { name: `编辑${title}` }).click();
  const editor = page.getByRole('dialog', { name: '编辑活动' });
  await editor.getByLabel('活动名称').fill(editedTitle);
  await editor.getByLabel('活动介绍').fill('刷新后仍保留的活动介绍。');
  await editor.getByRole('button', { name: '保存活动' }).click();
  await expect(page.getByRole('status')).toHaveText('活动内容已保存');
  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(page.locator('.workbench-card').filter({ hasText: editedTitle })).toContainText(
    '刷新后仍保留的活动介绍。',
  );

  const list = await request.get(`${apiRoot}/events/activities`, {
    headers: headers('demo-admin'),
  });
  const activities = (await list.json()) as { data: Array<{ id: string; title: string }> };
  const activity = activities.data.find((item) => item.title === editedTitle);
  expect(activity).toBeTruthy();
  const id = activity!.id;

  await transition(request, id, 'pending');
  await transition(request, id, 'rejected');
  await transition(request, id, 'draft');
  await transition(request, id, 'pending');
  await transition(request, id, 'approved');
  await transition(request, id, 'published');

  await switchUser(page, 'demo-student');
  await page.reload();
  const studentCard = page.locator('.workbench-card').filter({ hasText: editedTitle });
  await studentCard.getByRole('button', { name: '报名活动' }).click();
  await expect(page.getByRole('status')).toHaveText('报名成功');
  await studentCard.getByRole('button', { name: '取消报名' }).click();
  await expect(page.getByRole('status')).toHaveText('报名已取消');
  await studentCard.getByRole('button', { name: '报名活动' }).click();
  await expect(page.getByRole('status')).toHaveText('报名成功');

  const denied = await request.patch(`${apiRoot}/events/activities`, {
    headers: headers('demo-student'),
    data: { id, title: '越权活动' },
  });
  expect([403, 404]).toContain(denied.status());
  for (const to of ['requested', 'confirmed']) {
    const support = await request.patch(`${apiRoot}/events/activities/${id}/technical-support`, {
      headers: headers('demo-admin'),
      data: { to, note: 'E2E 技术支持' },
    });
    expect(support.status(), await support.text()).toBe(200);
  }
  await transition(request, id, 'finished');
  await transition(request, id, 'archived');
  const illegal = await request.post(`${apiRoot}/events/activities/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to: 'published' },
  });
  expect(illegal.status()).toBe(409);

  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(page.locator('.workbench-card').filter({ hasText: editedTitle })).toContainText(
    '已归档',
  );
});
