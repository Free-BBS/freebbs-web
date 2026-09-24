import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

const useSystemChrome = !process.env.CI && process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === 'true';

const mysqlEnvironment = {
  DATA_MODE: 'mysql',
  MYSQL_HOST: process.env.MYSQL_HOST ?? '127.0.0.1',
  MYSQL_PORT: process.env.MYSQL_PORT ?? '3306',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'free_bbs_development',
  MYSQL_USER: process.env.MYSQL_USER ?? 'freebbs_development',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? 'test-only-password',
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['admin.spec.ts', 'auth.spec.ts', 'release-smoke.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: 'playwright-report/production-shape' }], ['github']]
    : 'list',
  outputDir: 'test-results/production-shape',
  use: {
    baseURL: 'http://127.0.0.1:5174/development/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: useSystemChrome ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'production-shape',
      use: useSystemChrome
        ? { ...devices['Desktop Chrome'], channel: 'chrome' }
        : { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node tests/fixtures/main-auth-stub.mjs',
      url: 'http://127.0.0.1:3200/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MAIN_AUTH_STUB_PORT: '3200' },
    },
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3100/api/development/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...mysqlEnvironment,
        NODE_ENV: 'production',
        AUTH_MODE: 'main',
        HOST: '127.0.0.1',
        PORT: '3100',
        MAIN_SITE_API_BASE_URL: 'http://127.0.0.1:3200',
        DEVELOPMENT_PREVIEW_UIDS: 'demo-admin,main-site-student',
      },
    },
    {
      command:
        'npm run build -w @freebbs-development/web && npm run preview -w @freebbs-development/web -- --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174/development/',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_AUTH_MODE: 'main' },
    },
  ],
});
