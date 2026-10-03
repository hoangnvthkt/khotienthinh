import { supabase } from './supabase';

// M2c — Mua nóng / CCDC: công trường mua gấp, nhỏ lẻ. Từ ngưỡng (gồm VAT) CHT duyệt trước khi mua;
// dưới ngưỡng mua trước, báo CHT sau. Vượt số duyệt quá 10% thì CHT xác nhận lại.

export type HotPurchaseStatus = 'draft' | 'submitted' | 'approved_to_buy' | 'purchased' | 'received' | 'finance_review' | 'reconciled' | 'closed' | 'rejected' | 'cancelled';
export type HotPurchasePaymentSource = 'site_cash' | 'staff_paid' | 'company_bank' | 'supplier_credit';
export type HotPurchaseLineType = 'stock_item' | 'expense_only' | 'small_tool';

export interface HotPurchaseSummary {
  id: string; code: string; status: HotPurchaseStatus; projectId: string | null; projectCode: string | null; projectName: string | null;
  constructionSiteId: string | null; targetWarehouseId: string | null; warehouseName: string | null;
  supplierId: string | null; supplierName: string; paymentSource: HotPurchasePaymentSource; purchaseDate: string | null;
  invoiceNumber: string | null; invoiceDate: string | null; attachments: unknown[]; note: string | null; totalAmount: number;
  requiresApproval: boolean; approvalThreshold: number | null; cumulativeAmount: number | null; submittedAmount: number | null;
  approverName: string | null; approvedAmount: number | null; approvedAt: string | null; returnReason: string | null;
  overrunStatus: 'pending' | 'confirmed' | null; receivedAt: string | null; receivedByName: string | null; wmsTransactionId: string | null;
  createdAt: string; createdById: string | null; createdByName: string | null; lineCount: number; lineSummary: string | null;
  payable: { id: string; code: string; status: string; amount: number } | null; canApprove: boolean;
}

export interface HotPurchaseLine {
  id: string; lineNo: number; lineType: HotPurchaseLineType; itemId: string | null; sku: string | null; name: string; unit: string | null;
  qty: number; unitPrice: number; vatRate: number; amount: number; holderType: string | null; holderName: string | null;
  materialRequestId: string | null; requestLineId: string | null; requestCode: string | null; note: string | null;
}

export interface HotPurchaseDetail extends HotPurchaseSummary {
  commanderName: string | null;
  lines: HotPurchaseLine[];
  events: Array<{ action: string; reason: string | null; at: string; actorName: string | null; payload: Record<string, unknown> | null }>;
  permissions: { canEdit: boolean; canCancel: boolean; canDecide: boolean; canMarkPurchased: boolean; canConfirmOverrun: boolean; canReceive: boolean; canPostPayable: boolean };
}

export interface HotPurchaseProject { id: string; code: string | null; name: string | null; warehouses: Array<{ id: string; name: string; constructionSiteId: string | null }> }

export interface HotPurchaseList { threshold: number; canCreate: boolean; purchases: HotPurchaseSummary[]; projects: HotPurchaseProject[] }

export interface HotPurchaseSettings { threshold: number; rowVersion: number; updatedAt: string; updatedByName: string | null; canEdit: boolean }

export interface HotPurchaseLineInput {
  itemId?: string | null; name: string; unit: string; qty: number; unitPrice: number; vatRate: number; lineType: HotPurchaseLineType;
  holderName?: string | null; materialRequestId?: string | null; requestLineId?: string | null; note?: string | null;
}

export interface HotPurchaseSaveInput {
  id?: string; projectId: string; constructionSiteId: string | null; targetWarehouseId: string | null;
  supplierId: string | null; supplierName: string; paymentSource: HotPurchasePaymentSource; purchaseDate?: string | null;
  invoiceNumber?: string | null; invoiceDate?: string | null; note?: string | null; lines: HotPurchaseLineInput[];
}

/** Dòng đề xuất mang sang khi bấm "Mua nóng" ở Cần mua. */
export interface HotPurchasePrefill {
  projectId: string; constructionSiteId: string | null; targetWarehouseId: string | null;
  line: { itemId: string | null; name: string; unit: string | null; qty: number; materialRequestId: string; requestLineId: string; requestCode: string };
}

export const HOT_PURCHASE_PAYMENT_LABELS: Record<HotPurchasePaymentSource, { label: string; hint: string; settle: string }> = {
  site_cash: { label: 'Quỹ công trường', hint: 'Trừ quỹ công trường, vào bộ hoàn ứng cuối tháng', settle: 'Chờ quyết toán tháng' },
  staff_paid: { label: 'Nhân viên ứng trước', hint: 'Công ty nợ nhân viên, hoàn ứng khi quyết toán tháng', settle: 'Chờ quyết toán tháng' },
  company_bank: { label: 'Công ty chuyển khoản', hint: 'Ghi công nợ NCC → Đề nghị chi ở Tài chính', settle: 'Chờ kế toán ghi nợ' },
  supplier_credit: { label: 'NCC cho nợ', hint: 'Ghi công nợ NCC (hạn theo NCC) → Đề nghị chi ở Tài chính', settle: 'Chờ kế toán ghi nợ' },
};

export const HOT_PURCHASE_LINE_LABELS: Record<HotPurchaseLineType, { label: string; hint: string }> = {
  stock_item: { label: 'Nhập kho', hint: 'Vào tồn kho công trường (thủ kho nhận bằng phiếu nhập kho)' },
  expense_only: { label: 'Dùng ngay', hint: 'Ghi chi phí dự án, không qua kho' },
  small_tool: { label: 'CCDC', hint: 'Vào sổ CCDC theo người giữ' },
};

export const isApPayment = (s: HotPurchasePaymentSource) => s === 'company_bank' || s === 'supplier_credit';

export const hotPurchaseLineAmount = (l: Pick<HotPurchaseLineInput, 'qty' | 'unitPrice' | 'vatRate'>) => {
  const net = Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * 100) / 100;
  return net + Math.round(net * (Number(l.vatRate) || 0)) / 100;
};

const ERROR_MESSAGES: Record<string, string> = {
  HOT_PURCHASE_DENIED: 'Bạn chưa có quyền với phiếu mua nóng này. Nhờ quản trị cấp quyền "Mua nóng — Tạo" ở dự án.',
  HOT_PURCHASE_NOT_FOUND: 'Phiếu mua nóng không còn hoặc bạn không xem được. Tải lại.',
  HOT_PURCHASE_STATE: 'Phiếu đã sang bước khác. Tải lại rồi thử lại.',
  HOT_PURCHASE_PROJECT_REQUIRED: 'Chọn dự án.',
  HOT_PURCHASE_PAYMENT_INVALID: 'Chọn nguồn tiền.',
  HOT_PURCHASE_SUPPLIER_REQUIRED: 'Nhập nhà cung cấp hoặc tên người bán.',
  HOT_PURCHASE_SUPPLIER_PARTNER_REQUIRED: 'Công ty chuyển khoản / NCC cho nợ phải chọn NCC trong danh mục để ghi công nợ.',
  HOT_PURCHASE_WAREHOUSE_INVALID: 'Kho nhận không hợp lệ.',
  HOT_PURCHASE_LINES_REQUIRED: 'Phiếu chưa có dòng vật tư nào.',
  HOT_PURCHASE_LINE_INVALID: 'Có dòng thiếu tên, số lượng hoặc đơn giá không hợp lệ.',
  HOT_PURCHASE_ITEM_NOT_FOUND: 'Vật tư không còn trong danh mục. Chọn lại.',
  HOT_PURCHASE_STOCK_LINE_INVALID: 'Dòng Nhập kho phải chọn vật tư trong danh mục và kho nhận.',
  HOT_PURCHASE_TOOL_HOLDER_REQUIRED: 'Dòng CCDC phải ghi người giữ.',
  HOT_PURCHASE_REQUEST_LINE_INVALID: 'Dòng đề xuất không còn chờ cung ứng hoặc khác vật tư. Bỏ gắn đề xuất rồi lưu lại.',
  HOT_PURCHASE_AMOUNT_REQUIRED: 'Tổng tiền phải lớn hơn 0.',
  HOT_PURCHASE_EVIDENCE_REQUIRED: 'Ghi số hóa đơn / phiếu bán lẻ trước khi báo đã mua.',
  HOT_PURCHASE_APPROVE_DENIED: 'Chỉ Chỉ huy trưởng dự án duyệt được (dự án chưa có CHT thì Admin). Người lập không tự duyệt.',
  HOT_PURCHASE_ACTION_INVALID: 'Thao tác không hợp lệ.',
  HOT_PURCHASE_REASON_REQUIRED: 'Nhập lý do.',
  HOT_PURCHASE_OVERRUN_PENDING: 'Thực tế vượt số đã duyệt quá 10% — chờ CHT xác nhận lại rồi mới nhận hàng.',
  HOT_PURCHASE_RECEIVE_KEEPER_REQUIRED: 'Phiếu có dòng Nhập kho: thủ kho kho nhận phải xác nhận (cần quyền hoàn tất phiếu kho ở kho đó).',
  HOT_PURCHASE_THRESHOLD_INVALID: 'Ngưỡng phải lớn hơn 0.',
  FINANCE_RECORD_DENIED: 'Chỉ kế toán (quyền Tài chính — Ghi sổ) ghi công nợ được.',
  PROCUREMENT_MANAGE_DENIED: 'Chỉ Admin hoặc Mua hàng — Quản trị sửa được ngưỡng.',
  ROW_VERSION_CONFLICT: 'Ngưỡng vừa được người khác sửa. Tải lại.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không xử lý được phiếu mua nóng. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const hotPurchaseService = {
  list(filter: { projectId?: string | null; constructionSiteId?: string | null } = {}) {
    return call<HotPurchaseList>('list_hot_purchases_v1', { p_filter: { projectId: filter.projectId || '', constructionSiteId: filter.constructionSiteId || '' } });
  },
  get(id: string) { return call<HotPurchaseDetail>('get_hot_purchase_v1', { p_id: id }); },
  vendors(projectId: string, search?: string) {
    return call<Array<{ id: string; name: string; taxCode: string | null }>>('search_hot_purchase_vendors_v1', { p_project_id: projectId, p_search: search || null });
  },
  save(input: HotPurchaseSaveInput) { return call<{ id: string; code: string; total: number }>('save_hot_purchase_v1', { p_input: input }); },
  submit(id: string) {
    return call<{ id: string; status: HotPurchaseStatus; requiresApproval: boolean; total: number; cumulative: number; threshold: number }>('submit_hot_purchase_v1', { p_input: { id } });
  },
  decide(id: string, action: 'approve' | 'return', reason?: string) { return call<{ id: string; status: HotPurchaseStatus }>('decide_hot_purchase_v1', { p_input: { id, action, reason } }); },
  markPurchased(input: { id: string; invoiceNumber: string; invoiceDate?: string | null; lines: Array<{ id: string; qty: number; unitPrice: number; vatRate: number }> }) {
    return call<{ id: string; status: HotPurchaseStatus; total: number; overrun: boolean }>('mark_hot_purchase_purchased_v1', { p_input: input });
  },
  confirmOverrun(id: string, note?: string) { return call<{ id: string }>('confirm_hot_purchase_overrun_v1', { p_input: { id, note } }); },
  receive(id: string) { return call<{ id: string; status: HotPurchaseStatus; wmsTransactionId: string | null }>('receive_hot_purchase_v1', { p_input: { id } }); },
  postPayable(id: string) { return call<{ id: string; payableCode: string; amount: number }>('post_hot_purchase_payable_v1', { p_input: { id } }); },
  cancel(id: string, reason: string) { return call<{ id: string }>('cancel_hot_purchase_v1', { p_input: { id, reason } }); },
  settings() { return call<HotPurchaseSettings>('get_hot_purchase_settings_v1', {}); },
  saveSettings(threshold: number, expectedRowVersion: number) { return call<HotPurchaseSettings>('save_hot_purchase_settings_v1', { p_input: { threshold, expectedRowVersion } }); },
};
