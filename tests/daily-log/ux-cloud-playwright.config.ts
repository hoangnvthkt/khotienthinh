import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../e2e',testMatch:'daily-log-user-centered-*.spec.ts',workers:1,
  outputDir:'../../.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/ux-cloud-results',
  webServer:{command:'node --env-file=/Users/admin/khotienthinh/.env tests/daily-log/cloud-vite.mjs',url:'http://127.0.0.1:4197',reuseExistingServer:true,timeout:60000},
  use:{baseURL:'http://127.0.0.1:4197',trace:'off',video:'off',actionTimeout:15000}});
