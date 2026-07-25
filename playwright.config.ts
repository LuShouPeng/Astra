import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:1422',
    channel: 'msedge',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --mode acceptance',
    url: 'http://127.0.0.1:1422/?scenario=empty',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
