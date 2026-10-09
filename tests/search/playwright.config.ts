import { defineConfig, devices } from "@playwright/test";

// Tìm kiếm toàn hệ thống trên fixture (dữ liệu minh họa, không gọi Supabase): desktop 1440, tablet 820, iPhone (WebKit).
// Chạy: npx playwright test -c tests/search/playwright.config.ts
export default defineConfig({
  testDir: "../e2e",
  testMatch: /global-search\.spec\.ts/,
  workers: 1,
  // Fixture chạy trên dev server: lần đầu Vite biên dịch nguội có thể chậm.
  retries: 1,
  timeout: 60_000,
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 820, height: 1180 } } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  use: { baseURL: "http://127.0.0.1:4322", trace: "retain-on-failure" },
  outputDir: "../../.search-test-results/artifacts",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4322 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4322/tests/search/fixture.html",
    reuseExistingServer: false,
  },
});
