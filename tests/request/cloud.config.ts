import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/request/**/*.cloud.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
