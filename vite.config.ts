import path from 'path';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), {
        name: 'office-pdf-assets',
        generateBundle() {
          const root = path.resolve(__dirname, 'node_modules/pdfjs-dist');
          const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
          for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
            for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
              if (entry.isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs/${version}/${folder}/${entry.name}`, source: readFileSync(path.join(root, folder, entry.name)) });
            }
          }
        },
      }],
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
