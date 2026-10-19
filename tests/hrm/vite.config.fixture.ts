import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Fixture Ngày nghỉ việc: AppContext thay bằng kho nhân sự nhỏ; Supabase trỏ về địa chỉ giả (Playwright chặn mọi RPC).
export default defineConfig({
  root: path.resolve(__dirname, '../..'),
  plugins: [react()],
  envDir: path.resolve(__dirname),
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:4231'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('fixture-anon-key'),
  },
  resolve: { alias: [{ find: /^\.\.\/\.\.\/context\/AppContext$/, replacement: path.resolve(__dirname, 'app-context-stub.tsx') }] },
});
