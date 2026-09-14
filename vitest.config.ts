import path from 'node:path';
import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'tests/request/**/*.cloud.test.ts'],
    setupFiles: ['./lib/__tests__/setupMigrationArchive.ts'],
  },
});
