// Trợ lý · thẻ biểu đồ dùng chung (chủ SP 19/10/2026): công cụ cổng AI dựng số từ máy chủ (VD bien_dong_nhan_su), màn hình chỉ vẽ.
// Đi theo câu trả lời trong `sources` ({type:'chart'}) nên mở lại từ Lịch sử vẫn thấy. Bản app cũ bỏ qua loại nguồn lạ.
// Mỗi khung một trục (không trục kép), tối đa 2 chuỗi; số chưa biết là null → vẽ trống + ghi "chưa có số", không ghi 0.

export interface ChartStat { label: string; value: number | null; hint: string | null }
export interface ChartSeries { label: string; values: Array<number | null> }
export interface ChartPanel { title: string; kind: 'line' | 'bar'; unit: string; series: ChartSeries[] }
export interface ChartSpec {
  title: string;
  stats: ChartStat[];
  labels: string[];
  panels: ChartPanel[];
  notes: string[];
  source: string;
  link: { route: string; label: string } | null;
}

const MAX_POINTS = 24;
const MAX_SERIES = 2;
const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const arr = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Thẻ biểu đồ từ máy chủ → dạng màn hình vẽ được; hỏng (không nhãn, không khung) → null. */
export const parseChart = (raw: unknown): ChartSpec | null => {
  const o = obj(raw);
  const labels = arr(o.labels).map(l => text(l, 16)).slice(0, MAX_POINTS);
  if (!labels.length) return null;
  const panels = arr(o.panels).map(obj).flatMap((p): ChartPanel[] => {
    const series = arr(p.series).map(obj).slice(0, MAX_SERIES).map(s => ({
      label: text(s.label, 40) || 'Số liệu',
      values: labels.map((_, i) => numOrNull(arr(s.values)[i])),
    }));
    return series.length ? [{ title: text(p.title, 80), kind: p.kind === 'bar' ? 'bar' : 'line', unit: text(p.unit, 20), series }] : [];
  }).slice(0, 3);
  if (!panels.length) return null;
  const link = obj(o.link);
  const route = text(link.route, 200);
  return {
    title: text(o.title, 120) || 'Biểu đồ',
    stats: arr(o.stats).map(obj).slice(0, 4).map(s => ({ label: text(s.label, 30), value: numOrNull(s.value), hint: text(s.hint, 60) || null })).filter(s => s.label),
    labels, panels,
    notes: arr(o.notes).map(n => text(n, 200)).filter(Boolean).slice(0, 4),
    source: text(o.source, 200),
    link: route.startsWith('/') ? { route, label: text(link.label, 40) || 'Mở màn gốc' } : null,
  };
};

/** Bảng số của một khung (xem dạng bảng): mỗi nhãn một dòng; null giữ null để màn hình ghi "—". */
export const panelRows = (spec: Pick<ChartSpec, 'labels'>, panel: ChartPanel) =>
  spec.labels.map((label, i) => ({ label, values: panel.series.map(s => s.values[i] ?? null) }));

/** Khung có chuỗi nào chưa có số nào (VD nghỉ việc chưa ghi ngày) → nhãn chú thích "chưa có số". */
export const seriesMissing = (series: ChartSeries) => series.values.every(v => v == null);

/** Trục dọc khung đường: bám sát số (61→68 không bị dẹt sát trần), mốc tròn 1 / 2 / 5 / 10…, chừa một mốc trên dưới, không âm. */
export const lineAxis = (panel: ChartPanel): { domain: [number, number]; ticks: number[] } => {
  const values = panel.series.flatMap(s => s.values).filter((v): v is number => v != null);
  if (!values.length) return { domain: [0, 1], ticks: [0, 1] };
  const lo = Math.min(...values); const hi = Math.max(...values);
  const raw = Math.max(1, (hi - lo) / 3);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? 10 * pow;
  let min = Math.floor(lo / step) * step; if (min === lo) min -= step;
  let max = Math.ceil(hi / step) * step; if (max === hi) max += step;
  min = Math.max(0, min);
  const ticks: number[] = [];
  for (let t = min; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { domain: [min, max], ticks };
};
