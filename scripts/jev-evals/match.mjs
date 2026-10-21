// Chấm điểm khớp tên kiểu Vioo (port gọn từ lib/materialRequestText.ts: fold + token overlap) để lấy ứng viên top-K cho Jev.
export const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[φø∅Φ]/g, 'phi');
const STOP = new Set(['cong', 'ty', 'tnhh', 'cp', 'co', 'phan', 'cty', 'va', 'thuong', 'mai', 'dich', 'vu', 'san', 'xuat', 'xay', 'dung', 'dau', 'tu', 'tm', 'dv', 'sx', 'xd', 'kinh', 'doanh', 'tong', 'hop', 'cua', 'hang', 'viet', 'nam', 'cac', 'loai', 'cho', 'cai', 'bo']);
export const tokens = (t) => fold(t).replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/[^a-z0-9/]+/g, ' ').trim().split(/\s+/).filter(Boolean);
export const score = (query, name, { stop = false } = {}) => {
  const q = tokens(query).filter(t => !stop || !STOP.has(t)); const n = tokens(name);
  if (!q.length || !n.length) return 0;
  const nset = new Set(n); let hit = 0;
  for (const t of q) { if (nset.has(t)) hit += 1; else if (t.length >= 4 && n.some(x => x.startsWith(t) || t.startsWith(x) && x.length >= 4)) hit += 0.6; }
  const nq = q.filter(t => !stop || !STOP.has(t)).length || 1; const nn = n.filter(t => !stop || !STOP.has(t)).length || 1;
  return hit / Math.max(nq, Math.min(nn, nq + 2));
};
export const rank = (query, rows, nameOf, k = 8, opts) => rows.map(r => ({ r, s: score(query, nameOf(r), opts) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
