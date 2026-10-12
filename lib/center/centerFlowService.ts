import { supabase } from '../supabase';

// Dòng chảy công việc: một RPC (vcc_flow_v1) trả lượt giao trong khoảng + việc đang chờ hôm nay, đã gom theo phòng / người /
// kết quả / dự án và đã cắt theo quyền ở máy chủ. Trình duyệt chỉ vẽ và mở đúng hồ sơ. Khớp migration 20261013141500_center_flow_v1.

export type FlowRange = 7 | 30 | 90;
export type FlowScopeKind = 'company' | 'unit' | 'project';
export type FlowOutcome = 'waiting' | 'done' | 'returned' | 'rejected' | 'skipped' | 'cancelled';
export type FlowAgeBucket = 'd1' | 'd3' | 'd7' | 'd30' | 'd30p';
/** Mã phòng ảo cho người chưa gắn phòng ban (lỗ hổng dữ liệu, luôn hiện, không giấu). */
export const FLOW_UNASSIGNED = 'unassigned';

export interface FlowScope { kind: FlowScopeKind; canCompany: boolean; unitIds: string[]; projectIds: string[]; managedUnitIds: string[]; ledProjectIds: string[] }
export interface FlowThresholds { stuckBusinessDays: number; pilePerson: number; deadDays: number; unreadDays: number; slaDefaultHours: number; weekDays: number }
export interface FlowUnit { id: string; name: string; type: string; parentId: string | null; people: number; active: boolean }
export interface FlowLink { from: string; to: string; n: number; done: number; waiting: number; medHours: number | null }
export interface FlowOutcomeStat { outcome: FlowOutcome | string; n: number; avgHours: number | null; medHours: number | null }
export interface FlowUnitOutcome { unit: string; outcome: FlowOutcome | string; n: number }
export interface FlowPerson {
  userId: string; name: string | null; unitId: string; received: number; done: number; medHours: number | null;
  onTimePct: number | null; returned: number; rejected: number; holding: number;
}
export interface FlowCreator { userId: string; name: string | null; unitId: string; n: number }
export interface FlowDay { d: string; n: number }
export interface FlowWaitingUnit { unit: string; n: number; stuck: number; overdue: number; dead: number }
export interface FlowWaitingRole { role: string; n: number; stuck: number }
export interface FlowWaitingAge { bucket: FlowAgeBucket; n: number }
export interface FlowWaitingKind { name: string; source: string; n: number; stuck: number }
export interface FlowWaitingSource { source: string; module: string; n: number; stuck: number; withPerson: number }
export interface FlowWaitingPerson { userId: string; name: string | null; unitId: string; n: number; stuck: number; overdue: number; oldestAt: string; pile: boolean }
export interface FlowWaitingProject { projectId: string; n: number; stuck: number }
export interface FlowWaiting {
  total: number; stuck: number; overdue: number; overdueByDefaultSla: number; unassigned: number; dead: number;
  byUnit: FlowWaitingUnit[]; byRole: FlowWaitingRole[]; age: FlowWaitingAge[]; byKind: FlowWaitingKind[];
  bySource: FlowWaitingSource[]; byPerson: FlowWaitingPerson[]; byProject: FlowWaitingProject[];
}
export interface FlowProject {
  id: string; code: string; name: string; status: string; waiting: number; stuck: number;
  mrPending: number; mrApproved: number; mrTransit: number; mrAvgDays: number | null;
}
export interface FlowNotifications { total30: number; unread30: number; unread7d: number; people7d: number; noModule: number }
export interface FlowGaps { employeesWithoutUnit: number; employeesActive: number; assignmentsWithoutSla: number; assignments: number; unitsWithoutManager: number }

export interface FlowDataset {
  access: true;
  generatedAt: string;
  rangeDays: FlowRange;
  from: string;
  scope: FlowScope;
  thresholds: FlowThresholds;
  units: FlowUnit[];
  links: FlowLink[];
  outcomes: FlowOutcomeStat[];
  unitOutcomes: FlowUnitOutcome[];
  people: FlowPerson[];
  creators: FlowCreator[];
  daily: FlowDay[];
  waiting: FlowWaiting;
  projects: FlowProject[];
  /** Chỉ có ở phạm vi toàn công ty; null ở phạm vi phòng / dự án. */
  notifications: FlowNotifications | null;
  gaps: FlowGaps;
}
export type FlowDenied = { access: false; reason: 'no_center' | 'no_scope' | string };
export type FlowResult = FlowDataset | FlowDenied;

export interface FlowQuery { range?: FlowRange; projectId?: string | null; unitId?: string | null }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const parseWaiting = (w: Record<string, unknown>): FlowWaiting => ({
  total: num(w.total), stuck: num(w.stuck), overdue: num(w.overdue), overdueByDefaultSla: num(w.overdueByDefaultSla),
  unassigned: num(w.unassigned), dead: num(w.dead),
  byUnit: list(w.byUnit).map(x => ({ unit: str(x.unit, FLOW_UNASSIGNED), n: num(x.n), stuck: num(x.stuck), overdue: num(x.overdue), dead: num(x.dead) })),
  byRole: list(w.byRole).map(x => ({ role: str(x.role), n: num(x.n), stuck: num(x.stuck) })),
  age: list(w.age).map(x => ({ bucket: str(x.bucket) as FlowAgeBucket, n: num(x.n) })),
  byKind: list(w.byKind).map(x => ({ name: str(x.name), source: str(x.source), n: num(x.n), stuck: num(x.stuck) })),
  bySource: list(w.bySource).map(x => ({ source: str(x.source), module: str(x.module), n: num(x.n), stuck: num(x.stuck), withPerson: num(x.withPerson) })),
  byPerson: list(w.byPerson).map(x => ({
    userId: str(x.userId), name: strOrNull(x.name), unitId: str(x.unitId, FLOW_UNASSIGNED), n: num(x.n), stuck: num(x.stuck), overdue: num(x.overdue),
    oldestAt: str(x.oldestAt), pile: x.pile === true,
  })),
  byProject: list(w.byProject).map(x => ({ projectId: str(x.projectId), n: num(x.n), stuck: num(x.stuck) })),
});

/** Đọc JSON máy chủ thành kiểu chắc chắn; thiếu trường thì về rỗng / null, không bao giờ về 0 giả cho số liệu chưa biết (null giữ nguyên). */
export const parseFlowResult = (raw: unknown): FlowResult => {
  const r = obj(raw);
  if (r.access !== true) return { access: false, reason: str(r.reason, 'unknown') };
  const scope = obj(r.scope);
  const t = obj(r.thresholds);
  const rangeRaw = num(r.rangeDays);
  const notifications = r.notifications && typeof r.notifications === 'object' ? obj(r.notifications) : null;
  const gaps = obj(r.gaps);
  return {
    access: true,
    generatedAt: str(r.generatedAt),
    rangeDays: (rangeRaw === 7 || rangeRaw === 30 ? rangeRaw : 90),
    from: str(r.from),
    scope: {
      kind: (['company', 'unit', 'project'].includes(str(scope.kind)) ? str(scope.kind) : 'company') as FlowScopeKind,
      canCompany: scope.canCompany === true,
      unitIds: strList(scope.unitIds), projectIds: strList(scope.projectIds),
      managedUnitIds: strList(scope.managedUnitIds), ledProjectIds: strList(scope.ledProjectIds),
    },
    thresholds: {
      stuckBusinessDays: num(t.stuckBusinessDays) || 3, pilePerson: num(t.pilePerson) || 5, deadDays: num(t.deadDays) || 30,
      unreadDays: num(t.unreadDays) || 7, slaDefaultHours: num(t.slaDefaultHours) || 48, weekDays: num(t.weekDays) || 6,
    },
    units: list(r.units).map(u => ({ id: str(u.id), name: str(u.name), type: str(u.type), parentId: strOrNull(u.parentId), people: num(u.people), active: u.active !== false })),
    links: list(r.links).map(l => ({ from: str(l.from, FLOW_UNASSIGNED), to: str(l.to, FLOW_UNASSIGNED), n: num(l.n), done: num(l.done), waiting: num(l.waiting), medHours: numOrNull(l.medHours) })),
    outcomes: list(r.outcomes).map(o => ({ outcome: str(o.outcome), n: num(o.n), avgHours: numOrNull(o.avgHours), medHours: numOrNull(o.medHours) })),
    unitOutcomes: list(r.unitOutcomes).map(o => ({ unit: str(o.unit, FLOW_UNASSIGNED), outcome: str(o.outcome), n: num(o.n) })),
    people: list(r.people).map(p => ({
      userId: str(p.userId), name: strOrNull(p.name), unitId: str(p.unitId, FLOW_UNASSIGNED), received: num(p.received), done: num(p.done),
      medHours: numOrNull(p.medHours), onTimePct: numOrNull(p.onTimePct), returned: num(p.returned), rejected: num(p.rejected), holding: num(p.holding),
    })),
    creators: list(r.creators).map(c => ({ userId: str(c.userId), name: strOrNull(c.name), unitId: str(c.unitId, FLOW_UNASSIGNED), n: num(c.n) })),
    daily: list(r.daily).map(d => ({ d: str(d.d), n: num(d.n) })),
    waiting: parseWaiting(obj(r.waiting)),
    projects: list(r.projects).map(p => ({
      id: str(p.id), code: str(p.code), name: str(p.name), status: str(p.status), waiting: num(p.waiting), stuck: num(p.stuck),
      mrPending: num(p.mrPending), mrApproved: num(p.mrApproved), mrTransit: num(p.mrTransit), mrAvgDays: numOrNull(p.mrAvgDays),
    })),
    notifications: notifications ? {
      total30: num(notifications.total30), unread30: num(notifications.unread30), unread7d: num(notifications.unread7d),
      people7d: num(notifications.people7d), noModule: num(notifications.noModule),
    } : null,
    gaps: {
      employeesWithoutUnit: num(gaps.employeesWithoutUnit), employeesActive: num(gaps.employeesActive),
      assignmentsWithoutSla: num(gaps.assignmentsWithoutSla), assignments: num(gaps.assignments), unitsWithoutManager: num(gaps.unitsWithoutManager),
    },
  };
};

/** Lỗi 42501 từ máy chủ (lọc phòng / dự án ngoài phạm vi) → thông điệp ngắn cho giao diện. */
export const isFlowScopeDenied = (error: unknown): boolean => {
  const e = error as { code?: string; message?: string } | null;
  return !!e && (e.code === '42501' || /FLOW_SCOPE_DENIED|CENTER_ACCESS_DENIED/.test(e.message ?? ''));
};

export const fetchFlow = async (query: FlowQuery = {}): Promise<FlowResult> => {
  const { data, error } = await supabase.rpc('vcc_flow_v1', {
    p_range_days: query.range ?? 90,
    p_project_id: query.projectId ?? null,
    p_unit_id: query.unitId ?? null,
  });
  if (error) throw error;
  return parseFlowResult(data);
};

/** Kiểm nhẹ trước khi hiện tab (không tính số liệu). */
export const fetchFlowAccess = async (): Promise<{ access: boolean; scope: FlowScope | null }> => {
  const { data, error } = await supabase.rpc('vcc_flow_v1', { p_range_days: 90, p_project_id: null, p_unit_id: null, p_access_only: true });
  if (error) throw error;
  const r = obj(data);
  if (r.access !== true) return { access: false, scope: null };
  const parsed = parseFlowResult({ ...r, waiting: {}, gaps: {}, thresholds: {} });
  return { access: true, scope: parsed.access ? parsed.scope : null };
};
