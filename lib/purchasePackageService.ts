import type { MaterialRequestFulfillmentMode } from '../types';
import { supabase } from './supabase';

export interface CreatePurchaseDeliveryInput {
  purchaseOrderId: string;
  idempotencyKey: string;
  supplierId: string;
  supplierNameSnapshot: string;
  fulfillmentMode: MaterialRequestFulfillmentMode;
  vatRate: number;
  targetWarehouseId: string;
  plannedDeliveryDate?: string | null;
  note?: string | null;
  actorUserId: string;
  lines: Array<{
    purchaseOrderLineId: string;
    itemId: string;
    purchaseQty: number;
    purchaseUnit: string;
    stockQty: number;
    stockUnit: string;
    purchaseUnitPrice: number;
    stockUnitPrice: number;
  }>;
}

export interface PurchaseDeliveryCommandResult {
  deliveryBatchId: string;
  deliveryNo: number;
  deliveryCode: string;
  wmsTransactionId: string;
  qrToken: string;
}

type UpdatePurchaseDeliveryInput = CreatePurchaseDeliveryInput & {
  deliveryBatchId: string;
  wmsTransactionId: string;
};

export const assertCommandResult = (data: unknown): PurchaseDeliveryCommandResult => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Command tạo Đợt không trả về kết quả.');

  const value = row as Record<string, unknown>;
  const result = {
    deliveryBatchId: String(value.deliveryBatchId || ''),
    deliveryNo: Number(value.deliveryNo || 0),
    deliveryCode: String(value.deliveryCode || ''),
    wmsTransactionId: String(value.wmsTransactionId || ''),
    qrToken: String(value.qrToken || ''),
  };

  if (!result.deliveryBatchId || !result.wmsTransactionId || !result.qrToken) {
    throw new Error('Đợt giao, WMS hoặc QR chưa được tạo đầy đủ.');
  }

  return result;
};

const deliveryPayload = (input: CreatePurchaseDeliveryInput) => ({
  p_purchase_order_id: input.purchaseOrderId,
  p_idempotency_key: input.idempotencyKey,
  p_supplier_id: input.supplierId,
  p_supplier_name: input.supplierNameSnapshot,
  p_fulfillment_mode: input.fulfillmentMode,
  p_vat_rate: input.vatRate,
  p_target_warehouse_id: input.targetWarehouseId,
  p_planned_delivery_date: input.plannedDeliveryDate ?? null,
  p_note: input.note ?? null,
  p_actor_user_id: input.actorUserId,
  p_lines: input.lines,
});

const runDeliveryCommand = async (
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<PurchaseDeliveryCommandResult> => {
  const { data, error } = await supabase.rpc(rpcName, payload);
  if (error) throw error;
  return assertCommandResult(data);
};

export const purchasePackageService = {
  createDelivery(input: CreatePurchaseDeliveryInput) {
    return runDeliveryCommand('create_delivery_batch_with_wms_qr_v2', deliveryPayload(input));
  },

  updateUnreceivedDelivery(input: UpdatePurchaseDeliveryInput) {
    return runDeliveryCommand('update_unreceived_delivery_batch_v2', {
      ...deliveryPayload(input),
      p_delivery_batch_id: input.deliveryBatchId,
      p_wms_transaction_id: input.wmsTransactionId,
    });
  },

  async cancelUnreceivedDelivery(input: {
    deliveryBatchId: string;
    actorUserId: string;
    reason: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('cancel_unreceived_delivery_batch_v2', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason,
    });
    if (error) throw error;
  },
};
