import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: ['resource-usage-evidence.spec.mjs'], workers: 1,
  timeout: 120000,
  outputDir: '../../.superpowers/sdd/2026-09-23-daily-log-resource-evidence-supplier-payment-readiness/browser-results',
  use: { baseURL: 'http://127.0.0.1:4197', trace: 'off', video: 'off', actionTimeout: 15000 },
  webServer: { command: 'node tests/daily-log/cloud-vite.mjs', cwd: '../..',
    url: 'http://127.0.0.1:4197/tests/daily-log/resource-evidence-fixture.html',
    reuseExistingServer: false, timeout: 120000 },
});
