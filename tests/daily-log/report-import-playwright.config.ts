import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/daily-log/report-import-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /daily-log-report-import\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4221', colorScheme: 'light', trace: 'retain-on-failure' },
  outputDir: '../../.daily-log-report-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4221 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4221/tests/daily-log/report-import-fixture.html',
    reuseExistingServer: false,
  },
});
