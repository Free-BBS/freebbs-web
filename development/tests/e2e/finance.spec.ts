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
  const response = await request.post(`${apiRoot}/finance/records/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to },
  });
  expect(response.status(), await response.text()).toBe(200);
}

test('finance covers access denial and the complete approval lifecycle', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${testInfo.workerIndex}-${testInfo.retry}`;
  const title = `E2E 预算 ${suffix}`;
  const editedTitle = `${title} 已编辑`;
  const rejectedArchiveTitle = `E2E 驳回归档预算 ${suffix}`;

  await page.goto('./finance');
  await expect(page.getByRole('heading', { name: '暂无财务访问权限' })).toBeVisible();

  await switchUser(page, 'demo-admin');
  await expect(
    page.getByRole('region', { name: '财务治理' }).locator(':scope > header'),
  ).toHaveClass(/module-page-header/);
  await expect(page.getByRole('search', { name: '筛选财务记录' })).toBeVisible();
  await page.getByLabel('记录标题', { exact: true }).fill(title);
  await page.getByLabel('金额（元）', { exact: true }).fill('123.45');
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('财务草稿已创建');
  const card = page.locator('.responsive-record-list > li').filter({ hasText: title });
  await card.getByRole('button', { name: `编辑 ${title}` }).click();
  await card.getByLabel('编辑记录标题').fill(editedTitle);
  await card.getByLabel('编辑金额（元）').fill('234.56');
  await card.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('status')).toHaveText('财务草稿已更新');
  await page.reload();
  await switchUser(page, 'demo-admin');
  const refreshedDraft = page
    .locator('.responsive-record-list > li')
    .filter({ hasText: editedTitle });
  await expect(refreshedDraft).toContainText('草稿');
  await expect(refreshedDraft).toContainText('¥234.56');

  const list = await request.get(`${apiRoot}/finance/records`, {
    headers: headers('demo-admin'),
  });
  const records = (await list.json()) as { data: Array<{ id: string; title: string }> };
  const record = records.data.find((item) => item.title === editedTitle);
  expect(record).toBeTruthy();
  const id = record!.id;

  const rejectedArchiveDraft = await request.post(`${apiRoot}/finance/records`, {
    headers: headers('demo-admin'),
    data: {
      title: rejectedArchiveTitle,
      kind: 'budget',
      amountCents: 34_567,
      scope: { type: 'public', id: '*' },
    },
  });
  expect(rejectedArchiveDraft.status(), await rejectedArchiveDraft.text()).toBe(201);
  const rejectedArchiveBody = (await rejectedArchiveDraft.json()) as {
    data: { id: string; status: string };
  };
  expect(rejectedArchiveBody.data.status).toBe('draft');
  await transition(request, rejectedArchiveBody.data.id, 'submitted');
  await transition(request, rejectedArchiveBody.data.id, 'rejected');
  const archivedFromRejected = await request.post(
    `${apiRoot}/finance/records/${rejectedArchiveBody.data.id}/transitions`,
    {
      headers: headers('demo-admin'),
      data: { to: 'archived' },
    },
  );
  expect(archivedFromRejected.status(), await archivedFromRejected.text()).toBe(200);
  await expect(archivedFromRejected.json()).resolves.toMatchObject({
    data: { id: rejectedArchiveBody.data.id, status: 'archived' },
  });

  const illegalDraft = await request.post(`${apiRoot}/finance/records/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to: 'approved' },
  });
  expect(illegalDraft.status()).toBe(409);
  for (const to of ['submitted', 'rejected', 'draft', 'submitted', 'approved', 'archived']) {
    await transition(request, id, to);
  }
  const illegalArchived = await request.post(`${apiRoot}/finance/records/${id}/transitions`, {
    headers: headers('demo-admin'),
    data: { to: 'submitted' },
  });
  expect(illegalArchived.status()).toBe(409);
  const denied = await request.patch(`${apiRoot}/finance/records`, {
    headers: headers('demo-student'),
    data: { id, title: '越权预算' },
  });
  expect([403, 404]).toContain(denied.status());

  await page.reload();
  await switchUser(page, 'demo-admin');
  await expect(
    page.locator('.responsive-record-list > li').filter({ hasText: editedTitle }),
  ).toContainText('已归档');
});
