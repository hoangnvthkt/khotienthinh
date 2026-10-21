// Công trường 3D: đọc JSON của vcc_site3d_v1 (migration 20261017220000) thành số liệu cho cảnh 3D.
// Ngày quy về "số ngày từ D0" (đầu tháng của mốc sớm nhất) để cảnh nội suy % theo thanh thời gian.

export type MachineKind = 'crane' | 'excavator' | 'roller' | 'dozer' | 'rammer' | 'truck' | 'pilepress' | 'bender';

/** [wbs, wbs cha, tên, % hiện tại, KH bắt đầu, KH kết thúc, TT bắt đầu, TT kết thúc, khối lượng BOQ, đơn vị] — ngày là số ngày từ D0. */
export type SceneTask = [string, string | null, string, number, number | null, number | null, number | null, number | null, number | null, string | null];
/** [ngày, số người, trạng thái, máy [[loại, tên, số]], tổ [[việc, số người]]] */
export type SceneLog = [number, number, string, [MachineKind, string, number][], [string, number][]];

export interface SceneData {
  /** D0 (UTC ms, 00:00). */
  startMs: number;
  /** Hôm nay (giờ Việt Nam) tính từ D0. */
  today: number;
  tasks: SceneTask[];
  series: Record<string, [number, number][]>;
  logs: SceneLog[];
  stock: [string, string, number][];
}

export interface Site3dProject { id: string; code: string; name: string }
export type Site3dAccess = { access: true; canManage: boolean; projects: Site3dProject[] } | { access: false; reason: string };
export type Site3dResult =
  | { access: true; canManage: boolean; project: Site3dProject; data: SceneData }
  | { access: true; canManage: boolean; project: null; reason: 'not_found' }
  | { access: false; reason: string };

const DAY = 86_400_000;
const isoMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
};
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** Một dòng máy trong nhật ký có thể ghi nhiều loại ("Máy xúc, máy uốn thép…, ô tô") → đủ các loại có trong dòng. */
export function machineKinds(type: string, name: string): MachineKind[] {
  const s = `${type} ${name}`.toLowerCase();
  const out: MachineKind[] = [];
  if (/ép cọc/.test(s)) out.push('pilepress');
  if (/cẩu|kato|^cau\b|\bcau\b/.test(s)) out.push('crane');
  if (/maylu|máy lu/.test(s)) out.push('roller');
  if (/ủi/.test(s)) out.push('dozer');
  if (/đầm|damcoc/.test(s)) out.push('rammer');
  if (/(ototai|ô tô|xe tải|ô tải)/.test(s) && !/bồn/.test(s)) out.push('truck');
  if (/xúc|xuc|tc01/.test(s)) out.push('excavator');
  if (/uốn|cắt (thép|sắt)/.test(s)) out.push('bender');
  return [...new Set(out)];
}

/** Hôm nay theo giờ Việt Nam (UTC+7), dạng UTC 00:00. */
const vnToday = (now: Date): number => { const t = now.getTime() + 7 * 3_600_000; return t - (t % DAY); };

export function parseSceneData(raw: Record<string, unknown>, now = new Date()): SceneData {
  const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks as unknown[][] : [];
  const logsRaw = Array.isArray(raw.logs) ? raw.logs as unknown[][] : [];
  const seriesRaw = raw.series && typeof raw.series === 'object' ? raw.series as Record<string, unknown[][]> : {};
  const todayMs = isoMs(raw.today) ?? vnToday(now);
  // D0 = đầu tháng của mốc sớm nhất (KH / TT bắt đầu, nhật ký); không có mốc thì 90 ngày trước hôm nay.
  let first = Infinity;
  for (const t of tasksRaw) for (const v of [t[4], t[6]]) { const ms = isoMs(v); if (ms != null && ms < first) first = ms; }
  for (const l of logsRaw) { const ms = isoMs(l[0]); if (ms != null && ms < first) first = ms; }
  if (!Number.isFinite(first) || first > todayMs) first = todayMs - 90 * DAY;
  const f = new Date(first);
  const startMs = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1);
  const day = (value: unknown): number | null => { const ms = isoMs(value); return ms == null ? null : Math.round((ms - startMs) / DAY); };

  const tasks: SceneTask[] = tasksRaw.filter(t => Array.isArray(t) && typeof t[0] === 'string').map(t => [
    str(t[0]), t[1] == null ? null : str(t[1]), str(t[2]).replace(/\s+/g, ' ').trim(), num(t[3]) ?? 0,
    day(t[4]), day(t[5]), day(t[6]), day(t[7]), num(t[8]), t[9] == null || t[9] === '' ? null : str(t[9]),
  ]);
  const series: Record<string, [number, number][]> = {};
  for (const [wbs, pts] of Object.entries(seriesRaw)) {
    if (!Array.isArray(pts)) continue;
    const list = pts.map(p => [day(p?.[0]), num(p?.[1])] as const).filter((p): p is readonly [number, number] => p[0] != null && p[1] != null).map(([d, p]) => [d, p] as [number, number]);
    if (list.length) series[wbs] = list;
  }
  const logs: SceneLog[] = logsRaw.map(l => {
    const d = day(l[0]); if (d == null) return null;
    const machines = (Array.isArray(l[3]) ? l[3] as unknown[][] : []).flatMap(m => machineKinds(str(m?.[1]), str(m?.[0])).map(kind => [kind, str(m?.[0]).trim(), num(m?.[2]) ?? 1] as [MachineKind, string, number]));
    const labor = (Array.isArray(l[4]) ? l[4] as unknown[][] : []).map(x => [str(x?.[0]).trim(), num(x?.[1]) ?? 0] as [string, number]);
    const workers = num(l[1]) ?? 0;
    return workers > 0 || machines.length || labor.length ? [d, workers, str(l[2]), machines, labor] as SceneLog : null;
  }).filter((l): l is SceneLog => l !== null).sort((a, b) => a[0] - b[0]);
  const stock = (Array.isArray(raw.stock) ? raw.stock as unknown[][] : []).map(s => [str(s?.[0]).replace(/\s+/g, ' ').trim(), str(s?.[1]), num(s?.[2]) ?? 0] as [string, string, number]);
  return { startMs, today: Math.round((todayMs - startMs) / DAY), tasks, series, logs, stock };
}

const parseProject = (raw: unknown): Site3dProject | null => {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.code === 'string' ? { id: p.id, code: p.code, name: str(p.name) || p.code } : null;
};

export function parseSite3dAccess(raw: unknown): Site3dAccess {
  if (!raw || typeof raw !== 'object') return { access: false, reason: 'unknown' };
  const r = raw as Record<string, unknown>;
  if (r.access !== true) return { access: false, reason: str(r.reason) || 'unknown' };
  return { access: true, canManage: r.canManage === true, projects: (Array.isArray(r.projects) ? r.projects : []).map(parseProject).filter((p): p is Site3dProject => p !== null) };
}

export function parseSite3dResult(raw: unknown, now = new Date()): Site3dResult {
  if (!raw || typeof raw !== 'object') return { access: false, reason: 'unknown' };
  const r = raw as Record<string, unknown>;
  if (r.access !== true) return { access: false, reason: str(r.reason) || 'unknown' };
  const project = parseProject(r.project);
  if (!project) return { access: true, canManage: r.canManage === true, project: null, reason: 'not_found' };
  return { access: true, canManage: r.canManage === true, project, data: parseSceneData(r, now) };
}
