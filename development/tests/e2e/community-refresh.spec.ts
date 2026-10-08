import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const apiRoot = '/api/development/v1';
const headers = (user = 'demo-student') => ({ 'X-Demo-User': user });

test('real daily and wish publications preserve both identities, likes and replies', async ({
  page,
}, testInfo) => {
  await page.goto('./community');
  const composer = page.getByRole('region', { name: '分享校园新鲜事' });
  for (const kind of ['daily', 'wish'] as const) {
    for (const identity of ['named', 'anonymous'] as const) {
      const title = `校园${kind === 'wish' ? '愿望' : '日常'} ${identity}-${Date.now()}`;
      await composer
        .getByRole('radio', { name: kind === 'wish' ? '新生许愿' : '校园日常', exact: true })
        .check();
      await composer
        .getByRole('radio', {
          name: identity === 'anonymous' ? '匿名展示' : '实名展示',
          exact: true,
        })
        .check();
      await composer.getByLabel('标题', { exact: true }).fill(title);
      await composer
        .getByLabel('内容', { exact: true })
        .fill(
          kind === 'wish'
            ? '希望周末举办一场手机摄影工作坊，一起记录校园。'
            : '今天操场的夕阳特别好看，散步时遇见了新朋友。',
        );
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith('/community/posts') && response.request().method() === 'POST',
      );
      await composer.getByRole('button', { name: '确认发布' }).click();
      expect((await saved).status()).toBe(201);
      await expect(composer.getByLabel('内容', { exact: true })).toHaveValue('');
      const card = page.locator('.community-card').filter({ hasText: title });
      await expect(card).toBeVisible();
      if (identity === 'anonymous') await expect(card).toContainText('匿名小羊');
      else await expect(card).not.toContainText('匿名小羊');
      await card.getByRole('button', { name: '赞 0', exact: true }).click();
      await expect(card.getByRole('button', { name: '赞 1', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await card.getByRole('button', { name: `打开${title}`, exact: true }).click();
      const thread = page.getByRole('dialog', { name: title, exact: true });
      await thread.getByRole('radio', { name: '匿名回复' }).check();
      await thread.getByLabel('写下回复').fill('我也想加入！');
      await thread.getByRole('button', { name: '发送回复' }).click();
      await expect(thread.getByLabel('写下回复')).toHaveValue('');
      await expect(thread.locator('.community-comments article')).toContainText('我也想加入！');
      await thread.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('free_bbs_theme_mode', value);
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'free_bbs_theme_mode', newValue: value }),
        );
      }, mode);
      await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${mode}`));
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`community-${width}-${mode}.png`),
        fullPage: true,
      });
    }
  }
});

test('a failed publication retains the draft and a real API retry submits once', async ({
  page,
}) => {
  await page.goto('./community');
  let attempts = 0;
  let continueRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => {
    continueRetry = resolve;
  });
  await page.route(`**${apiRoot}/community/posts`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (++attempts === 1)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'temporary test failure' } }),
      });
    await retryGate;
    await route.continue();
  });
  const composer = page.getByRole('region', { name: '分享校园新鲜事' });
  const title = `可以重试的草稿-${Date.now()}`;
  await composer.getByLabel('标题', { exact: true }).fill(title);
  await composer.getByLabel('内容', { exact: true }).fill('这条内容在失败后应该保留。');
  await composer.getByRole('radio', { name: '匿名展示' }).check();
  await composer.getByRole('button', { name: '确认发布' }).click();
  await expect(composer.getByRole('alert')).toContainText('发布失败');
  await expect(composer.getByLabel('标题', { exact: true })).toHaveValue(title);
  await expect(composer.getByRole('radio', { name: '匿名展示' })).toBeChecked();
  await composer.getByRole('button', { name: '确认发布' }).click();
  await expect(composer.getByRole('button', { name: '正在发布…' })).toBeDisabled();
  await composer
    .locator('form')
    .evaluate((form) =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
  expect(attempts).toBe(2);
  continueRetry();
  await expect(composer.getByRole('status')).toContainText('已发布');
  await expect(page.locator('.community-card').filter({ hasText: title })).toHaveCount(1);
});

test('square festival entry retains consent and review before appearing in the public feed', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('./community');
  await page.getByRole('tab', { name: '学生节舞台' }).click();
  await page.getByRole('link', { name: '我要上学生节', exact: true }).click();
  const title = `广场学生节作品-${Date.now()}`;
  await page.getByLabel('作品名称', { exact: true }).fill(title);
  await page.getByLabel('作品介绍', { exact: true }).fill('一起听听校园里的声音。');
  await page
    .getByLabel('投稿视频', { exact: true })
    .setInputFiles(join(__dirname, '../fixtures/student-festival.webm'));
  await expect(page.getByRole('checkbox', { name: '我愿意即时展示' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '我愿意即时展示' }).check();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/events/festival/submissions') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '提交作品', exact: true }).click();
  expect((await saved).status()).toBe(201);
  const publicFeed = await page.request.get(`${apiRoot}/community/feed?channel=student_festival`, {
    headers: headers(),
  });
  expect(
    (await publicFeed.json()).data.some((item: { title: string }) => item.title === title),
  ).toBe(false);
  await page.getByLabel('Demo user').selectOption('demo-arts-member');
  await page.getByRole('button', { name: '审核投稿', exact: true }).click();
  const work = page.getByRole('article', { name: title, exact: true });
  await work.getByRole('button', { name: '通过并展示', exact: true }).click();
  await expect(work).toContainText('展示中');
  await page.getByLabel('Demo user').selectOption('demo-student');
  await page.goto('./community');
  await page.getByRole('tab', { name: '学生节舞台' }).click();
  await expect(page.locator('.community-card').filter({ hasText: title })).toBeVisible();
});

test('square rights entry uses the consultation privacy contract for private and public feedback', async ({
  page,
}) => {
  await page.goto('./community');
  await page.getByRole('tab', { name: '生权反馈' }).click();
  await page.getByRole('link', { name: '提交生权反馈', exact: true }).click();
  const privateTitle = `个人反馈-${Date.now()}`;
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '提交反馈或咨询' });
  await dialog.getByLabel('标题', { exact: true }).fill(privateTitle);
  await dialog.getByLabel('内容', { exact: true }).fill('希望有同学私下协助跟进这个问题。');
  await expect(dialog.getByRole('radio', { name: '私密咨询' })).toBeChecked();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/information/consultations') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '发布反馈', exact: true }).click();
  const privateRecord = (await (await saved).json()).data;
  expect(privateRecord.visibility).toBe('private');
  const publicTitle = `公开反馈-${Date.now()}`;
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  await dialog.getByLabel('标题', { exact: true }).fill(publicTitle);
  await dialog.getByLabel('内容', { exact: true }).fill('图书馆门前的路灯需要检修。');
  await dialog.getByRole('radio', { name: '公开反馈' }).check();
  const publicSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/information/consultations') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '发布反馈', exact: true }).click();
  expect((await publicSaved).status()).toBe(201);
  const otherFeed = await page.request.get(`${apiRoot}/information/feed?filter=public_feedback`, {
    headers: headers('demo-arts-member'),
  });
  const feedback = (await otherFeed.json()).data;
  expect(feedback.some((item: { title: string }) => item.title === publicTitle)).toBe(true);
  expect(feedback.some((item: { title: string }) => item.title === privateTitle)).toBe(false);
  await page.goto('./community');
  await page.getByRole('tab', { name: '生权反馈' }).click();
  await expect(page.getByRole('textbox', { name: '内容', exact: true })).toHaveCount(0);
  await expect(page.locator('.community-card').filter({ hasText: privateTitle })).toHaveCount(0);
});
