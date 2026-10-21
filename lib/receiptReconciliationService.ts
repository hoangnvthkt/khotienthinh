import { supabase } from './supabase';

// Đối chiếu nhận hàng tồn đọng: Mua hàng + thủ kho chốt từng đợt giao treo, thủ kho ghi sổ theo ngày hàng về.

export type ReconDecision = 'full' | 'partial' | 'none';
export type ReconRemainder = 'keep_open' | 'close';
export type ReconSide = 'buyer' | 'keeper';

export interface ReconLine {
  deliveryLineId: string; itemId: string; name: string; sku: string | null; unit: string | null;
  /** Quy cách của dòng đơn (một mã nhiều quy cách). */
  specification?: string | null;
  plannedQty: number; unitPrice: number;
  /** Thủ kho đã kiểm SL/CL nhưng chưa nhập kho. */
  checkedQty: number | null;
  /** Kho đã nhập phiếu WMS (đơn vị mua) nhưng PO chưa ghi nhận. */
  stockedQty: number | null;
}

export interface ReconSignature { id: string; name: string | null; at: string }
export interface ReconEvent { action: string; actorName: string | null; at: string; revision: number; before: Record<string, unknown> | null; after: Record<string, unknown> | null; note: string | null }

export interface ReconRecord {
  id: string; status: 'open' | 'posted' | 'voided'; decision: ReconDecision; remainder: ReconRemainder;
  arrivalDate: string | null; lines: Array<{ deliveryLineId: string; receivedQty: number }>; reason: string | null; revision: number;
  buyer: ReconSignature | null; keeper: ReconSignature | null;
  postedByName: string | null; postedAt: string | null;
  result: { batchStatus: string; poStatus: string; acceptedGross: number | null; payableId: string | null; closedShort: boolean } | null;
  updatedByName: string | null; updatedAt: string; events: ReconEvent[];
  rejection: { side: ReconSide; byId: string; byName: string | null; at: string; reason: string } | null;
}

export interface ReconItem {
  deliveryBatchId: string; deliveryNo: number | null; batchStatus: string; plannedDate: string | null;
  purchaseOrderId: string; poNumber: string | null; poStatus: string; purchaseMode: string; orderDate: string | null; vendorName: string | null;
  projectId: string | null; projectCode: string | null; warehouseId: string; warehouseName: string | null;
  wmsTransactionId: string; txStatus: string; docDate: string; ageDays: number; createdByName: string | null; vatRate: number;
  open: boolean; stocked: boolean;
  checked: { byName: string | null; at: string } | null;
  poUnscheduled: Array<{ name: string; specification?: string | null; unit: string | null; qty: number }>;
  otherOpenDeliveries: number;
  lines: ReconLine[];
  recon: ReconRecord | null;
  can: { edit: boolean; buyer: boolean; keeper: boolean; confirmBuyer: boolean; confirmKeeper: boolean;
    rejectBuyer: boolean; rejectKeeper: boolean; post: boolean };
}

export interface ReconList {
  canBuyer: boolean;
  /** Bậc quyền của người xem: Mua hàng, thủ kho (kho được giao), Admin, hay chỉ xem. */
  role: { buyer: boolean; keeper: boolean; admin: boolean; readOnly: boolean };
  warehouses: Array<{ id: string; name: string | null }>; items: ReconItem[];
}

const ERROR_MESSAGES: Record<string, string> = {
  RECEIPT_RECON_VIEW_DENIED: 'Chỉ Mua hàng và thủ kho được giao kho mới vào được màn đối chiếu.',
  RECEIPT_RECON_EDIT_DENIED: 'Bạn không thuộc Mua hàng hoặc thủ kho của kho này.',
  RECEIPT_RECON_CONFIRM_DENIED: 'Bạn không có quyền xác nhận phía này.',
  RECEIPT_RECON_POST_DENIED: 'Chỉ thủ kho của kho nhận (hoặc Admin) được ghi sổ.',
  RECEIPT_RECON_BATCH_CLOSED: 'Đợt giao đã được xử lý ở nơi khác (nhập kho hoặc hủy). Tải lại.',
  RECEIPT_RECON_DECISION_INVALID: 'Chọn Về đủ, Về thiếu/dư hoặc Không về.',
  RECEIPT_RECON_ARRIVAL_INVALID: 'Ngày hàng về không hợp lệ (không được sau hôm nay).',
  RECEIPT_RECON_LINES_INVALID: 'Nhập SL thực nhận cho mọi dòng (số không âm).',
  RECEIPT_RECON_USE_NONE: 'Tất cả dòng bằng 0 — hãy chọn "Không về".',
  RECEIPT_RECON_REASON_REQUIRED: 'Nhập lý do khi hàng về lệch hoặc không về.',
  RECEIPT_RECON_BELOW_STOCKED: 'SL thực nhận không được thấp hơn số kho đã nhập. Điều chỉnh giảm đi qua kiểm kê.',
  RECEIPT_RECON_REVISION_CONFLICT: 'Người khác vừa sửa đối chiếu này. Tải lại để xem bản mới.',
  RECEIPT_RECON_SAME_PERSON: 'Một người không xác nhận cả hai phía Mua hàng và Thủ kho.',
  RECEIPT_RECON_NOT_FOUND: 'Đối chiếu không còn hoặc đã ghi sổ. Tải lại.',
  RECEIPT_RECON_NOT_CONFIRMED: 'Cần đủ xác nhận của Mua hàng và Thủ kho trước khi ghi sổ.',
  RECEIPT_RECON_LINES_CHANGED: 'Dòng hàng của đợt giao đã thay đổi. Tải lại và đối chiếu lại.',
  RECEIPT_RECON_REJECT_REASON_REQUIRED: 'Nhập lý do từ chối để phía kia biết cần sửa gì.',
  RECEIPT_RECON_NOTHING_TO_REJECT: 'Chỉ từ chối được khi phía kia đã xác nhận và bạn chưa xác nhận.',
  RECEIPT_RECON_REMAINDER_OPEN: 'PO còn đợt giao khác đang mở — ghi sổ các đợt đó trước khi chốt thiếu.',
  INVENTORY_NEGATIVE_STOCK: 'Thao tác làm tồn kho âm. Kiểm tra lại số lượng.',
};

const call = async <T>(name: string, params: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find(key => error.message?.includes(key));
    const mapped = new Error(code ? ERROR_MESSAGES[code] : 'Không thực hiện được thao tác đối chiếu. Thử lại sau.');
    (mapped as Error & { code?: string }).code = code || error.code;
    throw mapped;
  }
  return data as T;
};

export const receiptReconciliationService = {
  list(filter: { warehouseId?: string } = {}) {
    return call<ReconList>('list_receipt_reconciliations_v1', { p_filter: filter });
  },
  save(input: { deliveryBatchId: string; expectedRevision: number | null; decision: ReconDecision; remainder: ReconRemainder;
    arrivalDate: string | null; reason: string; lines: Array<{ deliveryLineId: string; receivedQty: number }>; confirmAs: ReconSide | null }) {
    return call<ReconItem>('save_receipt_reconciliation_v1', { p_input: input });
  },
  confirm(input: { reconciliationId: string; side: ReconSide; revision: number; revoke?: boolean }) {
    return call<ReconItem>('confirm_receipt_reconciliation_v1', { p_input: input });
  },
  reject(input: { reconciliationId: string; side: ReconSide; revision: number; reason: string }) {
    return call<ReconItem>('reject_receipt_reconciliation_v1', { p_input: input });
  },
  post(input: { reconciliationId: string; revision: number }) {
    return call<ReconItem>('post_receipt_reconciliation_v1', { p_input: input });
  },
};

export type ReconStage = 'todo' | 'rejected' | 'waiting_buyer' | 'waiting_keeper' | 'ready' | 'posted';

/** Where a row stands, from the viewer's point of view. */
export const reconStage = (item: ReconItem): ReconStage => {
  const r = item.recon;
  if (r?.status === 'posted') return 'posted';
  if (!r) return 'todo';
  if (r.buyer && r.keeper) return 'ready';
  if (r.rejection) return 'rejected';
  if (!r.buyer && !r.keeper) return 'todo';
  return r.buyer ? 'waiting_keeper' : 'waiting_buyer';
};

export const RECON_STAGE_LABELS: Record<ReconStage, string> = {
  todo: 'Chưa đối chiếu', rejected: 'Bị từ chối — cần sửa', waiting_buyer: 'Chờ Mua hàng xác nhận', waiting_keeper: 'Chờ thủ kho xác nhận',
  ready: 'Đủ xác nhận — chờ ghi sổ', posted: 'Đã ghi sổ',
};

export const RECON_DECISION_LABELS: Record<ReconDecision, string> = { full: 'Về đủ', partial: 'Về thiếu / dư', none: 'Không về' };

export const RECON_EVENT_LABELS: Record<string, string> = {
  create: 'Lập đối chiếu', save: 'Sửa đối chiếu (xác nhận cũ mất hiệu lực)', confirm_buyer: 'Mua hàng xác nhận', confirm_keeper: 'Thủ kho xác nhận',
  revoke_buyer: 'Mua hàng bỏ xác nhận', revoke_keeper: 'Thủ kho bỏ xác nhận',
  reject_buyer: 'Mua hàng từ chối', reject_keeper: 'Thủ kho từ chối', post: 'Ghi sổ',
};

/** Does the viewer still need to act on this row? */
export const reconNeedsMe = (item: ReconItem) => item.open && (item.can.post || item.can.confirmBuyer || item.can.confirmKeeper
  || (item.can.edit && !item.recon)
  // Bị phía kia từ chối: phía mình phải sửa lại.
  || (!!item.recon?.rejection && (item.recon.rejection.side === 'keeper' ? item.can.buyer : item.can.keeper)));

/** Text the multi-purpose search box matches against. */
export const reconSearchText = (item: ReconItem) => [item.poNumber, `đợt ${item.deliveryNo}`, item.vendorName, item.projectCode,
  item.warehouseName, item.createdByName, ...item.lines.map(l => `${l.name} ${l.sku || ''}`)].join(' ').toLowerCase();

export const reconValue = (item: ReconItem) => item.lines.reduce((s, l) => s + l.plannedQty * l.unitPrice, 0) * (1 + item.vatRate / 100);
