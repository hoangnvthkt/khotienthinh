import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/daily-log/review-queue-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /daily-log-review-queue\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 860 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4220', colorScheme: 'light', trace: 'retain-on-failure' },
  outputDir: '../../.daily-log-review-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4220 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4220/tests/daily-log/review-queue-fixture.html',
    reuseExistingServer: false,
  },
});
