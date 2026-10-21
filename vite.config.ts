import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      test: {
        exclude: ['**/node_modules/**', '**/.git/**', '**/.worktrees/**'],
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              const normalizedId = id.replaceAll('\\', '/');
              // Rollup pulls unassigned static deps of a manual chunk into it.
              // Shared helpers must be pinned to an always-loaded chunk, else the
              // preload helper lands in `three` (entry preloads three.js) and
              // @babel/runtime lands in `charts` (3D screens load recharts).
              if (
                normalizedId.includes('vite/preload-helper') ||
                normalizedId.includes('/node_modules/@babel/runtime/')
              ) return 'react-vendor';
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
