import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e', testMatch: 'daily-log-wbs-area-summary.spec.ts', workers: 1, timeout: 180000,
  outputDir: '../../.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/cloud-browser-results',
  use: { baseURL: 'http://127.0.0.1:4197', trace: 'off', video: 'off', actionTimeout: 15000 },
  webServer: { command: 'node tests/daily-log/cloud-vite.mjs', cwd: '../..',
    url: 'http://127.0.0.1:4197/tests/daily-log/cloud-fixture.html', reuseExistingServer: false, timeout: 120000 },
});
