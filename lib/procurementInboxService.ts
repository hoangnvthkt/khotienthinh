import { supabase } from './supabase';

export type ProcurementSourceType = 'material_request' | 'material_plan';
export type ProcurementProgress = 'new' | 'partial' | 'ordered' | 'received';

export interface ProcurementInboxDocument {
  sourceType: ProcurementSourceType;
  sourceId: string;
  code: string;
  title: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  constructionSiteId: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  neededDate: string | null;
  requesterName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  createdAt: string;
  lineCount: number;
  orderedLines: number;
  partialLines: number;
  receivedLines: number;
  progress: ProcurementProgress;
  assigneeUserId: string | null;
  assigneeName: string | null;
  periodType: 'month' | 'week' | null;
  periodStart: string | null;
}

export interface ProcurementInbox {
  today: string;
  canManage: boolean;
  documents: ProcurementInboxDocument[];
  sourceCounts: Partial<Record<ProcurementSourceType, number>>;
  stages: { intake: number; intakeUrgent: number; unassigned: number; drafting: number; ordered: number; orderedLate: number; delivering: number; deliveringLate: number; receiving: number };
  projects: Array<{ id: string; code: string | null; name: string | null }>;
  assignees: Array<{ id: string; name: string }>;
}

export interface ProcurementInboxLine {
  lineId: string; itemId: string | null; itemName: string; sku: string | null; unit: string | null;
  needQty: number; orderedQty: number; receivedQty: number; remainingQty: number; stockQty: number | null;
  orders: Array<{ id: string; poNumber: string | null; status: string; vendorName: string | null; expectedDeliveryDate: string | null }>;
}

export interface ProcurementInboxDetail {
  sourceType: ProcurementSourceType; sourceId: string; code: string; title: string | null;
  projectId: string | null; projectCode: string | null; projectName: string | null;
  warehouseId: string | null; warehouseName: string | null; neededDate: string | null;
  requesterName: string | null; approvedAt: string | null; approvedByName: string | null;
  constructionSiteId: string | null; periodType: 'month' | 'week' | null; periodStart: string | null;
  lines: ProcurementInboxLine[];
  assignment: { assigneeUserId: string | null; assigneeName: string | null; assignedAt: string; note: string | null } | null;
}

export interface ProcurementInboxFilter {
  source?: ProcurementSourceType | '';
  progress?: 'open' | 'all' | ProcurementProgress;
  projectId?: string;
  assigneeId?: string;
  search?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  PROCUREMENT_VIEW_DENIED: 'Bạn chưa có quyền vào Mua hàng. Nhờ quản trị cấp quyền "Mua hàng — Xem".',
  PROCUREMENT_MANAGE_DENIED: 'Bạn chưa có quyền phân công trong Mua hàng.',
  PROCUREMENT_ASSIGNEE_INVALID: 'Người được chọn không thuộc phòng Mua hàng.',
  PROCUREMENT_SOURCE_NOT_FOUND: 'Phiếu nhu cầu không còn trong danh sách. Tải lại.',
  PROCUREMENT_SOURCES_REQUIRED: 'Chọn ít nhất một phiếu.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không tải được dữ liệu Mua hàng. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const procurementInboxService = {
  list(filter: ProcurementInboxFilter) {
    return call<ProcurementInbox>('list_procurement_inbox_v1', { p_filter: filter });
  },
  get(sourceType: ProcurementSourceType, sourceId: string) {
    return call<ProcurementInboxDetail>('get_procurement_inbox_document_v1', { p_source_type: sourceType, p_source_id: sourceId });
  },
  assign(input: { sources: Array<{ sourceType: ProcurementSourceType; sourceId: string }>; assigneeUserId: string | null; note?: string }) {
    return call<{ assigned: number }>('assign_procurement_inbox_v1', { p_input: input });
  },
};

/** Where the source document lives in its project. */
export const procurementSourceLink = (doc: Pick<ProcurementInboxDocument, 'sourceType' | 'sourceId' | 'projectId' | 'constructionSiteId' | 'periodType' | 'periodStart'>): string | null => {
  if (!doc.projectId) return null;
  const params = new URLSearchParams({ projectId: doc.projectId, ...(doc.constructionSiteId ? { siteId: doc.constructionSiteId } : {}) });
  if (doc.sourceType === 'material_request') { params.set('tab', 'material'); params.set('materialTab', 'request'); params.set('requestId', doc.sourceId); }
  else { params.set('tab', 'work_plan'); params.set('view', 'material'); if (doc.periodType) params.set('period', doc.periodType); if (doc.periodStart) params.set('start', doc.periodStart); }
  return `#/da?${params.toString()}`;
};

export const PROCUREMENT_SOURCE_LABELS: Record<ProcurementSourceType, string> = {
  material_plan: 'KH vật tư',
  material_request: 'Đề xuất công trường',
};

export const PROCUREMENT_PROGRESS_LABELS: Record<ProcurementProgress, string> = {
  new: 'Chưa đặt', partial: 'Đặt một phần', ordered: 'Đã đặt đủ', received: 'Đã về đủ',
};

/** Days until the needed date (negative = overdue); null when no date. */
export const daysUntil = (date: string | null, today: string): number | null => {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
};

export const urgencyOf = (date: string | null, today: string): { label: string; tone: 'overdue' | 'soon' | 'normal' | 'none' } => {
  const d = daysUntil(date, today);
  if (d == null) return { label: 'Chưa có ngày cần', tone: 'none' };
  if (d < 0) return { label: `Quá hạn ${-d} ngày`, tone: 'overdue' };
  if (d === 0) return { label: 'Cần hôm nay', tone: 'soon' };
  if (d <= 3) return { label: `Còn ${d} ngày`, tone: 'soon' };
  return { label: `Còn ${d} ngày`, tone: 'normal' };
};
