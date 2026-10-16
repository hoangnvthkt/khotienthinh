import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/settings/connections-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /connections\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 860 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4216', trace: 'retain-on-failure' },
  outputDir: '../../.connections-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4216 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4216/tests/settings/connections-fixture.html',
    reuseExistingServer: false,
  },
});
