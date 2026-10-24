import { defineConfig, devices } from '@playwright/test';

// Phân quyền kho qua luật kiêm nhiệm: npx playwright test -c tests/wms/access-sod-playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /wms-access-sod\.spec\.ts/,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4197' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4197/tests/wms/access-sod-fixture.html', reuseExistingServer: false,
  },
});
