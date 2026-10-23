import type { DrillDown } from '../dashboard/dashboardModel';
import { FLOW_UNASSIGNED, type FlowAgeBucket, type FlowDataset, type FlowUnit, type FlowWaitingPerson } from './centerFlowService';

// Dòng chảy công việc: tính toán thuần (không React) cho tab trong Trung tâm điều hành — bố cục Sankey ba cột,
// nhãn, bảng bấm xuống, thanh cho điện thoại. Mọi số đều lấy từ vcc_flow_v1, không ước lượng.

export const OUTCOME_LABEL: Record<string, string> = {
  done: 'Đã xử lý', waiting: 'Đang chờ', returned: 'Trả lại', rejected: 'Từ chối', skipped: 'Bỏ qua bước', cancelled: 'Hủy',
};
const OUTCOME_ORDER = ['done', 'waiting', 'returned', 'rejected', 'skipped', 'cancelled'];
export const outcomeLabel = (outcome: string): string => OUTCOME_LABEL[outcome] || outcome;

export const SOURCE_LABEL: Record<string, string> = {
  wf: 'Quy trình & Đề xuất', mr: 'Đề xuất vật tư', wms_tx: 'Phiếu kho', daily_log: 'Nhật ký thi công', work_plan: 'Kế hoạch tuần',
  po: 'Đơn hàng', po_delivery: 'Đợt giao', hot: 'Mua nóng / CCDC', fin_payment: 'Đề nghị chi', fin_site_expense: 'Chi quỹ công trường',
  fin_fund_opening: 'Mở quỹ công trường', leave: 'Nghỉ phép', makeup: 'Chấm công bù', site_assignment: 'Điều động', timesheet: 'Chốt công tháng',
  profile_change: 'Hồ sơ nhân sự', office: 'Văn bản', work: 'Vioo Work', vehicle: 'Đặt xe', stock_count: 'Kiểm kê', reconciliation: 'Đối chiếu nhận hàng', control: 'Lệch cần sửa',
};
export const sourceLabel = (source: string): string => SOURCE_LABEL[source] || source;

export const AGE_LABEL: Record<FlowAgeBucket, string> = { d1: 'Dưới 1 ngày', d3: '1–3 ngày', d7: '3–7 ngày', d30: '7–30 ngày', d30p: 'Trên 30 ngày' };

const nf = new Intl.NumberFormat('vi-VN');
export const fmtInt = (n: number): string => nf.format(n);
const one = (n: number): string => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
/** 19,5 → "19,5 giờ"; từ 72 giờ → ngày; null → "—". */
export const hoursText = (hours: number | null | undefined): string => {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours >= 72) return `${one(hours / 24)} ngày`;
  return `${one(hours)} giờ`;
};
export const pctText = (pct: number | null | undefined): string => (pct == null ? '—' : `${Math.round(pct)}%`);
/** "16/06" từ ISO; số ngày tới hôm nay. */
export const ddmm = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const daysSince = (iso: string, now: Date): number => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));
};
/** "09:41" nếu hôm nay, không thì "09:41 13/10". */
export const stampText = (generatedAt: string, now: Date): string | null => {
  const at = new Date(generatedAt);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === now.toDateString() ? time : `${time} ${pad(at.getDate())}/${pad(at.getMonth() + 1)}`;
};

/** Tên ngắn cho nhãn trên sơ đồ: bỏ "Phòng " / "Bộ phận " / "Ban chỉ huy công trình "; dài quá thì cắt. */
export const shortUnitName = (name: string, max = 22): string => {
  const short = name.replace(/^(Phòng|Bộ phận|Ban chỉ huy công trình|Văn phòng)\s+/i, (m, w: string) => (w.toLowerCase() === 'văn phòng' ? 'VP ' : ''));
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
};
export const unitOf = (data: Pick<FlowDataset, 'units'>, id: string): FlowUnit | undefined => data.units.find(unit => unit.id === id);
export const unitName = (data: Pick<FlowDataset, 'units'>, id: string): string => unitOf(data, id)?.name || (id === FLOW_UNASSIGNED ? 'Chưa gắn phòng ban' : 'Phòng khác');

/** Lượt giao trong khoảng (mọi kết quả). */
export const totalLinks = (data: Pick<FlowDataset, 'links'>): number => data.links.reduce((sum, link) => sum + link.n, 0);
export const totalDaily = (data: Pick<FlowDataset, 'daily'>): number => data.daily.reduce((sum, day) => sum + day.n, 0);
export const outcomeCount = (data: Pick<FlowDataset, 'outcomes'>, outcome: string): number => data.outcomes.find(o => o.outcome === outcome)?.n ?? 0;
export const medianDoneHours = (data: Pick<FlowDataset, 'outcomes'>): number | null => data.outcomes.find(o => o.outcome === 'done')?.medHours ?? null;

// ── Sankey ba cột: Nơi phát sinh (phòng người giao) → Nơi xử lý (phòng người nhận) → Kết quả ─────────────────
export interface SankeyColors { unit: string; gap: string; done: string; waiting: string; returned: string; rejected: string; other: string; stuck: string }
export const outcomeColor = (outcome: string, colors: SankeyColors): string =>
  outcome === 'done' ? colors.done : outcome === 'waiting' ? colors.waiting : outcome === 'returned' ? colors.returned : outcome === 'rejected' ? colors.rejected : colors.other;

export interface SankeyNode {
  key: string; col: 0 | 1 | 2; id: string; label: string; sub: string; full: string; value: number;
  x: number; y: number; h: number; ly: number; small: boolean; color: string; dashed: boolean;
  /** Cột Nơi xử lý: chiều cao vạch đỏ = tỷ lệ việc đứng yên hôm nay. */
  stuckH: number; waiting: number; stuck: number;
}
export interface SankeyLink {
  key: string; col: 0 | 1; from: string; to: string; value: number; d: string; color: string; opacity: number; title: string; outcome: string | null;
  /** Đường giữa dải (để hạt chạy khi bật Chuyển động). */
  mid: string;
}
export interface SankeyLayout { width: number; height: number; nodes: SankeyNode[]; links: SankeyLink[]; nodeWidth: number; empty: boolean }

const NODE_W = 14;
const PAD = 10;
const TOP = 26;
const BOTTOM = 12;

export const sankeyLayout = (data: FlowDataset, width: number, height: number, colors: SankeyColors): SankeyLayout => {
  const out: Record<string, number> = {};
  const inn: Record<string, number> = {};
  data.links.forEach(link => { out[link.from] = (out[link.from] || 0) + link.n; inn[link.to] = (inn[link.to] || 0) + link.n; });
  const outcomes: Record<string, number> = {};
  data.unitOutcomes.forEach(row => { outcomes[row.outcome] = (outcomes[row.outcome] || 0) + row.n; });
  const waitingByUnit = Object.fromEntries(data.waiting.byUnit.map(row => [row.unit, row]));
  const col0 = Object.entries(out).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const col1 = Object.entries(inn).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const col2 = Object.entries(outcomes).filter(([, v]) => v > 0).sort((a, b) => OUTCOME_ORDER.indexOf(a[0]) - OUTCOME_ORDER.indexOf(b[0]));
  if (col0.length === 0 || col1.length === 0) return { width, height, nodes: [], links: [], nodeWidth: NODE_W, empty: true };
  const cols = [col0, col1, col2];
  const scale = Math.min(...cols.filter(c => c.length).map(c => (height - TOP - BOTTOM - PAD * (c.length - 1)) / c.reduce((s, [, v]) => s + v, 0)));
  const X = [8, (width - NODE_W) / 2, width - NODE_W - 8];
  const nodes: SankeyNode[] = [];
  const pos = new Map<string, SankeyNode>();
  cols.forEach((col, ci) => {
    let y = TOP;
    col.forEach(([id, value]) => {
      const h = Math.max(3, value * scale);
      const unit = ci < 2 ? unitOf(data, id) : undefined;
      const gap = ci < 2 && id === FLOW_UNASSIGNED;
      const name = ci === 2 ? outcomeLabel(id) : gap ? 'Chưa gắn phòng' : shortUnitName(unit?.name || 'Phòng khác');
      const w = ci === 1 ? waitingByUnit[id] : undefined;
      const sub = ci === 0 ? `${fmtInt(value)} lượt giao` : ci === 1 ? `${fmtInt(value)} nhận` : fmtInt(value);
      const node: SankeyNode = {
        key: `${ci}:${id}`, col: ci as 0 | 1 | 2, id, label: name, sub, value,
        full: ci === 2 ? outcomeLabel(id) : unitName(data, id),
        x: X[ci], y, h, ly: 0, small: h < 28,
        color: ci === 2 ? outcomeColor(id, colors) : gap ? colors.gap : colors.unit, dashed: gap,
        stuckH: w && w.n > 0 ? Math.max(3, h * Math.min(1, w.stuck / w.n)) : 0, waiting: w?.n ?? 0, stuck: w?.stuck ?? 0,
      };
      nodes.push(node); pos.set(node.key, node);
      y += h + PAD;
    });
  });
  // Nhãn: nút thấp dùng một dòng; đẩy xuống nếu đè nhãn trước (cùng cột).
  cols.forEach((col, ci) => {
    let last = -99;
    col.forEach(([id]) => {
      const node = pos.get(`${ci}:${id}`)!;
      let ly = node.small ? node.y + node.h / 2 + 4 : node.y + node.h / 2 + 1;
      ly = Math.max(ly, last + (node.small ? 15 : 30));
      node.ly = ly; last = ly;
    });
  });
  // Dải: thứ tự theo vị trí nguồn rồi đích để ít cắt nhau; độ dày = số lượt.
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  const links: SankeyLink[] = [];
  const order = (col: number, id: string) => cols[col].findIndex(([key]) => key === id);
  const add = (rows: Array<{ from: string; to: string; value: number; color: string; opacity: number; outcome: string | null; title: string }>, sc: 0 | 1) => {
    const tc = (sc + 1) as 1 | 2;
    rows.slice().sort((a, b) => (order(sc, a.from) - order(sc, b.from)) || (order(tc, a.to) - order(tc, b.to))).forEach(row => {
      const s = pos.get(`${sc}:${row.from}`); const t = pos.get(`${tc}:${row.to}`);
      if (!s || !t || row.value <= 0) return;
      const h = Math.max(1.5, row.value * scale);
      const so = outOff.get(s.key) || 0; const to = inOff.get(t.key) || 0;
      const sy0 = s.y + so; const sy1 = sy0 + h; const ty0 = t.y + to; const ty1 = ty0 + h;
      outOff.set(s.key, so + h); inOff.set(t.key, to + h);
      const sx = s.x + NODE_W; const tx = t.x; const mx = (sx + tx) / 2;
      const r = (n: number) => Math.round(n * 10) / 10;
      links.push({
        key: `${s.key}>${t.key}`, col: sc, from: row.from, to: row.to, value: row.value, color: row.color, opacity: row.opacity, outcome: row.outcome, title: row.title,
        d: `M${r(sx)},${r(sy0)} C${r(mx)},${r(sy0)} ${r(mx)},${r(ty0)} ${r(tx)},${r(ty0)} L${r(tx)},${r(ty1)} C${r(mx)},${r(ty1)} ${r(mx)},${r(sy1)} ${r(sx)},${r(sy1)} Z`,
        mid: `M${r(sx)},${r((sy0 + sy1) / 2)} C${r(mx)},${r((sy0 + sy1) / 2)} ${r(mx)},${r((ty0 + ty1) / 2)} ${r(tx)},${r((ty0 + ty1) / 2)}`,
      });
    });
  };
  add(data.links.map(link => ({
    from: link.from, to: link.to, value: link.n, color: colors.unit, opacity: 0.3, outcome: null,
    title: `${unitName(data, link.from)} → ${unitName(data, link.to)}: ${fmtInt(link.n)} lượt giao${link.medHours != null ? ` · trung vị ${hoursText(link.medHours)}` : ''}${link.waiting ? ` · ${fmtInt(link.waiting)} đang chờ` : ''}`,
  })), 0);
  add(data.unitOutcomes.map(row => ({
    from: row.unit, to: row.outcome, value: row.n, color: outcomeColor(row.outcome, colors), outcome: row.outcome,
    opacity: row.outcome === 'waiting' ? 0.75 : row.outcome === 'done' ? 0.45 : 0.55,
    title: `${unitName(data, row.unit)} → ${outcomeLabel(row.outcome)}: ${fmtInt(row.n)} lượt`,
  })), 1);
  return { width, height, nodes, links, nodeWidth: NODE_W, empty: false };
};

// ── Thanh cho điện thoại / khung hẹp: Nơi xử lý nhận bao nhiêu, hôm nay còn bao nhiêu đang chờ ──────────────
export interface UnitBar { id: string; name: string; gap: boolean; received: number; waiting: number; stuck: number; overdue: number }
export const unitBars = (data: FlowDataset): UnitBar[] => {
  const inn: Record<string, number> = {};
  data.links.forEach(link => { inn[link.to] = (inn[link.to] || 0) + link.n; });
  const waiting = Object.fromEntries(data.waiting.byUnit.map(row => [row.unit, row]));
  const ids = new Set([...Object.keys(inn), ...Object.keys(waiting)]);
  return [...ids].map(id => ({
    id, name: id === FLOW_UNASSIGNED ? 'Chưa gắn phòng ban' : unitName(data, id), gap: id === FLOW_UNASSIGNED,
    received: inn[id] || 0, waiting: waiting[id]?.n ?? 0, stuck: waiting[id]?.stuck ?? 0, overdue: waiting[id]?.overdue ?? 0,
  })).sort((a, b) => (b.waiting - a.waiting) || (b.received - a.received));
};

// ── Một phòng: số liệu cho ngăn bên phải ──────────────────────────────────────────────────────────────────
export interface UnitSummary {
  id: string; name: string; people: number | null; gap: boolean;
  waiting: number; stuck: number; overdue: number; dead: number; received: number; sent: number; internal: number;
  partners: Array<{ id: string; name: string; received: number; sent: number }>;
  outcomes: Array<{ outcome: string; n: number }>;
  holders: FlowWaitingPerson[];
}
export const unitSummary = (data: FlowDataset, id: string): UnitSummary => {
  const unit = unitOf(data, id);
  const w = data.waiting.byUnit.find(row => row.unit === id);
  const inn = data.links.filter(link => link.to === id);
  const out = data.links.filter(link => link.from === id);
  const partnerIds = new Set([...inn.map(l => l.from), ...out.map(l => l.to)].filter(p => p !== id));
  const partners = [...partnerIds].map(p => ({
    id: p, name: unitName(data, p),
    received: inn.filter(l => l.from === p).reduce((s, l) => s + l.n, 0), sent: out.filter(l => l.to === p).reduce((s, l) => s + l.n, 0),
  })).sort((a, b) => (b.received + b.sent) - (a.received + a.sent));
  return {
    id, name: unitName(data, id), people: unit ? unit.people : null, gap: id === FLOW_UNASSIGNED,
    waiting: w?.n ?? 0, stuck: w?.stuck ?? 0, overdue: w?.overdue ?? 0, dead: w?.dead ?? 0,
    received: inn.reduce((s, l) => s + l.n, 0), sent: out.reduce((s, l) => s + l.n, 0), internal: inn.filter(l => l.from === id).reduce((s, l) => s + l.n, 0),
    partners,
    outcomes: data.unitOutcomes.filter(row => row.unit === id).sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome)),
    holders: data.waiting.byPerson.filter(person => person.unitId === id),
  };
};

// ── Bảng bấm xuống (ngăn DrillDrawer của Bảng điều khiển) ─────────────────────────────────────────────────
const unitCell = (data: FlowDataset, id: string) => unitName(data, id);

export const drillWaitingByUnit = (data: FlowDataset): DrillDown => ({
  title: `${fmtInt(data.waiting.total)} việc đang chờ theo phòng`,
  subtitle: 'Phòng của người đang giữ việc. Việc chờ một vai (HR, Kế toán, Thủ kho…) ở dòng cuối.',
  columns: [{ key: 'unit', label: 'Phòng' }, { key: 'n', label: 'Đang chờ', kind: 'number' }, { key: 'stuck', label: `Đứng yên > ${data.thresholds.stuckBusinessDays} ngày`, kind: 'number' },
    { key: 'overdue', label: 'Quá hạn', kind: 'number' }, { key: 'dead', label: `Trên ${data.thresholds.deadDays} ngày`, kind: 'number' }],
  rows: [
    ...data.waiting.byUnit.map(row => ({ id: row.unit, cells: { unit: unitCell(data, row.unit), n: row.n, stuck: row.stuck, overdue: row.overdue, dead: row.dead } })),
    ...data.waiting.byRole.map(row => ({ id: `role:${row.role}`, cells: { unit: `Chờ ${row.role}`, n: row.n, stuck: row.stuck, overdue: null, dead: null } })),
  ],
  total: { n: data.waiting.total, stuck: data.waiting.stuck, overdue: data.waiting.overdue, dead: data.waiting.dead },
  hint: 'Bấm một phòng trên sơ đồ để xem người đang giữ việc.',
});

export const drillStuckByPerson = (data: FlowDataset, now: Date): DrillDown => ({
  title: `${fmtInt(data.waiting.stuck)} việc đứng yên > ${data.thresholds.stuckBusinessDays} ngày làm việc`,
  subtitle: `Người đang giữ việc (20 người nhiều nhất). ${fmtInt(data.waiting.dead)} việc đã chờ trên ${data.thresholds.deadDays} ngày; ${fmtInt(data.waiting.unassigned)} việc chưa giao người.`,
  columns: [{ key: 'name', label: 'Người' }, { key: 'unit', label: 'Phòng' }, { key: 'n', label: 'Đang giữ', kind: 'number' }, { key: 'stuck', label: 'Đứng yên', kind: 'number' },
    { key: 'overdue', label: 'Quá hạn', kind: 'number' }, { key: 'oldest', label: 'Cũ nhất (ngày)', kind: 'number' }],
  rows: data.waiting.byPerson.filter(person => person.stuck > 0).map(person => ({
    id: person.userId, cells: { name: person.name || 'Người dùng', unit: unitCell(data, person.unitId), n: person.n, stuck: person.stuck, overdue: person.overdue, oldest: daysSince(person.oldestAt, now) },
  })),
  hint: 'Nhắc và mở từng việc có ở đợt sau (PR-3).',
});

export const drillOverdue = (data: FlowDataset): DrillDown => ({
  title: `${fmtInt(data.waiting.overdue)} việc quá hạn`,
  subtitle: `Hạn theo SLA của mẫu quy trình; ${fmtInt(data.waiting.overdueByDefaultSla)} việc chưa có hạn, tính theo SLA mặc định ${data.thresholds.slaDefaultHours} giờ.`,
  columns: [{ key: 'unit', label: 'Phòng' }, { key: 'overdue', label: 'Quá hạn', kind: 'number' }, { key: 'n', label: 'Đang chờ', kind: 'number' }],
  rows: data.waiting.byUnit.filter(row => row.overdue > 0).map(row => ({ id: row.unit, cells: { unit: unitCell(data, row.unit), overdue: row.overdue, n: row.n } })),
  total: { overdue: data.waiting.overdue, n: data.waiting.total },
});

export const drillOutcomes = (data: FlowDataset): DrillDown => ({
  title: `Kết quả ${fmtInt(totalLinks(data))} lượt giao trong ${data.rangeDays} ngày`,
  subtitle: 'Trung vị = một nửa số lượt xử lý nhanh hơn con số này; trung bình bị kéo bởi vài lượt rất chậm.',
  columns: [{ key: 'outcome', label: 'Kết quả' }, { key: 'n', label: 'Lượt', kind: 'number' }, { key: 'med', label: 'Trung vị' }, { key: 'avg', label: 'Trung bình' }],
  rows: data.outcomes.slice().sort((a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome)).map(row => ({
    id: row.outcome, cells: { outcome: outcomeLabel(row.outcome), n: row.n, med: hoursText(row.medHours), avg: hoursText(row.avgHours) },
  })),
  total: { n: totalLinks(data) },
});

export const drillDaily = (data: FlowDataset): DrillDown => ({
  title: `${fmtInt(totalDaily(data))} lượt giao trong 30 ngày`,
  subtitle: 'Theo ngày giao (giờ Việt Nam).',
  columns: [{ key: 'd', label: 'Ngày', kind: 'date' }, { key: 'n', label: 'Lượt giao', kind: 'number' }],
  rows: data.daily.slice().reverse().map(day => ({ id: day.d, cells: { d: day.d, n: day.n } })),
  total: { n: totalDaily(data) },
});

export const drillKinds = (data: FlowDataset, source?: string): DrillDown => {
  const rows = data.waiting.byKind.filter(row => !source || row.source === source);
  return {
    title: source ? `${sourceLabel(source)}: việc đang chờ theo loại phiếu` : 'Việc đang chờ theo loại phiếu',
    subtitle: source ? undefined : '12 loại nhiều nhất.',
    columns: [{ key: 'name', label: 'Loại phiếu' }, { key: 'n', label: 'Đang chờ', kind: 'number' }, { key: 'stuck', label: 'Đứng yên', kind: 'number' }],
    rows: rows.map(row => ({ id: `${row.source}:${row.name}`, cells: { name: row.name, n: row.n, stuck: row.stuck } })),
    total: { n: rows.reduce((s, r) => s + r.n, 0), stuck: rows.reduce((s, r) => s + r.stuck, 0) },
  };
};

export const drillPeople = (data: FlowDataset): DrillDown => ({
  title: `Người xử lý · ${data.rangeDays} ngày`,
  subtitle: 'Lượt nhận, lượt xong, trung vị giờ từ lúc giao tới lúc xử lý, % đúng hạn (chỉ lượt có hạn), số việc đang giữ hôm nay.',
  columns: [{ key: 'name', label: 'Người' }, { key: 'unit', label: 'Phòng' }, { key: 'received', label: 'Nhận', kind: 'number' }, { key: 'done', label: 'Xong', kind: 'number' },
    { key: 'med', label: 'Trung vị' }, { key: 'onTime', label: 'Đúng hạn' }, { key: 'returned', label: 'Trả lại', kind: 'number' }, { key: 'holding', label: 'Đang giữ', kind: 'number' }],
  rows: data.people.map(person => ({
    id: person.userId,
    cells: { name: person.name || 'Người dùng', unit: unitCell(data, person.unitId), received: person.received, done: person.done, med: hoursText(person.medHours),
      onTime: pctText(person.onTimePct), returned: person.returned, holding: person.holding },
  })),
});

/** Lựa chọn trên sơ đồ / ngăn. */
export type FlowSelection =
  | { type: 'unit'; id: string }
  | { type: 'outcome'; id: string }
  | { type: 'link'; from: string; to: string }
  | { type: 'project'; id: string };

/** Hạt chạy trên dải khi bật Chuyển động: dải lớn nhất, tối đa `max` hạt; dải to chạy nhanh hơn, dải đang chờ màu cam.
 *  `points` = vị trí lấy mẫu dọc đường giữa dải (toạ độ viewBox) để làm keyframe transform — trình duyệt chỉ dịch chuyển, không vẽ lại. */
export interface FlowParticle { key: string; path: string; points: Array<[number, number]>; color: string; dur: number; begin: number }
const parseMid = (mid: string): [number, number][] | null => {
  const m = mid.match(/^M([-\d.]+),([-\d.]+) C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)$/);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]], [n[6], n[7]]];
};
export const samplePath = (mid: string, steps = 16): Array<[number, number]> => {
  const p = parseMid(mid);
  if (!p) return [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps; const u = 1 - t;
    const x = u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
    const y = u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
    out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  return out;
};
export const flowParticles = (layout: SankeyLayout, max = 20): FlowParticle[] => {
  const top = layout.links.filter(link => link.value >= 1).slice().sort((a, b) => b.value - a.value).slice(0, max);
  const biggest = Math.max(1, ...top.map(link => link.value));
  return top.map((link, index) => ({
    key: link.key, path: link.mid, points: samplePath(link.mid), color: link.color,
    dur: Math.round((7 - 4 * Math.min(1, link.value / biggest)) * 10) / 10,
    begin: Math.round(((index * 0.37) % 3) * 10) / 10,
  }));
};
