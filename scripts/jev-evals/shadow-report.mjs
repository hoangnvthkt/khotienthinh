#!/usr/bin/env node
// J1 — báo cáo chạy bóng Jev từ ai_decisions (đọc Cloud, không ghi). Không có nội dung câu hỏi trong bảng.
//   JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/shadow-report.mjs [--days 14]
import { cloudSql, loadEnv } from './cloud.mjs';
const env = loadEnv();
const i = process.argv.indexOf('--days'); const days = i >= 0 ? Number(process.argv[i + 1]) || 14 : 14;
const rows = await cloudSql(env, `
  select status, predicted->>'tier' tier, predicted->>'intent' predicted, actual->>'intent' actual, actual->>'refusal' refusal, agree, cam_agree, (predicted->>'cam')::numeric cam,
         (predicted->>'confidence')::numeric conf, duration_ms, tokens_in, model, error
  from public.ai_decisions where created_at >= now() - interval '${days} days' order by created_at`);
const ok = rows.filter(r => r.status === 'ok');
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '—');
console.log(`ai_decisions ${days} ngày: ${rows.length} lượt · lỗi ${rows.length - ok.length} · model ${[...new Set(ok.map(r => r.model))].join(', ') || '—'}`);
const compared = ok.filter(r => r.agree != null);
console.log(`khớp ý định với model chính: ${compared.filter(r => r.agree).length}/${compared.length} (${pct(compared.filter(r => r.agree).length, compared.length)}) · ${ok.length - compared.length} lượt không so được (model chính chỉ trả lời chữ)`);
for (const tier of ['auto', 'verify', 'ask']) { const xs = ok.filter(r => r.tier === tier); const c = xs.filter(r => r.agree != null); console.log(`  ${tier.padEnd(6)} ${String(xs.length).padStart(4)} lượt · khớp ${c.filter(r => r.agree).length}/${c.length} (${pct(c.filter(r => r.agree).length, c.length)})`); }
console.log('theo ý định Jev đoán:');
for (const [k, xs] of Object.entries(ok.reduce((a, r) => ((a[r.predicted] ||= []).push(r), a), {}))) { const c = xs.filter(r => r.agree != null); console.log(`  ${k.padEnd(16)} ${String(xs.length).padStart(4)} · khớp ${c.filter(r => r.agree).length}/${c.length}`); }
const flagged = ok.filter(r => Number(r.cam) >= 0.5); const refused = ok.filter(r => r.refusal === 'thao_tac_cam');
console.log(`lệnh cấm: Jev báo ${flagged.length} · model chính từ chối thao tác cấm ${refused.length} · cả hai ${ok.filter(r => Number(r.cam) >= 0.5 && r.refusal === 'thao_tac_cam').length}`);
const ms = ok.map(r => r.duration_ms).filter(Boolean).sort((a, b) => a - b);
console.log(`thời gian Jev TB ${Math.round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1))} ms · p95 ${ms[Math.floor(ms.length * 0.95)] || 0} ms · token vào ${ok.reduce((s, r) => s + (r.tokens_in || 0), 0)}`);
const dis = compared.filter(r => !r.agree);
if (dis.length) { console.log(`lệch (${dis.length}):`); for (const r of dis.slice(0, 30)) console.log(`  Jev ${r.predicted} (conf ${Number(r.conf).toFixed(2)}) · thực ${r.actual}${r.refusal ? ` · từ chối ${r.refusal}` : ''}`); }
for (const r of rows.filter(r => r.status === 'error').slice(0, 5)) console.log('  LỖI', r.error);
