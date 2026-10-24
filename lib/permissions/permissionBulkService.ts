import { supabase } from '../supabase';
import { listPermissionAdminCatalog } from './permissionCatalogService';
import type { PermissionAdminCatalog } from './permissionTypes';
import { toSodPreview, type SodAcknowledgement, type SodWarning } from './sodService';

// Trung tâm phân quyền bước 3: Hàng loạt, Sao chép, Nhật ký. Máy chủ lưu từng người qua đường lưu quyền chuẩn
// (kiêm nhiệm, hạn, nhật ký); ở đây chia lô nhỏ để mỗi lần gọi dưới statement_timeout 8 s.

export type BulkAction =
  | { kind: 'template'; templateCode: string; options: string[] }
  | { kind: 'option'; optionKey: string; on: boolean }
  | { kind: 'extend'; withinDays: number }
  | { kind: 'add'; permissionCode: string; scopeType: string };

export interface BulkPreviewRow {
  userId: string;
  name: string;
  fromTemplate: string | null;
  toTemplate: string | null;
  skip: boolean;
  note: string | null;
  add: number;
  remove: number;
  extended: number;
  warnings: SodWarning[];
}

export interface BulkResultRow { userId: string; name: string; note?: string; error?: string; added?: number; removed?: number; extended?: number; rooms?: number }

export interface BulkApplyResult { done: BulkResultRow[]; failed: BulkResultRow[]; skipped: BulkResultRow[] }

export interface CopyWhat { template: boolean; extra: boolean; warehouses: boolean; room: boolean }

export interface CopyPreviewRow {
  userId: string;
  name: string;
  lines: { text: string; tone: 'ok' | 'warn' | 'muted' }[];
  warnings: SodWarning[];
}

export type AuditKind = 'template' | 'change' | 'sod' | 'room' | 'role' | 'account';

export interface AuditRow {
  id: string;
  at: string;
  eventType: string;
  kind: AuditKind;
  actor: string;
  target: string | null;
  reason: string;
  before: number | null;
  after: number | null;
  added: number | null;
  removed: number | null;
  template: string | null;
  rule: string | null;
  controlOwner: string | null;
  until: string | null;
  room: string | null;
  project: string | null;
}

export interface ExpiryOverview { nextExpiry: string | null; within30: number; within90: number }

/** Quyền cấp riêng được cho cả nhóm (phạm vi toàn công ty hoặc "của mình"; theo dự án / kho cấp ở Chỉnh chi tiết). */
export interface GrantableItem { code: string; label: string; module: string; scopeType: 'global' | 'own'; sensitive: boolean; search: string }

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export const toGrantableItems = (catalog: PermissionAdminCatalog): GrantableItem[] => catalog.applications.flatMap(application =>
  application.modules.flatMap(module => module.actions.flatMap(action => {
    if (!action.directGrantAllowed) return [];
    const scopeType = action.scopeTypes.includes('global') ? 'global' : action.scopeTypes.includes('own') ? 'own' : null;
    if (!scopeType) return [];
    const moduleLabel = module.label || application.label;
    return [{ code: action.permissionCode, label: action.label, module: moduleLabel, scopeType, sensitive: action.riskLevel === 'sensitive',
      search: normalize(`${application.label} ${moduleLabel} ${action.label} ${action.permissionCode}`) } as GrantableItem];
  })));

export const searchGrantable = (items: readonly GrantableItem[], query: string, limit = 40): GrantableItem[] => {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return (words.length ? items.filter(item => words.every(word => item.search.includes(word))) : items).slice(0, limit);
};

export const BULK_PREVIEW_CHUNK = 15;
export const BULK_APPLY_CHUNK = 10;
export const COPY_PREVIEW_CHUNK = 8;
export const COPY_APPLY_CHUNK = 5;
export const AUDIT_PAGE = 100;

export const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

const toAck = (ack: SodAcknowledgement | null) => (ack ? {
  reason: ack.reason.trim(),
  controlOwnerUserId: ack.controlOwnerUserId,
  compensatingControls: ack.compensatingControls.trim(),
  expiresAt: ack.expiresAt,
} : null);

const warningsOf = (value: unknown): SodWarning[] => toSodPreview({ warnings: value }).warnings;
const num = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));
const rowsOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const resultRow = (row: any): BulkResultRow => ({
  userId: String(row.userId), name: String(row.name || ''), note: row.note ?? undefined, error: row.error ?? undefined,
  added: num(row.added) ?? undefined, removed: num(row.removed) ?? undefined, extended: num(row.extended) ?? undefined, rooms: num(row.rooms) ?? undefined,
});

export const toBulkPreviewRows = (raw: unknown): BulkPreviewRow[] => rowsOf((raw as any)?.rows).map(row => ({
  userId: String(row.userId),
  name: String(row.name || ''),
  fromTemplate: row.fromTemplate ?? null,
  toTemplate: row.toTemplate ?? null,
  skip: Boolean(row.skip),
  note: row.note ?? null,
  add: Number(row.add || 0),
  remove: Number(row.remove || 0),
  extended: Number(row.extended || 0),
  warnings: warningsOf(row.warnings),
}));

export const toCopyPreviewRows = (raw: unknown): CopyPreviewRow[] => rowsOf((raw as any)?.rows).map(row => ({
  userId: String(row.userId),
  name: String(row.name || ''),
  lines: rowsOf(row.lines).map(line => ({ text: String(line.text || ''), tone: line.tone === 'warn' || line.tone === 'muted' ? line.tone : 'ok' })),
  warnings: warningsOf(row.warnings),
}));

export const toAuditRows = (raw: unknown): AuditRow[] => rowsOf((raw as any)?.rows).map(row => ({
  id: String(row.id),
  at: String(row.at),
  eventType: String(row.eventType || ''),
  kind: (['template', 'change', 'sod', 'room', 'role', 'account'].includes(row.kind) ? row.kind : 'change') as AuditKind,
  actor: String(row.actor || 'Hệ thống'),
  target: row.target ?? null,
  reason: String(row.reason || ''),
  before: num(row.before),
  after: num(row.after),
  added: num(row.added),
  removed: num(row.removed),
  template: row.template ?? null,
  rule: row.rule ?? null,
  controlOwner: row.controlOwner ?? null,
  until: row.until ?? null,
  room: row.room ?? null,
  project: row.project ?? null,
}));

const mergeResults = (parts: readonly BulkApplyResult[]): BulkApplyResult => ({
  done: parts.flatMap(part => part.done),
  failed: parts.flatMap(part => part.failed),
  skipped: parts.flatMap(part => part.skipped),
});

const toApplyResult = (raw: any): BulkApplyResult => ({
  done: rowsOf(raw?.done).map(resultRow),
  failed: rowsOf(raw?.failed).map(resultRow),
  skipped: rowsOf(raw?.skipped).map(resultRow),
});

const viDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Một dòng nhật ký bằng lời thường (sau tên người làm). */
export const auditText = (row: AuditRow): string => {
  const who = row.target || 'một người';
  const counts = row.before !== null && row.after !== null && row.before !== row.after ? ` (${row.before} → ${row.after} quyền)` : '';
  switch (row.eventType) {
    case 'user_template_assignment_saved': {
      const delta = [row.added ? `thêm ${row.added}` : '', row.removed ? `gỡ ${row.removed}` : ''].filter(Boolean).join(', ');
      return `gắn mẫu ${row.template || 'theo vị trí'} cho ${who}${delta ? ` (${delta})` : ''}`;
    }
    case 'user_template_assignment_removed': return `bỏ mẫu theo vị trí của ${who}`;
    case 'basic_template_reapplied_20261023': return `áp lại mẫu Nhân viên cơ bản cho ${who}`;
    case 'sod_existing_conflict_acknowledged':
      return `ghi nhận kiêm nhiệm ${row.rule || ''} của ${who}${row.controlOwner ? `, ${row.controlOwner} kiểm soát` : ''}${row.until ? ` đến ${viDate(row.until)}` : ''}`.replace(/\s+/g, ' ');
    case 'replace_project_permission_room_members': return `đổi thành viên Room ${row.room || ''}${row.project ? ` — ${row.project}` : ''}`.replace(/\s+/g, ' ');
    case 'upsert_project_staff_assignment': return `xếp ${who} vào dự án${row.project ? ` ${row.project}` : ''}`;
    case 'remove_project_staff_assignment':
    case 'end_project_staff_assignment':
    case 'project_room_member_departed': return `đưa ${who} rời dự án${row.project ? ` ${row.project}` : ''}`;
    case 'business_role_assigned': return `cấp vai trò đặc biệt cho ${who}`;
    case 'business_role_revoked': return `gỡ vai trò đặc biệt của ${who}`;
    case 'account_disabled_db_applied': return `khóa tài khoản ${who}`;
    case 'account_reactivated':
    case 'account_reactivated_zero_rights': return `mở lại tài khoản ${who}`;
    case 'work_pilot_access_granted': return `cấp Vioo Work thí điểm cho ${who}`;
    case 'work_pilot_access_revoked': return `gỡ Vioo Work thí điểm của ${who}`;
    case 'dead_system_grants_revoked': return `thu hồi quyền hệ thống không còn dùng của ${who}`;
    default: return `đổi quyền của ${who}${counts}`;
  }
};

export const AUDIT_KIND_LABEL: Record<AuditKind, string> = {
  template: 'Gắn mẫu', change: 'Đổi quyền', sod: 'Kiêm nhiệm', room: 'Room dự án', role: 'Vai trò', account: 'Tài khoản',
};

const GENERIC_REASONS = new Set(['lý do thay đổi', 'preview thay đổi grant mới', 'chỉnh sửa & phân quyền.', 'chỉnh sửa & phân quyền']);

/** Lý do không giải thích được vì sao đổi quyền (tên ảnh chụp, gõ lặp, email, tên người…). Room không bắt lý do. */
export const isUnclearReason = (row: Pick<AuditRow, 'reason' | 'kind' | 'target'>): boolean => {
  if (row.kind === 'room') return false;
  const reason = row.reason.trim();
  if (!reason) return true;
  const lower = reason.toLowerCase();
  if (GENERIC_REASONS.has(lower)) return true;
  if (/^screenshot\b|\.(png|jpe?g|heic|ifc|pdf|xlsx?|docx?)$/i.test(reason)) return true;
  if (/^\S+@\S+\.\S+$/.test(reason) || /^claude-[\w.-]+$/i.test(reason)) return true;
  if (/^(.{1,4}?)\1{2,}$/i.test(reason.replace(/\s+/g, ''))) return true;
  if (row.target && lower === row.target.trim().toLowerCase()) return true;
  return reason.replace(/[^\p{L}]/gu, '').length < 6;
};

export const permissionBulkService = {
  async grantableCatalog(): Promise<GrantableItem[]> {
    return toGrantableItems(await listPermissionAdminCatalog());
  },

  async previewBulk(userIds: readonly string[], action: BulkAction): Promise<BulkPreviewRow[]> {
    const parts = await Promise.all(chunk(userIds, BULK_PREVIEW_CHUNK).map(async ids => {
      const { data, error } = await supabase.rpc('preview_bulk_permission_change_v1', { p_user_ids: ids, p_action: action });
      if (error) throw error;
      return toBulkPreviewRows(data);
    }));
    return parts.flat().sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  },

  /** Áp theo lô, báo tiến độ; lô lỗi mạng thì dừng và trả phần đã xong. */
  async applyBulk(userIds: readonly string[], action: BulkAction, reason: string, ack: SodAcknowledgement | null,
    onProgress?: (done: number, total: number) => void): Promise<BulkApplyResult> {
    const parts: BulkApplyResult[] = [];
    let processed = 0;
    for (const ids of chunk(userIds, BULK_APPLY_CHUNK)) {
      const { data, error } = await supabase.rpc('apply_bulk_permission_change_v1', {
        p_user_ids: ids, p_action: action, p_reason: reason, p_ack: toAck(ack),
      });
      if (error) {
        if (!parts.length) throw error;
        parts.push({ done: [], skipped: [], failed: ids.map(userId => ({ userId, name: '', error: 'Chưa gửi được — thử lại' })) });
        break;
      }
      parts.push(toApplyResult(data));
      processed += ids.length;
      onProgress?.(processed, userIds.length);
    }
    return mergeResults(parts);
  },

  async previewCopy(fromUserId: string, toUserIds: readonly string[], what: CopyWhat): Promise<CopyPreviewRow[]> {
    const parts = await Promise.all(chunk(toUserIds, COPY_PREVIEW_CHUNK).map(async ids => {
      const { data, error } = await supabase.rpc('preview_copy_permissions_v1', { p_from: fromUserId, p_to: ids, p_what: what });
      if (error) throw error;
      return toCopyPreviewRows(data);
    }));
    return parts.flat().sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  },

  async applyCopy(fromUserId: string, toUserIds: readonly string[], what: CopyWhat, reason: string, ack: SodAcknowledgement | null,
    onProgress?: (done: number, total: number) => void): Promise<BulkApplyResult> {
    const parts: BulkApplyResult[] = [];
    let processed = 0;
    for (const ids of chunk(toUserIds, COPY_APPLY_CHUNK)) {
      const { data, error } = await supabase.rpc('apply_copy_permissions_v1', {
        p_from: fromUserId, p_to: ids, p_what: what, p_reason: reason, p_ack: toAck(ack),
      });
      if (error) {
        if (!parts.length) throw error;
        parts.push({ done: [], skipped: [], failed: ids.map(userId => ({ userId, name: '', error: 'Chưa gửi được — thử lại' })) });
        break;
      }
      parts.push(toApplyResult(data));
      processed += ids.length;
      onProgress?.(processed, toUserIds.length);
    }
    return mergeResults(parts);
  },

  async listAudit(before?: string | null): Promise<AuditRow[]> {
    const { data, error } = await supabase.rpc('list_permission_audit_v1', { p_limit: AUDIT_PAGE, p_before: before || null });
    if (error) throw error;
    return toAuditRows(data);
  },

  async expiryOverview(): Promise<ExpiryOverview> {
    const { data, error } = await supabase.rpc('get_permission_expiry_overview_v1');
    if (error) throw error;
    const row = (data || {}) as Record<string, unknown>;
    return { nextExpiry: (row.nextExpiry as string) || null, within30: Number(row.within30 || 0), within90: Number(row.within90 || 0) };
  },
};
