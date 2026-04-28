import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              const normalizedId = id.replaceAll('\\', '/');
              if (!normalizedId.includes('/node_modules/')) return;
              if (normalizedId.includes('/node_modules/xlsx/')) return 'xlsx';
              if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons';
              if (
                normalizedId.includes('/node_modules/docxtemplater/') ||
                normalizedId.includes('/node_modules/pizzip/') ||
                normalizedId.includes('/node_modules/file-saver/')
              ) return 'office';
              if (
                normalizedId.includes('/node_modules/three/') ||
                normalizedId.includes('/node_modules/@react-three/')
              ) return 'three';
              if (
                normalizedId.includes('/node_modules/recharts/') ||
                normalizedId.includes('/node_modules/d3-')
              ) return 'charts';
              if (normalizedId.includes('/node_modules/@supabase/')) return 'supabase';
              if (
                normalizedId.includes('/node_modules/react/') ||
                normalizedId.includes('/node_modules/react-dom/') ||
                normalizedId.includes('/node_modules/react-router/') ||
                normalizedId.includes('/node_modules/react-router-dom/') ||
                normalizedId.includes('/node_modules/scheduler/')
              ) return 'react-vendor';
            },
          },
        },
      }
    };
});
