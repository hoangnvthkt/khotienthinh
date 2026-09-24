import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e', testMatch: ['project-v2-planning.spec.ts', 'project-v2-collaboration.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:4196' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4196 --strictPort',
    cwd: '../..', url: 'http://127.0.0.1:4196/tests/project-v2/planning-fixture.html',
    reuseExistingServer: false },
});
