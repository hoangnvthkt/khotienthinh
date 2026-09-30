import { supabase } from './supabase';

// Hợp đồng nguyên tắc trong Mua hàng: đơn giá có ngày hiệu lực, lũy kế theo HĐ,
// bảng đối soát tháng (Mua hàng lập & chốt, kế toán ghi công nợ).

export interface ContractSummary {
  id: string; code: string; name: string | null; type: string | null; status: string | null;
  supplierId: string | null; supplierName: string | null; projectId: string | null; projectCode: string | null; projectName: string | null;
  constructionSiteId: string | null; value: number | null; signedDate: string | null; effectiveDate: string | null; expiryDate: string | null;
  priceLines: number; deliveryNotes: number; lastDeliveryDate: string | null; deliveredValue: number; postedValue: number;
  unpricedLines: number; openLines: number; openStatements: number;
  openMonths: Array<{ month: string; lines: number; value: number; unpriced: number }>;
  /** null when the contract has no value declared. */
  usagePct: number | null; limitNear: number; limitOver: number;
}

export interface ContractPriceLine {
  id: string; lineNo: number; itemId: string; sku: string | null; name: string; unit: string | null;
  unitPrice: number; vatRate: number; quantityLimit: number | null; amountLimit: number | null;
  effectiveFrom: string | null; effectiveTo: string | null; note: string | null; used: boolean;
}

export type PriceSource = 'statement' | 'contract' | 'note' | 'missing';
export interface ContractDeliveryLine {
  lineId: string; itemId: string; name: string; unit: string | null; qty: number; unitPrice: number | null; vatRate: number;
  priceSource: PriceSource; amount: number | null; wmsReady: boolean; statementId: string | null; statementCode: string | null; statementStatus: string | null;
}
export interface ContractStatement {
  id: string; code: string; periodMonth: string; status: string; grossAmount: number; vatAmount: number; totalAmount: number;
  lineCount: number; createdByName: string | null; postedAt: string | null; postedByName: string | null;
  confirmedByName: string | null; confirmedAt: string | null; returnReason: string | null; note: string | null; canPost: boolean;
}
export interface ContractDetail extends Omit<ContractSummary, 'priceLines' | 'deliveryNotes' | 'lastDeliveryDate' | 'deliveredValue' | 'postedValue' | 'unpricedLines' | 'openLines' | 'openStatements' | 'openMonths' | 'usagePct' | 'limitNear' | 'limitOver'> {
  paymentTerms: string | null; canManage: boolean;
  priceLines: ContractPriceLine[];
  usage: Array<{ itemId: string; name: string; unit: string | null; deliveredQty: number; deliveredValue: number; unpricedLines: number;
    quantityLimit: number | null; amountLimit: number | null; currentPrice: number | null }>;
  deliveries: Array<{ noteId: string; code: string; ticketNo: string | null; date: string; lines: ContractDeliveryLine[] }>;
  statements: ContractStatement[];
}

const ERROR_MESSAGES: Record<string, string> = {
  PROCUREMENT_VIEW_DENIED: 'Bạn chưa có quyền vào Mua hàng.',
  PROCUREMENT_MANAGE_DENIED: 'Bạn chưa có quyền quản lý Hợp đồng trong Mua hàng.',
  PROCUREMENT_CONTRACT_NOT_FOUND: 'Hợp đồng không còn hoặc đã hủy. Tải lại.',
  PROCUREMENT_CONTRACT_LINE_IN_USE: 'Dòng giá đã được dùng cho phiếu giao nên không xóa được — hãy đặt ngày hết hiệu lực.',
  PROCUREMENT_CONTRACT_ITEM_INVALID: 'Vật tư không tồn tại trong danh mục.',
  PROCUREMENT_CONTRACT_LINE_INVALID: 'Dòng giá không còn. Tải lại.',
  PROCUREMENT_CONTRACT_DATE_INVALID: 'Ngày hết hiệu lực phải sau ngày bắt đầu.',
  PROCUREMENT_CONTRACT_PRICE_OVERLAP: 'Có hai đơn giá của cùng vật tư cùng hiệu lực một ngày. Đặt ngày hết hiệu lực cho giá cũ.',
  PROCUREMENT_PO_PRICE_INVALID: 'Đơn giá, VAT hoặc hạn mức không hợp lệ.',
  PROCUREMENT_PO_PRICE_MISSING: 'Bảng đối soát chưa có giá trị. Nhập đơn giá trước khi chốt.',
  PROCUREMENT_PO_SCOPE_MIXED: 'Một bảng đối soát chỉ gồm phiếu giao của cùng một dự án/công trường.',
  PROCUREMENT_STATEMENT_EMPTY: 'Chọn ít nhất một dòng giao nhận.',
  PROCUREMENT_STATEMENT_LINE_INVALID: 'Có dòng giao không thuộc tháng này, chưa xong WMS hoặc đã nằm trong bảng đối soát khác. Tải lại.',
  PROCUREMENT_STATEMENT_NOT_EDITABLE: 'Chỉ sửa được bảng đối soát ở trạng thái nháp.',
  PROCUREMENT_STATEMENT_NOT_FOUND: 'Bảng đối soát không còn. Tải lại.',
  PROCUREMENT_STATEMENT_STATE: 'Bảng đối soát đã đổi trạng thái. Tải lại.',
  PROCUREMENT_STATEMENT_POST_DENIED: 'Chỉ kế toán dự án (Room Thanh toán — Xác nhận) hoặc Admin được ghi công nợ.',
  PROCUREMENT_STATEMENT_SELF_POST: 'Người chốt bảng đối soát không tự ghi công nợ. Nhờ kế toán khác.',
  PROCUREMENT_PO_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không thực hiện được thao tác với Hợp đồng. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const procurementContractService = {
  list(filter: { projectId?: string; search?: string }) {
    return call<{ canManage: boolean; contracts: ContractSummary[] }>('list_procurement_contracts_v1', { p_filter: filter });
  },
  get(id: string) {
    return call<ContractDetail>('get_procurement_contract_v1', { p_contract_id: id });
  },
  savePrices(input: { contractId: string; deleteIds?: string[]; lines: Array<{ id?: string; itemId: string; unitPrice: number; vatRate: number;
    quantityLimit?: number | null; amountLimit?: number | null; effectiveFrom?: string | null; effectiveTo?: string | null; note?: string }> }) {
    return call<{ saved: number }>('save_procurement_contract_lines_v1', { p_input: input });
  },
  saveStatement(input: { contractId: string; month: string; statementId?: string; note?: string; lines: Array<{ deliveryLineId: string; unitPrice: number; vatRate: number }> }) {
    return call<{ statementId: string; code: string; lines: number; totalAmount: number }>('save_procurement_contract_statement_v1', { p_input: input });
  },
  transitionStatement(input: { statementId: string; action: 'confirm' | 'withdraw' | 'delete' | 'return' | 'post'; reason?: string }) {
    return call<{ statementId: string; status: string }>('transition_procurement_contract_statement_v1', { p_input: input });
  },
  searchItems(query: string) {
    return call<Array<{ id: string; name: string; sku: string | null; unit: string | null }>>('search_procurement_items_v1', { p_search: query.trim() || null });
  },
};

export const STATEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp', confirmed: 'Chờ kế toán ghi công nợ', posted: 'Đã ghi công nợ', cancelled: 'Đã hủy', reversed: 'Đã đảo',
};

/** Usage of a limit in percent; null when there is no limit. */
export const limitPct = (used: number, limit: number | null | undefined) => limit && limit > 0 ? used / limit * 100 : null;
export const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
