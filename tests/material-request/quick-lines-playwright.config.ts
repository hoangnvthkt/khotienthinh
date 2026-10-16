import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/material-request/quick-lines-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /quick-lines\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4218', trace: 'retain-on-failure' },
  outputDir: '../../.quick-lines-test-results/artifacts',
  webServer: {
    command: 'npx vite --config tests/material-request/vite.config.fixture.ts --host 127.0.0.1 --port 4218 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4218/tests/material-request/quick-lines-fixture.html',
    reuseExistingServer: false,
  },
});
