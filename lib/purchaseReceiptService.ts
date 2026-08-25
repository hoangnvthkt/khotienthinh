import { TransactionStatus, type PurchaseOrderReceipt, type WmsTransactionAttachment } from '../types';
import type { PurchaseDeliveryUiStatus } from './purchasePackageDomain';
import { fromDb } from './dbMapping';
import { supabase } from './supabase';

export interface ReceiptQualityLineInput {
  deliveryLineId: string;
  itemId: string;
  acceptedPurchaseQty: number;
  acceptedStockQty: number;
  varianceReason?: string | null;
}

export interface ApproveReceiptQualityInput {
  deliveryBatchId: string;
  wmsTransactionId: string;
  actorUserId: string;
  qualityResult: 'passed' | 'partial' | 'rejected';
  lines: ReceiptQualityLineInput[];
  attachments: WmsTransactionAttachment[];
}

export interface ReceiptCommandResult {
  deliveryBatchId: string;
  wmsTransactionId: string;
  deliveryStatus: PurchaseDeliveryUiStatus;
  transactionStatus: TransactionStatus;
  acceptedGrossAmount: number;
}

export interface RecordPurchaseOrderReceiptV3Input {
  deliveryBatchId: string;
  idempotencyKey: string;
  actorUserId: string;
  qualityResult: 'passed' | 'partial' | 'rejected';
  isFinal: boolean;
  varianceReason?: string | null;
  attachments: WmsTransactionAttachment[];
  lines: Array<{
    deliveryLineId: string;
    itemId: string;
    deliveredPurchaseQty: number;
    acceptedPurchaseQty: number;
    deliveredStockQty: number;
    acceptedStockQty: number;
    varianceReason?: string | null;
  }>;
}

export interface RecordPurchaseOrderReceiptV3Result {
  receiptId: string;
  deliveryBatchId: string;
  receiptNo: number;
  wmsTransactionId: string;
  financeStatus: 'ready' | 'variance_pending' | 'posted';
  batchStatus: PurchaseDeliveryUiStatus;
  idempotentReplay: boolean;
}

const assertRecordReceiptV3Result = (data: unknown, deliveryBatchId: string): RecordPurchaseOrderReceiptV3Result => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Lệnh ghi nhận lần nhập không trả về kết quả.');
  const value = row as Record<string, unknown>;
  const result: RecordPurchaseOrderReceiptV3Result = {
    receiptId: String(readField(value, 'receiptId', 'receipt_id') || ''),
    deliveryBatchId: String(readField(value, 'deliveryBatchId', 'delivery_batch_id') || ''),
    receiptNo: Number(readField(value, 'receiptNo', 'receipt_no') || 0),
    wmsTransactionId: String(readField(value, 'wmsTransactionId', 'wms_transaction_id') || ''),
    financeStatus: String(readField(value, 'financeStatus', 'finance_status') || '') as RecordPurchaseOrderReceiptV3Result['financeStatus'],
    batchStatus: String(readField(value, 'batchStatus', 'batch_status') || 'receiving') as PurchaseDeliveryUiStatus,
    idempotentReplay: Boolean(readField(value, 'idempotentReplay', 'idempotent_replay')),
  };
  if (!result.receiptId || result.deliveryBatchId !== deliveryBatchId || !result.wmsTransactionId || result.receiptNo <= 0) {
    throw new Error('Kết quả lần nhập v3 không hợp lệ.');
  }
  return result;
};

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
  async recordReceiptV3(input: RecordPurchaseOrderReceiptV3Input): Promise<RecordPurchaseOrderReceiptV3Result> {
    const { data, error } = await supabase.rpc('record_purchase_order_receipt_v3', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_idempotency_key: input.idempotencyKey,
      p_actor_user_id: input.actorUserId,
      p_quality_result: input.qualityResult,
      p_is_final: input.isFinal,
      p_variance_reason: input.varianceReason || null,
      p_attachments: input.attachments,
      p_lines: input.lines,
    });
    if (error) throw error;
    return assertRecordReceiptV3Result(data, input.deliveryBatchId);
  },

  async listReceipts(deliveryBatchId: string): Promise<PurchaseOrderReceipt[]> {
    const { data: receipts, error: receiptError } = await supabase
      .from('purchase_order_receipts')
      .select('*')
      .eq('delivery_batch_id', deliveryBatchId)
      .order('receipt_no', { ascending: true });
    if (receiptError) throw receiptError;
    if (!receipts?.length) return [];
    const { data: lines, error: lineError } = await supabase
      .from('purchase_order_receipt_lines')
      .select('*')
      .in('receipt_id', receipts.map(row => row.id));
    if (lineError) throw lineError;
    const linesByReceipt = new Map<string, any[]>();
    (lines || []).forEach(line => linesByReceipt.set(line.receipt_id, [...(linesByReceipt.get(line.receipt_id) || []), line]));
    return receipts.map(receipt => ({
      ...(fromDb(receipt) as PurchaseOrderReceipt),
      lines: (linesByReceipt.get(receipt.id) || []).map(fromDb),
    }));
  },

  async confirmVariance(input: { receiptId: string; note: string; actorUserId: string }) {
    const { data, error } = await supabase.rpc('confirm_purchase_order_receipt_variance_v1', {
      p_receipt_id: input.receiptId,
      p_note: input.note,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return data as { receiptId: string; financeStatus: 'posted' };
  },

  async approveQuality(input: ApproveReceiptQualityInput): Promise<ReceiptCommandResult> {
    const { data, error } = await supabase.rpc('approve_receipt_quality_v2', {
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

  async finalize(input: {
    deliveryBatchId: string;
    wmsTransactionId: string;
    actorUserId: string;
  }): Promise<ReceiptCommandResult> {
    const { data, error } = await supabase.rpc('finalize_purchase_receipt_v2', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_wms_transaction_id: input.wmsTransactionId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return assertReceiptCommandResult(data, input);
  },
};
