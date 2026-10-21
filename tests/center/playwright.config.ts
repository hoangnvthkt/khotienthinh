import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  testMatch: /center-(shell|idle|embed|assistant|site3d|ai-admin)\.spec\.ts/,
  workers: 1,
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } }, testMatch: /center-(shell|embed|assistant|ai-admin)\.spec\.ts/ },
    { name: "tablet", use: { browserName: "chromium", viewport: { width: 820, height: 1180 } }, testMatch: /center-shell\.spec\.ts/ },
    { name: "mobile-safari", use: { ...devices["iPhone 13"], browserName: "webkit" }, testMatch: /center-(shell|assistant|ai-admin)\.spec\.ts/ },
    // Đo CPU WebKit khi đứng yên: chạy riêng, tuần tự (npx playwright test -c tests/center/playwright.config.ts --project webkit-idle).
    // trace: "off" — trình ghi vết của Playwright chụp màn liên tục, trang có SVG lớn (Dòng chảy) bị đội CPU lên ~18% dù trang không làm gì;
    // tắt để số đo là của trang (13/10: Dòng chảy 1,3%, Hôm nay 0%).
    // Công trường 3D (WebGL): Chrome headless cần SwiftShader; PW_CHANNEL=chrome để chạy bằng Chrome cài sẵn khi chưa tải trình duyệt của Playwright.
    { name: "site3d-desktop", use: { browserName: "chromium", channel: process.env.PW_CHANNEL || undefined, viewport: { width: 1440, height: 900 },
      launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } }, testMatch: /center-site3d\.spec\.ts/ },
    { name: "site3d-phone", use: { ...devices["iPhone 13"], browserName: "webkit" }, testMatch: /center-site3d\.spec\.ts/ },
    { name: "webkit-idle", use: { ...devices["iPhone 13"], browserName: "webkit", trace: "off" }, testMatch: /center-idle\.spec\.ts/ },
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
