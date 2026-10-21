// Đọc Supabase Cloud (read-only) cho bộ đo Jev. Dùng SUPABASE_ACCESS_TOKEN + VITE_SUPABASE_URL trong .env. Không in khóa.
import { existsSync, readFileSync } from 'node:fs';

export const loadEnv = (p = process.env.JEV_EVAL_ENV || process.env.CLOUD_SQL_ENV || (existsSync('.env') ? '.env' : '/Users/admin/khotienthinh/.env')) =>
  Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));

export const cloudSql = async (env, sql) => {
  const ref = new URL(env.VITE_SUPABASE_URL).host.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Cloud SQL HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
};
