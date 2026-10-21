import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/hrm/work-status-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /hrm-work-status\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4230', trace: 'retain-on-failure' },
  outputDir: '../../.hrm-work-status-test-results/artifacts',
  webServer: {
    command: 'npx vite --config tests/hrm/vite.config.fixture.ts --host 127.0.0.1 --port 4230 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4230/tests/hrm/work-status-fixture.html',
    reuseExistingServer: false,
  },
});
