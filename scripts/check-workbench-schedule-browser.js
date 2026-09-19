const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createEconomyPreview } = require('./preview-economy');
const { createWorkbenchPreviewApi } = require('./workbench-preview-api');

async function main() {
  const interactive = process.argv.includes('--interactive');
  const previewApi = createWorkbenchPreviewApi();
  const { events, communityNotices } = previewApi;
  const { server } = createEconomyPreview({
    extraPages: { '/workbench': 'workbench.html', '/aichat': 'aichat.html' },
    previewApiHandler: previewApi.handle,
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: !interactive,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/workbench`, { waitUntil: 'domcontentloaded' });
    await page.locator('.workbench-week-day').first().waitFor();
    await page.locator('.workbench-week-event').filter({ hasText: '实验室例会' }).waitFor();
    await page.getByText('查看本周计划').waitFor();
    assert.equal(await page.getByText('该功能未接入本地模拟').count(), 0);
    if (interactive) {
      console.log(`工作台交互预览已在 Chrome 打开：${base}/workbench`);
      console.log('此页面使用模拟数据；请保持 Git Bash 窗口开启，关闭 Chrome 后服务会退出。');
      await new Promise((resolve) => {
        browser.once('disconnected', resolve);
      });
      return;
    }
    assert.equal(await page.locator('.workbench-week-day').count(), 7);
    await page.locator('#workbench-notifications-tab').click();
    await page.getByText('发展端活动通知').waitFor();
    assert.equal(await page.locator('.workbench-persistent-column .workbench-agent-shortcut').count(), 0);
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-notifications-light.png'),
      fullPage: true,
    });
    assert.equal(await page.getByText('同学回复了你的讨论').count(), 0);
    assert.match(page.url(), /view=notifications/);
    await page.locator('[data-notice-view="discussion"]').click();
    await page.getByText('同学回复了你的讨论').waitFor();
    assert.equal(await page.getByText('发展端活动通知').count(), 0);
    await page.locator('[data-notice-view="all"]').click();
    const readRequest = page.waitForResponse(
      (response) =>
        response.url().includes('/api/notifications/') && response.url().endsWith('/read'),
    );
    await page.locator('[data-workbench-action="read-community-notification"]').first().click();
    const readResponse = await readRequest;
    assert.equal(readResponse.status(), 200);
    assert.ok(communityNotices.some((item) => item.readAt));
    await page.locator('#workbench-plan-tab').click();
    assert.equal(await page.locator('#workbench-plan-panel').isVisible(), true);
    await page.locator('#workbench-week-next').click();
    assert.equal(
      await page.locator('.workbench-week-event').filter({ hasText: '实验室例会' }).count(),
      0,
    );
    await page.locator('#workbench-week-previous').click();
    await page.locator('.workbench-week-event').filter({ hasText: '实验室例会' }).waitFor();
    await page.locator('#workbench-view-toggle').click();
    assert.equal(await page.locator('#workbench-schedule-list').isVisible(), true);
    await page.locator('#workbench-view-toggle').click();
    assert.equal(await page.locator('.workbench-week-scroll').isVisible(), true);
    await page.locator('#workbench-agent-message').fill('明天下午5点开会，持续时间2小时');
    await page.locator('#workbench-agent-generate').click();
    await page.locator('.workbench-agent-proposal').first().waitFor();
    assert.equal(await page.locator('.workbench-proposal-title').inputValue(), '开会');
    assert.match(await page.locator('.workbench-proposal-start').inputValue(), /T17:00$/);
    assert.match(await page.locator('.workbench-proposal-end').inputValue(), /T19:00$/);
    await page.locator('#workbench-agent-confirm').click();
    await page.getByText('已加入 1 段安排').waitFor();
    assert.equal(events.length, 2);
    await page.locator('#workbench-agent-message').fill('明天23:59之前完成报告');
    await page.locator('#workbench-agent-generate').click();
    await page.locator('.workbench-agent-proposal.is-deadline').waitFor();
    assert.equal(await page.locator('.workbench-agent-proposal.is-deadline .workbench-proposal-end').inputValue().then((value) => value.slice(11)), '23:59');
    await page.locator('#workbench-agent-confirm').click();
    await page.locator('.workbench-week-event.is-deadline').waitFor();
    assert.equal(events.length, 3);
    await page.locator('.workbench-week-event.is-deadline').click();
    assert.equal(await page.locator('#workbench-schedule-start').locator('..').isVisible(), false);
    assert.equal(await page.locator('#workbench-schedule-end').locator('..').innerText(), '截止时间');
    await page.locator('#workbench-schedule-dialog [data-workbench-dialog-close]').first().click();
    await page.locator('#workbench-agent-message').fill('每周三第三大节上课，持续3周');
    await page.locator('#workbench-agent-generate').click();
    await page.locator('.workbench-agent-proposal').first().waitFor();
    assert.equal(await page.locator('.workbench-agent-proposal').count(), 3);
    assert.match(await page.locator('.workbench-agent-proposal').first().innerText(), /周常/);
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-schedule-light.png'),
      fullPage: true,
    });
    await page.locator('[data-preview-notice] summary').click();
    await page.locator('[data-preview-theme]').click();
    await page.locator('#workbench-notifications-tab').click();
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-notifications-dark.png'),
      fullPage: true,
    });
    await page.locator('#workbench-plan-tab').click();
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-schedule-dark.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('.workbench-week-day').count(), 7);
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-schedule-mobile.png'),
      fullPage: true,
    });
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      body: document.documentElement.scrollWidth,
      weekScroll: document.querySelector('.workbench-week-scroll').scrollWidth,
    }));
    assert.ok(metrics.weekScroll > metrics.viewport, 'week canvas should scroll on narrow screens');
    assert.ok(
      metrics.body <= metrics.viewport + 6,
      `body should not overflow: ${JSON.stringify(metrics)}`,
    );
    await page.locator('#workbench-notifications-tab').click();
    await page.screenshot({
      path: path.join(os.tmpdir(), 'freebbs-workbench-notifications-mobile.png'),
      fullPage: true,
    });
    const noticeMetrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      body: document.documentElement.scrollWidth,
    }));
    assert.ok(
      noticeMetrics.body <= noticeMetrics.viewport + 6,
      `notifications should not overflow: ${JSON.stringify(noticeMetrics)}`,
    );
    previewApi.setCommunityUnavailable(true);
    await page.locator('#workbench-notification-refresh').click();
    await page.getByText('平台发布与讨论动态暂时无法加载').waitFor();
    await page.locator('#workbench-plan-tab').click();
    assert.equal(await page.locator('#workbench-plan-panel').isVisible(), true);
    previewApi.setCommunityUnavailable(false);
    await page.goto(`${base}/workbench?view=notifications`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#workbench-notifications-panel').isVisible(), true);
    assert.equal(await page.locator('#workbench-plan-panel').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Workbench schedule browser smoke passed:', base);
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
