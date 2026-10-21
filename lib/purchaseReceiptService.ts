import { TransactionStatus, type WmsTransactionAttachment } from '../types';
import type { PurchaseDeliveryUiStatus } from './purchasePackageDomain';
import { supabase } from './supabase';

export interface MaterialPoQualityLineInput {
  deliveryLineId: string;
  itemId: string;
  documentedPurchaseQty: number;
  countedPurchaseQty: number;
  acceptedPurchaseQty: number;
  documentedStockQty: number;
  countedStockQty: number;
  acceptedStockQty: number;
  varianceReason?: string | null;
  /** Người nhận đã xác nhận NCC giao dư thật (số đạt vượt phần đơn còn lại) — máy chủ chặn nếu thiếu. */
  overConfirmed?: boolean;
}

export type ReceiptQualityLineInput = MaterialPoQualityLineInput;

export interface ApproveReceiptQualityInput {
  deliveryBatchId: string;
  wmsTransactionId: string;
  actorUserId: string;
  qualityResult: 'passed' | 'partial' | 'rejected';
  lines: MaterialPoQualityLineInput[];
  attachments: WmsTransactionAttachment[];
}

export interface ReceiptCommandResult {
  deliveryBatchId: string;
  wmsTransactionId: string;
  deliveryStatus: PurchaseDeliveryUiStatus;
  transactionStatus: TransactionStatus;
  acceptedGrossAmount: number;
}

const deliveryStatuses = new Set<PurchaseDeliveryUiStatus>([
  'waiting_delivery',
  'receiving',
  'quality_approved',
  'received',
  'received_short',
  'received_over',
  'cancelled',
]);

const readField = (value: Record<string, unknown>, camelKey: string, snakeKey: string) =>
  value[camelKey] ?? value[snakeKey];

const assertReceiptCommandResult = (
  data: unknown,
  expected: { deliveryBatchId: string; wmsTransactionId: string },
): ReceiptCommandResult => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new Error('Command nhận hàng không trả về kết quả.');
  }

  const value = row as Record<string, unknown>;
  const deliveryBatchId = String(readField(value, 'deliveryBatchId', 'delivery_batch_id') || '');
  const wmsTransactionId = String(readField(value, 'wmsTransactionId', 'wms_transaction_id') || '');
  const deliveryStatus = String(readField(value, 'deliveryStatus', 'delivery_status') || '') as PurchaseDeliveryUiStatus;
  const transactionStatus = String(readField(value, 'transactionStatus', 'transaction_status') || '') as TransactionStatus;
  const acceptedGrossAmount = Number(readField(value, 'acceptedGrossAmount', 'accepted_gross_amount') || 0);

  if (deliveryBatchId !== expected.deliveryBatchId || wmsTransactionId !== expected.wmsTransactionId) {
    throw new Error('Kết quả command nhận hàng không khớp Đợt giao hoặc phiếu WMS.');
  }
  if (!deliveryStatuses.has(deliveryStatus) || !Object.values(TransactionStatus).includes(transactionStatus)) {
    throw new Error('Trạng thái trả về từ command nhận hàng không hợp lệ.');
  }
  if (!Number.isFinite(acceptedGrossAmount)) {
    throw new Error('Giá trị thực nhận trả về từ command nhận hàng không hợp lệ.');
  }

  return {
    deliveryBatchId,
    wmsTransactionId,
    deliveryStatus,
    transactionStatus,
    acceptedGrossAmount,
  };
};

export const purchaseReceiptService = {
  async approveQuality(input: ApproveReceiptQualityInput): Promise<ReceiptCommandResult> {
    const { data, error } = await supabase.rpc('approve_material_po_quality', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_wms_transaction_id: input.wmsTransactionId,
      p_actor_user_id: input.actorUserId,
      p_quality_result: input.qualityResult,
      p_lines: input.lines,
      p_attachments: input.attachments,
    });
    if (error) throw error;
    return assertReceiptCommandResult(data, input);
  },

  /** Kiểm SL/CL và nhập kho trong một lệnh (một giao dịch). */
  async receiveInOneStep(input: ApproveReceiptQualityInput): Promise<ReceiptCommandResult> {
    const { data, error } = await supabase.rpc('receive_purchase_delivery_v1', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_wms_transaction_id: input.wmsTransactionId,
      p_quality_result: input.qualityResult,
      p_lines: input.lines,
      p_attachments: input.attachments,
    });
    if (error) throw error;
    return assertReceiptCommandResult(data, input);
  },

  async finalizeReceipt(input: {
    deliveryBatchId: string;
    wmsTransactionId: string;
    actorUserId: string;
  }): Promise<ReceiptCommandResult> {
    const { data, error } = await supabase.rpc('finalize_material_po_receipt', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_wms_transaction_id: input.wmsTransactionId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return assertReceiptCommandResult(data, input);
  },

  async finalize(input: {
    deliveryBatchId: string;
    wmsTransactionId: string;
    actorUserId: string;
  }): Promise<ReceiptCommandResult> {
    return this.finalizeReceipt(input);
  },

  /** Nhận thiếu, NCC còn giao tiếp: mở ngay đợt giao kế tiếp cho phần còn lại (cùng giá, VAT, kho). Bấm lại trả đợt đã mở. */
  async continueDelivery(deliveryBatchId: string): Promise<{ deliveryId: string; deliveryNo: number; wmsTransactionId: string | null; replayed: boolean }> {
    const { data, error } = await supabase.rpc('continue_purchase_delivery_v1', { p: { deliveryId: deliveryBatchId } });
    if (error) {
      const code = Object.keys(CONTINUE_ERRORS).find(key => error.message?.includes(key));
      throw new Error(code ? CONTINUE_ERRORS[code] : error.message || 'Chưa mở được đợt giao tiếp.');
    }
    return data as { deliveryId: string; deliveryNo: number; wmsTransactionId: string | null; replayed: boolean };
  },
};

/** Tiến độ đơn của một đợt giao: dùng để cảnh báo trước khi nhận và hiện lịch sử sửa số. */
export interface PurchaseReceiptContextLine {
  deliveryLineId: string;
  purchaseOrderLineId: string;
  itemId: string;
  unit: string | null;
  orderedQty: number;
  receivedQty: number;
  pendingOtherQty: number;
  plannedQty: number;
  maxWithoutOver: number;
  stockPlannedQty: number;
  acceptedQty: number;
  acceptedStockQty: number;
  returnedQty: number;
  unitPrice: number;
}

export interface PurchaseReceiptOutsideImport {
  transactionId: string;
  date: string;
  note: string | null;
  partner: string | null;
  code: string | null;
  lines: Array<{ itemId: string; qty: number }>;
}

export interface PurchaseReceiptCorrection {
  at: string;
  byName: string | null;
  reason: string | null;
  transactionId: string | null;
  creditAmount: number;
  lines: Array<{ deliveryLineId: string; itemId: string; unit: string; before: number; after: number; diff: number }>;
}

export interface PurchaseReceiptContext {
  poId: string;
  poNumber: string | null;
  poCreatedAt: string | null;
  poStatus: string | null;
  deliveryNo: number;
  batchStatus: string;
  vatRate: number;
  receiptApproverId: string | null;
  lines: PurchaseReceiptContextLine[];
  otherOpenBatches: Array<{ deliveryNo: number; status: string; plannedDate: string | null; qty: number }>;
  outsideImports: PurchaseReceiptOutsideImport[];
  corrections: PurchaseReceiptCorrection[];
}

const num = (value: unknown) => Number(value ?? 0) || 0;

export const mapPurchaseReceiptContext = (raw: any): PurchaseReceiptContext => ({
  poId: String(raw?.poId || ''),
  poNumber: raw?.poNumber ?? null,
  poCreatedAt: raw?.poCreatedAt ?? null,
  poStatus: raw?.poStatus ?? null,
  deliveryNo: num(raw?.deliveryNo),
  batchStatus: String(raw?.batchStatus || ''),
  vatRate: num(raw?.vatRate),
  receiptApproverId: raw?.receiptApproverId ?? null,
  lines: (raw?.lines || []).map((l: any) => ({
    deliveryLineId: String(l.deliveryLineId), purchaseOrderLineId: String(l.purchaseOrderLineId || ''), itemId: String(l.itemId || ''),
    unit: l.unit ?? null, orderedQty: num(l.orderedQty), receivedQty: num(l.receivedQty), pendingOtherQty: num(l.pendingOtherQty),
    plannedQty: num(l.plannedQty), maxWithoutOver: num(l.maxWithoutOver), stockPlannedQty: num(l.stockPlannedQty),
    acceptedQty: num(l.acceptedQty), acceptedStockQty: num(l.acceptedStockQty), returnedQty: num(l.returnedQty), unitPrice: num(l.unitPrice),
  })),
  otherOpenBatches: (raw?.otherOpenBatches || []).map((b: any) => ({ deliveryNo: num(b.deliveryNo), status: String(b.status || ''), plannedDate: b.plannedDate ?? null, qty: num(b.qty) })),
  outsideImports: (raw?.outsideImports || []).map((t: any) => ({
    transactionId: String(t.transactionId), date: String(t.date || ''), note: t.note ?? null, partner: t.partner ?? null, code: t.code ?? null,
    lines: (t.lines || []).map((l: any) => ({ itemId: String(l.itemId || ''), qty: num(l.qty) })),
  })),
  corrections: (raw?.corrections || []).map((c: any) => ({
    at: String(c.at || ''), byName: c.byName ?? null, reason: c.reason ?? null, transactionId: c.transactionId ?? null, creditAmount: num(c.creditAmount),
    lines: (c.lines || []).map((l: any) => ({ deliveryLineId: String(l.deliveryLineId || ''), itemId: String(l.itemId || ''), unit: String(l.unit || ''),
      before: num(l.before), after: num(l.after), diff: num(l.diff) })),
  })),
});

const FIX_ERRORS: Record<string, string> = {
  PURCHASE_FIX_STALE: 'Số đã nhận vừa thay đổi — đóng và mở lại phiếu để xem số mới.',
  PURCHASE_FIX_NOT_FOUND: 'Không tìm thấy đợt giao.',
};

/** Lỗi máy chủ dạng "MÃ: câu tiếng Việt" → giữ câu tiếng Việt. */
export const receiptErrorMessage = (error: { message?: string } | null | undefined, fallback: string): string => {
  const message = error?.message || '';
  const code = Object.keys(FIX_ERRORS).find(key => message.includes(key));
  if (code) return FIX_ERRORS[code];
  const match = message.match(/^(PURCHASE_[A-Z_]+|WMS_[A-Z_]+|INVENTORY_[A-Z_]+):\s*(.+)$/s);
  return match ? match[2] : message || fallback;
};

export const purchaseReceiptContextService = {
  async get(deliveryBatchId: string): Promise<PurchaseReceiptContext> {
    const { data, error } = await supabase.rpc('get_purchase_receipt_context_v1', { p_delivery_batch_id: deliveryBatchId });
    if (error) throw new Error(receiptErrorMessage(error, 'Không tải được tiến độ đơn.'));
    return mapPurchaseReceiptContext(data);
  },

  /** Sửa số nhận nhầm (chỉ giảm): ghi phiếu điều chỉnh kho + giảm công nợ, đơn mở lại phần thiếu. */
  async correct(input: { deliveryBatchId: string; reason: string; lines: Array<{ deliveryLineId: string; correctQty: number; expectedQty: number }> }) {
    const { data, error } = await supabase.rpc('correct_purchase_receipt_v1', {
      p: { deliveryId: input.deliveryBatchId, reason: input.reason, lines: input.lines },
    });
    if (error) throw new Error(receiptErrorMessage(error, 'Chưa sửa được số nhận.'));
    return data as { correctionId: string; transactionId: string; creditAmount: number; batchStatus: string };
  },
};

const CONTINUE_ERRORS: Record<string, string> = {
  PURCHASE_CONTINUE_DENIED: 'Chỉ thủ kho kho nhận, Mua hàng hoặc Admin mở được đợt giao tiếp.',
  PURCHASE_CONTINUE_NOT_SHORT: 'Đợt giao này không ở trạng thái nhận thiếu.',
  PURCHASE_CONTINUE_PO_STATE: 'Đơn đã nhận đủ, đã đóng hoặc đã kết thúc thiếu.',
  PURCHASE_CONTINUE_NOTHING_LEFT: 'Đơn không còn phần chưa giao (đã có đợt giao khác cho phần còn lại).',
  PURCHASE_CONTINUE_NOT_FOUND: 'Không tìm thấy đợt giao.',
};
