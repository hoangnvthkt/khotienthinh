import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Fixture Đề xuất vật tư: AppContext thay bằng bản rút gọn (ItemSelectionModal chỉ đọc items, warehouses).
export default defineConfig({
  root: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: { alias: [{ find: /^\.\.\/context\/AppContext$/, replacement: path.resolve(__dirname, 'app-context-stub.tsx') }] },
});
