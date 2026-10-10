import { expect, test } from '@playwright/test';

// These fixtures use only the local demo identity; they never seed production storage.
test.beforeAll(async ({ request }) => {
  const path = '/api/development/v1/sports/matches';
  const headers = { 'X-Demo-User': 'demo-sports-member' };
  const list = await request.get(path, { headers });
  expect(list.status()).toBe(200);
  const existing = (await list.json()).data as Array<{ id: string; title: string }>;
  const now = Date.now();
  const examples = [
    {
      title: '示例比赛 · 篮球｜电子系 vs 自动化系',
      startsAt: new Date(now - 20 * 60000).toISOString(),
      endsAt: new Date(now + 90 * 60000).toISOString(),
      location: '篮球馆 · 本地演示赛程',
      result: null,
    },
    {
      title: '示例比赛 · 羽毛球｜电子系 vs 经管学院',
      startsAt: new Date(now - 4 * 3600000).toISOString(),
      endsAt: new Date(now - 2 * 3600000).toISOString(),
      location: '综合体育馆 · 本地演示赛程',
      result: '电子系 2–1 经管学院（演示结果）',
    },
  ];
  for (const example of examples) {
    const previous = existing.find(({ title }) => title === example.title);
    const data = { ...example, liveUrl: null, replayUrl: null, coverUrl: null };
    const response = previous
      ? await request.patch(`${path}/${previous.id}`, { headers, data })
      : await request.post(path, { headers, data });
    expect(response.status()).toBe(previous ? 200 : 201);
  }
});

test('organization exhibition opens exact department activity associations', async ({ page }) => {
  await page.goto('./organizations');
  await expect(page.getByRole('link', { name: /^走进电子系/ })).toHaveCount(5);
  await page.getByRole('link', { name: '走进电子系学生会', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看组织报名', exact: true })).toHaveAttribute(
    'href',
    '/development/collections/registrations?organization=arts_center%2Csports_center%2Cliaison_center%2Crights_development_center',
  );
  await page.getByRole('link', { name: '了解文艺中心', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文艺中心', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '相关活动' })).toBeVisible();
  await expect(page.getByRole('region', { name: '相关活动' })).not.toContainText('新生社群见面会');
  await page.getByRole('button', { name: '以往活动', exact: true }).click();
  await expect(page.getByRole('button', { name: '以往活动', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('./organizations/media_center/creative');
  await expect(page.getByText('暂无活跃活动', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看活动报名', exact: true })).toHaveCount(0);
});

test('growth filters work on account records and local sports examples are visible', async ({
  page,
}) => {
  await page.goto('./growth');
  await expect(page.locator('.growth-stats')).toContainText('已结束的活动报名');
  await expect(page.locator('.growth-timeline')).toContainText('新生社群见面会');
  await page.getByLabel('年份', { exact: true }).selectOption('undated');
  await expect(page.getByText('当前筛选下暂无活动足迹。', { exact: true })).toBeVisible();
  await page.getByLabel('年份', { exact: true }).selectOption('all');
  await expect(page.locator('.growth-timeline')).toContainText('新生社群见面会');
  await page.goto('./sports/matches');
  const live = page.getByRole('article', {
    name: '示例比赛 · 篮球｜电子系 vs 自动化系',
    exact: true,
  });
  const ended = page.getByRole('article', {
    name: '示例比赛 · 羽毛球｜电子系 vs 经管学院',
    exact: true,
  });
  await expect(live).toContainText('正在进行');
  await expect(ended).toContainText('已结束');
  await expect(ended).toContainText('电子系 2–1 经管学院（演示结果）');
  await expect(page.getByRole('button', { name: '添加比赛', exact: true })).toHaveCount(0);
  await page.getByLabel('Demo user').selectOption('demo-sports-member');
  await expect(page.getByRole('button', { name: '添加比赛', exact: true })).toBeVisible();
  await live.getByRole('button', { name: '添加直播链接', exact: true }).click();
  await live
    .getByLabel('示例比赛 · 篮球｜电子系 vs 自动化系直播链接', { exact: true })
    .fill('https://example.com/local-demo-stream');
  await live.getByRole('button', { name: '保存直播链接', exact: true }).click();
  await expect(live.getByRole('link', { name: /直播/ })).toHaveAttribute(
    'href',
    'https://example.com/local-demo-stream',
  );
  await live.getByRole('button', { name: '修改直播链接', exact: true }).click();
  await live.getByLabel('示例比赛 · 篮球｜电子系 vs 自动化系直播链接', { exact: true }).fill('');
  await live.getByRole('button', { name: '保存直播链接', exact: true }).click();
  await expect(live.getByRole('button', { name: '添加直播链接', exact: true })).toBeVisible();
});

for (const width of [390, 768, 1440]) {
  test(`growth and organizational pages stay aligned in both themes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.goto('./organizations');
      await page.evaluate((value) => {
        localStorage.setItem('free_bbs_theme_mode', value);
        document.body.classList.toggle('theme-light', value === 'light');
        document.body.classList.toggle('theme-dark', value === 'dark');
      }, theme);
      for (const route of [
        'organizations',
        'organizations/student_union',
        'organizations/media_center',
        'organizations/media_center/creative',
        'organizations/youth_league/freshman',
        'growth',
        'sports/matches',
        'desk/knowledge',
      ]) {
        await page.goto(`./${route}`);
        await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${theme}`));
        await expect(page.locator('.module-page, .sports-page').first()).toBeVisible();
        if (route === 'growth') await expect(page.locator('.growth-stats')).toBeVisible();
        if (route === 'sports/matches')
          await expect(page.getByRole('article').first()).toBeVisible();
        if (route === 'desk/knowledge') {
          await expect(page.locator('.knowledge-card-link').first()).toBeVisible();
          await expect(page.locator('.knowledge-filters')).toHaveCSS('display', 'flex');
          if (width === 1440) {
            const rows = await page
              .locator('.knowledge-filters > *')
              .evaluateAll((elements) =>
                elements.map((element) => element.getBoundingClientRect().bottom),
              );
            expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
          }
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${theme}.png`),
          fullPage: true,
        });
        if (route === 'desk/knowledge') {
          await page.locator('.knowledge-card-link').first().click();
          await expect(page.getByLabel('经验正文')).toBeVisible();
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
            .toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`knowledge-reading-${theme}.png`),
            fullPage: true,
          });
          await page.getByRole('link', { name: '返回经验库' }).click();
          await page.getByLabel('Demo user').selectOption('demo-admin');
          await page
            .locator('.knowledge-card-grid')
            .getByRole('button', { name: /^编辑 / })
            .first()
            .click();
          await expect(page.getByRole('dialog', { name: '编辑经验' })).toBeVisible();
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
            .toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`knowledge-editor-${theme}.png`),
            fullPage: true,
          });
        }
      }
    }
  });
}
