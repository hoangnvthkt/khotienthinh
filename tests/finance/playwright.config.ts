import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'g7-finance-control.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4197' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4197/tests/finance/g7-finance-fixture.html',
    reuseExistingServer: false,
  },
});
