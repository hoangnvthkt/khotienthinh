import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/procurement/prefill-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /po-prefill\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 860 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4212', trace: 'retain-on-failure' },
  outputDir: '../../.po-prefill-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4212 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4212/tests/procurement/prefill-fixture.html',
    reuseExistingServer: false,
  },
});
