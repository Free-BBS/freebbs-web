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
  const response = await request.post(`${apiRoot}/knowledge/entries/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('knowledge covers reader visibility and the complete manager lifecycle', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}`;
  const title = `E2E 经验 ${suffix}`;
  const editedTitle = `${title} 已编辑`;
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('./knowledge');
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '社工组织' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建经验' })).toHaveCount(0);

  await switchUser(page, 'demo-admin');
  await page.getByRole('button', { name: '新建经验' }).click();
  await page.getByLabel('经验标题').fill(title);
  await page.getByLabel('经验正文').fill('由真实界面创建的端到端经验草稿。');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^草稿已创建$/ })).toBeVisible();

  const createdCard = page.locator('.record-card').filter({ hasText: title });
  await createdCard.getByRole('button', { name: `编辑 ${title}` }).click();
  await page.getByLabel('编辑标题').fill(editedTitle);
  await page.getByLabel('编辑正文').fill('刷新后仍应保留的经验正文。');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^修改已保存$/ })).toBeVisible();
  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(page.locator('.record-card').filter({ hasText: editedTitle })).toContainText(
    '刷新后仍应保留的经验正文。',
  );

  const listResponse = await request.get(`${apiRoot}/knowledge/entries`, {
    headers: headers('demo-admin'),
  });
  expect(listResponse.status()).toBe(200);
  const entries = (await listResponse.json()) as { data: Array<{ id: string; title: string }> };
  const entry = entries.data.find((item) => item.title === editedTitle);
  expect(entry).toBeTruthy();
  const id = entry!.id;

  await transition(request, id, 'published');
  await switchUser(page, 'demo-student');
  await page.reload();
  await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible();

  const denied = await request.patch(`${apiRoot}/knowledge/entries`, {
    headers: headers('demo-student'),
    data: { id, title: '越权修改' },
  });
  expect([403, 404]).toContain(denied.status());

  await transition(request, id, 'draft');
  await transition(request, id, 'published');
  await transition(request, id, 'archived');
  const illegal = await request.post(`${apiRoot}/knowledge/entries/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to: 'published' },
  });
  expect(illegal.status()).toBe(409);
  await expect(illegal.json()).resolves.toMatchObject({
    data: { error: { code: 'invalid_state_transition' } },
  });

  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(page.locator('.record-card').filter({ hasText: editedTitle })).toContainText(
    '已归档',
  );
});
