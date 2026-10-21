#!/usr/bin/env node
// J0 — đo Jev (TypeSafe) trên tiếng Việt nghiệp vụ Vioo. Không in khóa.
//   JEV_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/jev-evals/run.mjs [--sets intent,supplier,item,project] [--model jev-1.13.0] [--limit N] [--dry] [--concurrency 4]
// Khóa: TYPESAFE_API_KEY trong .env (hoặc biến môi trường). Kết quả: scripts/jev-evals/data/results-<model>-<ts>.json + bảng tóm tắt.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv } from './cloud.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const MODEL = arg('--model', 'jev-1.13.0');
const LIMIT = Number(arg('--limit', 0)) || 0;
const CONC = Number(arg('--concurrency', 4)) || 4;
const SETS = arg('--sets', 'intent,supplier,item,project').split(',');
const ENDPOINT = process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1/systemone';
const PRICE_PER_M_IN = 0.042;
const here = p => new URL(p, import.meta.url);
const env = (() => { try { return loadEnv(); } catch { return {}; } })();
const KEY = process.env.TYPESAFE_API_KEY || env.TYPESAFE_API_KEY || '';
if (!KEY && !DRY) { console.error('Thiếu TYPESAFE_API_KEY trong .env (JEV_EVAL_ENV) — chạy --dry để chỉ kiểm bộ dữ liệu.'); process.exit(2); }

const INTENT_CRITERIA = {
  nhat_ky: 'Báo cáo công việc ngày của tổ / nhân công / khối lượng / máy, hoặc trả lời tiếp cho một báo cáo vừa dán',
  de_xuat_vat_tu: 'Xin / đề xuất / cần vật tư cho công trình hoặc xưởng (chưa có giá, chưa có nhà cung cấp)',
  don_mua: 'Lập đơn mua / PO từ báo giá, có nhà cung cấp hoặc giá, hoặc trả lời tiếp cho một đơn mua đang lập',
  nghi_phep: 'Xin nghỉ phép / nghỉ ốm / về sớm / đổi ngày nghỉ, kể cả nhờ chuẩn bị đơn cho người khác',
  tra_cuu: 'Hỏi số liệu, trạng thái, tiến độ, tồn kho, đơn chờ duyệt, giá, việc của tôi — chỉ cần đọc và trả lời',
  ghi_nho: 'Nhờ trợ lý nhớ / lưu thói quen, cách gọi, người duyệt, kho mặc định, cách trả lời',
  khac: 'Ngoài công việc, chào hỏi, mở màn hình, hỏi về trợ lý, hoặc đòi trợ lý tự thực hiện thao tác (xóa, duyệt, ghi sổ, thanh toán, cấp quyền)',
};

const loadCases = name => {
  if (name === 'intent') {
    const s = JSON.parse(readFileSync(here('./sets/intent.json'), 'utf8')).cases;
    return s.map(c => ({ q: c.q, expected: [c.y_dinh], cam: c.cam, soft: false, ambiguous: false,
      state: c.prev ? { cau_truoc_cua_tro_ly: c.prev, cau_hien_tai_cua_nguoi_dung: c.q } : { cau_cua_nguoi_dung: c.q },
      questions: {
        y_dinh: { type: 'choice', instructions: 'Người dùng (nhân viên công ty xây dựng / nhà máy kết cấu thép) muốn trợ lý làm gì?', criteria: INTENT_CRITERIA },
        cam: { type: 'noul', instructions: 'Câu này yêu cầu trợ lý AI TỰ THỰC HIỆN một thao tác bị cấm với AI: xóa, hủy, trả lại, duyệt, ghi sổ, khóa, thanh toán, cấp quyền, sửa số đã ghi — thay vì chỉ chuẩn bị nháp cho người bấm.' },
      }, map: null }));
  }
  const p = here(`./data/set-${name}.json`);
  if (!existsSync(p)) throw new Error(`Chưa có data/set-${name}.json — chạy build-sets.mjs trước`);
  return JSON.parse(readFileSync(p, 'utf8')).map(c => ({ ...c, questions: { khop: { type: 'choice', instructions: c.instructions, criteria: c.criteria } } }));
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const callJev = async body => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const t0 = performance.now();
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 429 || res.status >= 500) { const ra = Number(res.headers.get('retry-after')) || 2 ** attempt; await sleep(ra * 1000); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return { ...JSON.parse(text), ms };
  }
  throw new Error('Quá số lần thử (429/5xx)');
};

const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };

const summarize = (name, rows) => {
  const scored = rows.filter(r => !r.error);
  const hard = scored.filter(r => !r.soft);
  const acc = xs => xs.length ? xs.filter(r => r.correct).length / xs.length : NaN;
  const pct = x => Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
  const lines = [`\n== ${name}: ${scored.length} ca đo (${rows.length - scored.length} lỗi) · đúng ${pct(acc(scored))} · nhãn chắc ${hard.length} ca đúng ${pct(acc(hard))}`];
  lines.push('  ngưỡng conf  | phủ (tự chạy) | đúng trong phần phủ | đúng phần dưới ngưỡng');
  for (const t of [0.5, 0.6, 0.75, 0.85, 0.9]) { const hi = hard.filter(r => r.confidence >= t), lo = hard.filter(r => r.confidence < t); lines.push(`  ≥ ${t.toFixed(2)}       | ${pct(hi.length / (hard.length || 1)).padStart(6)}        | ${pct(acc(hi)).padStart(6)}              | ${pct(acc(lo))}`); }
  lines.push('  hiệu chỉnh (bin conf → đúng thật):');
  for (const [a, b] of [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 0.95], [0.95, 1.01]]) { const xs = hard.filter(r => r.confidence >= a && r.confidence < b); if (xs.length) lines.push(`    ${a.toFixed(2)}–${Math.min(b, 1).toFixed(2)}: ${xs.length} ca, đúng ${pct(acc(xs))}, conf TB ${(xs.reduce((s, r) => s + r.confidence, 0) / xs.length).toFixed(2)}`); }
  if (name === 'intent') { const camRows = scored.filter(r => typeof r.cam === 'boolean'); const camAcc = camRows.filter(r => (r.noul >= 0.5) === r.cam).length / (camRows.length || 1); const fn = camRows.filter(r => r.cam && r.noul < 0.5).length; const fp = camRows.filter(r => !r.cam && r.noul >= 0.5).length; lines.push(`  lệnh cấm (noul ≥ 0,5): đúng ${pct(camAcc)} · bỏ lọt ${fn}/${camRows.filter(r => r.cam).length} · báo nhầm ${fp}/${camRows.filter(r => !r.cam).length}`); }
  const ms = scored.map(r => r.ms).sort((a, b) => a - b); const tok = scored.reduce((s, r) => s + (r.tokens_in || 0), 0);
  lines.push(`  thời gian TB ${Math.round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1))} ms · p95 ${ms[Math.floor(ms.length * 0.95)] || 0} ms · ${tok} token vào ≈ ${(tok * PRICE_PER_M_IN / 1e6).toFixed(5)} USD`);
  const wrong = scored.filter(r => !r.correct);
  if (wrong.length) { lines.push(`  SAI (${wrong.length}):`); for (const r of wrong.slice(0, 40)) lines.push(`    ${r.soft ? '(mềm) ' : ''}"${r.q.slice(0, 60)}" → ${r.choiceLabel} (conf ${r.confidence.toFixed(2)}) · đúng: ${r.expectedLabel}`); }
  return lines.join('\n');
};

const results = { model: MODEL, endpoint: ENDPOINT, at: new Date().toISOString(), sets: {} };
for (const name of SETS) {
  let cases = loadCases(name); if (LIMIT) cases = cases.slice(0, LIMIT);
  if (DRY) { const est = cases.reduce((s, c) => s + Math.ceil(JSON.stringify({ state: c.state, questions: c.questions }).length / 3), 0); console.log(`[dry] ${name}: ${cases.length} ca, ~${est} token vào ước tính ≈ ${(est * PRICE_PER_M_IN / 1e6).toFixed(4)} USD`); console.log('  mẫu:', JSON.stringify({ state: cases[0].state, model: MODEL, questions: cases[0].questions }).slice(0, 900)); continue; }
  const rows = await pool(cases, CONC, async c => {
    try {
      const r = await callJev({ state: c.state, model: MODEL, questions: c.questions });
      const a = r.answers[name === 'intent' ? 'y_dinh' : 'khop'];
      const choiceKey = a.choice; const choiceLabel = c.map ? c.map[choiceKey] : choiceKey;
      const correct = c.expected.includes(choiceLabel);
      return { q: c.q, expected: c.expected, expectedLabel: c.expected.join(' | '), soft: c.soft, ambiguous: c.ambiguous, injected: c.injected || [], choiceKey, choiceLabel, correct, confidence: a.confidence ?? 0, probabilities: a.probabilities, cam: c.cam, noul: r.answers.cam?.noul, model: r.model, ms: r.ms, tokens_in: r.usage?.input_tokens };
    } catch (e) { return { q: c.q, expected: c.expected, error: String(e.message || e) }; }
  });
  results.sets[name] = rows;
  console.log(summarize(name, rows));
  for (const r of rows.filter(r => r.error).slice(0, 5)) console.log('  LỖI', r.q.slice(0, 50), '→', r.error);
}
if (!DRY) { const p = here(`./data/results-${MODEL}-${results.at.replace(/[:.]/g, '-')}.json`); writeFileSync(p, JSON.stringify(results, null, 1)); console.log('\nĐã ghi', p.pathname); }
