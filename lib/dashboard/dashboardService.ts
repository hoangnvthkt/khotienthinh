import { supabase } from '../supabase';
import type { DashGap, DashNeed, DashProject, DashProjectFinance, DashboardDataset, DashboardId } from './dashboardTypes';

// Bảng điều khiển đọc một RPC (get_center_dashboard_v1): máy chủ kiểm quyền từng bảng, từng dự án và tổng hợp số.
// Không realtime: số liệu giữ trong bộ nhớ tới khi người dùng bấm Cập nhật — rời Trung tâm rồi quay lại vẫn thấy số cũ
// kèm giờ tổng hợp, không gọi lại máy chủ.

const BOARDS: readonly DashboardId[] = ['portfolio', 'cashflow', 'materials', 'debt'];
const GAPS: readonly DashGap[] = ['dates', 'gantt', 'baseline', 'coords', 'director', 'contract', 'budget', 'unclassified', 'ar_due', 'ap_due',
  'material_budget', 'material_price'];

type Row = Record<string, unknown>;
const obj = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const numOrNull = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const num = (value: unknown): number => numOrNull(value) ?? 0;

const parseAccess = (value: unknown): DashboardId[] => list(value).filter((id): id is DashboardId => BOARDS.includes(id as DashboardId));

const parseFinance = (value: unknown): DashProjectFinance | null => {
  if (!value || typeof value !== 'object') return null;
  const f = obj(value);
  const ar = obj(f.ar);
  const flow = obj(ar.flow);
  const ap = obj(f.ap);
  const rec = obj(f.records);
  const pair = (raw: unknown) => ({ total: num(obj(raw).total), paid: num(obj(raw).paid) });
  return {
    contractValue: numOrNull(f.contractValue), variation: num(f.variation), budget: numOrNull(f.budget), output: numOrNull(f.output),
    accepted: num(f.accepted), received: num(f.received), cost: num(f.cost),
    costByCategory: Object.fromEntries(Object.entries(obj(f.costByCategory)).map(([key, v]) => [key, num(v)])),
    ar: {
      requested: num(ar.requested), retention: num(ar.retention), advance: num(ar.advance), advanceRecovered: num(ar.advanceRecovered),
      outstanding: num(ar.outstanding), overdue: num(ar.overdue),
      flow: { paid: num(flow.paid), outstanding: num(flow.outstanding), retention: num(flow.retention), recovered: num(flow.recovered) },
    },
    ap: {
      requested: num(ap.requested), retention: num(ap.retention), advance: num(ap.advance), outstanding: num(ap.outstanding), overdue: num(ap.overdue),
      paid: num(ap.paid), subcontract: pair(ap.subcontract), supplier: pair(ap.supplier),
    },
    records: { arRounds: num(rec.arRounds), apDocs: num(rec.apDocs), receipts: num(rec.receipts), payments: num(rec.payments) },
  };
};

const parseProject = (value: unknown): DashProject => {
  const p = obj(value);
  const site = p.site && typeof p.site === 'object' ? obj(p.site) : null;
  const materials = p.materials && typeof p.materials === 'object' ? obj(p.materials) : null;
  const progress = (raw: unknown) => { const n = numOrNull(raw); return n == null ? null : Math.max(0, Math.min(100, n)); };
  return {
    id: text(p.id), code: text(p.code) || text(p.id), name: text(p.name) || text(p.code), status: text(p.status),
    createdAt: textOrNull(p.createdAt), director: textOrNull(p.director),
    site: site ? { name: text(site.name), address: textOrNull(site.address), lat: numOrNull(site.lat), lng: numOrNull(site.lng) } : null,
    start: textOrNull(p.start), end: textOrNull(p.end), plannedProgress: progress(p.plannedProgress), actualProgress: progress(p.actualProgress),
    updatedAt: textOrNull(p.updatedAt), finance: parseFinance(p.finance),
    materials: materials ? { budget: numOrNull(materials.budget), purchased: num(materials.purchased), imported: num(materials.imported),
      exported: num(materials.exported), estimated: num(materials.estimated) } : null,
    gaps: list(p.gaps).filter((gap): gap is DashGap => GAPS.includes(gap as DashGap)),
  };
};

export const parseDashboard = (raw: unknown): DashboardDataset => {
  const r = obj(raw);
  return {
    generatedAt: text(r.generatedAt) || new Date().toISOString(),
    today: text(r.today).slice(0, 10),
    access: parseAccess(r.access),
    projects: list(r.projects).map(parseProject).filter(project => project.id),
    months: list(r.months).map(obj).map(m => ({
      month: text(m.month).slice(0, 7), projectId: text(m.projectId), revenue: num(m.revenue), cost: num(m.cost), cashIn: num(m.cashIn),
      cashOut: num(m.cashOut), matIn: num(m.matIn), matOut: num(m.matOut),
    })),
    materialItems: list(r.materialItems).map(obj).map(m => ({
      id: text(m.id), projectId: text(m.projectId), name: text(m.name), unit: text(m.unit), budget: num(m.budget), purchased: num(m.purchased),
    })),
    needs: list(r.needs).map(obj).map((n): DashNeed => ({
      id: text(n.id), requestId: text(n.requestId) || text(n.id), code: text(n.code), title: text(n.title), kind: n.kind === 'buy' ? 'buy' : 'issue',
      material: text(n.material), unit: text(n.unit), qty: num(n.qty), neededDate: textOrNull(n.neededDate), projectId: text(n.projectId),
    })),
  };
};

const FAILED = 'Chưa tải được số liệu. Kiểm tra mạng rồi bấm Cập nhật.';

let dataCache: { userId: string; data: DashboardDataset } | null = null;
let accessCache: { userId: string; promise: Promise<DashboardId[]> } | null = null;

/** Bảng người này được xem (nhẹ) — để biết có hiện tab "Bảng điều khiển" không. */
export const fetchDashboardAccess = (userId: string): Promise<DashboardId[]> => {
  if (dataCache?.userId === userId) return Promise.resolve(dataCache.data.access);
  if (accessCache?.userId === userId) return accessCache.promise;
  const promise = Promise.resolve(supabase.rpc('get_center_dashboard_v1', { p_access_only: true })).then(({ data, error }) => {
    if (error) throw error;
    return parseAccess(obj(data).access);
  });
  accessCache = { userId, promise };
  promise.catch(() => { if (accessCache?.promise === promise) accessCache = null; });
  return promise;
};

/** Số liệu đủ 4 bảng; force = người dùng bấm Cập nhật. */
export const fetchDashboard = async (userId: string, force = false): Promise<DashboardDataset> => {
  if (!force && dataCache?.userId === userId) return dataCache.data;
  const { data, error } = await supabase.rpc('get_center_dashboard_v1');
  if (error) {
    console.warn('Center dashboard load failed:', error);
    throw new Error(FAILED);
  }
  const parsed = parseDashboard(data);
  dataCache = { userId, data: parsed };
  accessCache = { userId, promise: Promise.resolve(parsed.access) };
  return parsed;
};
