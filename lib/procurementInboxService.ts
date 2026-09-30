import { supabase } from './supabase';

export type ProcurementSourceType = 'material_request' | 'material_plan';
export type ProcurementProgress = 'new' | 'partial' | 'ordered' | 'received' | 'closed';

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
  closedAt: string | null;
  closeReason: string | null;
  closedByName: string | null;
}

export interface ProcurementInbox {
  today: string;
  canManage: boolean;
  documents: ProcurementInboxDocument[];
  sourceCounts: Partial<Record<ProcurementSourceType, number>>;
  stages: { intake: number; intakeUrgent: number; unassigned: number; drafting: number; ordered: number; orderedLate: number; delivering: number; deliveringLate: number; receiving: number; awaitingMe: number };
  projects: Array<{ id: string; code: string | null; name: string | null }>;
  assignees: Array<{ id: string; name: string }>;
}

export interface ProcurementInboxLine {
  lineId: string; itemId: string | null; itemName: string; sku: string | null; unit: string | null;
  needQty: number; orderedQty: number; receivedQty: number; remainingQty: number; stockQty: number | null;
  /** Set when the item is bought in another unit: stock qty = purchase qty × purchaseFactor. */
  purchaseUnit: string | null; purchaseFactor: number | null;
  orders: Array<{ id: string; poNumber: string | null; status: string; vendorName: string | null; expectedDeliveryDate: string | null; orderedQty: number }>;
}

export interface ProcurementInboxDetail {
  sourceType: ProcurementSourceType; sourceId: string; code: string; title: string | null;
  projectId: string | null; projectCode: string | null; projectName: string | null;
  warehouseId: string | null; warehouseName: string | null; neededDate: string | null;
  requesterName: string | null; approvedAt: string | null; approvedByName: string | null;
  constructionSiteId: string | null; periodType: 'month' | 'week' | null; periodStart: string | null;
  closure: { closedAt: string; reason: string; closedByName: string | null } | null;
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
  PROCUREMENT_CLOSE_REASON_REQUIRED: 'Nhập lý do đóng nhu cầu.',
  PROCUREMENT_NEED_CLOSED: 'Có phiếu nhu cầu đã đóng. Mở lại phiếu trước khi lập đơn.',
  PROCUREMENT_PO_ITEMS_REQUIRED: 'Đơn hàng chưa có vật tư nào có SL đặt lớn hơn 0.',
  PROCUREMENT_PO_QTY_INVALID: 'SL đặt phải lớn hơn 0.',
  PROCUREMENT_PO_PRICE_INVALID: 'Đơn giá không hợp lệ.',
  PROCUREMENT_PO_PRICE_MISSING: 'Còn vật tư chưa có đơn giá. Sửa đơn, nhập đủ giá rồi gửi duyệt.',
  PROCUREMENT_PO_VAT_INVALID: 'Thuế VAT phải từ 0 đến 100%.',
  PROCUREMENT_PO_VENDOR_REQUIRED: 'Chọn nhà cung cấp.',
  PROCUREMENT_PO_SCOPE_MIXED: 'Một đơn hàng chỉ gồm phiếu của cùng một dự án/công trường.',
  PROCUREMENT_PO_DUPLICATE_LINE: 'Một dòng nhu cầu bị chọn hai lần.',
  PROCUREMENT_PO_WAREHOUSE_INVALID: 'Kho nhận không hợp lệ.',
  PROCUREMENT_PO_NOT_FOUND: 'Đơn hàng không còn tồn tại. Tải lại.',
  PROCUREMENT_PO_NOT_EDITABLE: 'Chỉ người lập được sửa đơn nháp hoặc bị trả lại.',
  PROCUREMENT_PO_SUBMIT_DENIED: 'Chỉ người lập được gửi duyệt đơn nháp hoặc bị trả lại.',
  PROCUREMENT_PO_APPROVER_INVALID: 'Người duyệt phải có quyền Mua hàng — Quản trị (hoặc Admin) và không phải người lập.',
  PROCUREMENT_PO_APPROVE_DENIED: 'Bạn không phải người được giao duyệt đơn này.',
  PROCUREMENT_PO_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại để người lập biết cần sửa gì.',
  PROCUREMENT_PO_DELETE_DENIED: 'Chỉ xóa được đơn nháp chưa từng gửi duyệt.',
  ROW_VERSION_CONFLICT: 'Đơn hàng vừa được người khác cập nhật. Tải lại rồi thử lại.',
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
  close(input: { sources: ProcurementSourceRef[]; action: 'close' | 'reopen'; reason?: string }) {
    return call<{ changed: number }>('close_procurement_need_v1', { p_input: input });
  },
  vendors(search?: string) {
    return call<ProcurementVendor[]>('list_procurement_vendors_v1', { p_search: search || null });
  },
  listOrders(filter: ProcurementOrderFilter) {
    return call<ProcurementOrderList>('list_procurement_orders_v1', { p_filter: filter });
  },
  getOrder(id: string) {
    return call<ProcurementOrderDetail>('get_procurement_order_v1', { p_po_id: id });
  },
  saveOrder(input: ProcurementOrderSaveInput) {
    return call<{ purchaseOrderId: string; poNumber: string; rowVersion: number; totalAmount: number; lines: number }>('save_procurement_hub_po_v1', { p_input: input });
  },
  transitionOrder(input: { purchaseOrderId: string; expectedRowVersion: number; action: 'submit' | 'approve' | 'return' | 'delete'; approverUserId?: string; reason?: string }) {
    return call<{ purchaseOrderId: string; status: string; rowVersion: number }>('transition_procurement_hub_po_v1', { p_input: input });
  },
};

export type ProcurementSourceRef = { sourceType: ProcurementSourceType; sourceId: string };
export interface ProcurementVendor { id: string; name: string; taxCode: string | null; recentOrders: number }
export type ProcurementOrderStage = 'drafting' | 'ordered' | 'delivering' | 'received';
export interface ProcurementOrderFilter { stage?: ProcurementOrderStage | 'all'; projectId?: string; search?: string; mine?: boolean }
export interface ProcurementOrderSummary {
  id: string; poNumber: string | null; status: string; stage: ProcurementOrderStage | 'other'; isHub: boolean;
  vendorName: string | null; projectId: string | null; projectCode: string | null; projectName: string | null;
  constructionSiteId: string | null; totalAmount: number; vatRate: number; orderDate: string | null; expectedDeliveryDate: string | null;
  late: boolean; lineCount: number; qtyTotal: number; qtyReceived: number;
  createdById: string | null; createdByName: string | null; submittedToUserId: string | null; submittedToName: string | null;
  awaitingMe: boolean; sources: Array<ProcurementSourceRef & { code: string | null }>;
}
export interface ProcurementOrderList { today: string; orders: ProcurementOrderSummary[]; awaitingMyApproval: number }
export interface ProcurementOrderLine {
  lineId: string; itemId: string; name: string; sku: string | null; unit: string | null; qty: number; unitPrice: number; receivedQty: number; note: string | null;
  stockUnit: string | null; factor: number;
  allocations: Array<ProcurementSourceRef & { code: string | null; lineId: string; qty: number; needQty: number }>;
}
export interface ProcurementOrderDetail {
  id: string; poNumber: string | null; status: string; stage: ProcurementOrderStage | 'other'; isHub: boolean; rowVersion: number;
  vendorId: string | null; vendorName: string | null; projectId: string | null; constructionSiteId: string | null;
  projectCode: string | null; projectName: string | null; targetWarehouseId: string | null; warehouseName: string | null;
  orderDate: string | null; expectedDeliveryDate: string | null; totalAmount: number; vatRate: number; note: string | null;
  createdById: string | null; createdByName: string | null; createdAt: string; submittedToUserId: string | null; submittedToName: string | null;
  returnReason: string | null; everSubmitted: boolean;
  lines: ProcurementOrderLine[];
  events: Array<{ action: string; actorName: string | null; reason: string | null; at: string }>;
  permissions: { canEdit: boolean; canSubmit: boolean; canApprove: boolean; canDelete: boolean };
  approvers: Array<{ id: string; name: string }>;
}
export interface ProcurementOrderSaveInput {
  purchaseOrderId?: string; expectedRowVersion?: number; vendorId: string; targetWarehouseId?: string | null;
  expectedDeliveryDate?: string | null; vatRate: number; note?: string;
  items: Array<{ itemId: string; unitPrice: number; note?: string; allocations: Array<ProcurementSourceRef & { lineId: string; qty: number }> }>;
}

export const PROCUREMENT_PO_STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp', sent: 'Chờ duyệt', returned: 'Bị trả lại', confirmed: 'Đã duyệt · chờ giao', in_transit: 'Đang giao',
  partial: 'Giao một phần', delivered: 'Đã giao đủ', closed: 'Đã đóng', cancelled: 'Đã hủy',
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
  new: 'Chưa đặt', partial: 'Đặt một phần', ordered: 'Đã đặt đủ', received: 'Đã về đủ', closed: 'Đã đóng',
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
