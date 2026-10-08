import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'procurement-po-excel-import.spec.ts',
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4197', colorScheme: 'light' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4197/tests/procurement/po-excel-import-fixture.html',
    reuseExistingServer: false,
  },
});
