import { expect, test } from '@playwright/test';

const organizations = [
  {
    key: 'student_union',
    name: '电子系学生会',
    departments: ['文艺中心', '体育中心', '联络中心', '权益发展中心'],
  },
  {
    key: 'youth_league',
    name: '电子系团委',
    departments: ['组织组', '新生组', '志愿组', '实践组', '人文组', '扬帆计划组'],
  },
  { key: 'tms', name: '电子系TMS分会', departments: [] },
  {
    key: 'science_association',
    name: '电子系科协',
    departments: ['办公室', '软件部', '硬件部', '学培部', '项目部', '策划部'],
  },
  {
    key: 'media_center',
    name: '电子系学生媒体中心',
    departments: ['创意设计部', '影音策划部', '新媒体与记者团部'],
  },
] as const;

test('five sheep entrances show complete departments and keep organizational navigation', async ({
  page,
}) => {
  const expectDepartmentActivities = async (organizationRoot = false) => {
    const related = page.getByRole('region', { name: '相关活动', exact: true });
    await expect(related.getByRole('heading', { name: '相关活动', exact: true })).toBeVisible();
    await expect(page.getByText('正在加载部门主页…', { exact: true })).toHaveCount(0);
    await expect(related.getByText('正在整理相关活动…', { exact: true })).toHaveCount(0);
    const active = related.getByRole('button', { name: '活跃活动', exact: true });
    const past = related.getByRole('button', { name: '以往活动', exact: true });
    await expect(active).toHaveAttribute('aria-pressed', 'true');
    await expect(past).toHaveAttribute('aria-pressed', 'false');
    await past.click();
    await expect(past).toHaveAttribute('aria-pressed', 'true');
    await expect(active).toHaveAttribute('aria-pressed', 'false');
    await active.click();
    await expect(active).toHaveAttribute('aria-pressed', 'true');
    await expect(past).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('link', { name: /^(查看相关报名|查看活动报名)$/ })).toHaveCount(0);
    if (!organizationRoot)
      await expect(page.locator('a[href*="/collections/registrations?organization="]')).toHaveCount(
        0,
      );
    await expect(
      page.getByText('目前展示全部活动报名，媒体中心相关活动请查看活动说明。', { exact: true }),
    ).toHaveCount(0);
  };
  await page.goto('./organizations');
  await expect(page.getByText('同在电子，亲如一家', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /^走进电子系/ })).toHaveCount(5);
  const sources = await page
    .locator('.organization-exhibit img')
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(5);
  await expect
    .poll(() =>
      page
        .locator('.organization-exhibit img')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  for (const organization of organizations) {
    for (const name of organization.departments)
      await expect(
        page.locator('.organization-gallery').getByText(name, { exact: true }),
      ).toBeVisible();
  }
  for (const organization of organizations) {
    await page.goto(`./organizations/${organization.key}`);
    await expect(
      page.getByRole('heading', {
        name: organization.key === 'tms' ? 'TMS 电子系分会' : organization.name,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.organization-page')).not.toContainText(
      /部员|部长|执行主席|主席团|岗位层级|财务负责人/,
    );
    if (organization.key === 'tms') {
      await expectDepartmentActivities(true);
      await expect(page.getByRole('link', { name: '查看组织报名', exact: true })).toHaveAttribute(
        'href',
        /\/collections\/registrations\?organization=tms$/,
      );
    }
    for (const name of organization.departments) {
      const department = page.getByRole('link', { name: `了解${name}`, exact: true });
      const target = await department.getAttribute('href');
      expect(target).toBeTruthy();
      await department.click();
      await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
      await expect(page.locator('.organization-page')).not.toContainText(/部员|部长|岗位层级/);
      await expectDepartmentActivities();
      await page.goto(`./organizations/${organization.key}`);
    }
  }
});

test('media exhibition opens the unfiltered activity catalog', async ({ page }) => {
  await page.goto('./organizations/media_center');
  await page.getByRole('link', { name: '查看活动报名', exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/registrations$/);
  await expect(page.locator('.registration-organization-filter')).toHaveCount(0);
  await expect(page.locator('.registration-grid')).toContainText('新生社群见面会');
});

test('badge details and display title persist only in the selected local account', async ({
  page,
}) => {
  await page.goto('./growth');
  await expect(page.locator('.growth-badge-card')).toHaveCount(18);
  await page.getByRole('button', { name: '查看初次登场详情', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('初次登场');
  await detail.getByRole('button', { name: /展示称号/ }).click();
  await expect(page.getByLabel('成长档案展示称号', { exact: true })).toContainText('初次登场');
  await page.reload();
  await expect(page.getByLabel('成长档案展示称号', { exact: true })).toContainText('初次登场');
  await page.getByRole('button', { name: '领域专长', exact: true }).click();
  await expect(page.locator('.growth-badge-card')).toHaveCount(7);
  await page.getByLabel('Demo user').selectOption('demo-captain');
  await expect(page.getByLabel('成长档案展示称号', { exact: true })).toContainText('尚未选择');
  await page.getByLabel('Demo user').selectOption('demo-student');
  await expect(page.getByLabel('成长档案展示称号', { exact: true })).toContainText('初次登场');
});

for (const width of [390, 768, 1440]) {
  test(`sheep exhibition and badge album fit both themes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.goto('./organizations');
      await page.evaluate((value) => localStorage.setItem('free_bbs_theme_mode', value), theme);
      for (const route of ['organizations', 'organizations/science_association', 'growth']) {
        await page.goto(`./${route}`);
        await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${theme}`));
        if (route === 'growth') await expect(page.locator('.growth-badge-card')).toHaveCount(18);
        else {
          await expect(page.locator('.organization-page img').first()).toBeVisible();
          await expect
            .poll(() =>
              page
                .locator('.organization-page img')
                .evaluateAll((images) =>
                  images.every(
                    (image) =>
                      (image as HTMLImageElement).complete &&
                      (image as HTMLImageElement).naturalWidth > 0,
                  ),
                ),
            )
            .toBe(true);
        }
        if (route === 'organizations') {
          // Decode and visit each illustration before a full-page capture;
          // off-screen async images can otherwise remain unpainted in Chromium.
          for (const picture of await page.locator('.organization-exhibit img').all()) {
            await picture.scrollIntoViewIfNeeded();
            await picture.evaluate((image) => (image as HTMLImageElement).decode());
          }
          await page.evaluate(() => window.scrollTo(0, 0));
          const heights = await page
            .locator('.organization-exhibit')
            .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
          expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`${route.replaceAll('/', '-')}-${theme}.png`),
          fullPage: true,
        });
        if (route === 'growth') {
          await page.locator('.growth-badge-card').last().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
            .toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`badge-detail-${theme}.png`),
            fullPage: false,
          });
          await page.keyboard.press('Escape');
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(page.locator('.growth-badge-card').last()).toBeFocused();
        }
      }
    }
  });
}
