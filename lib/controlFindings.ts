// Kiểm soát viên (K0–K1, chủ SP 22–23/10/2026): lệch dữ liệu mà bộ luật máy chủ tìm ra (cron 15 phút, không gọi AI). Admin thấy hết, bật
// "Báo người xử lý" từng luật; người xử lý / trưởng bộ phận thấy lệch của mình (luật đã bật, từ ngày luật tính), mở chứng từ để sửa;
// trưởng bộ phận, người Quản trị phân hệ, Admin chấp nhận lệch có lý do. RPC: control_overview_v1, control_findings_v1,
// control_finding_accept_v1, control_finding_reopen_v1, control_run_now_v1, control_rule_set_mode_v1, control_findings_for_doc_v1 (dải trên chứng từ).
// Migration 20261028190000 + 20261029200000 + 20261030170000.
import { supabase } from './supabase';

export type ControlSeverity = 'P0' | 'P1' | 'P2';
export type ControlStatus = 'open' | 'accepted' | 'resolved';
export interface ControlRule {
  code: string; module: string; title: string; principle: string; fixHint: string; ownerHint: string; severity: ControlSeverity;
  mode: 'shadow' | 'live' | 'off'; sinceDate: string;
  open: number; openLegacy: number; accepted: number; resolved7d: number; amountOpen: number | null;
}
export interface ControlRun { id: number; startedAt: string; finishedAt: string | null; trigger: string; rules: number; opened: number; resolved: number; openTotal: number | null; errors: Array<{ rule: string; error: string }> }
export interface ControlOverview { isAdmin: boolean; rules: ControlRule[]; lastRun: ControlRun | null }
export interface ControlFinding {
  id: string; rule: string; ruleTitle: string; module: string; severity: ControlSeverity; ownerHint: string;
  objectType: string; objectId: string | null; objectCode: string | null; projectId: string | null; projectName: string | null;
  title: string; detail: Record<string, unknown>; amount: number | null; happenedOn: string | null; link: string | null; legacy: boolean; status: ControlStatus;
  firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; acceptedAt: string | null; acceptedReason: string | null; acceptedBy: string | null;
  /** Người xử lý (tên). */ assignees: string[];
  /** Người đang xem được chấp nhận / mở lại lệch này (trưởng bộ phận, Quản trị phân hệ, Admin). */ canAccept: boolean;
  /** Quá 3 ngày chưa xử lý — đã lên trưởng bộ phận. */ escalated: boolean;
  /** Cách xử lý của luật (dải cảnh báo trên chứng từ). */ fixHint?: string;
}
export type ControlStatusFilter = ControlStatus | 'all';
export interface ControlService {
  overview: () => Promise<ControlOverview>;
  findings: (rule: string | null, status: ControlStatusFilter, legacy: boolean | null) => Promise<ControlFinding[]>;
  accept: (id: string, reason: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  runNow: () => Promise<{ rules: number; opened: number; resolved: number; errors: Array<{ rule: string; error: string }>; skipped?: boolean }>;
  setMode: (code: string, mode: ControlRule['mode']) => Promise<void>;
  /** Lệch đang mở của một chứng từ (đơn mua / đề xuất) — dải cảnh báo trên chứng từ. */
  forDoc: (doc: { poId?: string | null; requestId?: string | null }) => Promise<ControlFinding[]>;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) || 0 : 0);
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const SEV: readonly ControlSeverity[] = ['P0', 'P1', 'P2'];
const sev = (v: unknown): ControlSeverity => (SEV.includes(v as ControlSeverity) ? v as ControlSeverity : 'P2');

export const parseRule = (raw: unknown): ControlRule => {
  const o = asObj(raw);
  return { code: String(o.code ?? ''), module: String(o.module ?? ''), title: String(o.title ?? ''), principle: String(o.principle ?? ''), fixHint: String(o.fixHint ?? ''),
    ownerHint: String(o.ownerHint ?? ''), severity: sev(o.severity), mode: o.mode === 'live' || o.mode === 'off' ? o.mode : 'shadow', sinceDate: String(o.sinceDate ?? ''),
    open: num(o.open), openLegacy: num(o.openLegacy), accepted: num(o.accepted), resolved7d: num(o.resolved7d), amountOpen: numOrNull(o.amountOpen) };
};
export const parseRun = (raw: unknown): ControlRun | null => {
  const o = asObj(raw);
  if (o.id == null) return null;
  return { id: num(o.id), startedAt: String(o.startedAt ?? ''), finishedAt: str(o.finishedAt), trigger: String(o.trigger ?? ''), rules: num(o.rules), opened: num(o.opened),
    resolved: num(o.resolved), openTotal: numOrNull(o.openTotal),
    errors: (Array.isArray(o.errors) ? o.errors : []).map(asObj).map(e => ({ rule: String(e.rule ?? ''), error: String(e.error ?? '') })) };
};
export const parseFinding = (raw: unknown): ControlFinding => {
  const o = asObj(raw);
  const status = o.status === 'accepted' || o.status === 'resolved' ? o.status : 'open';
  // Chỉ nhận đường dẫn trong app (bắt đầu bằng "/"), không nhận javascript: hay URL ngoài.
  const link = str(o.link);
  return { id: String(o.id ?? ''), rule: String(o.rule ?? ''), ruleTitle: String(o.ruleTitle ?? ''), module: String(o.module ?? ''), severity: sev(o.severity), ownerHint: String(o.ownerHint ?? ''),
    objectType: String(o.objectType ?? ''), objectId: str(o.objectId), objectCode: str(o.objectCode), projectId: str(o.projectId), projectName: str(o.projectName),
    title: String(o.title ?? ''), detail: asObj(o.detail), amount: numOrNull(o.amount), happenedOn: str(o.happenedOn), link: link && /^\/[^/]/.test(link) ? link : null,
    legacy: o.legacy === true, status, firstSeenAt: String(o.firstSeenAt ?? ''), lastSeenAt: String(o.lastSeenAt ?? ''), resolvedAt: str(o.resolvedAt),
    acceptedAt: str(o.acceptedAt), acceptedReason: str(o.acceptedReason), acceptedBy: str(o.acceptedBy),
    assignees: (Array.isArray(o.assignees) ? o.assignees : []).filter((x): x is string => typeof x === 'string'), canAccept: o.canAccept === true, escalated: o.escalated === true,
    ...(str(o.fixHint) ? { fixHint: str(o.fixHint) as string } : {}) };
};

const MESSAGES: Array<[RegExp, string]> = [
  [/CONTROL_ACCEPT_DENIED/, 'Chỉ trưởng bộ phận, người Quản trị phân hệ hoặc Admin chấp nhận được lệch này.'],
  [/CONTROL_ADMIN_REQUIRED|42501/, 'Chỉ Admin làm được việc này.'],
  [/CONTROL_REASON_REQUIRED/, 'Lý do cần ít nhất 10 ký tự.'],
  [/CONTROL_FINDING_NOT_OPEN|CONTROL_FINDING_NOT_ACCEPTED|PT409/, 'Lệch này vừa đổi trạng thái — tải lại để xem bản mới.'],
];
export const controlErrorMessage = (e: unknown) => {
  const text = e instanceof Error ? e.message : typeof e === 'object' && e ? String((e as { message?: unknown }).message ?? '') : String(e ?? '');
  return MESSAGES.find(([re]) => re.test(text))?.[1] ?? 'Chưa làm được, thử lại sau.';
};
const call = async (fn: string, args: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(controlErrorMessage({ message: `${error.code ?? ''} ${error.message}` }));
  return data as unknown;
};

export const controlService: ControlService = {
  async overview() {
    const o = asObj(await call('control_overview_v1'));
    return { isAdmin: o.isAdmin === true, rules: (Array.isArray(o.rules) ? o.rules : []).map(parseRule), lastRun: parseRun(o.lastRun) };
  },
  async findings(rule, status, legacy) {
    const d = await call('control_findings_v1', { p_rule: rule, p_status: status, p_legacy: legacy, p_limit: 300 });
    return (Array.isArray(d) ? d : []).map(parseFinding);
  },
  async accept(id, reason) { await call('control_finding_accept_v1', { p_id: id, p_reason: reason }); },
  async reopen(id) { await call('control_finding_reopen_v1', { p_id: id }); },
  async setMode(code, mode) { await call('control_rule_set_mode_v1', { p_code: code, p_mode: mode }); },
  async forDoc(doc) {
    const d = await call('control_findings_for_doc_v1', { p_po_id: doc.poId || null, p_request_id: doc.requestId || null });
    return (Array.isArray(d) ? d : []).map(parseFinding);
  },
  async runNow() {
    const o = asObj(await call('control_run_now_v1', { p_rule: null }));
    return { rules: num(o.rules), opened: num(o.opened), resolved: num(o.resolved), skipped: o.skipped === true,
      errors: (Array.isArray(o.errors) ? o.errors : []).map(asObj).map(e => ({ rule: String(e.rule ?? ''), error: String(e.error ?? '') })) };
  },
};

/** Đếm cho ô số đầu tab: mới (từ ngày luật bắt đầu tính), mới mức P0, dữ liệu cũ, đã chấp nhận, tự đóng 7 ngày. */
export const controlTotals = (rules: readonly ControlRule[]) => rules.reduce((t, r) => ({
  open: t.open + r.open, p0: t.p0 + (r.severity === 'P0' ? r.open : 0), legacy: t.legacy + r.openLegacy, accepted: t.accepted + r.accepted, resolved7d: t.resolved7d + r.resolved7d,
}), { open: 0, p0: 0, legacy: 0, accepted: 0, resolved7d: 0 });
