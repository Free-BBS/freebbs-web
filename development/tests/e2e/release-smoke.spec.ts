import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';

const apiRoot = '/api/development/v1';

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line no-empty-pattern -- an empty fixture list lets skip run before browser launch.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'production-shape',
    'Release smoke requires the production-shape project.',
  );
});

test('serves the built development application with live MySQL readiness', async ({
  page,
  request,
}) => {
  const staticResponse = await page.goto('./');
  expect(staticResponse?.status()).toBe(200);
  await expect(page.locator('body')).toContainText('需要登录');

  const health = await request.get(`${apiRoot}/health`);
  expect(health.status(), await health.text()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({
    data: { status: 'ok', databaseMode: 'mysql' },
  });

  const ready = await request.get(`${apiRoot}/ready`);
  expect(ready.status(), await ready.text()).toBe(200);
  await expect(ready.json()).resolves.toMatchObject({ data: { status: 'ok' } });
});

test('rejects an invalid main-site token', async ({ request }) => {
  const response = await request.get(`${apiRoot}/me`, {
    headers: { Authorization: 'Bearer production-invalid-token' },
  });
  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({
    data: { error: { code: 'invalid_identity' } },
  });
});

test('keeps the legacy clubs URL compatible in the production-shaped application', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, token]) => window.localStorage.setItem(key, token),
    ['free_bbs_auth_token', 'production-student-token'],
  );

  await page.goto('./clubs');
  await expect(page).toHaveURL(/\/development\/growth$/);
  await expect(
    page.getByRole('heading', { name: '个人成长档案', exact: true }).first(),
  ).toBeVisible();
});

test('reports not ready after the production database becomes unavailable', async ({
  request,
}, testInfo) => {
  test.skip(
    process.env.PRODUCTION_E2E_SHUTDOWN_DB !== 'true',
    'Set PRODUCTION_E2E_SHUTDOWN_DB=true only for a disposable CI database.',
  );
  const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
  expect(rootPassword, 'MYSQL_ROOT_PASSWORD must target the disposable CI service').toBeTruthy();

  const connection = await createConnection({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? '3306'),
    user: 'root',
    password: rootPassword,
  });
  try {
    await connection.query('SHUTDOWN');
  } finally {
    connection.destroy();
  }

  await expect
    .poll(async () => (await request.get(`${apiRoot}/ready`)).status(), {
      message: `readiness stayed healthy in ${testInfo.project.name}`,
      timeout: 15_000,
    })
    .toBe(503);
});
