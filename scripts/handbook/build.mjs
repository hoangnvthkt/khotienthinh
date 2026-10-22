// Sinh supabase/functions/ai-gateway/handbook.generated.ts từ docs + danh mục trong mã. Chạy: npm run handbook:build
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildHandbook, renderGenerated } from './lib.mjs';

const root = resolve(new URL('.', import.meta.url).pathname, '../..');
const docsDir = join(root, 'docs/so-tay');
const docs = readdirSync(docsDir).filter(f => f.endsWith('.md')).sort().map(name => ({ name, text: readFileSync(join(docsDir, name), 'utf8') }));
const guide = readFileSync(join(root, 'docs/huong-dan-su-dung-phong-quan-ly-du-an.md'), 'utf8');

// Danh mục là TypeScript: gói tạm bằng esbuild rồi import (không kéo React).
const tmp = mkdtempSync(join(tmpdir(), 'vioo-handbook-'));
try {
  const out = join(tmp, 'catalog.mjs');
  execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(root, 'lib/search/searchCatalog.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error']);
  const catalog = await import(pathToFileURL(out).href);
  const entries = buildHandbook({ docs, guide, catalog: { quickActions: catalog.quickActionDefs(new Date(2026, 0, 5)), extraPages: catalog.EXTRA_PAGES, routeKeywords: catalog.ROUTE_KEYWORDS } });
  const target = join(root, 'supabase/functions/ai-gateway/handbook.generated.ts');
  writeFileSync(target, renderGenerated(entries));
  const bySource = entries.reduce((m, e) => ({ ...m, [e.source]: (m[e.source] || 0) + 1 }), {});
  console.log(`Sổ tay: ${entries.length} mục → ${target.replace(root + '/', '')}`, bySource, `${Math.round(renderGenerated(entries).length / 1024)} KB`);
} finally { rmSync(tmp, { recursive: true, force: true }); }
