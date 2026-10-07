import { supabase } from '../supabase';
import type { CenterModuleKey } from './centerRegistry';

// "Việc của tôi": một RPC gom việc từ phân công thật của từng module (vcc_my_work_items_v1).
// Máy chủ đã lọc theo quyền; trình duyệt chỉ nhóm, sắp xếp và mở đúng hồ sơ.

export type InboxTab = 'mine' | 'sent' | 'watch';

export type WorkItemSource =
  | 'rq' | 'mr' | 'wms_tx' | 'daily_log' | 'daily_slip' | 'work_plan' | 'po' | 'po_delivery' | 'hot'
  | 'fin_payment' | 'fin_site_expense' | 'fin_fund_opening' | 'leave' | 'makeup' | 'site_assignment'
  | 'timesheet' | 'profile_change' | 'office' | 'work' | 'vehicle' | 'stock_count' | 'reconciliation';

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
