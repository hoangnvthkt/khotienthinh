import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e', testMatch: 'daily-log-revisions.spec.ts', workers: 1,
  outputDir: '../../.superpowers/sdd/2026-09-23-daily-log-wbs-area-summary-progress/browser-results',
  use: { baseURL: 'http://127.0.0.1:4196' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4196 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4196/tests/daily-log/revision-fixture.html', reuseExistingServer: false },
});
