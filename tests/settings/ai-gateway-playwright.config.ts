import { defineConfig, devices } from '@playwright/test';
// npx playwright test -c tests/settings/ai-gateway-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /ai-gateway\.spec\.ts/,
  workers: 1,
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 860 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4215', trace: 'retain-on-failure' },
  outputDir: '../../.ai-gateway-test-results/artifacts',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4215 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4215/tests/settings/ai-gateway-fixture.html',
    reuseExistingServer: false,
  },
});
