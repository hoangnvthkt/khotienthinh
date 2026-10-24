import { defineConfig, devices } from '@playwright/test';

// Trung tâm phân quyền: npx playwright test -c tests/permissions/playwright.config.ts
export default defineConfig({
  testDir: '../e2e',
  testMatch: /permission-center\.spec\.ts/,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4193' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 820, height: 1180 } } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    // Khi WebKit của Playwright không chạy được trên máy (23/10: lỗi Segmentation fault trên macOS 26), dùng khổ iPhone bằng Chromium để kiểm bố cục.
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4193 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4193/tests/permissions/center-fixture.html', reuseExistingServer: false,
  },
});
