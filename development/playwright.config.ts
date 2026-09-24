import { defineConfig, devices } from '@playwright/test';

const useSystemChrome = !process.env.CI && process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === 'true';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['admin.spec.ts', 'release-smoke.spec.ts'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:5173/development/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: useSystemChrome ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: useSystemChrome
        ? { ...devices['Desktop Chrome'], channel: 'chrome' }
        : { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/development/',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_MODE: 'demo',
      DATA_MODE: 'memory',
      NODE_ENV: 'development',
      VITE_AUTH_MODE: 'demo',
    },
  },
});
