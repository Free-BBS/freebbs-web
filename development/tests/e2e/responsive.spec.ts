import { expect, test, type Locator, type Page } from '@playwright/test';

const viewports = [
  { name: 'desktop', width: 1440, height: 1000, navigation: '.sidebar .module-nav' },
  { name: 'tablet', width: 900, height: 900, navigation: '.mobile-nav' },
  { name: 'mobile', width: 390, height: 844, navigation: '.mobile-nav' },
] as const;

const fontStylesheetHref =
  'https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&family=Noto+Serif+SC:wght@400;500;600;700&display=swap';

// Each matrix case performs one dashboard load and eight authenticated module transitions.
const responsiveMatrixTimeout = 90_000;

const routes: readonly {
  path: string;
  destination?: string;
  heading: string;
  primaryAction: (page: Page) => Locator;
}[] = [
  {
    path: 'knowledge',
    heading: 'General',
    primaryAction: (page) => page.getByRole('button', { name: '新建经验' }),
  },
  {
    path: 'information',
    heading: '公开信息',
    destination: 'information/announcements',
    primaryAction: (page) => page.getByRole('button', { name: '保存公告草稿' }),
  },
  {
    path: 'growth',
    heading: '个人成长档案',
    primaryAction: (page) => page.getByRole('heading', { name: '成就称号' }),
  },
  {
    path: 'events',
    heading: '無活动',
    primaryAction: (page) => page.getByRole('button', { name: '创建活动' }),
  },
  {
    path: 'liaison',
    heading: '無限机会',
    primaryAction: (page) => page.getByRole('button', { name: '查看委托' }),
  },
  {
    path: 'sports',
    heading: '体育代表队',
    primaryAction: (page) => page.getByRole('link', { name: '查看队伍详情' }).first(),
  },
  {
    path: 'finance',
    heading: '财务治理',
    primaryAction: (page) => page.getByRole('button', { name: '保存草稿' }),
  },
  {
    path: 'admin',
    heading: '治理管理台',
    primaryAction: (page) => page.getByRole('button', { name: '筛选用户' }),
  },
] as const;

async function expectMainSiteFontRequest(page: Page) {
  const fontStylesheet = page.locator(`link[rel="stylesheet"][href="${fontStylesheetHref}"]`);
  await expect(fontStylesheet).toHaveCount(1);
  await expect(fontStylesheet).toHaveAttribute('href', fontStylesheetHref);
  await expect(
    page.locator('link[rel="preconnect"][href="https://fonts.googleapis.com"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('link[rel="preconnect"][href="https://fonts.gstatic.com"][crossorigin]'),
  ).toHaveCount(1);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function expectLongTextWraps(target: Locator, value: string) {
  await expect(target).toBeVisible();
  await target.evaluate((element, text) => {
    element.textContent = text;
  }, value);

  const metrics = await target.evaluate((element) => {
    const card = element.closest<HTMLElement>('.workbench-card, .record-card');
    const containingBlock = element.parentElement;
    if (!card || !containingBlock) {
      throw new Error('Long-text probe requires real card and text containing blocks');
    }

    const cardRect = card.getBoundingClientRect();
    const containerRect = containingBlock.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const fragments = Array.from(element.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const tolerance = 1;

    return {
      cardRectWidth: cardRect.width,
      containerClientWidth: containingBlock.clientWidth,
      containerRectWidth: containerRect.width,
      containerScrollWidth: containingBlock.scrollWidth,
      documentFits: document.documentElement.scrollWidth <= window.innerWidth,
      fragmentCount: fragments.length,
      fragmentsContained: fragments.every(
        (rect) =>
          rect.left >= containerRect.left - tolerance &&
          rect.right <= containerRect.right + tolerance,
      ),
      targetRectHeight: targetRect.height,
      targetRectWidth: targetRect.width,
      targetClientWidth: element.clientWidth,
      targetScrollWidth: element.scrollWidth,
      wrapsAcrossLines:
        fragments.length > 1 ||
        (Number.isFinite(lineHeight) && targetRect.height > lineHeight * 1.5),
    };
  });

  expect(metrics.cardRectWidth).toBeGreaterThan(0);
  expect(metrics.containerClientWidth).toBeGreaterThan(0);
  expect(metrics.containerRectWidth).toBeGreaterThan(0);
  expect(metrics.targetRectWidth).toBeGreaterThan(0);
  expect(metrics.targetRectHeight).toBeGreaterThan(0);
  expect(metrics.wrapsAcrossLines).toBe(true);
  expect(metrics.fragmentsContained).toBe(true);
  expect(metrics.targetScrollWidth).toBeLessThanOrEqual(metrics.targetClientWidth + 1);
  expect(metrics.documentFits).toBe(true);
}

for (const viewport of viewports) {
  test(`${viewport.name} keeps the dashboard and all eight visible modules reachable`, async ({
    page,
  }) => {
    test.setTimeout(responsiveMatrixTimeout);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('./dashboard');
    await expectMainSiteFontRequest(page);
    await expect(page.getByRole('heading', { name: '发展端工作台', exact: true })).toBeVisible();
    await expect(
      page.locator(`${viewport.navigation} a[href="/development/dashboard"]`),
    ).toHaveCount(0);
    if (viewport.name === 'desktop') {
      await expect(page.getByRole('link', { name: 'FREE BBS' })).toHaveAttribute(
        'href',
        '/development/dashboard',
      );
    }
    await expect(page.getByRole('heading', { name: '行动提示' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '最近内容' })).toBeVisible();
    await expect(page.getByTestId('dashboard-module-card')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('Demo user').selectOption('demo-admin');
    await expect(page.getByLabel('Demo user')).toHaveValue('demo-admin');

    for (const route of routes) {
      const routeLink = page.locator(`${viewport.navigation} a[href="/development/${route.path}"]`);
      await routeLink.click();
      await expect(page).toHaveURL(new RegExp(`/development/${route.destination ?? route.path}$`));
      await page.waitForLoadState('networkidle');
      await expect(
        page.getByRole('heading', { name: route.heading, exact: true }).first(),
      ).toBeVisible();

      const currentNavigation = page.locator(
        `${viewport.navigation} a[aria-current="page"][href="/development/${route.path}"]`,
      );
      await expect(currentNavigation).toBeVisible();
      await expect(currentNavigation).toBeInViewport();

      const primaryAction = route.primaryAction(page);
      await expect(primaryAction).toBeVisible();
      await primaryAction.scrollIntoViewIfNeeded();
      await expect(
        primaryAction,
        `${viewport.name}/${route.path} primary action should be reachable`,
      ).toBeInViewport();
      await expectNoHorizontalOverflow(page);

      if (route.path === 'sports') {
        await expectLongTextWraps(
          page.locator('.workbench-card p').first(),
          `SCOPE${'A'.repeat(512)}`,
        );
      }
      if (route.path === 'admin') {
        await expectLongTextWraps(
          page.locator('.record-card strong').first(),
          `UID${'9'.repeat(512)}`,
        );
      }
    }
  });
}

test('mobile nested routes preserve their module shell without horizontal page overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const nestedRoutes = [
    ['/information/proposals/proposal-night-lighting', '/development/information'],
    ['/events/activity-ma-john-cup', '/development/events'],
    ['/liaison/problems/liaison-problem-lab-energy', '/development/liaison'],
    ['/sports/team-basketball', '/development/sports'],
  ] as const;

  for (const [route, navigationHref] of nestedRoutes) {
    await page.goto(`.${route}`);
    await expect(page.locator('.main-site-header')).toBeVisible();
    await expect(
      page.locator(`.mobile-nav a[aria-current="page"][href="${navigationHref}"]`),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test('mobile dialog keeps an overflowing body scrollable and its footer reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./dashboard');
  await expect(page.getByRole('heading', { name: '发展端工作台' })).toBeVisible();

  await page.evaluate(() => {
    const fields = Array.from(
      { length: 20 },
      (_, index) => `
        <label for="dialog-probe-${index}">字段 ${index + 1}</label>
        <input id="dialog-probe-${index}" value="响应式对话框内容 ${index + 1}" />`,
    ).join('');
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.dataset.testid = 'responsive-dialog-probe';
    backdrop.innerHTML = `
      <div
        class="dialog-form"
        role="dialog"
        aria-modal="true"
        aria-label="响应式对话框探针"
        tabindex="-1"
      >
        <form class="dialog-form-layout">
          <header class="dialog-form-header">
            <h2>响应式对话框探针</h2>
            <p>使用 DialogForm 的真实共享 DOM contract 与样式。</p>
          </header>
          <div class="dialog-form-body">
            <div class="dialog-form-fields">${fields}</div>
          </div>
          <footer class="dialog-form-actions">
            <button type="button">取消</button>
            <button type="submit">保存</button>
          </footer>
        </form>
      </div>`;
    document.body.append(backdrop);
  });

  const dialog = page.getByRole('dialog', { name: '响应式对话框探针' });
  const body = dialog.locator('.dialog-form-body');
  const footer = dialog.locator('.dialog-form-actions');
  await expect(dialog).toBeVisible();
  await expect(footer).toBeInViewport();

  const dialogMetrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      overflow: getComputedStyle(element).overflow,
      right: rect.right,
      top: rect.top,
    };
  });
  expect(dialogMetrics.left).toBeGreaterThanOrEqual(0);
  expect(dialogMetrics.top).toBeGreaterThanOrEqual(0);
  expect(dialogMetrics.right).toBeLessThanOrEqual(390);
  expect(dialogMetrics.bottom).toBeLessThanOrEqual(844);
  expect(dialogMetrics.overflow).toBe('hidden');

  const bodyMetrics = await body.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  expect(bodyMetrics.clientHeight).toBeGreaterThan(0);
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
  expect(bodyMetrics.overflowY).toBe('auto');

  const footerBeforeScroll = await footer.boundingBox();
  expect(footerBeforeScroll).not.toBeNull();
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      body.evaluate(
        (element) =>
          element.scrollTop > 0 &&
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  await expect(footer).toBeInViewport();
  const footerAfterScroll = await footer.boundingBox();
  expect(footerAfterScroll).not.toBeNull();
  expect(footerAfterScroll?.y).toBeCloseTo(footerBeforeScroll?.y ?? 0, 0);
  await expectNoHorizontalOverflow(page);
});
