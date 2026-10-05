import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir:'../e2e', testMatch:'procurement-external-intake.spec.ts', workers:1,
 use:{baseURL:'http://127.0.0.1:4197',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4197 --strictPort',cwd:'../..',url:'http://127.0.0.1:4197/tests/procurement/external-intake-fixture.html',reuseExistingServer:false}
});
