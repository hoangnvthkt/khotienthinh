import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  testMatch: /office(?:-mobile)?\.spec\.ts/,
  workers: 1,
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
      testMatch: "office-mobile.spec.ts",
    },
  ],
  use: { baseURL: "http://127.0.0.1:4206", trace: "retain-on-failure" },
  outputDir: "../../.office-test-results",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4206 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4206/tests/office/fixture.html",
    reuseExistingServer: false,
  },
});
