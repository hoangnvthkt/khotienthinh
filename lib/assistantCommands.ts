// Trợ lý v2 · T2a — lệnh nháp (chủ SP duyệt 18/10/2026). Trợ lý chỉ CHUẨN BỊ (cổng AI ghi assistant_commands + hiện thẻ);
// người dùng bấm Xác nhận trên thẻ → màn hình gọi ĐÚNG lệnh gửi của module (như form thường) → ghi biên nhận.
// AI không có đường nào tự gửi: lệnh gửi chỉ chạy ở đây, bằng phiên người dùng, khi họ bấm nút.
// T2b đề xuất vật tư: thẻ không gửi thẳng — mở form Đề xuất thật của dự án (Gõ nhanh điền sẵn), form lưu xong mới ghi biên nhận.
import { supabase } from './supabase';
import { leaveService, type LeaveSession } from './leaveService';

export type CommandKind = 'leave_request' | 'material_request';
export type CommandStatus = 'prepared' | 'done' | 'cancelled' | 'failed';

export interface AssistantCommand {
  id: string;
  kind: CommandKind;
  status: CommandStatus;
  title: string;
  payload: Record<string, unknown>;
  preview: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** Thẻ nháp cũ hơn 24 giờ thì không gửi từ thẻ nữa (số liệu có thể đã đổi) — hỏi lại Trợ lý để chuẩn bị lại. */
export const COMMAND_TTL_MS = 24 * 3_600_000;

const KINDS: ReadonlySet<string> = new Set(['leave_request', 'material_request']);
const STATUSES: ReadonlySet<string> = new Set(['prepared', 'done', 'cancelled', 'failed']);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const parseCommand = (raw: unknown): AssistantCommand | null => {
  const o = obj(raw);
  if (!str(o.id) || !KINDS.has(str(o.kind))) return null;
  return {
    id: str(o.id), kind: o.kind as CommandKind, status: (STATUSES.has(str(o.status)) ? o.status : 'prepared') as CommandStatus,
    title: str(o.title) || 'Lệnh nháp', payload: obj(o.payload), preview: obj(o.preview), result: obj(o.result),
    error: str(o.error) || null, createdAt: str(o.createdAt), confirmedAt: str(o.confirmedAt) || null,
  };
};
export const parseCommands = (raw: unknown): AssistantCommand[] => (Array.isArray(raw) ? raw : []).map(parseCommand).filter((c): c is AssistantCommand => Boolean(c));

export const isCommandExpired = (command: Pick<AssistantCommand, 'status' | 'createdAt'>, now: Date) => {
  const at = new Date(command.createdAt).getTime();
  return command.status === 'prepared' && Number.isFinite(at) && now.getTime() - at > COMMAND_TTL_MS;
};

// ── Nghỉ phép của tôi ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface LeaveCommandView {
  typeName: string;
  start: string; end: string; startSession: LeaveSession; endSession: LeaveSession;
  reason: string;
  requiresAttachment: boolean;
  days: number | null;
  annualRemaining: number | null;
  steps: Array<{ label: string; name: string | null }>;
  problems: string[];
}
const SESSIONS: ReadonlySet<string> = new Set(['full', 'morning', 'afternoon']);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const leaveView = (command: AssistantCommand): LeaveCommandView => {
  const p = command.payload; const pv = command.preview;
  const session = (v: unknown): LeaveSession => (SESSIONS.has(str(v)) ? v as LeaveSession : 'full');
  return {
    typeName: str(p.typeName) || str(p.type), start: str(p.start), end: str(p.end) || str(p.start),
    startSession: session(p.startSession), endSession: session(p.endSession), reason: str(p.reason), requiresAttachment: p.requiresAttachment === true,
    days: num(pv.days), annualRemaining: num(pv.annualRemaining),
    steps: (Array.isArray(pv.steps) ? pv.steps : []).map(obj).map(s => ({ label: str(s.label) || 'Duyệt', name: str(s.name) || null })),
    problems: (Array.isArray(pv.problems) ? pv.problems : []).filter((x): x is string => typeof x === 'string' && Boolean(x)),
  };
};

const SESSION_LABEL: Record<LeaveSession, string> = { full: 'cả ngày', morning: 'buổi sáng', afternoon: 'buổi chiều' };
const ddmm = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);
/** "21/10 cả ngày" hoặc "21/10 buổi chiều → 22/10 buổi sáng". */
export const leaveRangeLabel = (v: Pick<LeaveCommandView, 'start' | 'end' | 'startSession' | 'endSession'>) =>
  v.start === v.end ? `${ddmm(v.start)} ${SESSION_LABEL[v.startSession]}`
    : `${ddmm(v.start)}${v.startSession === 'full' ? '' : ` ${SESSION_LABEL[v.startSession]}`} → ${ddmm(v.end)}${v.endSession === 'full' ? '' : ` ${SESSION_LABEL[v.endSession]}`}`;

/** Người dùng bấm "Gửi đơn": gọi đúng lệnh gửi của module Nghỉ phép (như form thường) rồi ghi biên nhận. */
export const executeCommand = async (command: AssistantCommand, edits: { reason?: string }): Promise<Record<string, unknown>> => {
  if (command.kind === 'leave_request') {
    const v = leaveView(command);
    const row = await leaveService.submit({ type: str(command.payload.type), start: v.start, end: v.end, startSession: v.startSession, endSession: v.endSession,
      minutes: null, subtype: null, reason: (edits.reason ?? v.reason).trim() });
    return { code: row?.code || null, id: row?.id || null, route: '/hrm/leave' };
  }
  throw new Error('Lệnh này chưa hỗ trợ.');
};

// ── Đề xuất vật tư (T2b) ──────────────────────────────────────────────────────────────────────────────────────────────
export interface MrDraftLine { name: string; spec: string | null; qty: number | null; unit: string | null; note: string | null }
export interface MrCommandView {
  projectId: string; projectCode: string; projectName: string; siteId: string | null;
  title: string; purpose: string; neededDate: string | null; lines: MrDraftLine[];
}
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export const mrView = (command: AssistantCommand): MrCommandView => {
  const p = command.payload;
  return {
    projectId: str(p.projectId), projectCode: str(p.projectCode), projectName: str(p.projectName), siteId: str(p.siteId) || null,
    title: str(p.title), purpose: str(p.purpose), neededDate: /^\d{4}-\d{2}-\d{2}$/.test(str(p.neededDate)) ? str(p.neededDate) : null,
    lines: (Array.isArray(p.lines) ? p.lines : []).map(obj).filter(l => str(l.name))
      .map(l => ({ name: str(l.name), spec: str(l.spec) || null, qty: numOrNull(l.qty), unit: str(l.unit) || null, note: str(l.note) || null })),
  };
};
/** Màn Đề xuất vật tư của dự án; form tự mở lệnh nháp theo ?assistantDraft=. */
export const mrDraftRoute = (command: AssistantCommand) => {
  const v = mrView(command);
  const q = new URLSearchParams({ projectId: v.projectId, tab: 'material', materialTab: 'request', assistantDraft: command.id });
  if (v.siteId) q.set('siteId', v.siteId);
  return `/da?${q.toString()}`;
};
export const mrRequestRoute = (command: AssistantCommand) => {
  const v = mrView(command);
  const id = typeof command.result.id === 'string' ? command.result.id : '';
  return `/da?${new URLSearchParams({ projectId: v.projectId, tab: 'material', materialTab: 'request', ...(id ? { requestId: id } : {}) }).toString()}`;
};

export const getCommand = async (id: string): Promise<AssistantCommand | null> => {
  const { data, error } = await supabase.rpc('assistant_command_get_v1', { p_id: id });
  if (error) throw error;
  return parseCommand(data);
};

// Thẻ trong khung chat và form ở tab khác cùng trang: form lưu xong báo để thẻ đổi thành biên nhận ngay.
const CHANGED = 'vioo:assistant-command';
export const notifyCommandChanged = (command: AssistantCommand) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AssistantCommand>(CHANGED, { detail: command }));
};
export const onCommandChanged = (id: string, listener: (command: AssistantCommand) => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const handle = (event: Event) => { const c = (event as CustomEvent<AssistantCommand>).detail; if (c?.id === id) listener(c); };
  window.addEventListener(CHANGED, handle);
  return () => window.removeEventListener(CHANGED, handle);
};

export const finishCommand = async (id: string, status: Exclude<CommandStatus, 'prepared'>, result: Record<string, unknown> = {}, error: string | null = null): Promise<AssistantCommand | null> => {
  const { data, error: rpcError } = await supabase.rpc('assistant_command_finish_v1', { p_id: id, p_status: status, p_result: result, p_error: error });
  if (rpcError) throw rpcError;
  return parseCommand(data);
};
