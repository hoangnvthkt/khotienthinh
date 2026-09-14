import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../e2e', testMatch: 'authorization-v2-module-access.spec.ts',
  workers: 1, use: { baseURL: 'http://127.0.0.1:4192' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4192 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4192/tests/authorization/editor-fixture.html', reuseExistingServer: false },
});
