import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  testMatch: /center-(shell|idle)\.spec\.ts/,
  workers: 1,
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } }, testMatch: /center-shell\.spec\.ts/ },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 820, height: 1180 } }, testMatch: /center-shell\.spec\.ts/ },
    { name: "mobile-safari", use: { ...devices["iPhone 13"], browserName: "webkit" }, testMatch: /center-shell\.spec\.ts/ },
    // Đo CPU WebKit khi đứng yên: chạy riêng, tuần tự (npx playwright test -c tests/center/playwright.config.ts --project webkit-idle).
    { name: "webkit-idle", use: { ...devices["iPhone 13"], browserName: "webkit" }, testMatch: /center-idle\.spec\.ts/ },
  ],
  use: { baseURL: "http://127.0.0.1:4207", trace: "retain-on-failure" },
  outputDir: "../../.center-test-results/artifacts",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4207 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4207/tests/center/fixture.html",
    reuseExistingServer: false,
  },
});
