import { supabase } from './supabase';

// Hợp đồng nguyên tắc trong Mua hàng: khai HĐ + đơn giá có ngày hiệu lực, gọi hàng theo HĐ (đơn PO gắn HĐ,
// nhận như PO), lũy kế theo HĐ, bảng đối soát tháng (Mua hàng lập & chốt, kế toán ghi công nợ).

export interface ContractSummary {
  id: string; code: string; name: string | null; type: string | null; status: string | null;
  supplierId: string | null; supplierName: string | null; projectId: string | null; projectCode: string | null; projectName: string | null;
  constructionSiteId: string | null; value: number | null; signedDate: string | null; effectiveDate: string | null; expiryDate: string | null;
  priceLines: number; deliveryNotes: number; lastDeliveryDate: string | null; deliveredValue: number; postedValue: number;
  unpricedLines: number; openLines: number; openStatements: number;
  /** Đã nhận nhưng phiếu nhập kho chưa hoàn tất — chưa đối soát được. */
  pendingLines: number; openOrders: number; waitingOrders: number;
  /** HĐ còn hiệu lực (chưa hết hạn / hoàn thành). */
  orderable: boolean; canOrder: boolean;
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
/** stock = đã nhập, đang lưu kho; direct = nhập–xuất thẳng (dùng ngay); none = không qua kho; pending = chưa nhập kho xong. */
export type StockState = 'stock' | 'direct' | 'none' | 'pending';
export interface ContractDeliveryLine {
  lineId: string; itemId: string; name: string; unit: string | null; qty: number; unitPrice: number | null; vatRate: number;
  priceSource: PriceSource; amount: number | null; wmsReady: boolean; statementId: string | null; statementCode: string | null; statementStatus: string | null;
  stockState: StockState; warehouseName: string | null; contractPrice: number | null;
}
export interface ContractOrderItem { lineId: string; itemId: string; name: string; unit: string; qty: number; unitPrice: number; priceSource?: 'contract' | 'manual'; receivedQty?: number }
export interface ContractOrder {
  id: string; poNumber: string; status: string; totalAmount: number; vatRate: number; expectedDeliveryDate: string | null;
  fulfillmentMode: 'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION'; warehouseName: string | null; projectCode: string | null; rowVersion: number;
  createdById: string | null; createdByName: string | null; submittedToName: string | null; returnReason: string | null; lines: number;
  items: ContractOrderItem[]; targetWarehouseId: string | null; note: string | null; purchaseMode: 'single' | 'multiple'; receivedValue: number;
}
export interface ContractStatement {
  id: string; code: string; periodMonth: string; status: string; grossAmount: number; vatAmount: number; totalAmount: number;
  lineCount: number; createdByName: string | null; postedAt: string | null; postedByName: string | null;
  confirmedByName: string | null; confirmedAt: string | null; returnReason: string | null; note: string | null; canPost: boolean;
  projectCode: string | null;
}
export interface ContractDetail extends Omit<ContractSummary, 'priceLines' | 'deliveryNotes' | 'lastDeliveryDate' | 'deliveredValue' | 'postedValue' | 'unpricedLines' | 'openLines' | 'openStatements' | 'openMonths' | 'usagePct' | 'limitNear' | 'limitOver' | 'pendingLines' | 'openOrders' | 'waitingOrders' | 'orderable'> {
  paymentTerms: string | null; paymentTermDays: number | null; note: string | null; canManage: boolean;
  /** Người có quyền Mua hàng — thấy đối soát / công nợ. */
  isBuyer: boolean; canOrder: boolean;
  approvers: Array<{ id: string; name: string }>;
  orders: ContractOrder[];
  priceLines: ContractPriceLine[];
  usage: Array<{ itemId: string; name: string; unit: string | null; deliveredQty: number; deliveredValue: number; unpricedLines: number;
    quantityLimit: number | null; amountLimit: number | null; currentPrice: number | null }>;
  deliveries: Array<{ noteId: string; code: string; ticketNo: string | null; date: string; purchaseOrderNo: string | null; projectCode: string | null; scopeKey: string; lines: ContractDeliveryLine[] }>;
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
  PROCUREMENT_PO_PRICE_MISSING: 'Còn dòng chưa có đơn giá — nhập đơn giá trước khi gửi / chốt.',
  PROCUREMENT_PO_SCOPE_MIXED: 'Một bảng đối soát chỉ gồm phiếu giao của cùng một dự án/công trường.',
  PROCUREMENT_STATEMENT_EMPTY: 'Chọn ít nhất một dòng giao nhận.',
  PROCUREMENT_STATEMENT_LINE_INVALID: 'Có dòng giao không thuộc tháng này, chưa xong WMS hoặc đã nằm trong bảng đối soát khác. Tải lại.',
  PROCUREMENT_STATEMENT_NOT_EDITABLE: 'Chỉ sửa được bảng đối soát ở trạng thái nháp.',
  PROCUREMENT_STATEMENT_NOT_FOUND: 'Bảng đối soát không còn. Tải lại.',
  PROCUREMENT_STATEMENT_STATE: 'Bảng đối soát đã đổi trạng thái. Tải lại.',
  PROCUREMENT_STATEMENT_POST_DENIED: 'Chỉ kế toán dự án (Room Thanh toán — Xác nhận) hoặc Admin được ghi công nợ.',
  PROCUREMENT_STATEMENT_SELF_POST: 'Người chốt bảng đối soát không tự ghi công nợ. Nhờ kế toán khác.',
  PROCUREMENT_PO_RETURN_REASON_REQUIRED: 'Nhập lý do trả lại.',
  PROCUREMENT_STATEMENT_PRICE_REASON: 'Có dòng giá khác giá HĐ — ghi lý do cho từng dòng đó.',
  PROCUREMENT_CONTRACT_FIELDS_REQUIRED: 'Nhập số và tên hợp đồng.',
  PROCUREMENT_CONTRACT_INVALID: 'Giá trị HĐ, hạn thanh toán hoặc trạng thái không hợp lệ.',
  PROCUREMENT_CONTRACT_SCOPE_LOCKED: 'HĐ đã có giao nhận / đơn gọi hàng nên không đổi được NCC hoặc dự án.',
  PROCUREMENT_CONTRACT_CLOSED: 'HĐ đã hoàn thành hoặc đã hủy — không gọi hàng được nữa.',
  PROCUREMENT_CONTRACT_EXPIRED: 'Ngày giao nằm ngoài thời hạn HĐ. Nhờ Mua hàng gia hạn HĐ hoặc đổi ngày giao.',
  PROCUREMENT_CONTRACT_WAREHOUSE_SCOPE: 'HĐ này của một dự án khác — chọn kho của dự án ghi trên HĐ.',
  PROCUREMENT_CONTRACT_ORDER_DENIED: 'Bạn chưa có quyền gọi hàng theo HĐ cho kho này. Nhờ quản trị cấp "Gọi hàng theo HĐ" của dự án.',
  PROCUREMENT_CONTRACT_PRICE_REQUIRED: 'Vật tư chưa có giá trong HĐ — nhập giá tạm (chốt lại khi đối soát).',
  PROCUREMENT_CONTRACT_VAT_MIXED: 'Các vật tư có VAT khác nhau — tách thành đơn riêng theo từng mức VAT.',
  PROCUREMENT_CONTRACT_LIMIT_APPROVAL: 'Đơn vượt giá trị HĐ hoặc hạn mức vật tư — chọn người Mua hàng duyệt.',
  PROCUREMENT_PO_APPROVER_INVALID: 'Người duyệt không hợp lệ (phải là Mua hàng — Quản trị, không phải chính bạn).',
  PROCUREMENT_PO_VENDOR_REQUIRED: 'Chọn nhà cung cấp đang hoạt động.',
  PROCUREMENT_PO_WAREHOUSE_INVALID: 'Chọn kho nhận đang hoạt động.',
  PROCUREMENT_PO_ITEMS_REQUIRED: 'Thêm ít nhất một vật tư.',
  PROCUREMENT_PO_QTY_INVALID: 'Số lượng phải lớn hơn 0.',
  PROCUREMENT_PO_DUPLICATE_LINE: 'Mỗi vật tư chỉ một dòng.',
  PROCUREMENT_PO_NOT_EDITABLE: 'Đơn đã gửi — không sửa được nữa.',
  PROCUREMENT_PO_SUBMIT_DENIED: 'Chỉ người lập gửi / xóa được đơn nháp này.',
  PROCUREMENT_PO_DELETE_DENIED: 'Đơn đã từng gửi nên không xóa được.',
  PROCUREMENT_PROACTIVE_ALLOCATED: 'Dòng đã gắn nhu cầu — không giảm dưới phần đã gắn.',
  PROCUREMENT_PROACTIVE_PROJECT_REQUIRED: 'Dự án không còn hoạt động.',
  PROCUREMENT_ITEM_NOT_FOUND: 'Vật tư không còn trong danh mục.',
  ROW_VERSION_CONFLICT: 'Đơn vừa được người khác sửa. Tải lại.',
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
    return call<{ canManage: boolean; isBuyer: boolean; contracts: ContractSummary[] }>('list_procurement_contracts_v1', { p_filter: filter });
  },
  saveContract(input: ContractInput) {
    return call<{ contractId: string; code: string }>('save_procurement_contract_v1', { p_input: input });
  },
  saveOrder(input: ContractOrderInput) {
    return call<{ purchaseOrderId: string; poNumber: string; rowVersion: number; totalAmount: number; lines: number; manualPrices: number }>('save_procurement_contract_order_v1', { p_input: input });
  },
  transitionOrder(input: { purchaseOrderId: string; expectedRowVersion: number; action: 'send' | 'delete'; approverUserId?: string }) {
    return call<{ purchaseOrderId: string; status: string; rowVersion: number; overLimit: boolean }>('transition_procurement_contract_order_v1', { p_input: input });
  },
  get(id: string) {
    return call<ContractDetail>('get_procurement_contract_v1', { p_contract_id: id });
  },
  savePrices(input: { contractId: string; deleteIds?: string[]; lines: Array<{ id?: string; itemId: string; unitPrice: number; vatRate: number;
    quantityLimit?: number | null; amountLimit?: number | null; effectiveFrom?: string | null; effectiveTo?: string | null; note?: string }> }) {
    return call<{ saved: number }>('save_procurement_contract_lines_v1', { p_input: input });
  },
  saveStatement(input: { contractId: string; month: string; statementId?: string; note?: string; lines: Array<{ deliveryLineId: string; unitPrice: number; vatRate: number; reason?: string }> }) {
    return call<{ statementId: string; code: string; lines: number; totalAmount: number }>('save_procurement_contract_statement_v1', { p_input: input });
  },
  transitionStatement(input: { statementId: string; action: 'confirm' | 'withdraw' | 'delete' | 'return' | 'post'; reason?: string }) {
    return call<{ statementId: string; status: string }>('transition_procurement_contract_statement_v1', { p_input: input });
  },
  searchItems(query: string) {
    return call<Array<{ id: string; name: string; sku: string | null; unit: string | null }>>('search_procurement_items_v1', { p_search: query.trim() || null });
  },
};

export interface ContractInput {
  contractId?: string; code: string; name: string; supplierId: string; projectId?: string | null; signedDate?: string | null;
  effectiveDate?: string | null; expiryDate?: string | null; value?: number | null; paymentTermDays?: number | null; paymentTerms?: string; status?: 'draft' | 'signed' | 'completed'; note?: string;
}
export interface ContractOrderInput {
  purchaseOrderId?: string; expectedRowVersion?: number; contractId: string; targetWarehouseId: string; expectedDeliveryDate?: string | null;
  fulfillmentMode: 'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION'; purchaseMode?: 'single' | 'multiple'; vatRate?: number; note?: string;
  items: Array<{ lineId?: string; itemId: string; qty: number; unitPrice?: number | null; note?: string }>;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp', returned: 'Bị trả lại', sent: 'Chờ Mua hàng duyệt (vượt hạn mức)', confirmed: 'Đã gửi NCC · chờ giao',
  in_transit: 'Đang giao', partial: 'Đã nhận một phần', delivered: 'Đã nhận đủ', closed: 'Đã kết thúc', cancelled: 'Đã hủy',
};
export const STOCK_STATE_LABELS: Record<StockState, string> = {
  stock: 'Đã nhập kho · lưu kho', direct: 'Nhập–xuất thẳng', none: 'Không qua kho', pending: 'Chưa nhập kho xong',
};

export const STATEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp', confirmed: 'Chờ kế toán ghi công nợ', posted: 'Đã ghi công nợ', cancelled: 'Đã hủy', reversed: 'Đã đảo',
};

/** Usage of a limit in percent; null when there is no limit. */
export const limitPct = (used: number, limit: number | null | undefined) => limit && limit > 0 ? used / limit * 100 : null;
export const monthLabel = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
