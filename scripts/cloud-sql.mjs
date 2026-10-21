#!/usr/bin/env node
// Chạy SQL trên Supabase Cloud qua Management API (dùng SUPABASE_ACCESS_TOKEN + VITE_SUPABASE_URL trong .env). Không in khóa.
//   node scripts/cloud-sql.mjs "select 1"                  # chỉ đọc (endpoint read-only)
//   node scripts/cloud-sql.mjs --file x.sql --rollback      # GHI nhưng thay "commit;" cuối tệp bằng "rollback;" (chạy thử)
//   node scripts/cloud-sql.mjs --file x.sql --write         # GHI thật (tệp tự begin; … commit;)
// .env: mặc định ./.env, trong worktree đặt CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env
import { existsSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const envPath = process.env.CLOUD_SQL_ENV || (existsSync('.env') ? '.env' : '/Users/admin/khotienthinh/.env');
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const ref = new URL(env.VITE_SUPABASE_URL).host.split('.')[0];
const fileAt = args.indexOf('--file');
let sql = fileAt >= 0 ? readFileSync(args[fileAt + 1], 'utf8') : args.find(a => !a.startsWith('--')) || '';
const write = args.includes('--write') || args.includes('--rollback');
if (args.includes('--rollback')) sql = sql.replace(/\ncommit;\s*$/i, '\nrollback;\n');
if (!sql.trim()) { console.error('Thiếu câu SQL'); process.exit(2); }
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query${write ? '' : '/read-only'}`, {
  method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
const text = await res.text();
if (!res.ok) { console.error('HTTP', res.status, text.slice(0, 800)); process.exit(1); }
try { console.table(JSON.parse(text)); } catch { console.log(text); }
