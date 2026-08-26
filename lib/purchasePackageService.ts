import type { MaterialRequestFulfillmentMode, PurchaseMode, PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderDeliveryLine, Transaction } from '../types';
import { fromDb } from './dbMapping';
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

export interface ApprovePurchasePackageResult {
  purchaseOrderId: string;
  status: 'confirmed';
  purchaseMode: PurchaseMode;
  delivery?: PurchaseDeliveryCommandResult;
}

export interface MaterialPoBatchDecisionResult {
  deliveryBatchId: string;
  approvalStatus: 'pending_approval' | 'approved' | 'revision_requested' | 'rejected';
}

export interface PurchaseDeliveryQrLookup {
  purchaseOrder: PurchaseOrder;
  deliveryBatch: PurchaseOrderDeliveryBatch;
}

type UpdatePurchaseDeliveryInput = CreatePurchaseDeliveryInput & {
  deliveryBatchId: string;
  wmsTransactionId: string;
};

const readField = (value: Record<string, unknown>, camelKey: string, snakeKey: string) =>
  value[camelKey] ?? value[snakeKey];

export const assertCommandResult = (data: unknown): PurchaseDeliveryCommandResult => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Command tạo Đợt không trả về kết quả.');

  const value = row as Record<string, unknown>;
  const result = {
    deliveryBatchId: String(readField(value, 'deliveryBatchId', 'delivery_batch_id') || ''),
    deliveryNo: Number(readField(value, 'deliveryNo', 'delivery_no') || 0),
    deliveryCode: String(readField(value, 'deliveryCode', 'delivery_code') || ''),
    wmsTransactionId: String(readField(value, 'wmsTransactionId', 'wms_transaction_id') || ''),
    qrToken: String(readField(value, 'qrToken', 'qr_token') || ''),
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

const assertApproveResult = (data: unknown): ApprovePurchasePackageResult => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('Command duyệt Gói không trả về kết quả.');

  const value = row as Record<string, unknown>;
  const purchaseOrderId = String(value.purchaseOrderId || '');
  const status = String(value.status || '');
  const purchaseMode = String(value.purchaseMode || '') as PurchaseMode;
  const delivery = value.delivery == null ? undefined : assertCommandResult(value.delivery);

  if (!purchaseOrderId || status !== 'confirmed' || !['single', 'multiple'].includes(purchaseMode)) {
    throw new Error('Kết quả duyệt Gói mua hàng không hợp lệ.');
  }
  if (purchaseMode === 'single' && !delivery) {
    throw new Error('Gói mua một lần chưa trả về Đợt giao đầu tiên.');
  }

  return {
    purchaseOrderId,
    status: 'confirmed',
    purchaseMode,
    delivery,
  };
};

export const purchasePackageService = {
  async getDeliveryByQrToken(token: string): Promise<PurchaseDeliveryQrLookup | null> {
    const { data: batchRow, error: batchError } = await supabase
      .from('purchase_order_delivery_batches')
      .select('*')
      .eq('qr_token', token)
      .maybeSingle();
    if (batchError) throw batchError;
    if (!batchRow) return null;

    const { data: lineRows, error: lineError } = await supabase
      .from('purchase_order_delivery_lines')
      .select('*')
      .eq('delivery_batch_id', batchRow.id);
    if (lineError) throw lineError;

    const { data: poRow, error: poError } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('id', batchRow.purchase_order_id)
      .single();
    if (poError) throw poError;

    const lines = (lineRows || []).map(row => ({
      ...(fromDb(row) as PurchaseOrderDeliveryLine),
      plannedQty: Number(row.planned_qty || 0),
      deliveredQty: Number(row.delivered_qty ?? row.accepted_qty ?? 0),
      acceptedQty: Number(row.accepted_qty || 0),
      deliveredStockQty: Number(row.delivered_stock_qty ?? row.accepted_stock_qty ?? 0),
      acceptedStockQty: Number(row.accepted_stock_qty || 0),
      returnedQty: Number(row.returned_qty || 0),
      deliveryUnitPrice: Number(row.delivery_unit_price || 0),
      stockPlannedQty: Number(row.stock_planned_qty || 0),
    }));

    return {
      purchaseOrder: fromDb(poRow) as PurchaseOrder,
      deliveryBatch: {
        ...(fromDb(batchRow) as PurchaseOrderDeliveryBatch),
        fulfillmentBatchIds: batchRow.fulfillment_batch_ids || [],
        wmsTransactionId: batchRow.wms_transaction_id || null,
        supplementalApprovalId: batchRow.supplemental_approval_id || null,
        supplierId: batchRow.supplier_id || null,
        supplierNameSnapshot: batchRow.supplier_name_snapshot || null,
        deliveryNo: Number(batchRow.delivery_no || 1),
        status: batchRow.status || 'planned',
        vatRate: Number(batchRow.vat_rate || 0),
        qrToken: batchRow.qr_token || null,
        idempotencyKey: batchRow.idempotency_key || null,
        qualityResult: batchRow.quality_result || null,
        varianceReason: batchRow.variance_reason || null,
        acceptedGrossAmount: Number(batchRow.accepted_gross_amount || 0),
        lines,
      },
    };
  },

  async getWmsTransactionById(transactionId: string): Promise<Transaction | null> {
    if (!transactionId) return null;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .maybeSingle();
    if (error) throw error;
    return data ? (fromDb(data) as Transaction) : null;
  },

  async approvePackage(input: {
    purchaseOrderId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<ApprovePurchasePackageResult> {
    return this.approveSingle(input);
  },

  async submitBatch(input: {
    deliveryBatchId: string;
    approverUserId: string;
    actorUserId: string;
  }): Promise<MaterialPoBatchDecisionResult> {
    const { data, error } = await supabase.rpc('submit_material_po_batch', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_approver_user_id: input.approverUserId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return data as MaterialPoBatchDecisionResult;
  },

  async decideBatch(input: {
    deliveryBatchId: string;
    decision: 'revision_requested' | 'rejected';
    note?: string | null;
    actorUserId: string;
  }): Promise<MaterialPoBatchDecisionResult> {
    const { data, error } = await supabase.rpc('decide_material_po_batch', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_decision: input.decision,
      p_note: input.note ?? null,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return data as MaterialPoBatchDecisionResult;
  },

  async approveBatch(input: {
    deliveryBatchId: string;
    actorUserId: string;
  }): Promise<PurchaseDeliveryCommandResult> {
    return runDeliveryCommand('approve_material_po_batch', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_actor_user_id: input.actorUserId,
    });
  },

  async approveSingle(input: {
    purchaseOrderId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<ApprovePurchasePackageResult> {
    const { data, error } = await supabase.rpc('approve_single_material_po', {
      p_purchase_order_id: input.purchaseOrderId,
      p_actor_user_id: input.actorUserId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return assertApproveResult(data);
  },

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

  async closePackageShort(input: {
    purchaseOrderId: string;
    actorUserId: string;
    reason: string;
    lines: Array<{ purchaseOrderLineId: string; closeQty: number }>;
  }): Promise<void> {
    const { error } = await supabase.rpc('close_purchase_package_short_v2', {
      p_purchase_order_id: input.purchaseOrderId,
      p_actor_user_id: input.actorUserId,
      p_reason: input.reason,
      p_lines: input.lines,
    });
    if (error) throw error;
  },
};
