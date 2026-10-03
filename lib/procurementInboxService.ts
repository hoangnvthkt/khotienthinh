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
  /** Đề xuất công trường: tồn khả dụng ở kho khác (Cấp từ kho) và phiếu chuyển đã lập cho dòng. */
  otherStock?: ProcurementOtherStock[];
  transfers?: Array<{ id: string; status: string; qty: number; sourceWarehouseName: string | null }>;
}

export interface ProcurementOtherStock {
  warehouseId: string; warehouseName: string; warehouseType: string | null; qty: number;
  /** Cả kho gửi và kho nhận đã bật chuyển kho 2 bước — chưa bật thì thủ kho không xuất/nhận được. */
  transferReady: boolean;
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
  PROCUREMENT_PO_WAREHOUSE_REQUIRED: 'Đơn chưa có kho nhận. Cập nhật kho nhận ở phiếu đề xuất trong dự án rồi lập lại đơn.',
  PROCUREMENT_PO_PRICE_MISSING: 'Còn vật tư chưa có đơn giá. Sửa đơn, nhập đủ giá rồi gửi duyệt.',
  PROCUREMENT_PO_VAT_INVALID: 'Thuế VAT phải từ 0 đến 100%.',
  PROCUREMENT_PO_VENDOR_REQUIRED: 'Chọn nhà cung cấp.',
  PROCUREMENT_PO_SCOPE_MIXED: 'Một đơn hàng chỉ gồm phiếu của cùng một dự án/công trường.',
  PROCUREMENT_GROUP_WAREHOUSE_REQUIRED: 'Đơn gom: có phiếu nhu cầu chưa chọn kho nhận. Cập nhật kho nhận ở phiếu trong dự án rồi lập lại.',
  PROCUREMENT_GROUP_SITE_REQUIRED: 'Đơn gom: chọn công trường nhận cho đợt giao.',
  PROCUREMENT_GROUP_SITE_INVALID: 'Công trường không thuộc đơn gom này.',
  PROCUREMENT_GROUP_LINE_NOT_AT_SITE: 'Có vật tư không đặt cho công trường này. Bỏ dòng đó khỏi đợt giao.',
  PROCUREMENT_EXCESS_REASON_REQUIRED: 'Nhập lý do gán phần thừa.',
  PROCUREMENT_EXCESS_OVER: 'SL gán lớn hơn phần thừa đang có ở công trường.',
  PROCUREMENT_EXCESS_TARGET_INVALID: 'Chỉ gán phần thừa cho dòng đề xuất đang chờ cung ứng, cùng vật tư, cùng dự án của công trường.',
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
  PROCUREMENT_DELIVERY_PO_STATE: 'Chỉ lập đợt giao hoặc kết thúc thiếu cho đơn đã duyệt, đang giao.',
  PROCUREMENT_DELIVERY_NOT_EDITABLE: 'Đợt giao đã có phiếu nhập kho hoặc đang chờ duyệt nên không sửa được.',
  PROCUREMENT_DELIVERY_APPROVER_REQUIRED: 'Đợt giao làm vượt giá trị đơn đã duyệt — chọn người duyệt bổ sung (không phải bạn).',
  PROCUREMENT_DELIVERY_NOT_FOUND: 'Đợt giao không còn tồn tại. Tải lại.',
  PROCUREMENT_DELIVERY_NOT_CANCELLABLE: 'Kho đã bắt đầu nhận đợt này nên không hủy được.',
  PROCUREMENT_DELIVERY_STILL_OPEN: 'Còn đợt giao chưa nhận xong. Chờ kho nhận hoặc hủy đợt đó trước khi kết thúc thiếu.',
  PROCUREMENT_CANCEL_REASON_REQUIRED: 'Nhập lý do hủy đợt giao.',
  SUPPLIER_RETURN_NOT_FOUND: 'Phiếu trả NCC không còn. Tải lại.',
  SUPPLIER_RETURN_ALREADY_DECIDED: 'Kho đã xuất trả nên không đổi được quyết định.',
  PROCUREMENT_PROACTIVE_REASON_REQUIRED: 'Chọn lý do mua chủ động (chọn "Khác" thì ghi rõ lý do).',
  PROCUREMENT_PROACTIVE_PROJECT_REQUIRED: 'Chọn dự án nhận hàng.',
  PROCUREMENT_PROACTIVE_PROJECT_LOCKED: 'Không đổi được dự án của đơn chủ động. Xóa nháp và lập đơn mới cho dự án khác.',
  PROCUREMENT_PROACTIVE_OVER_BOQ_REASON: 'Có vật tư vượt BOQ hoặc ngoài BOQ của dự án — ghi lý do mua vượt.',
  PROCUREMENT_PROACTIVE_ALLOCATED: 'Có dòng đã gắn nhu cầu: không bỏ dòng đó và không giảm SL dưới phần đã gắn. Gỡ gắn trước nếu cần.',
  PROCUREMENT_PO_PROACTIVE_USE_EDITOR: 'Đơn chủ động phải sửa bằng màn "Đơn chủ động". Tải lại rồi bấm Sửa.',
  PROCUREMENT_PO_LINE_INVALID: 'Dòng đơn hàng không còn. Tải lại.',
  PROCUREMENT_ITEM_NOT_FOUND: 'Vật tư không còn trong danh mục. Chọn lại.',
  PROCUREMENT_PROACTIVE_LINK_STATE: 'Đơn này đã đóng hoặc bị trả lại nên không gắn/gỡ nhu cầu được.',
  PROCUREMENT_PROACTIVE_ITEM_MISMATCH: 'Dòng đơn chủ động khác vật tư với dòng nhu cầu.',
  PROCUREMENT_PROACTIVE_OVER_NEED: 'SL gắn lớn hơn phần nhu cầu còn thiếu.',
  PROCUREMENT_PROACTIVE_OVER_UNALLOCATED: 'SL gắn lớn hơn phần chưa phân bổ của đơn chủ động.',
  PROCUREMENT_UNLINK_REASON_REQUIRED: 'Nhập lý do gỡ gắn.',
  PROCUREMENT_LINK_NOT_FOUND: 'Liên kết đã được gỡ trước đó. Tải lại.',
  MR_SUPPLY_NOT_FOUND: 'Không tìm thấy đề xuất. Tải lại.',
  MR_SUPPLY_STATE: 'Đề xuất đã hoàn tất hoặc đã kết thúc nên không cấp thêm.',
  MR_SUPPLY_WAREHOUSE_INVALID: 'Kho gửi không hợp lệ hoặc trùng kho nhận.',
  MR_SUPPLY_TRANSFER_NOT_ENABLED: 'Kho gửi hoặc kho nhận chưa bật chuyển kho 2 bước nên thủ kho chưa xuất/nhận được. Nhờ quản trị bật rồi thử lại, hoặc Mua mới.',
  MR_SUPPLY_LINE_NOT_FOUND: 'Dòng vật tư không còn trong đề xuất. Tải lại.',
  MR_SUPPLY_QTY_INVALID: 'SL chuyển phải lớn hơn 0.',
  MR_SUPPLY_OVER_NEED: 'SL chuyển lớn hơn phần còn thiếu của dòng.',
  MR_SUPPLY_STOCK_INSUFFICIENT: 'Kho gửi không còn đủ hàng khả dụng (đã trừ phiếu chuyển đang chờ xuất). Tải lại.',
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
  poPaymentStatus(ids: string[]) {
    return ids.length ? call<Record<string, ProcurementPoPayment>>('get_procurement_po_payment_status_v1', { p_po_ids: ids }) : Promise.resolve({} as Record<string, ProcurementPoPayment>);
  },
  getOrder(id: string) {
    return call<ProcurementOrderDetail>('get_procurement_order_v1', { p_po_id: id });
  },
  saveOrder(input: ProcurementOrderSaveInput) {
    return call<{ purchaseOrderId: string; poNumber: string; rowVersion: number; totalAmount: number; lines: number }>('save_procurement_hub_po_v1', { p_input: input });
  },
  saveDelivery(input: ProcurementDeliverySaveInput) {
    return call<{ deliveryId: string; deliveryNo: number; needsApproval: boolean; amount: number }>('save_procurement_delivery_v1', { p_input: input });
  },
  decideDelivery(input: { deliveryId: string; action: 'approve' | 'return'; reason?: string }) {
    return call<{ deliveryId: string }>('decide_procurement_delivery_v1', { p_input: input });
  },
  cancelDelivery(input: { deliveryId: string; reason: string }) {
    return call<{ deliveryId: string }>('cancel_procurement_delivery_v1', { p_input: input });
  },
  decideReturn(input: { returnId: string; resolution: 'replace' | 'credit'; note?: string }) {
    return call<{ returnId: string; resolution: string }>('decide_procurement_supplier_return_v1', { p_input: input });
  },
  closeShort(input: { purchaseOrderId: string; expectedRowVersion: number; reason: string; returnToNeed: boolean }) {
    return call<{ status: string; shortStockQty: number }>('close_procurement_po_short_v1', { p_input: input });
  },
  proactiveOptions() {
    return call<{ projects: ProcurementProactiveProject[]; stockWarehouses: Array<{ id: string; name: string }> }>('list_procurement_proactive_options_v1', {});
  },
  searchItems(projectId: string | null, search?: string) {
    return call<ProcurementCatalogItem[]>('search_procurement_items_v1', { p_project_id: projectId, p_search: search || null });
  },
  saveProactiveOrder(input: ProcurementProactiveSaveInput) {
    return call<{ purchaseOrderId: string; poNumber: string; rowVersion: number; totalAmount: number; lines: number; overBoq: number }>('save_procurement_proactive_po_v1', { p_input: input });
  },
  proactiveCandidates(sourceType: ProcurementSourceType, sourceId: string) {
    return call<ProcurementProactiveCandidate[]>('list_procurement_proactive_candidates_v1', { p_source_type: sourceType, p_source_id: sourceId });
  },
  linkProactive(input: { action: 'link' | 'unlink'; purchaseOrderId: string; poLineId: string; sourceType: ProcurementSourceType; sourceId: string; lineId: string; qty?: number; reason?: string }) {
    return call<{ purchaseOrderId: string; action: string; qty: number }>('link_procurement_proactive_need_v1', { p_input: input });
  },
  supplyFromStock(input: { requestId: string; lineId: string; sourceWarehouseId: string; qty: number; note?: string }) {
    return call<{ transactionId: string; qty: number; unit: string | null; itemName: string; sourceWarehouseName: string; targetWarehouseName: string; code: string }>(
      'create_material_request_supply_transfer_v1', { p_input: input });
  },
  assignGroupExcess(input: { purchaseOrderId: string; warehouseId: string; poLineId: string; sourceId: string; lineId: string; qty: number; reason: string }) {
    return call<{ purchaseOrderId: string; qty: number; code: string }>('assign_group_po_excess_v1', { p_input: input });
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
  awaitingMe: boolean; purchaseMode: 'single' | 'multiple'; returnsPending: number; kind: ProcurementOrderKind; sources: Array<ProcurementSourceRef & { code: string | null }>;
  /** Đơn gom nhiều dự án (giao thẳng từng công trường). */
  isGroup?: boolean;
}
export interface ProcurementOrderList { today: string; orders: ProcurementOrderSummary[]; awaitingMyApproval: number }
export interface ProcurementOrderLine {
  lineId: string; itemId: string; name: string; sku: string | null; unit: string | null; qty: number; unitPrice: number; receivedQty: number; note: string | null;
  /** Quy cách / cấu hình hiển thị cạnh tên (đơn chủ động) — kho vẫn theo mã vật tư gốc. */
  specification?: string | null;
  stockUnit: string | null; factor: number; returnedQty: number;
  /** Purchase-unit quantity neither received nor on an open delivery. */
  remainingToDeliver: number;
  /** Ordered quantity in the stock unit, and how much of it is already linked to needs. */
  stockQty: number; allocatedQty: number;
  /** Proactive orders: BOQ snapshot when the line was saved. */
  boq: ProcurementBoqSnapshot | null;
  allocations: Array<ProcurementSourceRef & { code: string | null; lineId: string; qty: number; needQty: number;
    projectCode?: string | null; warehouseId?: string | null; warehouseName?: string | null; excessReason?: string | null }>;
}

/** Một công trường của đơn gom: SL đặt / đã nhận / còn phải giao theo dòng đơn (đơn vị kho) và từng dòng nhu cầu. */
export interface ProcurementGroupSite {
  warehouseId: string; warehouseName: string; projectId: string | null; projectCode: string | null;
  lines: Array<{ lineId: string; orderedStockQty: number; receivedStockQty: number; undeliveredStockQty: number;
    /** Đã nhận về công trường nhưng vượt các dòng nhu cầu (tồn kho) và đề xuất cùng dự án có thể nhận phần thừa. */
    excessStockQty: number; excessCandidates: Array<{ sourceId: string; lineId: string; code: string; shortQty: number }>;
    allocations: Array<{ linkId: string; kind: ProcurementSourceType; code: string | null; neededDate: string | null; orderedQty: number; receivedQty: number; excess: boolean; excessReason: string | null }> }>;
}
export type ProcurementPoPaymentState = 'none' | 'unpaid' | 'partial' | 'paid';
/** Tình trạng thanh toán PO (từ công nợ nhận hàng) — Mua hàng chỉ thấy nợ, đã chi và hạn (K3b-2). */
export interface ProcurementPoPayment {
  status: ProcurementPoPaymentState; recognized: number; credit: number; paid: number; outstanding: number; inRequest: number;
  documents: number; nextDue: string | null; overdue: boolean;
}
export interface ProcurementOrderDetail {
  id: string; poNumber: string | null; status: string; stage: ProcurementOrderStage | 'other'; isHub: boolean; rowVersion: number;
  vendorId: string | null; vendorName: string | null; projectId: string | null; constructionSiteId: string | null;
  projectCode: string | null; projectName: string | null; targetWarehouseId: string | null; warehouseName: string | null;
  orderDate: string | null; expectedDeliveryDate: string | null; totalAmount: number; vatRate: number; note: string | null;
  createdById: string | null; createdByName: string | null; createdByTitle?: string | null; createdAt: string; submittedToUserId: string | null; submittedToName: string | null;
  returnReason: string | null; everSubmitted: boolean;
  purchaseMode: 'single' | 'multiple'; approvedTotalAmount: number;
  kind: ProcurementOrderKind; proactive: ProcurementProactiveInfo | null;
  shortClose: { reason: string; returnToNeed: boolean; shortStockQty: number; at: string; by: string | null } | null;
  isGroup?: boolean; sites?: ProcurementGroupSite[];
  deliveries: ProcurementDelivery[];
  returns: ProcurementSupplierReturn[];
  lines: ProcurementOrderLine[];
  events: Array<{ action: string; actorName: string | null; reason: string | null; at: string; payload?: { sourceCode?: string; qty?: number } | null }>;
  permissions: { canEdit: boolean; canSubmit: boolean; canApprove: boolean; canDelete: boolean; canAddDelivery: boolean; canCloseShort: boolean; canDecideReturn: boolean; canLink: boolean };
  approvers: Array<{ id: string; name: string }>;
}
export interface ProcurementDelivery {
  id: string; deliveryNo: number; status: string; approvalStatus: string | null; plannedDate: string | null; vatRate: number;
  note: string | null; wmsTransactionId: string | null; hasQr: boolean; createdById: string | null; createdByName: string | null;
  approvalAssigneeId: string | null; approvalAssigneeName: string | null; decisionNote: string | null;
  receivedAt: string | null; receivedByName: string | null; amount: number; acceptedAmount: number;
  targetWarehouseId?: string | null; warehouseName?: string | null; projectCode?: string | null; allocationMode?: 'earliest' | 'ratio';
  lines: Array<{ lineId: string; itemId: string; name: string; plannedQty: number; unit: string | null; stockPlannedQty: number;
    stockUnit: string | null; unitPrice: number; acceptedQty: number; acceptedStockQty: number }>;
}
export interface ProcurementSupplierReturn {
  id: string; returnNo: string; status: 'pending' | 'completed'; reason: string; reasonCode: string | null; note: string | null;
  resolution: 'replace' | 'credit' | null; resolutionNote: string | null; resolutionByName: string | null;
  createdAt: string; createdByName: string | null; completedAt: string | null; warehouseName: string | null;
  lines: Array<{ lineId: string; itemId: string; name: string; returnQty: number; unit: string | null; stockReturnQty: number; stockUnit: string | null; unitPrice: number }>;
}
export interface ProcurementDeliverySaveInput {
  purchaseOrderId: string; deliveryId?: string; plannedDate?: string | null; vatRate: number; note?: string; approverUserId?: string;
  /** Đơn gom: công trường nhận và cách chia khi giao thiếu cho nhiều dòng nhu cầu của công trường. */
  targetWarehouseId?: string; allocationMode?: 'earliest' | 'ratio';
  lines: Array<{ purchaseOrderLineId: string; purchaseQty: number; stockQty: number; unitPrice: number }>;
}
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  planned: 'Nháp', receiving: 'Chờ kho nhận', wms_pending: 'Chờ kho nhận', waiting_delivery: 'Chờ giao', quality_approved: 'Kho đã kiểm',
  received: 'Đã nhận đủ', received_short: 'Nhận thiếu', received_over: 'Nhận dư', cancelled: 'Đã hủy', supplemental_pending: 'Chờ duyệt bổ sung',
};
/** Committed value of deliveries (before VAT): received ones at accepted qty, open ones at planned qty. */
export const committedDeliveryAmount = (deliveries: ProcurementDelivery[], exceptId?: string) => deliveries
  .filter(d => d.status !== 'cancelled' && d.id !== exceptId)
  .reduce((sum, d) => sum + (['received', 'received_short', 'received_over'].includes(d.status) ? d.acceptedAmount : d.amount), 0);

export interface ProcurementOrderSaveInput {
  purchaseOrderId?: string; purchaseMode?: 'single' | 'multiple'; expectedRowVersion?: number; vendorId: string; targetWarehouseId?: string | null;
  expectedDeliveryDate?: string | null; vatRate: number; note?: string;
  items: Array<{ itemId: string; unitPrice: number; note?: string; purchaseQty?: number; purchaseUnit?: string; allocations: Array<ProcurementSourceRef & { lineId: string; qty: number }> }>;
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

// ---------------------------------------------------------------------------
// M2d — Đơn chủ động (Mua hàng tự lập, không cần phiếu nhu cầu)
// ---------------------------------------------------------------------------
export type ProcurementOrderKind = 'need' | 'proactive';
export type ProcurementProactiveReason = 'price_lock' | 'long_lead' | 'min_stock' | 'other';
export const PROACTIVE_REASON_LABELS: Record<ProcurementProactiveReason, { label: string; hint: string }> = {
  price_lock: { label: 'Chốt giá tốt', hint: 'Mua trước khi NCC tăng giá' },
  long_lead: { label: 'Hàng đặt dài ngày', hint: 'Phải đặt sớm mới kịp tiến độ' },
  min_stock: { label: 'Bù tồn tối thiểu', hint: 'Giữ mức tồn an toàn ở kho công trường' },
  other: { label: 'Khác', hint: 'Ghi rõ lý do' },
};
export interface ProcurementProactiveInfo { purpose: 'project' | 'stock'; reasonCode: ProcurementProactiveReason; reason?: string; overBoqReason?: string }
export interface ProcurementBoqSnapshot { status: 'within' | 'over' | 'outside' | 'stock'; boqQty: number; orderedBefore: number }
export interface ProcurementProactiveProject { id: string; code: string | null; name: string | null; status: string | null; warehouses: Array<{ id: string; name: string }> }
export interface ProcurementCatalogItem {
  id: string; name: string; sku: string | null; unit: string | null; purchaseUnit: string | null; purchaseFactor: number | null;
  inBoq: boolean; boqQty: number; orderedQty: number;
}
export interface ProcurementProactiveSaveInput {
  purchaseOrderId?: string; expectedRowVersion?: number; purpose: 'project' | 'stock'; projectId: string | null; targetWarehouseId: string; vendorId: string;
  purchaseMode: 'single' | 'multiple'; expectedDeliveryDate?: string | null; vatRate: number; note?: string;
  reasonCode: ProcurementProactiveReason; reason?: string; overBoqReason?: string;
  items: Array<{ lineId?: string; itemId: string; stockQty: number; purchaseQty?: number; purchaseUnit?: string; unitPrice: number; note?: string; specification?: string }>;
}
export interface ProcurementProactiveCandidate {
  needLineId: string; itemId: string; itemName: string; unit: string | null; remainingQty: number;
  purchaseOrderId: string; poNumber: string | null; status: string; vendorName: string | null; expectedDeliveryDate: string | null;
  poLineId: string; lineStockQty: number; unallocatedQty: number; reasonCode: ProcurementProactiveReason | null;
}
/** BOQ status of a quantity about to be ordered: within, over the remaining BOQ, or an item outside the project BOQ. */
export const boqStatusOf = (item: Pick<ProcurementCatalogItem, 'inBoq' | 'boqQty' | 'orderedQty'>, qty: number): ProcurementBoqSnapshot['status'] =>
  !item.inBoq ? 'outside' : item.orderedQty + qty > item.boqQty * 1.0001 + 0.0005 ? 'over' : 'within';
