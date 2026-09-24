import { expect, test } from '@playwright/test';

test('knowledge cards support keyboard reading, refresh and return', async ({ page }) => {
  await page.goto('./knowledge');
  const card = page.locator('.knowledge-card-grid > li').first();
  const link = card.locator('.knowledge-card-link');
  const title = await link.innerText();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/knowledge\/[^/?]+$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByLabel('经验正文')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveText('经验库');
  await page.getByRole('link', { name: '返回经验库' }).click();
  await expect(page).toHaveURL(/\/knowledge$/);
});

test('the preview area opens a card while editing stays on the directory', async ({ page }) => {
  await page.goto('./knowledge');
  const preview = page.locator('.knowledge-card-preview').first();
  await expect(preview).toBeVisible();
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await expect(page.getByLabel('经验正文')).toBeVisible();
  await page.getByRole('link', { name: '返回经验库' }).click();
  await page.getByLabel('Demo user').selectOption('demo-admin');
  const edit = page
    .locator('.knowledge-card-grid')
    .getByRole('button', { name: /^编辑 / })
    .first();
  await edit.click();
  await expect(page.getByRole('dialog', { name: '编辑经验' })).toBeVisible();
  await expect(page).toHaveURL(/\/knowledge$/);
});

test('protected reading preserves its audience and rejects an identity without access', async ({
  page,
}) => {
  await page.goto('./knowledge');
  await page.getByLabel('Demo user').selectOption('demo-admin');
  await page.getByRole('button', { name: '社工组织', exact: true }).click();
  const link = page.locator('.knowledge-card-link').first();
  const title = await link.innerText();
  await link.click();
  await expect(page).toHaveURL(/\/knowledge\/[^/?]+\?audience=social_org$/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const url = page.url();
  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge\?audience=social_org$/);
  await expect(page.getByRole('button', { name: '社工组织', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: title, exact: true }).click();
  await page.reload();
  // Demo identity deliberately resets on full reload; restore it before checking protected data.
  await page.getByLabel('Demo user').selectOption('demo-admin');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回经验库' }).click();
  await expect(page.getByRole('button', { name: '社工组织', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Demo user').selectOption('demo-student');
  await page.goto(url);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('经验正文')).toHaveCount(0);
});
