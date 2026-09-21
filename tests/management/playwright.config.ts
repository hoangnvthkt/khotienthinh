import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: 'g8-management-dataset.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4198' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4198 --strictPort', cwd: '../..',
    url: 'http://127.0.0.1:4198/tests/management/g8-management-fixture.html', reuseExistingServer: false,
  },
});
