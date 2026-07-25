import { TransactionStatus, type WmsTransactionAttachment } from '../types';
import type { PurchaseDeliveryUiStatus } from './purchasePackageDomain';
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
