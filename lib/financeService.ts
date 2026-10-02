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
export interface FinancePendingStatement {
  id: string; code: string; supplierId: string; supplierName: string; contractCode: string | null; projectId: string; projectCode: string | null;
  periodMonth: string | null; statementDate: string | null; grossAmount: number; vatAmount: number; totalAmount: number;
  createdByName: string | null; confirmedByName: string | null; confirmedAt: string | null; canPost: boolean;
}
export interface FinanceApprovalStep { label: string; approvers: Array<{ id: string; name: string; active: boolean }> }
export interface FinanceSettings {
  can: FinanceCan;
  settings: { defaultPaymentDays: number; cutoverDate: string; rowVersion: number; updatedAt: string; updatedByName: string | null };
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
  FINANCE_SELF_CONFIRM: 'Người xác nhận phải khác người lập — kể cả Admin.',
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

export const financeService = {
  list(filter: { projectId?: string; source?: string } = {}) { return call<FinancePayablesList>('list_finance_payables_v1', { p_filter: filter }); },
  supplier(supplierId: string) { return call<FinanceSupplierDetail>('get_finance_supplier_v1', { p_supplier_id: supplierId }); },
  directReceipts() { return call<FinanceDirectReceipts>('list_finance_direct_receipts_v1', {}); },
  postDirectReceipts(input: { receipts: Array<{ transactionId: string; rowVersion: number; prices?: Record<string, number> }>; vat: FinanceVatChoice; invoiceNo?: string; duplicateChecked?: boolean }) {
    return call<{ documents: Array<{ transactionId: string; code: string; amount: number }>; total: number }>('post_finance_direct_receipts_v1', { p_input: input });
  },
  returnDirectReceipts(input: { transactionIds: string[]; reason: string }) {
    return call<{ returned: number }>('return_finance_direct_receipts_v1', { p_input: input });
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
  direct_receipt_post: 'Ghi nợ phiếu nhập trực tiếp', direct_receipt_return: 'Trả lại phiếu nhập cho kho', direct_receipt_cancel: 'Kho hủy phiếu nhập — hủy công nợ',
};
