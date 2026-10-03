import { supabase } from './supabase';

// Module Tài chính (K3a): công nợ NCC toàn công ty. Mọi ghi chép đi qua RPC; server kiểm quyền và tách nhiệm.

export type FinanceCan = { view: boolean; record: boolean; confirm: boolean; manage: boolean };
export type FinanceTone = 'overdue' | 'soon' | 'later';
export type FinanceOpeningStatus = 'not_needed' | 'todo' | 'pending' | 'done';
export type FinanceIssue = 'internal_partner' | 'tiny_amount' | 'same_person_statement' | 'after_opening' | 'pending_cancel';

export interface FinancePayablesList {
  today: string; cutoverDate: string; defaultPaymentDays: number; can: FinanceCan;
  totals: { owed: number; docCount: number; supplierCount: number; overdue: number; overdueCount: number; soon: number; soonCount: number;
    noDueCount: number; issues: number; openingPendingSuppliers: number; pendingExternal: number };
  pendingStatements: { count: number; amount: number };
  projects: Array<{ id: string; code: string | null; name: string | null }>;
  suppliers: FinanceSupplierSummary[];
}
export interface FinanceSupplierSummary {
  supplierId: string; name: string; internal: boolean; owed: number; overdue: number; soon: number; pendingExternal: number;
  docCount: number; nextDue: string | null; projects: Array<string | null>; issues: number; opening: FinanceOpeningStatus; worst: FinanceTone;
}
export interface FinanceDocument {
  id: string; code: string; documentNo: string; sourceType: string; origin: string | null;
  projectId: string | null; projectCode: string | null; projectName: string | null; contractId: string | null; contractCode: string | null;
  documentDate: string; dueDate: string | null; dueSource: 'contract' | 'supplier' | 'default' | 'manual' | null;
  recognized: number; credit: number; paid: number; outstanding: number; pendingExternal: number; status: string;
  issues: FinanceIssue[]; createdAt: string;
  provenance: Record<string, string | number | null> | null;
  pendingAdjustment: { id: string; kind: 'cancel'; reason: string; createdBy: string; createdByName: string | null; createdAt: string } | null;
}
export interface FinancePayment {
  id: string; code: string; status: 'submitted' | 'paid' | 'cancelled' | 'reversed' | string; rowVersion: number; external: boolean;
  projectId: string | null; projectCode: string | null; paymentDate: string; amount: number; method: string; documentRef: string | null;
  note: string | null; attachments: FinanceAttachment[]; createdBy: string | null; createdByName: string | null; createdAt: string;
  paidByName: string | null; paidAt: string | null; rejection: { reason: string; byName: string; at: string } | null; reversal: string | null;
  allocations: Array<{ documentId: string; documentNo: string; amount: number }> | null;
  /** 'advance' = phiếu chi tạm ứng; phân bổ là các lần cấn trừ vào chứng từ. */
  kind?: string; requestCode?: string | null;
}
export interface FinanceOpening {
  id: string; projectId: string; projectCode: string | null; status: 'draft' | 'submitted' | 'confirmed' | 'rejected' | 'cancelled';
  revision: number; cutoverDate: string; misaAmount: number; viooOutstanding: number | null; openingAmount: number | null;
  note: string | null; attachments: FinanceAttachment[]; reviewedDocumentIds: string[];
  createdBy: string; createdByName: string | null; createdAt: string; submittedByName: string | null; submittedAt: string | null;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; openingDocumentId: string | null;
}
export interface FinanceEvent { action: string; entityType: string; actorName: string | null; reason: string | null; payload: Record<string, unknown>; at: string }
export interface FinanceSupplierDetail {
  today: string; cutoverDate: string; defaultPaymentDays: number; can: FinanceCan; currentUserId: string;
  supplier: { id: string; name: string; code: string | null; taxCode: string | null; bankName: string | null; bankAccount: string | null;
    internal: boolean; internalReason: string | null; terms: { paymentDays: number; note: string | null; updatedAt: string; updatedByName: string | null } | null };
  contracts: Array<{ id: string; code: string; status: string; paymentTermDays: number | null; paymentTermsText: string | null; requireInvoice: boolean }>;
  documents: FinanceDocument[]; payments: FinancePayment[]; openings: FinanceOpening[]; events: FinanceEvent[];
}
export type FinanceVatChoice = '0' | '5' | '8' | '10' | 'incl';
export interface FinanceDirectReceipt {
  id: string; rowVersion: number; date: string; note: string | null; warehouseId: string; warehouse: string;
  projectId: string | null; projectCode: string | null; cutoverDate: string | null; beforeCutover: boolean;
  supplierId: string | null; supplierName: string | null; contractCode: string | null;
  createdByName: string | null; approvedByName: string | null; attachments: number; value: number; missingPrice: number;
  lines: Array<{ index: number; itemId: string; itemName: string; unit: string | null; qty: number; price: number; catalogPrice: number | null;
    vatRate: number | 'incl' | null; priceIncludesVat: boolean }>;
  duplicateOf: string | null; canPost: boolean;
  returned: { reason: string; at: string; byName: string | null } | null;
}
export interface FinanceDirectReceipts { receipts: FinanceDirectReceipt[]; returned: FinanceDirectReceipt[]; can: { record: boolean } }
export type FinanceRequestStatus = 'pending' | 'returned' | 'approved' | 'paid' | 'rejected' | 'withdrawn' | 'cancelled' | 'reversed';
export interface FinanceRouteStep { label: string; approverIds: string[]; eligibleIds: string[]; approverNames: string[]; eligibleNames: string[]; extra?: boolean }
export interface FinanceRoutePreview {
  route: { versionId: string; tierNo: number; amount: number; priorAmount: number; priorRequests: Array<{ code: string; amount: number; status: string }>;
    thresholdAmount: number; steps: FinanceRouteStep[]; handlerNames: string[]; problemStep: string | null };
  bank: { bankName: string | null; account: string } | null; internal: boolean; reserved: Record<string, number>; canRecord: boolean;
}
export interface FinancePaymentRequest {
  id: string; code: string; supplierId: string; supplierName: string; method: 'bank_transfer' | 'cash'; bank: { bankName: string | null; account: string } | null;
  plannedDate: string; amount: number; note: string | null; status: FinanceRequestStatus; route: FinanceRouteStep[]; currentStep: number;
  thresholdAmount: number; priorRequests: Array<{ code: string; amount: number; status: string }>;
  paid: { paymentDate: string; documentRef: string; attachments: FinanceAttachment[]; byName: string | null; at: string; note: string | null;
    batches: Array<{ batchId: string; projectId: string | null; amount: number }>; reversal?: { reason: string; byName: string | null; at: string } } | null;
  createdBy: string; createdByName: string | null; createdAt: string; rowVersion: number; submissionNo: number;
  lines: Array<{ documentId: string; documentNo: string; code: string; sourceType: string; projectId: string | null; projectCode: string | null; amount: number; outstandingSnapshot: number; dueDate: string | null }>;
  steps: Array<{ submissionNo: number; stepNo: number | null; label: string; action: string; actorName: string | null; reason: string | null; at: string }>;
  canApprove: boolean; canWithdraw: boolean; canResubmit: boolean; canCancel: boolean; canConfirm: boolean; canReverse: boolean;
  /** 'advance' = đề nghị tạm ứng NCC (không có chứng từ; gắn PO hoặc HĐ nguyên tắc). */
  kind?: 'payable' | 'advance';
  advance?: { purchaseOrderId: string | null; poNumber: string | null; contractId: string | null; contractCode: string | null; projectId: string | null;
    projectCode: string | null; base: number | null; percent: number | null; repayDueDate: string; offset: number } | null;
}
export interface FinancePaymentRequests {
  counts: { request: number; approved: number; approvedAmount: number; paid: number; waitingMe: number };
  requests: FinancePaymentRequest[];
}
export interface FinancePendingStatement {
  id: string; code: string; supplierId: string; supplierName: string; contractCode: string | null; projectId: string; projectCode: string | null;
  periodMonth: string | null; statementDate: string | null; grossAmount: number; vatAmount: number; totalAmount: number;
  createdByName: string | null; confirmedByName: string | null; confirmedAt: string | null; canPost: boolean;
}
export interface FinanceApprovalStep { label: string; approvers: Array<{ id: string; name: string; active: boolean }> }
export interface FinanceSettings {
  can: FinanceCan;
  settings: { defaultPaymentDays: number; cutoverDate: string; rowVersion: number; updatedAt: string; updatedByName: string | null;
    advanceWarnPercent: number; advanceExtraPercent: number; advanceExtraApproverIds: string[]; advanceGraceDays: number };
  /** Ai đang giữ từng quyền Tài chính (Admin luôn có đủ). */
  responsibilities: Record<'view' | 'record' | 'confirm' | 'manage', Array<{ id: string; name: string; admin: boolean }>>;
  matrix: { id: string; versionNo: number; note: string | null; createdAt: string; createdByName: string | null;
    rules: Array<{ tierNo: number; minAmount: number; maxAmount: number | null; steps: FinanceApprovalStep[] }> };
  versions: Array<{ versionNo: number; note: string | null; createdAt: string; createdByName: string | null; current: boolean }>;
  delegations: Array<{ id: string; fromUserId: string; fromName: string; toUserId: string; toName: string; validFrom: string; validTo: string;
    reason: string; createdByName: string | null; revokedAt: string | null; revokeReason: string | null }>;
  users: Array<{ id: string; name: string }>;
}
export interface FinanceCostCutovers {
  cutovers: Array<{ projectId: string; projectCode: string | null; projectName: string | null; cutoverDate: string; note: string;
    updatedAt: string; updatedByName: string | null; overlapCount: number; overlapAmount: number }>;
  projects: Array<{ id: string; code: string | null; name: string | null }>;
}
export type FinanceTransferReason = 'no_value' | 'dirty_stock' | 'no_average' | 'price_outlier';
export interface FinanceTransferReview {
  transactionId: string; date: string; note: string | null;
  sourceWarehouse: string | null; targetWarehouse: string | null; sourceProject: string | null; targetProject: string | null;
  lines: Array<{ itemId: string; itemName: string; unit: string | null; qty: number; unitPrice: number; amount: number;
    refPrice: number | null; reason: FinanceTransferReason | null; suggested: number | null }>;
  ledgerValue: number; suggested: number | null; flaggedAt: string; canConfirm: boolean;
}
export interface FinanceAttachment { name: string; path: string; size: number; type: string; uploadedAt: string }

const ERROR_MESSAGES: Record<string, string> = {
  FINANCE_VIEW_DENIED: 'Bạn chưa có quyền xem Tài chính. Nhờ quản trị cấp quyền "Tài chính — Xem công nợ toàn công ty".',
  FINANCE_RECORD_DENIED: 'Bạn chưa có quyền Tài chính — Ghi nhận.',
  FINANCE_CONFIRM_DENIED: 'Bạn chưa có quyền Tài chính — Xác nhận.',
  FINANCE_MANAGE_DENIED: 'Chỉ Admin hoặc Quản trị Tài chính được sửa phần này.',
  FINANCE_SELF_CONFIRM: 'Người xác nhận phải khác người lập, người duyệt và người đã nhận hàng / chốt đối soát — kể cả Admin.',
  FINANCE_WITHDRAW_DENIED: 'Chỉ người lập được rút khi còn chờ xác nhận.',
  FINANCE_REASON_REQUIRED: 'Nhập lý do.',
  FINANCE_PAYMENT_DATE_INVALID: 'Ngày chi không hợp lệ (không được sau hôm nay).',
  FINANCE_PAYMENT_REF_REQUIRED: 'Nhập số UNC / phiếu chi.',
  FINANCE_PAYMENT_REF_DUPLICATE: 'Số UNC / phiếu chi này đã được ghi cho NCC — kiểm tra có ghi trùng không.',
  FINANCE_PAYMENT_METHOD_INVALID: 'Hình thức chi không hợp lệ.',
  FINANCE_ATTACHMENT_REQUIRED: 'Đính kèm UNC / phiếu chi (ảnh hoặc PDF).',
  FINANCE_ALLOCATIONS_REQUIRED: 'Chọn ít nhất một chứng từ và số tiền đã trả.',
  FINANCE_AMOUNT_INVALID: 'Số tiền không hợp lệ.',
  FINANCE_OVER_OUTSTANDING: 'Số tiền lớn hơn phần còn nợ của chứng từ (đã trừ khoản đang chờ xác nhận).',
  FINANCE_DOCUMENT_SCOPE: 'Chứng từ không thuộc NCC / dự án đã chọn.',
  FINANCE_DUPLICATE_DOCUMENT: 'Một chứng từ được chọn hai lần.',
  FINANCE_INTERNAL_PARTNER: 'Đây là đơn vị nội bộ của công ty — không chi tiền. Đề xuất hủy công nợ (điều chuyển nội bộ).',
  FINANCE_PERIOD_LOCKED: 'Kỳ kế toán của ngày này đã khóa.',
  FINANCE_PAYMENT_NOT_FOUND: 'Khoản chi không còn. Tải lại.',
  FINANCE_PAYMENT_STATE: 'Khoản chi đã được xử lý. Tải lại.',
  FINANCE_OPENING_EXISTS: 'NCC × dự án này đã có phiên đối chiếu đầu kỳ.',
  FINANCE_OPENING_NOT_FOUND: 'Phiên đối chiếu không còn. Tải lại.',
  FINANCE_OPENING_STATE: 'Phiên đối chiếu đã đổi trạng thái. Tải lại.',
  FINANCE_OPENING_PENDING_ITEMS: 'Còn khoản chi ngoài hệ thống hoặc đề xuất hủy đang chờ xác nhận — xử lý xong rồi gửi đối chiếu.',
  FINANCE_OPENING_VIOO_HIGHER: 'Số Vioo đang ghi nợ cao hơn sổ MISA: ghi các khoản đã trả ngoài hệ thống (hoặc đề xuất hủy chứng từ sai) trước khi gửi.',
  FINANCE_OPENING_STALE: 'Số nợ Vioo đã thay đổi kể từ lúc gửi. Trả lại để người lập kiểm tra và gửi lại.',
  FINANCE_OPENING_HAS_PAYMENTS: 'Số dư đầu kỳ đã có khoản chi — không đảo được.',
  FINANCE_TRANSFER_NOT_COMPLETED: 'Phiếu chuyển không còn ở trạng thái hoàn tất (có thể đã hủy). Tải lại.',
  FINANCE_TRANSFER_ALREADY_CONFIRMED: 'Phiếu chuyển này đã được xác nhận chi phí. Tải lại.',
  FINANCE_VAT_REQUIRED: 'Chọn thuế VAT cho phiếu.',
  FINANCE_DIRECT_RECEIPT_REQUIRED: 'Chọn ít nhất một phiếu nhập.',
  FINANCE_DIRECT_RECEIPT_STATE: 'Phiếu nhập đã đổi trạng thái (kho vừa sửa hoặc hủy). Tải lại.',
  FINANCE_DIRECT_RECEIPT_POSTED: 'Phiếu nhập này đã được ghi công nợ. Tải lại.',
  FINANCE_DIRECT_RECEIPT_SELF_POST: 'Bạn lập hoặc duyệt phiếu nhập này — nhờ kế toán khác ghi nợ.',
  FINANCE_SUPPLIER_REQUIRED: 'Phiếu nhập chưa gắn nhà cung cấp — trả lại kho để bổ sung.',
  FINANCE_DUPLICATE_UNCHECKED: 'Có phiếu nghi trùng — đối chiếu với kho rồi tích xác nhận.',
  FINANCE_PRICE_REQUIRED: 'Nhập đơn giá cho các dòng chưa có giá.',
  FINANCE_STOCK_BALANCE_MISMATCH: 'Sổ kho của vật tư không khớp để cập nhật giá — báo quản trị kiểm tra.',
  FINANCE_SUPPLIER_BANK_REQUIRED: 'NCC chưa có số tài khoản — Mua hàng cập nhật ở hồ sơ đối tác, hoặc chọn chi tiền mặt.',
  FINANCE_NO_ELIGIBLE_APPROVER: 'Bước duyệt không còn người hợp lệ (người lập / người xử lý chứng từ không được duyệt). Nhờ Quản trị Tài chính thêm người dự phòng hoặc ủy quyền.',
  FINANCE_NOT_APPROVER: 'Bạn không phải người duyệt bước này (hoặc đã duyệt bước trước / là người lập / đã xử lý chứng từ).',
  FINANCE_REQUEST_STATE: 'Đề nghị chi đã đổi trạng thái. Tải lại.',
  FINANCE_REQUEST_NOT_FOUND: 'Đề nghị chi không còn. Tải lại.',
  FINANCE_MATRIX_MISSING: 'Chưa có ma trận duyệt chi hiện hành — Quản trị Tài chính cấu hình ở Quản trị.',
  FINANCE_DOCUMENT_NOT_FOUND: 'Chứng từ không còn. Tải lại.',
  FINANCE_DOCUMENT_HAS_PAYMENTS: 'Chứng từ đã có khoản chi (hoặc đang chờ xác nhận) — không hủy được.',
  FINANCE_ADJUSTMENT_PENDING: 'Chứng từ đang có đề xuất hủy chờ xác nhận.',
  FINANCE_ADJUSTMENT_STATE: 'Đề xuất đã được xử lý. Tải lại.',
  FINANCE_DOCUMENT_STATE: 'Chứng từ không còn mở.',
  FINANCE_DUE_BEFORE_DOCUMENT: 'Hạn thanh toán không được trước ngày ghi nợ.',
  FINANCE_TERMS_INVALID: 'Số ngày trả chậm phải từ 0 đến 365.',
  FINANCE_SUPPLIER_NOT_FOUND: 'Không tìm thấy NCC.',
  FINANCE_CONTRACT_NOT_FOUND: 'Không tìm thấy hợp đồng.',
  FINANCE_MATRIX_INVALID: 'Ma trận duyệt chưa hợp lệ.',
  FINANCE_MATRIX_GAP: 'Các mức tiền phải liền nhau, bắt đầu từ 0, không chồng lấn.',
  FINANCE_MATRIX_OPEN_END: 'Mức cuối cùng phải để trống "đến" (không giới hạn).',
  FINANCE_MATRIX_STEP_REQUIRED: 'Mỗi mức cần ít nhất một bước, mỗi bước có tên và ít nhất một người duyệt đang làm việc.',
  FINANCE_DELEGATION_INVALID: 'Ủy quyền chưa hợp lệ (người nhận khác người ủy quyền, ngày kết thúc không trước ngày bắt đầu).',
  FINANCE_DELEGATION_STATE: 'Ủy quyền đã được thu hồi.',
  FINANCE_ACTION_INVALID: 'Thao tác không hợp lệ.',
  FINANCE_ADVANCE_TARGET_REQUIRED: 'Chọn đơn hàng hoặc hợp đồng nguyên tắc để gắn tạm ứng.',
  FINANCE_ADVANCE_TARGET_SCOPE: 'Đơn hàng / hợp đồng không thuộc NCC này.',
  FINANCE_ADVANCE_TARGET_CLOSED: 'Đơn hàng / hợp đồng đã kết thúc (giao đủ, hủy hoặc hết hạn) — không tạm ứng thêm.',
  FINANCE_ADVANCE_CONTRACT_ORDER: 'Đơn gọi hàng theo HĐ nguyên tắc: tạm ứng theo hợp đồng (chọn "Theo HĐ nguyên tắc").',
  FINANCE_ADVANCE_OVER_ORDER: 'Tổng tạm ứng của đơn vượt giá trị đơn (gồm VAT).',
  FINANCE_ADVANCE_DUE_INVALID: 'Chọn hạn hoàn ứng từ hôm nay trở đi.',
  FINANCE_ADVANCE_STATE: 'Tạm ứng đã đổi trạng thái (chưa chi, đã đảo hoặc đã hết). Tải lại.',
  FINANCE_ADVANCE_DOCUMENT_SCOPE: 'Chứng từ không cùng NCC, dự án hoặc đơn / HĐ với tạm ứng.',
  FINANCE_ADVANCE_OVER: 'Số tiền lớn hơn tạm ứng còn lại hoặc phần còn nợ của chứng từ.',
  FINANCE_ADVANCE_OFFSET_STATE: 'Lần cấn trừ này đã được hoàn tác. Tải lại.',
  FINANCE_ADVANCE_HAS_OFFSETS: 'Tạm ứng đã cấn trừ vào công nợ — hoàn tác cấn trừ trước khi đảo phiếu chi.',
  FINANCE_ADVANCE_HAS_ADJUSTMENTS: 'Tạm ứng có phiếu hoàn / chuyển đang chờ hoặc đã xác nhận — xử lý trước khi đảo phiếu chi.',
  FINANCE_ADVANCE_ADJUSTMENT_PENDING: 'Tạm ứng đang có phiếu hoàn / chuyển chờ xác nhận — xử lý xong rồi lập tiếp.',
  FINANCE_ADVANCE_TRANSFER_SCOPE: 'Chỉ chuyển sang đơn khác của cùng NCC, cùng dự án (không phải đơn theo HĐ nguyên tắc).',
  FINANCE_ADVANCE_TRANSFER_PO_ONLY: 'Chỉ chuyển được tạm ứng gắn đơn hàng.',
  FINANCE_ADVANCE_SETTINGS_INVALID: 'Thông số chưa hợp lệ: ngưỡng cảnh báo ≤ ngưỡng duyệt thêm ≤ 100%, số ngày 0–365, người duyệt đang làm việc.',
  FINANCE_ADVANCE_EXTRA_APPROVER_REQUIRED: 'Chọn ít nhất một người duyệt tạm ứng vượt ngưỡng.',
  ROW_VERSION_CONFLICT: 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.',
  PROCUREMENT_STATEMENT_POST_DENIED: 'Bạn chưa có quyền ghi công nợ cho dự án này.',
  PROCUREMENT_STATEMENT_SELF_POST: 'Người ghi công nợ phải khác người chốt bảng đối soát.',
  PROCUREMENT_STATEMENT_STATE: 'Bảng đối soát đã đổi trạng thái. Tải lại.',
  PROCUREMENT_PO_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không thực hiện được. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const FINANCE_BUCKET = 'finance-attachments';
const safeName = (name: string) => name.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'file';

export interface FinanceOverviewProject {
  id: string; code: string; name: string; status: string | null;
  /** null = chưa khai HĐ chủ đầu tư. */
  contractValue: number | null;
  /** Tiến độ theo Gantt (như màn dự án); null = chưa có kế hoạch. */
  progress: number | null;
  received: number; advanceReceived: number | null; cost: number;
  costByCategory: Record<string, number>;
  months: Array<{ month: string; in: number | null; out: number | null }>;
  materialBudget: number | null;
  payable: { outstanding: number; overdue: number; soon: number; docs: number };
  /** Tạm ứng NCC còn lại (đã chi, chưa cấn trừ / hoàn); null = không có. */
  supplierAdvance?: number | null;
  receivables: Array<{ description: string; amount: number; paidAmount: number | null; dueDate: string | null; paidDate: string | null; status: string; advance: boolean }>;
}
export interface FinanceOverview {
  canOverview: boolean; today: string; projects: FinanceOverviewProject[];
  companyPayable?: { outstanding: number; docs: number };
  advances?: { remaining: number; overdue: number; overdueCount: number; refundDue: number; refundDueCount: number } | null;
}

export type FinanceAdvanceState = 'approving' | 'to_pay' | 'open' | 'refund_due' | 'settled' | 'reversed' | 'closed';
export interface FinanceAdvanceAdjustment {
  id: string; kind: 'refund' | 'transfer'; amount: number; status: 'submitted' | 'confirmed' | 'rejected' | 'withdrawn' | 'reversed';
  targetPoNumber: string | null; sourcePoNumber: string | null; paymentDate: string | null; documentRef: string | null; attachments: FinanceAttachment[];
  reason: string; createdBy: string; createdByName: string | null; createdAt: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  canDecide: boolean; canWithdraw: boolean; canReverse: boolean;
}
export interface FinanceAdvance {
  id: string; code: string; status: FinanceRequestStatus; state: FinanceAdvanceState; supplierId: string; supplierName: string;
  projectId: string | null; projectCode: string | null; purchaseOrderId: string | null; supplierContractId: string | null;
  target: { kind: 'po' | 'contract'; no: string; status: string | null; expectedDate: string | null; base: number | null; received: number | null } | null;
  amount: number; percent: number | null; base: number | null; offset: number; refunded: number; remaining: number;
  repayDueDate: string; overdue: boolean; note: string | null; createdByName: string | null; createdAt: string; rowVersion: number;
  paid: { paymentDate: string; documentRef: string; byName: string | null; attachments: FinanceAttachment[]; reversal: { reason: string; byName: string | null; at: string } | null } | null;
  currentStepLabel: string | null;
  offsets: Array<{ id: string; documentId: string; documentNo: string; amount: number; released: number; mode: 'auto' | 'manual'; status: 'active' | 'released';
    at: string; byName: string | null; releasedAt: string | null; releasedByName: string | null; releaseKind: 'manual' | 'return' | 'document_cancel' | null; releaseReason: string | null }>;
  adjustments: FinanceAdvanceAdjustment[];
  candidates: Array<{ documentId: string; documentNo: string; documentDate: string; available: number }>;
  transferTargets: Array<{ id: string; poNumber: string; expectedDate: string | null; base: number }>;
  canAct: boolean; canRelease: boolean;
}
export interface FinanceAdvances {
  today: string; can: FinanceCan; currentUserId: string;
  totals: { remaining: number; openCount: number; overdue: number; overdueCount: number; refundDue: number; refundDueCount: number;
    approving: number; approvingAmount: number; adjustmentsWaiting: number; adjustmentsWaitingMe: number };
  advances: FinanceAdvance[];
}
export interface FinanceAdvanceOrder {
  id: string; poNumber: string; status: string; projectId: string | null; projectCode: string | null; expectedDate: string | null; vatRate: number | null;
  base: number; received: number; advanced: number; items: string | null;
}
export interface FinanceAdvanceOptions {
  today: string; can: FinanceCan;
  settings: { warnPercent: number; extraPercent: number; graceDays: number };
  supplier: { id: string; name: string; bankName: string | null; bankAccount: string | null; internal: boolean };
  orders: FinanceAdvanceOrder[];
  contracts: Array<{ id: string; code: string; name: string; status: string | null; value: number | null; expiryDate: string | null; projectId: string | null }>;
  projects: Array<{ id: string; code: string | null; name: string | null }>;
}
export interface FinanceAdvanceSupplier { id: string; name: string; hasBank: boolean; orders: number; value: number }
export interface FinanceAdvancePreview {
  route: FinanceRoutePreview['route'] & { percent: number | null; warnPercent: number; extraPercent: number; extraCovered?: boolean };
  target: { base: number | null; received: number | null; other: number; poNumber: string | null; contractCode: string | null; expectedDate: string | null;
    projectId: string | null; available: number | null };
  bank: { bankName: string | null; account: string } | null; internal: boolean; canRecord: boolean;
}
export interface FinanceAdvanceInput {
  requestId?: string; expectedRowVersion?: number; supplierId: string; purchaseOrderId?: string | null; contractId?: string | null; projectId?: string | null;
  amount: number; repayDueDate: string; method: 'bank_transfer' | 'cash'; plannedDate: string; note: string;
}

export const financeService = {
  list(filter: { projectId?: string; source?: string } = {}) { return call<FinancePayablesList>('list_finance_payables_v1', { p_filter: filter }); },
  /** Tổng quan toàn công ty + sức khỏe từng dự án (chỉ Tài chính — Quản trị / Admin). */
  overview() { return call<FinanceOverview>('get_finance_overview_v1', {}); },
  supplier(supplierId: string) { return call<FinanceSupplierDetail>('get_finance_supplier_v1', { p_supplier_id: supplierId }); },
  directReceipts() { return call<FinanceDirectReceipts>('list_finance_direct_receipts_v1', {}); },
  postDirectReceipts(input: { receipts: Array<{ transactionId: string; rowVersion: number; prices?: Record<string, number> }>; vat: FinanceVatChoice; invoiceNo?: string; duplicateChecked?: boolean }) {
    return call<{ documents: Array<{ transactionId: string; code: string; amount: number }>; total: number }>('post_finance_direct_receipts_v1', { p_input: input });
  },
  returnDirectReceipts(input: { transactionIds: string[]; reason: string }) {
    return call<{ returned: number }>('return_finance_direct_receipts_v1', { p_input: input });
  },
  paymentRequests(stage: 'request' | 'approved' | 'paid' | 'closed' | 'all') { return call<FinancePaymentRequests>('list_finance_payment_requests_v1', { p_filter: { stage } }); },
  previewPaymentRequest(input: { supplierId: string; requestId?: string; lines: Array<{ documentId: string; amount: number }> }) {
    return call<FinanceRoutePreview>('preview_finance_payment_request_v1', { p_input: input });
  },
  savePaymentRequest(input: { requestId?: string; expectedRowVersion?: number; supplierId: string; method: 'bank_transfer' | 'cash'; plannedDate: string; note?: string;
    lines: Array<{ documentId: string; amount: number }> }) {
    return call<{ requestId: string; code: string; amount: number }>('save_finance_payment_request_v1', { p_input: input });
  },
  decidePaymentRequest(input: { requestId: string; expectedRowVersion: number; action: 'approve' | 'return' | 'reject' | 'withdraw' | 'cancel'; reason?: string }) {
    return call<{ status: FinanceRequestStatus; currentStep: number }>('decide_finance_payment_request_v1', { p_input: input });
  },
  confirmPaymentRequest(input: { requestId: string; expectedRowVersion: number; paymentDate: string; documentRef: string; attachments: FinanceAttachment[]; note?: string }) {
    return call<{ status: FinanceRequestStatus }>('confirm_finance_payment_request_v1', { p_input: input });
  },
  reversePaymentRequest(input: { requestId: string; expectedRowVersion: number; reason: string }) {
    return call<{ status: FinanceRequestStatus }>('reverse_finance_payment_request_v1', { p_input: input });
  },
  advances(supplierId?: string) { return call<FinanceAdvances>('list_finance_advances_v1', { p_filter: supplierId ? { supplierId } : {} }); },
  advanceSuppliers() { return call<{ suppliers: FinanceAdvanceSupplier[] }>('get_finance_advance_options_v1', { p_supplier_id: null }); },
  advanceOptions(supplierId: string) { return call<FinanceAdvanceOptions>('get_finance_advance_options_v1', { p_supplier_id: supplierId }); },
  previewAdvance(input: { supplierId: string; requestId?: string; purchaseOrderId?: string | null; contractId?: string | null; projectId?: string | null; amount: number }) {
    return call<FinanceAdvancePreview>('preview_finance_advance_v1', { p_input: input });
  },
  saveAdvance(input: FinanceAdvanceInput) { return call<{ requestId: string; code: string; amount: number }>('save_finance_advance_request_v1', { p_input: input }); },
  releaseAdvanceOffset(input: { offsetId: string; reason: string }) { return call<{ released: number }>('release_finance_advance_offset_v1', { p_input: input }); },
  applyAdvanceOffset(input: { requestId: string; documentId: string; amount: number }) { return call<{ amount: number }>('apply_finance_advance_offset_v1', { p_input: input }); },
  saveAdvanceAdjustment(input: { requestId: string; kind: 'refund' | 'transfer'; reason: string; amount?: number; paymentDate?: string; documentRef?: string;
    attachments?: FinanceAttachment[]; targetPurchaseOrderId?: string }) {
    return call<{ adjustmentId: string }>('save_finance_advance_adjustment_v1', { p_input: input });
  },
  decideAdvanceAdjustment(input: { adjustmentId: string; action: 'confirm' | 'reject' | 'withdraw' | 'reverse'; reason?: string }) {
    return call<{ adjustmentId: string }>('decide_finance_advance_adjustment_v1', { p_input: input });
  },
  saveAdvanceSettings(input: { warnPercent: number; extraPercent: number; graceDays: number; extraApproverIds: string[]; expectedRowVersion: number; reason: string }) {
    return call<{ ok: boolean }>('save_finance_advance_settings_v1', { p_input: input });
  },
  pendingStatements() { return call<FinancePendingStatement[]>('list_finance_pending_statements_v1', {}); },
  postStatement(input: { statementId: string; action: 'post' | 'return'; reason?: string }) {
    return call<{ statementId: string; status: string }>('transition_procurement_contract_statement_v1', { p_input: input });
  },
  settings() { return call<FinanceSettings>('get_finance_settings_v1', {}); },
  transferReviews() { return call<FinanceTransferReview[]>('list_finance_transfer_reviews_v1', {}); },
  confirmTransferCost(input: { transactionId: string; amount: number; reason?: string }) {
    return call<{ amount: number; suggested: number | null }>('confirm_finance_transfer_cost_v1', { p_input: input });
  },
  costCutovers() { return call<FinanceCostCutovers>('get_finance_cost_cutovers_v1', {}); },
  saveCostCutover(input: { projectId: string; cutoverDate: string | null; note?: string; reason: string }) {
    return call<{ expenseBefore: number; expenseAfter: number }>('save_finance_cost_cutover_v1', { p_input: input });
  },
  saveSupplierTerms(input: { supplierId: string; paymentDays: number | null; note?: string; applyToOpen: boolean; reason: string }) {
    return call<{ recomputed: number }>('save_finance_supplier_terms_v1', { p_input: input });
  },
  saveContractTerms(input: { contractId: string; paymentDays: number | null; requireInvoice: boolean; applyToOpen: boolean; reason: string }) {
    return call<{ recomputed: number }>('save_finance_contract_terms_v1', { p_input: input });
  },
  setDue(input: { documentId: string; dueDate: string | null; reason: string }) { return call<{ documentId: string }>('set_finance_payable_due_v1', { p_input: input }); },
  saveExternalPayment(input: { supplierId: string; projectId: string | null; paymentDate: string; method: 'bank_transfer' | 'cash' | 'other'; documentRef: string;
    note?: string; attachments: FinanceAttachment[]; allocations: Array<{ documentId: string; amount: number }> }) {
    return call<{ paymentId: string; amount: number }>('save_finance_external_payment_v1', { p_input: input });
  },
  decideExternalPayment(input: { paymentId: string; action: 'confirm' | 'reject' | 'withdraw' | 'reverse'; reason?: string; expectedRowVersion: number }) {
    return call<{ paymentId: string; status: string }>('decide_finance_external_payment_v1', { p_input: input });
  },
  saveOpening(input: { id?: string; expectedRevision?: number; supplierId: string; projectId: string; misaAmount: number; note?: string;
    attachments: FinanceAttachment[]; reviewedDocumentIds: string[] }) {
    return call<{ id: string; revision: number }>('save_finance_opening_v1', { p_input: input });
  },
  transitionOpening(input: { id: string; expectedRevision: number; action: 'submit' | 'confirm' | 'reject' | 'cancel'; reason?: string }) {
    return call<{ id: string; status: string; revision: number }>('transition_finance_opening_v1', { p_input: input });
  },
  requestCancel(input: { documentId: string; reason: string }) { return call<{ adjustmentId: string }>('request_finance_payable_cancel_v1', { p_input: input }); },
  decideAdjustment(input: { adjustmentId: string; action: 'confirm' | 'reject' | 'withdraw'; reason?: string }) {
    return call<{ adjustmentId: string }>('decide_finance_payable_adjustment_v1', { p_input: input });
  },
  saveSettings(input: { defaultPaymentDays: number; expectedRowVersion: number; applyToOpen: boolean; reason: string }) {
    return call<{ recomputed: number }>('save_finance_settings_v1', { p_input: input });
  },
  saveMatrix(input: { note: string; rules: Array<{ minAmount: number; maxAmount: number | null; steps: Array<{ label: string; approverIds: string[] }> }> }) {
    return call<{ versionNo: number }>('save_finance_approval_matrix_v1', { p_input: input });
  },
  saveDelegation(input: { fromUserId: string; toUserId: string; validFrom: string; validTo: string; reason: string }) {
    return call<{ id: string }>('save_finance_delegation_v1', { p_input: input });
  },
  revokeDelegation(input: { id: string; reason: string }) { return call<{ id: string }>('save_finance_delegation_v1', { p_input: { ...input, action: 'revoke' } }); },
  async upload(supplierId: string, files: File[]): Promise<FinanceAttachment[]> {
    const out: FinanceAttachment[] = [];
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) throw new Error(`Tệp ${file.name} vượt quá 25 MB.`);
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `${supplierId}/${id}-${safeName(file.name)}`;
      const { error } = await supabase.storage.from(FINANCE_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw new Error(`Không tải được ${file.name}: ${error.message}`);
      out.push({ name: file.name, path, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
    }
    return out;
  },
  async openAttachment(path: string) {
    const { data, error } = await supabase.storage.from(FINANCE_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new Error('Không mở được tệp.');
    window.open(data.signedUrl, '_blank', 'noopener');
  },
};

export const ISSUE_LABELS: Record<FinanceIssue, string> = {
  internal_partner: 'Đơn vị nội bộ — không chi tiền; đề xuất hủy công nợ (điều chuyển nội bộ)',
  tiny_amount: 'Giá trị bất thường — kiểm tra đơn giá lúc đối soát',
  same_person_statement: 'Bảng đối soát do cùng một người lập và ghi nợ — cần người khác soát xét khi đối chiếu đầu kỳ',
  after_opening: 'Phát sinh sau khi đã chốt đầu kỳ nhưng có ngày trước mốc — kiểm tra có nằm trong số dư đầu kỳ không',
  pending_cancel: 'Đang có đề xuất hủy chờ xác nhận',
};
export const DUE_SOURCE_LABELS: Record<string, string> = {
  contract: 'theo HĐ', supplier: 'theo NCC', default: 'mặc định công ty', manual: 'sửa tay',
};
export const SOURCE_LABELS: Record<string, string> = {
  purchase_delivery_receipt: 'Nhận hàng PO', direct_supplier_receipt: 'Nhập trực tiếp NCC', supplier_delivery_statement: 'Đối soát HĐ', opening_balance: 'Số dư đầu kỳ',
  supplier_return_credit: 'Trả hàng NCC', manual_adjustment: 'Điều chỉnh', site_direct_purchase: 'Mua nóng', purchase_order: 'PO', supplier_invoice_adjustment: 'Điều chỉnh hóa đơn',
};
export const METHOD_LABELS: Record<string, string> = { bank_transfer: 'Chuyển khoản', cash: 'Tiền mặt', other: 'Khác', site_cash: 'Quỹ công trường', offset: 'Bù trừ' };
export const EVENT_LABELS: Record<string, string> = {
  terms_save: 'Khai hạn thanh toán NCC', contract_terms_save: 'Khai hạn theo HĐ', due_recompute: 'Tính lại hạn', due_set: 'Sửa hạn',
  external_payment_submit: 'Ghi chi ngoài hệ thống', external_payment_confirm: 'Xác nhận chi ngoài', external_payment_reject: 'Từ chối chi ngoài',
  external_payment_withdraw: 'Rút khoản chi', external_payment_reverse: 'Đảo khoản chi',
  opening_save: 'Lưu đối chiếu đầu kỳ', opening_submit: 'Gửi đối chiếu đầu kỳ', opening_confirm: 'Chốt đầu kỳ', opening_reject: 'Trả lại đối chiếu', opening_cancel: 'Hủy / đảo đối chiếu',
  cancel_request: 'Đề xuất hủy công nợ', cost_cutover_save: 'Đổi mốc chi phí MISA', transfer_cost_review: 'Chuyển kho chờ xác nhận giá vốn', transfer_cost_confirm: 'Xác nhận chi phí chuyển kho', cancel_confirm: 'Xác nhận hủy công nợ', cancel_reject: 'Từ chối hủy công nợ', cancel_withdraw: 'Rút đề xuất hủy',
  payment_request_submit: 'Lập / gửi đề nghị chi', payment_request_approve: 'Duyệt đề nghị chi', payment_request_return: 'Trả lại đề nghị chi',
  payment_request_reject: 'Từ chối đề nghị chi', payment_request_withdraw: 'Rút đề nghị chi', payment_request_cancel: 'Hủy đề nghị chi đã duyệt',
  payment_request_paid: 'Xác nhận đã chi', payment_request_reverse: 'Đảo phiếu chi',
  advance_submit: 'Lập đề nghị tạm ứng', advance_paid: 'Chi tạm ứng', advance_offset: 'Cấn trừ tạm ứng vào công nợ', advance_release: 'Hoàn tác cấn trừ tạm ứng',
  advance_refund_submit: 'Ghi NCC hoàn tạm ứng', advance_refund_confirm: 'Xác nhận NCC hoàn tạm ứng', advance_refund_reject: 'Từ chối phiếu hoàn tạm ứng',
  advance_refund_withdraw: 'Rút phiếu hoàn tạm ứng', advance_refund_reverse: 'Đảo phiếu thu hoàn tạm ứng',
  advance_transfer_submit: 'Đề nghị chuyển tạm ứng sang đơn khác', advance_transfer_confirm: 'Xác nhận chuyển tạm ứng', advance_transfer_reject: 'Từ chối chuyển tạm ứng',
  advance_transfer_withdraw: 'Rút đề nghị chuyển tạm ứng', advance_offset_failed: 'Cấn trừ tạm ứng tự động không được — cần cấn tay', advance_settings_save: 'Đổi thông số tạm ứng',
  direct_receipt_post: 'Ghi nợ phiếu nhập trực tiếp', direct_receipt_return: 'Trả lại phiếu nhập cho kho', direct_receipt_cancel: 'Kho hủy phiếu nhập — hủy công nợ',
};
