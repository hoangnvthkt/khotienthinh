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
export interface FinanceRouteStep { label: string; approverIds: string[]; eligibleIds: string[]; approverNames: string[]; eligibleNames: string[]; extra?: boolean; budget?: boolean; fund?: boolean }
/** Vì sao có bước duyệt thêm: khoản mục vượt ngân sách, quỹ dự án âm; dự án chưa chốt đầu kỳ quỹ thì chưa xét được. */
export interface FinanceRouteExtras {
  budgetOver?: Array<{ projectId: string; projectCode: string; item: string; budget: number; projected: number }>;
  fundShort?: Array<{ projectId: string; projectCode: string; balance: number; pending: number; amount: number; after: number }>;
  fundUnknown?: string[];
}
export interface FinanceRoutePreview {
  route: { versionId: string; tierNo: number; amount: number; priorAmount: number; priorRequests: Array<{ code: string; amount: number; status: string }>;
    thresholdAmount: number; steps: FinanceRouteStep[]; handlerNames: string[]; problemStep: string | null } & FinanceRouteExtras;
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
  kind?: 'payable' | 'advance' | 'expense';
  /** Phiếu chi khác (không có NCC): loại chi, dự án và khoản mục chi phí nếu tính vào dự án. */
  expense?: { category: string; costCategory: string | null; projectId: string | null; projectCode: string | null } | null;
  /** Tài khoản tiền đã chi (sổ thu chi). */
  cashEntry?: { accountName: string; date: string } | null;
  advance?: { purchaseOrderId: string | null; poNumber: string | null; contractId: string | null; contractCode: string | null; projectId: string | null;
    /** Tạm ứng gắn HĐ thầu phụ (contractCode là số HĐ thầu phụ). */
    subcontractId?: string | null;
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
    advanceWarnPercent: number; advanceExtraPercent: number; advanceExtraApproverIds: string[]; advanceGraceDays: number; cashMinBalance: number;
    budgetWarnPercent: number; budgetApproverIds: string[]; capitalProviderIds: string[] };
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

// ---------- Tài chính dự án (P1 xuất bản module) ----------
export interface FinanceMyScope { companyView: boolean; can: FinanceCan; projects: Array<{ id: string; code: string; name: string }> }
export interface FinanceProjectPage {
  today: string; cutoverDate: string; companyView: boolean; can: FinanceCan;
  project: { id: string; code: string; name: string; status: string | null; progress: number | null };
  cost: Omit<FinanceCostProjectSummary, keyof FinanceProjectFund>;
  fund: { opening: number | null; openingDate: string | null; received: number; otherIn: number; spent: number; capital: number; flow: number; balance: number | null };
  contracts: Array<{ id: string; code: string; name: string | null; customerName: string; value: number | null; vatPercent: number; endDate: string | null; status: string;
    metrics: CustomerContractMetrics }>;
  subcontracts: Array<{ id: string; code: string; name: string; value: number | null; status: string; metrics: SubcontractMetrics }>;
  payables: Array<{ id: string; code: string; documentNo: string; sourceType: string; supplierId: string; supplierName: string; documentDate: string; dueDate: string | null;
    recognized: number; paid: number; outstanding: number; pendingExternal: number }>;
  months: Array<{ month: string; revenue: number; cost: number; paid: number }>;
  ledger: Array<{ id: string; date: string; type: string; category: string | null; item: string | null; itemName: string | null; amount: number; description: string | null;
    counterparty: string | null; source: string | null; invoiceNo: string | null; payment: boolean }>;
  ledgerTotal: number;
}

// ---------- Thầu phụ (F4) ----------
export type SubcontractIssue = 'no_partner' | 'zero_value' | 'no_signed_date' | 'signed_future' | 'no_project' | 'status' | 'no_retention_due' | 'over_contract' | 'no_bank';
export interface SubcontractMetrics {
  grossValue: number | null; vatPercent: number; vatSource: 'contract' | 'default'; cumulativeNet: number; hasRounds: boolean; cumulativePercent: number | null;
  acceptedGross: number; outstanding: number; overdue: number; retentionHeld: number; retentionDue: string | null; paid: number;
  advanceRemaining: number; advanceRemainingOpening: number; advanceRemainingVioo: number; pitWithheld: number; cost: number;
  recoveryPercent: number; recoveryPercentSource: 'contract' | 'auto'; retentionPercent: number; withholdPit: boolean; pitPercent: number;
  paymentTermDays: number; paymentTermSource: 'contract' | 'default'; warrantyMonths: number | null; retentionDueDate: string | null;
  /** todo = chưa khai đầu kỳ (chưa biết còn nợ / giữ lại / tạm ứng trước mốc). */
  opening: 'todo' | 'submitted' | 'confirmed'; openRound: 'draft' | 'submitted' | null; issues: SubcontractIssue[];
}
export interface SubcontractSummary {
  id: string; code: string; name: string | null; subcontractorName: string; partnerId: string | null; partnerName: string | null; projectId: string | null; projectCode: string | null;
  value: number | null; status: string; signedDate: string | null; completionDate: string | null; withholdPit: boolean;
  lastRound: { sequenceNo: number; status: SubcontractRoundStatus; periodEnd: string | null } | null; metrics: SubcontractMetrics;
}
export interface SubcontractCostReview {
  id: string; projectId: string; projectCode: string; date: string; amount: number; description: string; counterparty: string | null; createdByName: string | null; createdAt: string;
  misa: Array<{ id: string; date: string; amount: number; description: string }>;
}
export interface FinanceSubcontracts {
  today: string; cutoverDate: string; can: FinanceCan; currentUserId: string;
  totals: { contracts: number; value: number; outstanding: number; overdue: number; retentionHeld: number; advanceRemaining: number; pitWithheld: number;
    openingsTodo: number; openingsPending: number; openingsPendingMe: number; roundsSubmitted: number; roundsWaitingMe: number; roundsDraft: number; retentionDue: number };
  contracts: SubcontractSummary[]; reviewCosts: SubcontractCostReview[]; withoutContract: Array<{ name: string; projectCode: string; amount: number }>;
}
export type SubcontractRoundStatus = 'draft' | 'submitted' | 'recognized' | 'cancelled';
export type SubcontractDeductionKind = 'material' | 'service' | 'penalty' | 'other';
export interface SubcontractDeduction { kind: SubcontractDeductionKind; amount: number; reason: string }
export interface SubcontractRound {
  id: string; sequenceNo: number; kind: 'progress' | 'opening'; periodStart: string | null; periodEnd: string | null; description: string;
  cumulativeNet: number; previousNet: number; netAmount: number; vatPercent: number; vatAmount: number; gross: number; advanceRecovery: number; retention: number;
  pit: number; otherDeduction: number; deductions: SubcontractDeduction[]; payable: number; suggestedRecovery: number | null; suggestedRetention: number | null;
  suggestedPit: number | null; adjustReason: string | null; overContractReason: string | null; status: SubcontractRoundStatus; submittedAt: string | null;
  returnReason: string | null; returnedByName: string | null; recognizedDate: string | null; recognizedByName: string | null; dueDate: string | null;
  retentionDueDate: string | null; attachments: FinanceAttachment[]; note: string | null; cancelReason: string | null; createdBy: string; createdByName: string | null;
  createdAt: string; rowVersion: number; paid: number; outstanding: number;
  canEdit: boolean; canSubmit: boolean; canWithdraw: boolean; canDecide: boolean; canCancel: boolean; canReverse: boolean;
}
export interface SubcontractOpening {
  id: string; cutoverDate: string; cumulativeNet: number; paidTotal: number; outstanding: number; outstandingDueDate: string | null; retentionHeld: number;
  retentionDueDate: string | null; advanceRemaining: number; note: string | null; attachments: FinanceAttachment[]; status: 'submitted' | 'confirmed' | 'rejected' | 'cancelled';
  createdBy: string; createdByName: string | null; createdAt: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  canDecide: boolean; canCancel: boolean;
}
export interface SubcontractDetail {
  today: string; cutoverDate: string; can: FinanceCan; currentUserId: string;
  contract: { id: string; code: string; name: string | null; subcontractorName: string; taxCode: string | null; scopeOfWork: string | null; projectId: string | null;
    projectCode: string | null; partnerId: string | null; partner: { id: string; name: string; taxCode: string | null; bankName: string | null; bankAccount: string | null } | null;
    value: number | null; status: string; signedDate: string | null; completionDate: string | null; retentionPercent: number | null; vatPercent: number | null;
    advanceRecoveryPercent: number | null; paymentTermDays: number | null; warrantyMonths: number | null; withholdPit: boolean; pitPercent: number };
  metrics: SubcontractMetrics;
  budget: { item: string; budget: number | null; projected: number } | null;
  manDays: { lines: number; people: number; lastDate: string | null };
  rounds: SubcontractRound[]; openings: SubcontractOpening[];
  documents: Array<{ id: string; code: string; documentNo: string; sourceType: string; documentDate: string; dueDate: string | null; recognized: number; paid: number;
    outstanding: number; pendingExternal: number; status: string }>;
  advances: Array<{ id: string; code: string; status: string; amount: number; offset: number; refunded: number; remaining: number; repayDueDate: string | null; paidDate: string | null }>;
  events: FinanceEvent[]; partners: Array<{ id: string; name: string; taxCode: string | null }>;
}
export interface SubcontractRoundInput {
  id?: string; expectedRowVersion?: number; subcontractId: string; periodStart?: string | null; periodEnd: string; description: string; cumulativeNet: number;
  vatPercent?: number | null; advanceRecovery?: number | null; retention?: number | null; pit?: number | null; deductions: SubcontractDeduction[];
  adjustReason?: string; overContractReason?: string; attachments: FinanceAttachment[]; note?: string;
}
export interface SubcontractRoundPreview {
  previousNet: number; cumulativeNet: number; netAmount: number; vatPercent: number; vatAmount: number; gross: number; advanceRecovery: number; retention: number;
  pit: number; otherDeduction: number; payable: number; suggestedRecovery: number; suggestedRetention: number; suggestedPit: number; overContract: boolean;
  cumulativePercent: number | null; budget: { over: boolean; budget: number | null; projected: number; item: string };
}

const ERROR_MESSAGES: Record<string, string> = {
  FINANCE_VIEW_DENIED: 'Bạn chưa có quyền xem Tài chính. Nhờ quản trị cấp quyền "Tài chính — Xem Tài chính toàn công ty".',
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
  FINANCE_ROUND_KIND_INVALID: 'Loại đợt không hợp lệ.',
  FINANCE_ROUND_DESCRIPTION_REQUIRED: 'Nhập nội dung đợt thu.',
  FINANCE_ROUND_NOT_FOUND: 'Đợt thu không còn. Tải lại.',
  FINANCE_ROUND_STATE: 'Đợt thu đã đổi trạng thái (hoặc là đợt cũ / số dư đầu kỳ — không sửa được). Tải lại.',
  FINANCE_ROUND_ADJUST_REASON: 'Thu hồi tạm ứng / giữ lại khác gợi ý theo HĐ — ghi lý do.',
  FINANCE_ROUND_DEDUCTION_INVALID: 'Thu hồi tạm ứng + giữ lại không được lớn hơn giá trị đợt.',
  FINANCE_ROUND_HAS_RECEIPTS: 'Đợt đã có phiếu thu (chờ xác nhận hoặc đã xác nhận) — đảo / rút phiếu thu trước khi hủy.',
  FINANCE_ROUND_SCOPE: 'Đợt thu không thuộc HĐ này hoặc chưa được CĐT xác nhận.',
  FINANCE_RETENTION_OVER: 'Số đề nghị trả giữ lại lớn hơn số đang bị giữ.',
  FINANCE_INVOICE_REQUIRED: 'Nhập số hóa đơn.',
  FINANCE_DATE_FUTURE: 'Ngày không được sau hôm nay.',
  FINANCE_RECEIPT_REF_REQUIRED: 'Nhập số giấy báo có / phiếu thu.',
  FINANCE_RECEIPT_REF_DUPLICATE: 'Số giấy báo có này đã được ghi cho HĐ — kiểm tra có ghi trùng không.',
  FINANCE_RECEIPT_OVER_ALLOCATED: 'Tổng trừ vào các đợt lớn hơn số tiền còn trống của phiếu thu.',
  FINANCE_RECEIPT_NOT_FOUND: 'Phiếu thu không còn. Tải lại.',
  FINANCE_RECEIPT_STATE: 'Phiếu thu đã đổi trạng thái. Tải lại.',
  FINANCE_GUARANTEE_NOT_FOUND: 'Không tìm thấy bảo lãnh của HĐ chủ đầu tư.',
  FINANCE_GUARANTEE_INVALID: 'Bảo lãnh đang hiệu lực cần số tiền và ngày hết hạn (không trước ngày phát hành).',
  CUSTOMER_RECEIVABLE_FINANCE_ONLY: 'Đợt thu / chứng từ thanh toán của HĐ chủ đầu tư lập và ghi thu ở Tài chính → Phải thu.',
  FINANCE_CASH_ACCOUNT_REQUIRED: 'Chọn tài khoản tiền (tiền ra / vào từ tài khoản nào). Chưa có thì khai ở Thu chi & quỹ.',
  FINANCE_CASH_ACCOUNT_INACTIVE: 'Tài khoản tiền đã ngừng dùng — chọn tài khoản khác.',
  FINANCE_CASH_ACCOUNT_INVALID: 'Nhập tên tài khoản; ngân hàng cần số tài khoản; quỹ công trường cần chọn dự án.',
  FINANCE_CASH_ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản tiền.',
  FINANCE_CASH_ACCOUNT_NOT_EMPTY: 'Tài khoản còn số dư hoặc còn phiếu chờ xác nhận — chuyển hết tiền trước khi ngừng dùng.',
  FINANCE_CASH_ACCOUNT_DIRECT_WRITE: 'Danh mục tài khoản tiền chỉ sửa ở Tài chính → Thu chi & quỹ.',
  FINANCE_CASH_BEFORE_CUTOVER: 'Ngày trước mốc 01/10 — khoản này thuộc sổ MISA, không ghi vào sổ thu chi Vioo.',
  FINANCE_CASH_PERIOD_LOCKED: 'Tháng này của tài khoản đã chốt đối chiếu sao kê — không ghi lùi ngày; ghi điều chỉnh vào tháng sau.',
  FINANCE_CASH_ENTRY_IMMUTABLE: 'Sổ thu chi không sửa / xóa được — đảo phiếu để điều chỉnh.',
  FINANCE_CASH_TRANSFER_SAME: 'Tài khoản chuyển và nhận phải khác nhau.',
  FINANCE_CASH_MOVEMENT_STATE: 'Phiếu đã đổi trạng thái. Tải lại.',
  FINANCE_CASH_PLAN_INVALID: 'Khoản định kỳ chưa hợp lệ (tên, số tiền, ngày 1–28, tháng kết thúc không trước tháng bắt đầu).',
  FINANCE_CASH_OPENING_REQUIRED: 'Chốt số dư đầu kỳ của tài khoản trước khi đối chiếu sao kê.',
  FINANCE_RECON_INVALID: 'Chỉ đối chiếu tháng đã kết thúc; nhập số dư sao kê.',
  FINANCE_RECON_EXPLAIN: 'Số sổ khác sao kê — giải thích chênh lệch.',
  FINANCE_RECON_EXISTS: 'Tháng này của tài khoản đã có phiếu đối chiếu.',
  FINANCE_RECON_STATE: 'Phiếu đối chiếu đã được xử lý. Tải lại.',
  FINANCE_RECON_STALE: 'Số dư sổ đã thay đổi kể từ lúc gửi — trả lại để người lập đối chiếu lại.',
  FINANCE_EXPENSE_INVALID: 'Nhập đối tượng nhận tiền, loại chi và nội dung.',
  ROW_VERSION_CONFLICT: 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.',
  PROCUREMENT_STATEMENT_POST_DENIED: 'Bạn chưa có quyền ghi công nợ cho dự án này.',
  PROCUREMENT_STATEMENT_SELF_POST: 'Người ghi công nợ phải khác người chốt bảng đối soát.',
  PROCUREMENT_STATEMENT_STATE: 'Bảng đối soát đã đổi trạng thái. Tải lại.',
  PROCUREMENT_PO_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại.',
  FINANCE_PROJECT_NOT_FOUND: 'Không tìm thấy dự án (hoặc dự án không thuộc phạm vi Tài chính).',
  FINANCE_BUDGET_PENDING: 'Dự án đang có một ngân sách chờ duyệt — duyệt / trả lại hoặc rút bản đó trước.',
  FINANCE_BUDGET_EMPTY: 'Nhập ngân sách cho ít nhất một khoản mục.',
  FINANCE_BUDGET_LINE_INVALID: 'Khoản mục hoặc số tiền không hợp lệ (vật tư lấy từ dự toán, không nhập tay).',
  FINANCE_BUDGET_NOT_FOUND: 'Không tìm thấy ngân sách.',
  FINANCE_BUDGET_STATE: 'Ngân sách đã đổi trạng thái. Tải lại.',
  FINANCE_BUDGET_SELF_DECIDE: 'Người lập không tự duyệt.',
  FINANCE_BUDGET_APPROVER_DENIED: 'Chỉ người duyệt vượt ngân sách (cài ở Quản trị) mới duyệt được.',
  FINANCE_PO_BUDGET_STATE: 'Đơn hàng không còn chờ duyệt vượt ngân sách. Tải lại.',
  FINANCE_FUND_OPENING_EXISTS: 'Dự án đã có đầu kỳ quỹ (đang chờ chốt hoặc đã chốt).',
  FINANCE_FUND_OPENING_NOT_FOUND: 'Không tìm thấy đầu kỳ quỹ.',
  FINANCE_FUND_OPENING_STATE: 'Đầu kỳ quỹ đã đổi trạng thái. Tải lại.',
  FINANCE_CAPITAL_DENIED: 'Chỉ người cấp vốn dự án (cài ở Quản trị) mới ghi được.',
  FINANCE_CAPITAL_DATE_INVALID: 'Ngày không hợp lệ (từ mốc 01/10 đến hôm nay).',
  FINANCE_CAPITAL_RETURN_EXCEEDS: 'Số thu hồi vượt số vốn công ty đang ứng cho dự án.',
  FINANCE_CAPITAL_NOT_FOUND: 'Không tìm thấy khoản cấp vốn.',
  FINANCE_CAPITAL_STATE: 'Khoản cấp vốn đã bị đảo.',
  FINANCE_CAPITAL_AUTO: 'Khoản cấp vốn tự ghi khi chi — muốn bỏ thì đảo phiếu chi gốc.',
  FINANCE_SITE_FUND_INVALID: 'Quỹ công trường không hợp lệ hoặc đã ngừng dùng.',
  FINANCE_SITE_FUND_DENIED: 'Chỉ người giữ quỹ công trường (hoặc kế toán có quyền Ghi nhận) mới ghi được khoản chi.',
  FINANCE_SITE_EXPENSE_INVALID: 'Khoản chi chưa hợp lệ: cần nội dung, số tiền, khoản mục và ngày từ mốc đến hôm nay.',
  FINANCE_SITE_EXPENSE_NOT_FOUND: 'Không tìm thấy khoản chi.',
  FINANCE_SITE_EXPENSE_STATE: 'Khoản chi đã đổi trạng thái. Tải lại.',
  FINANCE_ALLOCATION_MONTH_INVALID: 'Chỉ phân bổ tháng đã kết thúc, từ tháng 10/2026.',
  FINANCE_ALLOCATION_EXISTS: 'Tháng này đã có kỳ phân bổ (đang lập, chờ chốt hoặc đã chốt).',
  FINANCE_ALLOCATION_NOT_FOUND: 'Không tìm thấy kỳ phân bổ.',
  FINANCE_ALLOCATION_STATE: 'Kỳ phân bổ đã đổi trạng thái. Tải lại.',
  FINANCE_ALLOCATION_DAYS_INVALID: 'Số công không hợp lệ (0–31, chỉ dự án có HĐ chủ đầu tư).',
  FINANCE_ALLOCATION_POOL_INVALID: 'Nhập nội dung, số tiền và lý do cho khoản chi phí chung thêm tay.',
  FINANCE_ALLOCATION_NOT_READY: 'Chưa gửi chốt được: HR chưa chốt bảng công tháng hoặc bảng lương tháng chưa duyệt.',
  FINANCE_COST_SETTINGS_INVALID: 'Ngưỡng 50–100%, cần ít nhất một người duyệt vượt ngân sách và một người cấp vốn.',
  FINANCE_PROJECT_VIEW_DENIED: 'Bạn chưa được bật quyền xem tài chính của dự án này. Nhờ Admin bật công tắc "Xem tài chính dự án" cho bạn.',
  FINANCE_SUBCONTRACT_NOT_FOUND: 'Không tìm thấy hợp đồng thầu phụ. Tải lại.',
  FINANCE_SUB_PARTNER_REQUIRED: 'HĐ thầu phụ chưa gắn đối tác (thầu phụ / tổ đội) — Quản trị Tài chính chọn đối tác ở "Điều khoản thanh toán" trước.',
  FINANCE_SUB_PARTNER_LOCKED: 'HĐ đã có đợt nghiệm thu hoặc tạm ứng — không đổi đối tác được.',
  FINANCE_SUB_PROJECT_REQUIRED: 'HĐ thầu phụ chưa gắn dự án — sửa ở module Hợp đồng trước.',
  FINANCE_SUB_CONTRACT_STATE: 'HĐ thầu phụ chưa ký hoặc đã hủy / hết hạn — chỉ lập đợt cho HĐ Đã ký, Đang thi công hoặc Hoàn thành.',
  FINANCE_SUB_OPENING_REQUIRED: 'Chưa chốt đầu kỳ 30/09 của HĐ này. Khai số MISA (nhập 0 nếu chưa phát sinh) và nhờ người khác chốt trước khi lập đợt.',
  FINANCE_SUB_OPENING_EXISTS: 'HĐ đã có đầu kỳ (đang chờ chốt hoặc đã chốt).',
  FINANCE_SUB_OPENING_HAS_ROUNDS: 'HĐ đã có đợt nghiệm thu sau mốc — đảo / hủy các đợt đó trước khi sửa đầu kỳ.',
  FINANCE_SUB_PERIOD_INVALID: 'Chọn ngày kết thúc kỳ (ngày bắt đầu không sau ngày kết thúc).',
  FINANCE_SUB_CUMULATIVE_INVALID: 'Lũy kế đến kỳ này phải lớn hơn lũy kế các đợt trước. Sai đợt trước thì đảo đợt đó.',
  FINANCE_SUB_OVER_CONTRACT: 'Lũy kế vượt giá trị HĐ — ghi lý do (VD số phụ lục HĐ) mới lưu được.',
  FINANCE_SUB_DEDUCTION_INVALID: 'Mỗi khoản khấu trừ cần loại, số tiền lớn hơn 0 và lý do.',
  FINANCE_SUB_RECOVERY_OVER: 'Thu hồi tạm ứng lớn hơn tạm ứng còn lại của HĐ.',
  FINANCE_SUB_ROUND_OPEN_EXISTS: 'HĐ đang có một đợt nháp / chờ ghi nhận — xử lý xong đợt đó rồi lập đợt mới.',
  FINANCE_SUB_ATTACHMENT_REQUIRED: 'Đính kèm biên bản nghiệm thu / bảng xác nhận khối lượng trước khi gửi.',
  FINANCE_SUB_ROUND_STALE: 'Số liệu HĐ đã đổi (đợt trước bị đảo hoặc đổi đối tác). Mở đợt, lưu lại rồi gửi.',
  FINANCE_SUB_ROUND_NOT_LAST: 'Chỉ đảo được đợt đã ghi nhận gần nhất — đảo các đợt sau trước.',
  FINANCE_RETENTION_NOT_DUE: 'Tiền giữ lại bảo hành chưa đến hạn (hoặc HĐ chưa có ngày hoàn thành / tháng bảo hành) — chưa lập đề nghị chi được.',
  FINANCE_COST_REVIEW_NOT_FOUND: 'Không còn dòng chi phí ghi tay này. Tải lại.',
  FINANCE_COST_REVIEW_DONE: 'Dòng này đã được soát xét.',
  FINANCE_COST_REVIEW_AMOUNT: 'Số đảo phải lớn hơn 0 và không lớn hơn số tiền của dòng ghi tay.',
  SUBCONTRACT_FINANCE_ONLY: 'Nghiệm thu thanh toán, tạm ứng, lịch thanh toán của HĐ thầu phụ lập ở Tài chính → Phải trả → Thầu phụ.',
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
  /** Phải thu CĐT của dự án (đợt CĐT đã xác nhận chưa trả), quá hạn, sản lượng chưa đề nghị (null = chưa có tiến độ). */
  ar?: { outstanding: number; overdue: number; unbilled: number | null; advanceRemaining: number } | null;
  receivables: Array<{ description: string; amount: number; paidAmount: number | null; dueDate: string | null; paidDate: string | null; status: string; advance: boolean }>;
}
export interface FinanceOverview {
  canOverview: boolean; today: string; projects: FinanceOverviewProject[];
  companyPayable?: { outstanding: number; docs: number };
  advances?: { remaining: number; overdue: number; overdueCount: number; refundDue: number; refundDueCount: number } | null;
  receivables?: { outstanding: number; overdue: number; unbilled: number | null } | null;
  cash?: { balance: number; known: boolean; accounts: number; lowest: number | null; lowestWeek: string | null; belowMinWeek: string | null; minBalance: number } | null;
}

export type ReceivableRoundKind = 'advance' | 'progress' | 'settlement' | 'retention' | 'other' | 'opening';
export type ReceivableRoundStatus = 'draft' | 'sent' | 'confirmed' | 'cancelled';
export interface CustomerContractMetrics {
  gross: number; progress: number | null; estOutput: number | null; billed: number; received: number; outstanding: number; overdue: number; prepayment: number;
  advanceReceived: number; advanceRemaining: number; advanceRecovered: number; retentionHeld: number; unbilled: number | null;
  recoveryPercent: number; recoveryPercentSource: 'contract' | 'auto'; retentionPercent: number; retentionPercentSource: 'contract' | 'default';
  paymentTermDays: number; paymentTermSource: 'contract' | 'default'; warrantyMonths: number | null; opening: 'confirmed' | 'submitted' | 'todo' | 'not_needed';
}
export interface FinanceReceivables {
  today: string; can: FinanceCan; currentUserId: string; cutoverDate: string;
  totals: { outstanding: number; overdue: number; overdueCount: number; unbilled: number | null; advanceRemaining: number; retentionHeld: number; prepayment: number;
    sentStale: number; receiptsPending: number; receiptsPendingMe: number; openingsTodo: number; openingsPending: number; guaranteesExpiring: number; guaranteesMissing: number };
  contracts: Array<{ id: string; code: string; name: string; projectId: string | null; projectCode: string | null; customerName: string; value: number; vatPercent: number | null;
    endDate: string | null; status: string; nextDue: string | null; draftRounds: number; metrics: CustomerContractMetrics }>;
  reviewRevenues: Array<{ id: string; projectCode: string; date: string; amount: number; description: string | null; source: string | null }>;
}
export interface ReceivableRound {
  id: string; sequenceNo: number; kind: ReceivableRoundKind; description: string; netAmount: number; vatPercent: number; vatAmount: number; gross: number;
  advanceRecovery: number; retention: number; receivable: number; suggestedRecovery: number | null; suggestedRetention: number | null; adjustReason: string | null;
  status: ReceivableRoundStatus; sentDate: string | null; confirmedDate: string | null; confirmedByName: string | null; submittedGross: number | null; customerNote: string | null;
  dueDate: string | null; invoiceNo: string | null; invoiceDate: string | null; attachments: FinanceAttachment[]; note: string | null; legacy: boolean; cancelReason: string | null;
  createdByName: string | null; createdAt: string; rowVersion: number; received: number; pending: number; outstanding: number; overdue: boolean; lastReceived: string | null;
  canEdit: boolean; canAct: boolean;
}
export interface CustomerReceipt {
  id: string; code: string; receiptDate: string; amount: number; documentRef: string; attachments: FinanceAttachment[]; note: string | null;
  status: 'submitted' | 'confirmed' | 'rejected' | 'withdrawn' | 'reversed'; rowVersion: number; createdBy: string; createdByName: string | null; createdAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; reversedByName: string | null; reversedAt: string | null; reverseReason: string | null;
  allocations: Array<{ roundId: string; sequenceNo: number; description: string; amount: number; kind: 'receipt' | 'prepayment' }>; unallocated: number;
  canDecide: boolean; canWithdraw: boolean; canReverse: boolean;
}
export interface CustomerOpening {
  id: string; cutoverDate: string; receivableAmount: number; receivableDueDate: string | null; advanceRemaining: number; retentionHeld: number; note: string | null;
  attachments: FinanceAttachment[]; status: 'submitted' | 'confirmed' | 'rejected' | 'cancelled'; createdBy: string; createdByName: string | null; createdAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; canDecide: boolean; canCancel: boolean;
}
export interface ContractGuarantee {
  id: string; type: 'advance' | 'performance' | 'warranty' | string; name: string; amount: number | null; percent: number | null; bankName: string | null; number: string | null;
  issueDate: string | null; expiryDate: string | null; status: 'draft' | 'active' | 'released' | 'expired' | string; note: string | null; expiring: boolean;
}
export interface CustomerContractDetail {
  today: string; can: FinanceCan; currentUserId: string; cutoverDate: string;
  contract: { id: string; code: string; name: string; customerName: string; customerTaxCode: string | null; projectId: string | null; projectCode: string | null;
    value: number; vatPercent: number; signedDate: string | null; endDate: string | null; status: string; warrantyMonths: number | null;
    advanceRecoveryPercent: number | null; retentionPercent: number | null; paymentTermDays: number | null };
  metrics: CustomerContractMetrics; rounds: ReceivableRound[]; receipts: CustomerReceipt[]; openings: CustomerOpening[]; guarantees: ContractGuarantee[];
  events: Array<{ action: string; actorName: string | null; reason: string | null; payload: Record<string, unknown>; at: string }>;
}

/** Quỹ dự án: số dư null = chưa chốt đầu kỳ (chưa biết), không hiện 0. */
export interface FinanceProjectFund {
  opening: number | null; openingDate: string | null; received: number; otherIn: number; spent: number; capital: number; flow: number; balance: number | null;
}
export interface FinanceCostProjectSummary extends FinanceProjectFund {
  /** Tổng các khoản mục đã có ngân sách (vật tư = dự toán); null = chưa có khoản nào. */
  budget: number | null; actual: number; committed: number; autoMapped: number; unclassified: number;
  materialBudget: number | null; materialActual: number; materialCommitted: number;
  overItems: number; warnItems: number; missingItems: number; overList: Array<{ item: string; budget: number; used: number }>;
  /** Tiến độ Gantt; null = chưa có kế hoạch. Dự báo khi hoàn thành chỉ khi tiến độ ≥ 20%. */
  progress: number | null; eac: number | null;
}
export interface FinanceCostProject extends FinanceCostProjectSummary {
  id: string; code: string; name: string; contractValue: number | null; receivedAll: number;
  currentBudget: { id: string; versionNo: number; decidedAt: string } | null;
  pendingBudget: { id: string; versionNo: number; createdByName: string; canDecide: boolean } | null;
  openingStatus: 'none' | 'submitted' | 'confirmed'; openingCanDecide: boolean;
}
export interface FinanceCostCan { view: boolean; record: boolean; confirm: boolean; manage: boolean; capital: boolean }
export interface FinancePoBudgetPending {
  purchaseOrderId: string; poNumber: string; projectId: string; projectCode: string; vendor: string | null; order: number; budget: number; projected: number;
  requestedByName: string | null; requestedAt: string | null; approverName: string | null; createdByName: string | null; canDecide: boolean;
}
export interface FinanceCost {
  today: string; cutoverDate: string; warnPercent: number; can: FinanceCostCan; capitalProviders: string[]; budgetApprovers: string[];
  projects: FinanceCostProject[]; poBudget: FinancePoBudgetPending[];
  stale: { count: number; amount: number; items: Array<{ poId: string; poNumber: string; projectCode: string | null; vendor: string | null; status: string; expectedDate: string | null; openNet: number; hub: boolean }> };
}
export interface FinanceCostLine {
  costItemId: string | null; symbol: string | null; name: string | null; groupSymbol: string | null; groupName: string | null;
  budget: number | null; actual: number; autoMapped: number; committed: number; budgetSource: 'material' | 'budget' | null;
}
export interface FinanceProjectBudget {
  id: string; versionNo: number; status: 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'superseded'; reason: string; materialBudget: number | null; otherTotal: number;
  createdByName: string; createdAt: string; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; rowVersion: number;
  canDecide: boolean; canWithdraw: boolean; lines: Array<{ costItemId: string; amount: number; note: string | null }>;
}
export type FinanceFundRowKind = 'customer_receipt' | 'advance_refund' | 'other_receipt' | 'supplier_payment' | 'expense' | 'site_transfer' | 'capital' | 'capital_return' | 'allocation';
export interface FinanceProjectCost {
  today: string; cutoverDate: string; warnPercent: number; can: FinanceCostCan;
  project: FinanceCostProjectSummary & { id: string; code: string; name: string; contractValue: number | null; receivedAll: number };
  items: Array<{ id: string; symbol: string; name: string; groupSymbol: string; groupName: string }>;
  lines: FinanceCostLine[]; budgets: FinanceProjectBudget[];
  commitments: Array<{ poId: string; poNumber: string; vendor: string | null; status: string; expectedDate: string | null; netTotal: number; receivedNet: number; openNet: number; stale: boolean; hub: boolean }>;
  fund: FinanceProjectFund & {
    pending: number;
    openingRecord: { id: string; status: 'submitted' | 'confirmed' | 'rejected' | 'cancelled'; cutoverDate: string; receivedToDate: number; spentToDate: number; balance: number;
      note: string | null; attachments: FinanceAttachment[]; createdByName: string; createdAt: string; decidedByName: string | null; decidedAt: string | null;
      decisionNote: string | null; canDecide: boolean; canCancel: boolean } | null;
    rows: Array<{ date: string; kind: FinanceFundRowKind; code: string | null; description: string; amount: number; sourceType: string; reversal: boolean }>;
    capitalList: Array<{ id: string; code: string; kind: 'topup' | 'return'; amount: number; date: string; reason: string; sourceType: 'manual' | 'payment_request';
      status: 'posted' | 'reversed'; createdByName: string; createdAt: string; reversedByName: string | null; reverseReason: string | null; canReverse: boolean }>;
  };
}

export type FinanceSiteExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'reversed';
export interface FinanceSiteExpense {
  id: string; code: string; date: string; description: string; counterparty: string | null; costItemId: string; costItem: string; amount: number;
  attachments: FinanceAttachment[]; status: FinanceSiteExpenseStatus; submissionNo: number; createdById: string; createdByName: string; createdAt: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; reverseReason: string | null; rowVersion: number;
  canEdit: boolean; canDecide: boolean; canReverse: boolean;
}
export interface FinanceSiteFund {
  id: string; name: string; projectId: string; projectCode: string | null; holderUserId: string | null; holderName: string | null; active: boolean; mine: boolean;
  /** Số dư sổ thu chi của quỹ (âm = công ty đang nợ người giữ quỹ). */
  /** received = tiền đã chuyển vào quỹ trừ tiền nộp lại (ròng). */
  balance: number; received: number; pending: number; approved: number; expenses: FinanceSiteExpense[];
}
export interface FinanceSiteFunds {
  today: string; cutoverDate: string; can: { view: boolean; record: boolean; confirm: boolean };
  items: Array<{ id: string; symbol: string; name: string; groupName: string }>; funds: FinanceSiteFund[];
}
export type FinanceAllocationStatus = 'draft' | 'submitted' | 'confirmed' | 'reversed' | 'cancelled';
export interface FinanceAllocation {
  month: string; firstMonth: string; lastClosableMonth: string; can: { view: boolean; record: boolean; confirm: boolean; manage: boolean };
  readiness: { timesheet: { status: 'reviewing' | 'submitted' | 'closed'; version: number; decidedAt: string | null } | null;
    payroll: { confirmed: number; draft: number; gross: number }; receipts: Array<{ projectId: string; projectCode: string; amount: number }> };
  projects: Array<{ id: string; code: string }>;
  runs: Array<{ id: string; code: string; month: string; status: FinanceAllocationStatus; siteTotal: number; poolTotal: number; createdByName: string;
    decidedByName: string | null; decidedAt: string | null; reverseReason: string | null; decisionNote: string | null }>;
  run: null | {
    id: string; code: string; month: string; status: FinanceAllocationStatus; timesheetVersion: number | null; payrollCount: number; payrollTotal: number;
    siteTotal: number; officeTotal: number; poolTotal: number; receiptsTotal: number; note: string | null; rowVersion: number;
    createdByName: string; createdAt: string; submittedAt: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
    canEdit: boolean; canSubmit: boolean; canDecide: boolean; canCancel: boolean; canReverse: boolean;
    staff: Array<{ employeeId: string; name: string; gross: number; siteDays: Record<string, number>; officeDays: number; autoSiteDays: Record<string, number>;
      autoOfficeDays: number; edited: boolean; editReason: string | null }>;
    pool: Array<{ id: string; sourceType: 'expense_request' | 'office_salary' | 'manual'; description: string; category: string | null; amount: number; included: boolean; note: string | null }>;
    lines: Array<{ projectId: string; projectCode: string; kind: 'salary' | 'overhead'; amount: number; basis: number | null; share: number | null }>;
  };
}

export type CashAccountKind = 'cash' | 'bank' | 'site';
export interface CashAccountOption { id: string; name: string; kind: CashAccountKind; bankName: string | null; accountNo: string | null; balance: number; openingConfirmed: boolean }
export interface CashAccount {
  id: string; name: string; kind: CashAccountKind; bankName: string | null; accountNo: string | null; projectId: string | null; projectCode: string | null;
  holderName: string | null; holderUserId?: string | null; note: string | null; active: boolean; balance: number; lockedThrough: string | null;
  opening: { id: string; status: 'submitted' | 'confirmed' | 'rejected' | 'cancelled'; balance: number; cutoverDate: string; note: string | null; attachments: FinanceAttachment[];
    createdBy: string; createdByName: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; canDecide: boolean } | null;
  lastRecon: { id: string; month: string; status: 'submitted' | 'confirmed' | 'rejected'; bookBalance: number; statementBalance: number; difference: number; explanation: string | null;
    attachments: FinanceAttachment[]; createdBy: string; createdByName: string | null; decidedByName: string | null; decisionNote: string | null; canDecide: boolean } | null;
}
export interface CashForecastWeek { weekStart: string; inSure: number; inMaybe: number; inPlan: number; outAp: number; outRequests: number; outPlan: number; balanceSure: number; balanceMaybe: number }
export interface CashEntry {
  id: string; date: string; accountId: string; accountName: string; direction: 'in' | 'out'; amount: number; sourceType: string; sourceId: string; code: string | null;
  description: string; counterparty: string | null; projectCode: string | null; reversalOf: string | null; reversed: boolean; createdByName: string | null;
}
export interface CashMovement {
  id: string; code: string; kind: 'receipt' | 'transfer'; category: string; fromAccountId: string | null; fromName: string | null; toAccountId: string; toName: string;
  amount: number; date: string; documentRef: string | null; counterparty: string | null; projectCode: string | null; description: string; attachments: FinanceAttachment[];
  status: 'submitted' | 'confirmed' | 'rejected' | 'withdrawn' | 'reversed'; rowVersion: number; createdBy: string; createdByName: string | null; decidedByName: string | null;
  decisionNote: string | null; reverseReason: string | null; canDecide: boolean; canWithdraw: boolean; canReverse: boolean;
}
export interface CashPlan { id: string; name: string; direction: 'in' | 'out'; category: string; amount: number; dayOfMonth: number; accountId: string | null; startMonth: string; endMonth: string | null; active: boolean }
export interface FinanceCash {
  today: string; can: FinanceCan; currentUserId: string; month: string; cutoverDate: string;
  forecast: { start: number; minBalance: number; weeks: CashForecastWeek[]; lowest: number | null; lowestWeek: string | null; belowMinWeek: string | null; known: boolean; accounts: number };
  flows30: { in: number; out: number }; accounts: CashAccount[]; entries: CashEntry[]; movements: CashMovement[]; plans: CashPlan[];
  projects: Array<{ id: string; code: string | null }>;
  pending: { openings: number; reconciliations: number; movements: number; waitingMe: number; accountsWithoutOpening: number };
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
  target: { kind: 'po' | 'contract' | 'subcontract'; no: string; status: string | null; expectedDate: string | null; base: number | null; received: number | null } | null;
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
  confirmPaymentRequest(input: { requestId: string; expectedRowVersion: number; paymentDate: string; documentRef: string; attachments: FinanceAttachment[]; note?: string; cashAccountId: string }) {
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
    attachments?: FinanceAttachment[]; targetPurchaseOrderId?: string; cashAccountId?: string }) {
    return call<{ adjustmentId: string }>('save_finance_advance_adjustment_v1', { p_input: input });
  },
  decideAdvanceAdjustment(input: { adjustmentId: string; action: 'confirm' | 'reject' | 'withdraw' | 'reverse'; reason?: string }) {
    return call<{ adjustmentId: string }>('decide_finance_advance_adjustment_v1', { p_input: input });
  },
  saveAdvanceSettings(input: { warnPercent: number; extraPercent: number; graceDays: number; extraApproverIds: string[]; expectedRowVersion: number; reason: string }) {
    return call<{ ok: boolean }>('save_finance_advance_settings_v1', { p_input: input });
  },
  myScope() { return call<FinanceMyScope>('get_finance_my_scope_v1', {}); },
  projectPage(projectId: string) { return call<FinanceProjectPage>('get_finance_project_v1', { p_project_id: projectId }); },
  subcontracts() { return call<FinanceSubcontracts>('get_finance_subcontracts_v1', {}); },
  subcontract(id: string) { return call<SubcontractDetail>('get_finance_subcontract_v1', { p_subcontract_id: id }); },
  saveSubcontractTerms(input: { subcontractId: string; partnerId?: string | null; vatPercent: number | null; retentionPercent: number | null; advanceRecoveryPercent: number | null;
    paymentTermDays: number | null; warrantyMonths: number | null; withholdPit: boolean; pitPercent: number; reason: string }) {
    return call<{ subcontractId: string }>('save_finance_subcontract_terms_v1', { p_input: input });
  },
  saveSubcontractOpening(input: { subcontractId: string; cumulativeNet: number; paidTotal: number; outstanding: number; outstandingDueDate?: string | null; retentionHeld: number;
    retentionDueDate?: string | null; advanceRemaining: number; note?: string; attachments: FinanceAttachment[] }) {
    return call<{ id: string }>('save_finance_subcontract_opening_v1', { p_input: input });
  },
  decideSubcontractOpening(input: { id: string; action: 'confirm' | 'reject' | 'cancel'; reason?: string }) {
    return call<{ id: string; status: string }>('decide_finance_subcontract_opening_v1', { p_input: input });
  },
  previewSubcontractRound(input: SubcontractRoundInput) { return call<SubcontractRoundPreview>('preview_finance_subcontract_round_v1', { p_input: input }); },
  saveSubcontractRound(input: SubcontractRoundInput) { return call<{ id: string; sequenceNo: number; payable: number; rowVersion: number }>('save_finance_subcontract_round_v1', { p_input: input }); },
  transitionSubcontractRound(input: { id: string; expectedRowVersion: number; action: 'submit' | 'withdraw' | 'return' | 'cancel' | 'recognize' | 'reverse'; reason?: string; date?: string }) {
    return call<{ id: string; status: SubcontractRoundStatus; payable: number; dueDate: string | null; rowVersion: number }>('transition_finance_subcontract_round_v1', { p_input: input });
  },
  previewSubcontractAdvance(input: { subcontractId: string; requestId?: string; amount: number }) {
    return call<Omit<FinanceAdvancePreview, 'internal'>>('preview_finance_subcontract_advance_v1', { p_input: input });
  },
  saveSubcontractAdvance(input: { requestId?: string; expectedRowVersion?: number; subcontractId: string; amount: number; method: 'bank_transfer' | 'cash'; plannedDate: string; repayDueDate: string; note: string }) {
    return call<{ requestId: string; code: string; amount: number }>('save_finance_subcontract_advance_v1', { p_input: input });
  },
  reviewManualCost(input: { transactionId: string; action: 'keep' | 'reverse'; amount?: number; reason: string; misaIds?: string[] }) {
    return call<{ transactionId: string; reversed: number }>('review_finance_manual_cost_v1', { p_input: input });
  },
  receivables() { return call<FinanceReceivables>('get_finance_receivables_v1', {}); },
  customerContract(contractId: string) { return call<CustomerContractDetail>('get_finance_customer_contract_v1', { p_contract_id: contractId }); },
  saveCustomerTerms(input: { contractId: string; advanceRecoveryPercent: number | null; retentionPercent: number | null; paymentTermDays: number | null; warrantyMonths: number | null; reason: string }) {
    return call<{ contractId: string }>('save_finance_customer_terms_v1', { p_input: input });
  },
  saveGuarantee(input: { id: string; amount: number; percent?: number | null; bankName?: string; number?: string; issueDate?: string | null; expiryDate?: string | null; status: string; note?: string }) {
    return call<{ id: string }>('save_finance_guarantee_v1', { p_input: input });
  },
  saveRound(input: { id?: string; expectedRowVersion?: number; contractId: string; kind: ReceivableRoundKind; description: string; netAmount: number; vatPercent?: number;
    advanceRecovery?: number | null; retention?: number | null; adjustReason?: string; attachments: FinanceAttachment[]; note?: string }) {
    return call<{ id: string; sequenceNo: number; receivable: number }>('save_finance_receivable_round_v1', { p_input: input });
  },
  transitionRound(input: { id: string; expectedRowVersion: number; action: 'send' | 'confirm' | 'return' | 'invoice' | 'cancel'; date?: string; confirmedGross?: number;
    advanceRecovery?: number | null; retention?: number | null; reason?: string; invoiceNo?: string }) {
    return call<{ id: string; status: ReceivableRoundStatus; receivable: number; dueDate: string | null }>('transition_finance_receivable_round_v1', { p_input: input });
  },
  saveCustomerReceipt(input: { contractId: string; amount: number; receiptDate: string; documentRef: string; attachments: FinanceAttachment[]; note?: string; cashAccountId: string;
    allocations: Array<{ roundId: string; amount: number }> }) {
    return call<{ id: string; code: string; unallocated: number }>('save_finance_customer_receipt_v1', { p_input: input });
  },
  decideCustomerReceipt(input: { id: string; expectedRowVersion: number; action: 'confirm' | 'reject' | 'withdraw' | 'reverse'; reason?: string }) {
    return call<{ id: string }>('decide_finance_customer_receipt_v1', { p_input: input });
  },
  applyCustomerPrepayment(input: { receiptId: string; roundId: string; amount: number }) { return call<{ id: string }>('apply_finance_customer_prepayment_v1', { p_input: input }); },
  saveCustomerOpening(input: { contractId: string; receivableAmount: number; receivableDueDate?: string | null; advanceRemaining: number; retentionHeld: number; note?: string; attachments: FinanceAttachment[] }) {
    return call<{ id: string }>('save_finance_customer_opening_v1', { p_input: input });
  },
  decideCustomerOpening(input: { id: string; action: 'confirm' | 'reject' | 'cancel'; reason?: string }) { return call<{ id: string }>('decide_finance_customer_opening_v1', { p_input: input }); },
  cashAccounts() { return call<CashAccountOption[]>('get_finance_cash_accounts_v1', {}); },
  cash(filter: { month?: string; accountId?: string } = {}) { return call<FinanceCash>('get_finance_cash_v1', { p_filter: filter }); },
  saveCashAccount(input: { id?: string; name: string; kind: CashAccountKind; bankName?: string; accountNo?: string; projectId?: string | null; holderName?: string; holderUserId?: string | null; note?: string; isActive?: boolean }) {
    return call<{ id: string }>('save_finance_cash_account_v1', { p_input: input });
  },
  saveCashOpening(input: { accountId: string; balance: number; note?: string; attachments: FinanceAttachment[] }) { return call<{ id: string }>('save_finance_cash_opening_v1', { p_input: input }); },
  decideCashOpening(input: { id: string; action: 'confirm' | 'reject' | 'cancel'; reason?: string }) { return call<{ id: string }>('decide_finance_cash_opening_v1', { p_input: input }); },
  saveCashReconciliation(input: { accountId: string; month: string; statementBalance: number; explanation?: string; attachments: FinanceAttachment[] }) {
    return call<{ id: string; bookBalance: number; difference: number }>('save_finance_cash_reconciliation_v1', { p_input: input });
  },
  decideCashReconciliation(input: { id: string; action: 'confirm' | 'reject'; reason?: string }) { return call<{ id: string }>('decide_finance_cash_reconciliation_v1', { p_input: input }); },
  saveCashPlan(input: { id?: string; name: string; direction: 'in' | 'out'; category: string; amount: number; dayOfMonth: number; accountId?: string | null; startMonth: string; endMonth?: string | null; active: boolean }) {
    return call<{ id: string }>('save_finance_cash_plan_v1', { p_input: input });
  },
  saveCashSettings(input: { minBalance: number; reason: string; expectedRowVersion: number }) { return call<{ minBalance: number }>('save_finance_cash_settings_v1', { p_input: input }); },
  saveCashMovement(input: { kind: 'receipt' | 'transfer'; category?: string; fromAccountId?: string | null; toAccountId: string; amount: number; date: string; documentRef?: string;
    counterparty?: string; projectId?: string | null; description: string; attachments: FinanceAttachment[] }) {
    return call<{ id: string; code: string }>('save_finance_cash_movement_v1', { p_input: input });
  },
  decideCashMovement(input: { id: string; expectedRowVersion: number; action: 'confirm' | 'reject' | 'withdraw' | 'reverse'; reason?: string }) {
    return call<{ id: string }>('decide_finance_cash_movement_v1', { p_input: input });
  },
  previewExpense(input: { amount: number; requestId?: string; projectId?: string | null; costCategory?: string | null }) { return call<{ route: FinanceRoutePreview['route']; canRecord: boolean }>('preview_finance_expense_v1', { p_input: input }); },
  saveExpense(input: { requestId?: string; expectedRowVersion?: number; counterparty: string; category: string; amount: number; plannedDate: string; method: 'bank_transfer' | 'cash';
    note: string; projectId?: string | null; costCategory?: string | null }) {
    return call<{ requestId: string; code: string; amount: number }>('save_finance_expense_request_v1', { p_input: input });
  },
  pendingStatements() { return call<FinancePendingStatement[]>('list_finance_pending_statements_v1', {}); },
  cost() { return call<FinanceCost>('get_finance_cost_v1', {}); },
  projectCost(projectId: string) { return call<FinanceProjectCost>('get_finance_project_cost_v1', { p_project_id: projectId }); },
  saveProjectBudget(input: { projectId: string; reason: string; lines: Array<{ costItemId: string; amount: number; note?: string }> }) {
    return call<{ id: string; versionNo: number }>('save_finance_project_budget_v1', { p_input: input });
  },
  decideProjectBudget(input: { id: string; expectedRowVersion: number; action: 'approve' | 'reject' | 'withdraw'; reason?: string }) {
    return call<{ id: string; status: string }>('decide_finance_project_budget_v1', { p_input: input });
  },
  saveFundOpening(input: { projectId: string; receivedToDate: number; spentToDate: number; note?: string; attachments: FinanceAttachment[] }) {
    return call<{ id: string }>('save_finance_project_fund_opening_v1', { p_input: input });
  },
  decideFundOpening(input: { id: string; action: 'confirm' | 'reject' | 'cancel'; reason?: string }) {
    return call<{ id: string; status: string }>('decide_finance_project_fund_opening_v1', { p_input: input });
  },
  saveCapital(input: { projectId: string; kind: 'topup' | 'return'; amount: number; date: string; reason: string }) {
    return call<{ id: string; code: string }>('save_finance_project_capital_v1', { p_input: input });
  },
  reverseCapital(input: { id: string; reason: string }) { return call<{ id: string }>('reverse_finance_project_capital_v1', { p_input: input }); },
  decidePoBudget(input: { purchaseOrderId: string; action: 'approve' | 'reject'; reason?: string }) {
    return call<{ purchaseOrderId: string; status: string }>('decide_finance_po_budget_v1', { p_input: input });
  },
  siteFunds() { return call<FinanceSiteFunds>('get_finance_site_funds_v1', {}); },
  saveSiteExpense(input: { id?: string; expectedRowVersion?: number; accountId: string; spentDate: string; description: string; counterparty?: string; costItemId: string; amount: number; attachments: FinanceAttachment[] }) {
    return call<{ id: string; code: string }>('save_finance_site_expense_v1', { p_input: input });
  },
  withdrawSiteExpense(input: { id: string; expectedRowVersion: number }) { return call<{ id: string }>('withdraw_finance_site_expense_v1', { p_input: input }); },
  decideSiteExpenses(input: { action: 'approve' | 'reject' | 'reverse'; reason?: string; items: Array<{ id: string; expectedRowVersion: number; costItemId?: string }> }) {
    return call<{ count: number }>('decide_finance_site_expenses_v1', { p_input: input });
  },
  allocation(month?: string) { return call<FinanceAllocation>('get_finance_allocation_v1', { p_month: month || null }); },
  createAllocation(month: string) { return call<{ id: string; code: string }>('create_finance_allocation_v1', { p_input: { month } }); },
  saveAllocation(input: { runId: string; expectedRowVersion: number; action: 'refresh' | 'staff' | 'pool' | 'pool_add' | 'pool_remove'; employeeId?: string;
    siteDays?: Record<string, number>; officeDays?: number; itemId?: string; included?: boolean; description?: string; amount?: number; reason?: string }) {
    return call<{ id: string }>('save_finance_allocation_v1', { p_input: input });
  },
  decideAllocation(input: { id: string; expectedRowVersion: number; action: 'submit' | 'return' | 'confirm' | 'cancel' | 'reverse'; reason?: string }) {
    return call<{ id: string; status: string }>('decide_finance_allocation_v1', { p_input: input });
  },
  saveCostSettings(input: { warnPercent: number; budgetApproverIds: string[]; capitalProviderIds: string[]; reason: string; expectedRowVersion: number }) {
    return call<{ ok: boolean }>('save_finance_cost_settings_v1', { p_input: input });
  },
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
    note?: string; attachments: FinanceAttachment[]; allocations: Array<{ documentId: string; amount: number }>; cashAccountId?: string | null }) {
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
  subcontract_round: 'Nghiệm thu thầu phụ', subcontract_retention: 'Giữ lại bảo hành thầu phụ', subcontract_opening: 'Đầu kỳ thầu phụ',
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
  advance_transfer_withdraw: 'Rút đề nghị chuyển tạm ứng',
  expense_submit: 'Lập phiếu chi khác', expense_paid: 'Chi phiếu chi khác', cash_settings_save: 'Đổi tồn quỹ tối thiểu',
  budget_submit: 'Lập ngân sách dự án', budget_approve: 'Duyệt ngân sách dự án', budget_reject: 'Trả lại ngân sách dự án', budget_withdraw: 'Rút ngân sách dự án',
  fund_opening_submit: 'Gửi đầu kỳ quỹ dự án', fund_opening_confirm: 'Chốt đầu kỳ quỹ dự án', fund_opening_reject: 'Trả lại đầu kỳ quỹ dự án', fund_opening_cancel: 'Hủy đầu kỳ quỹ dự án',
  capital_topup: 'Công ty cấp vốn cho dự án', capital_return: 'Thu hồi vốn từ dự án', capital_reverse: 'Đảo khoản cấp vốn', capital_auto_topup: 'Tự ghi cấp vốn khi chi (quỹ âm)',
  po_budget_request: 'Đơn mua vượt ngân sách chờ duyệt', po_budget_approve: 'Duyệt đơn mua vượt ngân sách', po_budget_reject: 'Không duyệt đơn mua vượt ngân sách',
  cost_settings_save: 'Đổi thông số ngân sách / cấp vốn',
  site_expense_submit: 'Ghi khoản chi quỹ công trường', site_expense_withdraw: 'Rút khoản chi quỹ công trường', site_expense_approve: 'Duyệt khoản chi quỹ công trường',
  site_expense_reject: 'Trả lại khoản chi quỹ công trường', site_expense_reverse: 'Đảo khoản chi quỹ công trường',
  allocation_create: 'Lập phân bổ tháng', allocation_refresh: 'Làm mới phân bổ', allocation_staff: 'Sửa số công phân bổ', allocation_pool: 'Bỏ / tính khoản chi phí chung',
  allocation_pool_add: 'Thêm khoản chi phí chung', allocation_pool_remove: 'Xóa khoản chi phí chung', allocation_submit: 'Gửi chốt phân bổ', allocation_return: 'Trả lại phân bổ',
  allocation_confirm: 'Chốt phân bổ tháng', allocation_cancel: 'Hủy kỳ phân bổ', allocation_reverse: 'Đảo phân bổ tháng',
  customer_terms_save: 'Khai điều khoản HĐ chủ đầu tư', guarantee_save: 'Khai bảo lãnh', round_create: 'Lập đợt thu', round_update: 'Sửa đợt thu',
  round_send: 'Gửi hồ sơ CĐT', round_confirm: 'CĐT xác nhận số tiền', round_return: 'CĐT trả lại hồ sơ', round_invoice: 'Ghi hóa đơn', round_cancel: 'Hủy đợt thu',
  receipt_submit: 'Ghi phiếu thu', receipt_confirm: 'Xác nhận phiếu thu', receipt_reject: 'Từ chối phiếu thu', receipt_withdraw: 'Rút phiếu thu',
  receipt_reverse: 'Đảo phiếu thu', receipt_apply_prepayment: 'Trừ tiền trả trước vào đợt', customer_opening_submit: 'Gửi đối chiếu đầu kỳ phải thu',
  customer_opening_confirm: 'Chốt đầu kỳ phải thu', customer_opening_reject: 'Trả lại đối chiếu đầu kỳ', customer_opening_cancel: 'Hủy chốt đầu kỳ phải thu', advance_offset_failed: 'Cấn trừ tạm ứng tự động không được — cần cấn tay', advance_settings_save: 'Đổi thông số tạm ứng',
  subcontract_terms_save: 'Khai điều khoản HĐ thầu phụ', subcontract_opening_submit: 'Gửi đầu kỳ thầu phụ', subcontract_opening_confirm: 'Chốt đầu kỳ thầu phụ',
  subcontract_opening_reject: 'Trả lại đầu kỳ thầu phụ', subcontract_opening_cancel: 'Hủy đầu kỳ thầu phụ', subcontract_round_create: 'Lập đợt nghiệm thu thầu phụ',
  subcontract_round_update: 'Sửa đợt nghiệm thu thầu phụ', subcontract_round_submit: 'Gửi ghi nhận đợt thầu phụ', subcontract_round_withdraw: 'Rút đợt thầu phụ về nháp',
  subcontract_round_return: 'Trả lại đợt thầu phụ', subcontract_round_cancel: 'Hủy đợt thầu phụ', subcontract_round_recognize: 'Ghi nhận đợt thầu phụ (công nợ + chi phí)',
  subcontract_round_reverse: 'Đảo đợt thầu phụ', cost_review_keep: 'Soát xét: chi phí ghi tay không trùng', cost_review_reverse: 'Soát xét: đảo phần trùng MISA',
  direct_receipt_post: 'Ghi nợ phiếu nhập trực tiếp', direct_receipt_return: 'Trả lại phiếu nhập cho kho', direct_receipt_cancel: 'Kho hủy phiếu nhập — hủy công nợ',
};
