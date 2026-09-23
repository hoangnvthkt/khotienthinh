import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: 'procurement-v2-dossier.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4197' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4197/tests/procurement-v2/dossier-fixture.html',
    reuseExistingServer: false },
});
