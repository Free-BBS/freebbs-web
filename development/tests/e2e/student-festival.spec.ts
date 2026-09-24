import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const videoPath = join(__dirname, '../fixtures/student-festival.webm');

test('all center ranks are selectable and arts members can review from the header', async ({
  page,
}, testInfo) => {
  await page.goto('./events/student-festival');
  const switcher = page.getByLabel('Demo user');
  for (const center of ['文艺中心', '体育中心', '联络中心', '权发中心']) {
    for (const rank of ['部员', '部长', '负责人']) {
      await expect(
        switcher.getByRole('option', { name: `${center}${rank}`, exact: true }),
      ).toHaveCount(1);
    }
  }
  await expect(page.getByRole('button', { name: '审核投稿', exact: true })).toHaveCount(0);
  const title = `文艺部员审核-${Date.now()}`;
  await submit(page, title, true);
  await switcher.selectOption('demo-arts-member');
  await page.evaluate(() => window.scrollTo(0, 0));
  const review = page.getByRole('button', { name: '审核投稿', exact: true });
  await expect(review).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('arts-review-header.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('arts-review-header-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await review.click();
  await expect(page.getByRole('tab', { name: '投稿审核', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const work = page.getByRole('article', { name: title, exact: true });
  await work.getByRole('button', { name: '通过并展示', exact: true }).click();
  await expect(work).toContainText('展示中');
  for (const rank of ['director', 'lead']) {
    await switcher.selectOption(`demo-arts-${rank}`);
    await expect(review).toBeVisible();
  }
  for (const center of ['sports', 'liaison', 'rights']) {
    for (const rank of ['member', 'director', 'lead']) {
      await switcher.selectOption(`demo-${center}-${rank}`);
      await expect(
        page.getByText('投稿审核由文艺中心部员、部长、负责人，团委负责人及平台管理员负责。'),
      ).toBeVisible();
      await expect(review).toHaveCount(0);
    }
  }
});

async function submit(page: Page, title: string, display: boolean) {
  await page.getByLabel('作品名称', { exact: true }).fill(title);
  await page.getByLabel('作品介绍', { exact: true }).fill('原创测试短视频，验证投稿与展示。');
  await page.getByLabel('投稿视频', { exact: true }).setInputFiles(videoPath);
  await page.getByRole('checkbox', { name: '我愿意即时展示', exact: true }).setChecked(display);
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith('/events/festival/submissions') && result.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '提交作品', exact: true }).click();
  const uploaded = await response;
  expect(uploaded.status()).toBe(201);
  return (await uploaded.json()).data.id as string;
}

test('consented video can be approved, played, removed and explicitly approved again', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  const title = `学生节合奏-${Date.now()}`;
  await page.goto('./events');
  await page.getByRole('link', { name: /我要上学生节/ }).click();
  await expect(page).toHaveURL(/\/events\/student-festival$/);
  await expect(
    page.locator('.sidebar .module-nav a[aria-current="page"][href="/development/events"]'),
  ).toBeVisible();
  const id = await submit(page, title, true);
  await expect(page.getByRole('article', { name: title, exact: true })).not.toBeVisible();
  await expect(page.getByRole('tab', { name: '投稿审核', exact: true })).toHaveCount(0);
  const protectedMedia = `/api/development/v1/events/festival/submissions/${id}/media`;
  expect(
    (
      await page.request.get(protectedMedia, { headers: { 'X-Demo-User': 'demo-student' } })
    ).status(),
  ).toBe(404);
  await page.getByLabel('Demo user').selectOption('demo-tuanwei-lead');
  await page.getByRole('tab', { name: '投稿审核', exact: true }).click();
  let work = page.getByRole('article', { name: title, exact: true });
  await work.getByLabel('审核说明').fill('欢迎登上学生节舞台');
  await work.getByRole('button', { name: '通过并展示', exact: true }).click();
  await expect(work.getByRole('button', { name: '撤下展示', exact: true })).toBeVisible();
  await page.getByLabel('Demo user').selectOption('demo-student');
  work = page.getByRole('article', { name: title, exact: true });
  await work.getByRole('button', { name: `加载视频：${title}`, exact: true }).click();
  const media = work.locator('video');
  await expect(media).toBeVisible();
  await media.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    return element.play();
  });
  await expect
    .poll(() => media.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => media.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('festival-showcase.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('festival-showcase-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Demo user').selectOption('demo-admin');
  await page.getByRole('tab', { name: '投稿审核', exact: true }).click();
  await page
    .getByRole('article', { name: title, exact: true })
    .getByRole('button', { name: '撤下展示', exact: true })
    .click();
  await expect(page.getByRole('article', { name: title, exact: true })).toContainText('未展示');
  await page.getByLabel('Demo user').selectOption('demo-student');
  await expect(page.getByRole('article', { name: title, exact: true })).not.toBeVisible();
  expect(
    (
      await page.request.get(protectedMedia, { headers: { 'X-Demo-User': 'demo-student' } })
    ).status(),
  ).toBe(404);
  await page.getByLabel('Demo user').selectOption('demo-arts-member');
  await page.getByRole('button', { name: '审核投稿', exact: true }).click();
  const removed = page.getByRole('article', { name: title, exact: true });
  await removed.getByLabel('审核说明').fill('重新确认，可以展示');
  await removed.getByRole('button', { name: '重新审核并展示', exact: true }).click();
  await expect(removed).toContainText('展示中');
  await page.getByLabel('Demo user').selectOption('demo-student');
  await expect(page.getByRole('article', { name: title, exact: true })).toBeVisible();
  expect(
    (
      await page.request.get(protectedMedia, { headers: { 'X-Demo-User': 'demo-student' } })
    ).status(),
  ).toBe(200);
});

test('mobile private submissions provide owner receipts and remain reviewer-only', async ({
  page,
}) => {
  const title = `仅供评选-${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./events/student-festival');
  await expect(
    page.getByRole('checkbox', { name: '我愿意即时展示', exact: true }),
  ).not.toBeChecked();
  const id = await submit(page, title, false);
  await page.getByRole('tab', { name: '我的投稿', exact: true }).click();
  const receipt = page.getByRole('article', { name: title, exact: true });
  await expect(receipt).toBeVisible();
  await expect(receipt.locator('video')).toHaveCount(0);
  await expect(receipt.getByRole('button', { name: /^加载视频/ })).toHaveCount(0);
  const path = `/api/development/v1/events/festival/submissions/${id}/media`;
  expect(
    (await page.request.get(path, { headers: { 'X-Demo-User': 'demo-student' } })).status(),
  ).toBe(404);
  expect(
    (await page.request.get(path, { headers: { 'X-Demo-User': 'demo-sports-lead' } })).status(),
  ).toBe(404);
  await page.getByLabel('Demo user').selectOption('demo-tuanwei-lead');
  await page.getByRole('tab', { name: '投稿审核', exact: true }).click();
  const privateWork = page.getByRole('article', { name: title, exact: true });
  await expect(privateWork.getByRole('button', { name: '通过并展示', exact: true })).toHaveCount(0);
  await privateWork.getByRole('button', { name: `加载视频：${title}`, exact: true }).click();
  await expect(privateWork.locator('video')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
