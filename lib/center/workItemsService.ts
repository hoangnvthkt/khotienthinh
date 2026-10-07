import { civilOf } from './civilDate';
import { supabase } from '../supabase';
import type { CenterModuleKey } from './centerRegistry';

// "Việc của tôi": một RPC gom việc từ phân công thật của từng module (vcc_my_work_items_v1).
// Máy chủ đã lọc theo quyền; trình duyệt chỉ nhóm, sắp xếp và mở đúng hồ sơ.

export type InboxTab = 'mine' | 'sent' | 'watch';

export type WorkItemSource =
  | 'rq' | 'mr' | 'wms_tx' | 'daily_log' | 'daily_slip' | 'work_plan' | 'po' | 'po_delivery' | 'hot'
  | 'fin_payment' | 'fin_site_expense' | 'fin_fund_opening' | 'leave' | 'makeup' | 'site_assignment'
  | 'timesheet' | 'profile_change' | 'office' | 'work' | 'vehicle' | 'stock_count' | 'reconciliation' | 'wf' | 'safety';

/** approve: duyệt · do: làm / sửa · confirm: xác nhận · read: đọc & xác nhận · wait: tôi gửi, chờ người khác · watch: theo dõi */
export type WorkItemKind = 'approve' | 'do' | 'confirm' | 'read' | 'wait' | 'watch';

export interface WorkItem {
  source: WorkItemSource;
  module: CenterModuleKey;
  kind: WorkItemKind;
  id: string;
  code: string;
  title: string;
  who: string | null;
  whoId: string | null;
  meta: string | null;
  dueAt: string | null;
  status: string | null;
  ref: Record<string, unknown>;
}

export interface WorkItemsPage {
  tab: InboxTab;
  generatedAt: string;
  total: number;
  truncatedSources: string[];
  items: WorkItem[];
}

const MODULE_KEYS: ReadonlySet<string> = new Set(['project', 'hrm', 'work', 'office', 'procurement', 'finance', 'warehouse', 'request', 'vehicle', 'workflow']);
const KINDS: ReadonlySet<string> = new Set(['approve', 'do', 'confirm', 'read', 'wait', 'watch']);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export const parseWorkItem = (raw: unknown): WorkItem | null => {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = text(row.id);
  const source = text(row.source);
  const module = text(row.module);
  if (!id || !source || !module || !MODULE_KEYS.has(module)) return null;
  const kind = text(row.kind);
  return {
    source: source as WorkItemSource,
    module: module as CenterModuleKey,
    kind: (kind && KINDS.has(kind) ? kind : 'do') as WorkItemKind,
    id,
    code: text(row.code) || '—',
    title: text(row.title) || text(row.code) || 'Hồ sơ',
    who: text(row.who),
    whoId: text(row.whoId),
    meta: text(row.meta),
    dueAt: text(row.dueAt),
    status: text(row.status),
    ref: row.ref && typeof row.ref === 'object' ? row.ref as Record<string, unknown> : {},
  };
};

export const parseWorkItemsPage = (raw: unknown, tab: InboxTab): WorkItemsPage => {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(row.items) ? row.items.map(parseWorkItem).filter((item): item is WorkItem => item !== null) : [];
  return {
    tab,
    generatedAt: text(row.generatedAt) || new Date().toISOString(),
    total: typeof row.total === 'number' ? row.total : items.length,
    truncatedSources: Array.isArray(row.truncatedSources) ? row.truncatedSources.filter((s): s is string => typeof s === 'string') : [],
    items,
  };
};

export const fetchWorkItems = async (tab: InboxTab): Promise<WorkItemsPage> => {
  const { data, error } = await supabase.rpc('vcc_my_work_items_v1', { p_tab: tab });
  if (error) throw error;
  return parseWorkItemsPage(data, tab);
};

// Mã người đọc được. Vài nguồn không có số chứng từ (phiếu kho chỉ có id máy kiểu "tx-po-delivery-<hex>") —
// không bao giờ hiện id máy: đổi thành ký hiệu loại phiếu + ngày, nguồn khác thì tên loại hồ sơ.
const MACHINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|[0-9a-f]{12,}|^tx-/i;
const WMS_TYPE_CODE: Record<string, string> = { IMPORT: 'PNK', EXPORT: 'PXK', TRANSFER: 'PCK', ADJUSTMENT: 'PĐC', LIQUIDATION: 'PTL' };
const SOURCE_FALLBACK: Partial<Record<WorkItemSource, string>> = {
  wms_tx: 'Phiếu kho', stock_count: 'Kiểm kê', daily_slip: 'Phiếu kỹ sư', makeup: 'Bù công', leave: 'Nghỉ phép', timesheet: 'Bảng công',
  profile_change: 'Hồ sơ NV', vehicle: 'Đặt xe', reconciliation: 'Đối chiếu', po_delivery: 'Đợt giao', fin_site_expense: 'Chi quỹ', fin_fund_opening: 'Mở quỹ',
  wf: 'Phiếu quy trình', safety: 'Sự cố an toàn',
};
/** Loại hồ sơ, ghi cạnh mã trong nhóm gom nhiều loại (Dự án, Công việc). */
export const SOURCE_LABEL: Partial<Record<WorkItemSource, string>> = {
  rq: 'Đề xuất', wf: 'Quy trình', work: 'Vioo Work',
  mr: 'Đề xuất vật tư', daily_log: 'Nhật ký', daily_slip: 'Phiếu kỹ sư', work_plan: 'Kế hoạch', safety: 'An toàn',
};

export const isMachineCode = (code: string | null | undefined): boolean => !code || MACHINE_ID.test(code.trim());

export const displayCode = (item: Pick<WorkItem, 'source' | 'code' | 'dueAt' | 'ref'>): string => {
  if (!isMachineCode(item.code)) return item.code;
  const day = civilOf(item.dueAt);
  const ddmm = day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '';
  const type = typeof item.ref?.type === 'string' ? WMS_TYPE_CODE[item.ref.type] : undefined;
  const label = (item.source === 'wms_tx' && type) || SOURCE_FALLBACK[item.source] || 'Hồ sơ';
  return ddmm ? `${label} ${ddmm}` : label;
};

/** Hạn: quá hạn → âm; "còn N giờ" khi dưới 1 ngày. Trả null khi không có hạn. */
export const dueInfo = (dueAt: string | null, now: Date): { label: string; tone: 'hot' | 'soon' | 'normal' } | null => {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const dayMs = 86_400_000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / dayMs);
  const hours = Math.round((due.getTime() - now.getTime()) / 3_600_000);
  const dmy = `${String(due.getDate()).padStart(2, '0')}/${String(due.getMonth() + 1).padStart(2, '0')}`;
  if (days < 0) return { label: `quá hạn ${-days} ngày`, tone: 'hot' };
  if (days === 0) return { label: hours > 0 && hours < 24 && due.getHours() + due.getMinutes() > 0 ? `còn ${hours} giờ` : 'hôm nay', tone: 'hot' };
  if (days === 1) return { label: 'ngày mai', tone: 'soon' };
  if (days <= 3) return { label: `còn ${days} ngày`, tone: 'soon' };
  return { label: dmy, tone: 'normal' };
};

/** Sắp xếp trong nhóm: có hạn trước (gần nhất lên đầu), rồi theo mã. */
export const sortWorkItems = (items: readonly WorkItem[]): WorkItem[] => [...items].sort((a, b) => {
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt) || a.code.localeCompare(b.code);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.code.localeCompare(b.code);
});
