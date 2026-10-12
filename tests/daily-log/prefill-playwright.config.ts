import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/daily-log/prefill-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /daily-log-prefill\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 820 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4211', trace: 'retain-on-failure' },
  outputDir: '../../.daily-log-prefill-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4211 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4211/tests/daily-log/prefill-fixture.html',
    reuseExistingServer: false,
  },
});
