import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'../e2e',testMatch:'daily-log-summary-cloud.spec.ts',workers:1,
  outputDir:'../../.superpowers/sdd/2026-09-26-daily-log-user-centered-ux-revision/summary-cloud-results',
  use:{baseURL:'http://127.0.0.1:4197',trace:'off',video:'off',actionTimeout:15000}});
