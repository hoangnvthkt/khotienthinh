import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'g5-procurement-workbench.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4195' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4195 --strictPort',
    cwd: '../..',
    url: 'http://127.0.0.1:4195/tests/procurement/workbench-fixture.html',
    reuseExistingServer: false,
  },
});
