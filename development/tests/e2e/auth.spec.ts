import { expect, test } from '@playwright/test';

const apiRoot = '/api/development/v1';
const mainSiteStudentToken = 'production-student-token';

// eslint-disable-next-line no-empty-pattern -- an empty fixture list lets skip run before browser launch.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name === 'production-shape' &&
      testInfo.title.includes('authenticated demo session'),
    'The deterministic demo switcher is covered only by the memory/demo project.',
  );
  test.skip(
    testInfo.project.name !== 'production-shape' && testInfo.title.includes('main-site token'),
    'The main-site contract requires the production-shape project.',
  );
});

test('restores an authenticated demo session and can switch deterministic identities', async ({
  page,
}) => {
  await page.goto('./dashboard');

  await expect(page.getByRole('heading', { name: '发展端工作台' })).toBeVisible();
  await expect(page.locator('.main-site-user')).toContainText('普通同学');
  await expect(page.getByLabel('Demo user')).toHaveValue('demo-student');

  await page.getByLabel('Demo user').selectOption('demo-admin');
  await expect(page.locator('.main-site-user')).toContainText('平台管理员');

  await page.getByLabel('Demo user').selectOption('demo-student');
  await page.reload();
  await expect(page.getByRole('heading', { name: '发展端工作台' })).toBeVisible();
  await expect(page.locator('.main-site-user')).toContainText('普通同学');
});

test('a main-site token synchronizes its subject and preserves a deep development route', async ({
  page,
  request,
}) => {
  await page.addInitScript(
    ([key, token]) => window.localStorage.setItem(key, token),
    ['free_bbs_auth_token', mainSiteStudentToken],
  );

  await page.goto('./events?filter=pending#record-x');

  await expect(page.locator('.main-site-user')).toContainText('主站同步同学');
  await expect(page.getByLabel('Demo user')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => `${location.pathname}${location.search}${location.hash}`))
    .toBe('/development/events?filter=pending#record-x');

  const synchronized = await request.get(`${apiRoot}/admin/subjects?query=main-site-student`, {
    headers: { Authorization: 'Bearer production-admin-token' },
  });
  expect(synchronized.status(), await synchronized.text()).toBe(200);
  await expect(synchronized.json()).resolves.toMatchObject({
    data: {
      total: 1,
      items: [
        {
          uid: 'main-site-student',
          displayName: '主站同步同学',
          status: 'active',
        },
      ],
    },
  });
});
