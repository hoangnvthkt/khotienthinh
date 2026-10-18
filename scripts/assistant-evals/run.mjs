#!/usr/bin/env node
// Chạy bộ kiểm hồi quy Trợ lý v2 — xem README.md. Gói evals.ts (cùng mã cổng AI) bằng esbuild rồi chạy với model thật.
//   node scripts/assistant-evals/run.mjs                 # mọi ca
//   node scripts/assistant-evals/run.mjs po-tool-totals  # một vài ca
import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// SDK Anthropic chỉ có trong deno.json của cổng AI; cài tạm: npm i --no-save @anthropic-ai/sdk@0.131.0 (hoặc trỏ ASSISTANT_EVAL_NODE_MODULES).
const modules = process.env.ASSISTANT_EVAL_NODE_MODULES || join(root, 'node_modules');
if (!existsSync(join(modules, '@anthropic-ai/sdk'))) {
  console.error('Thiếu @anthropic-ai/sdk. Chạy: npm i --no-save @anthropic-ai/sdk@0.131.0');
  process.exit(2);
}
const outDir = join(root, 'node_modules/.cache/assistant-evals');
mkdirSync(outDir, { recursive: true });
const outfile = join(outDir, `evals-${Date.now()}.mjs`);
await build({ entryPoints: [join(here, 'evals.ts')], bundle: true, platform: 'node', format: 'esm', outfile, nodePaths: [modules], logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
const { runEvals } = await import(pathToFileURL(outfile).href);
const failed = await runEvals(process.env.ASSISTANT_EVAL_ENV || join(root, '.env'), process.argv.slice(2));
process.exit(failed ? 1 : 0);
