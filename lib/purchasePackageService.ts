import type { PurchaseMode, PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderDeliveryLine, Transaction } from '../types';
import { fromDb } from './dbMapping';
import { supabase } from './supabase';
import { fetchAllPages, takeCursorPage } from './supabasePagination';
import { wmsTransactionListService } from './wmsTransactionListService';

const PURCHASE_PACKAGE_PO_SELECT = 'id,construction_site_id,vendor_id,vendor_name,po_number,items,total_amount,order_date,expected_delivery_date,actual_delivery_date,status,material_request_id,delivery_note,note,created_at,project_id,qr_token,target_warehouse_id,received_transaction_ids,source_mode,submitted_to_user_id,submitted_to_name,submitted_to_permission,submission_note,ever_submitted,last_action_by,last_action_at,procurement_group_id,procurement_group_no,archived_at,archived_by,archive_reason,created_by_id,vat_rate,approval_request_title,direct_purchase_id,payment_term,invoice_number,invoice_date,payment_status,metadata,approved_total_amount,supplemental_approval_status,purchase_mode,fulfillment_mode,reference_gross_amount,closed_need_qty';
const PURCHASE_DELIVERY_BATCH_SELECT = 'id,purchase_order_id,project_id,construction_site_id,delivery_no,planned_delivery_date,status,fulfillment_batch_ids,note,created_by,created_at,updated_at,supplemental_approval_id,supplier_id,supplier_name_snapshot,fulfillment_mode,vat_rate,qr_token,idempotency_key,quality_result,variance_reason,quality_approved_by,quality_approved_at,received_by,received_at,accepted_gross_amount,wms_transaction_id';
const PURCHASE_DELIVERY_LINE_SELECT = 'id,delivery_batch_id,purchase_order_id,purchase_order_line_id,item_id,planned_qty,unit,stock_planned_qty,stock_unit,created_at,updated_at,delivery_unit_price,accepted_qty,accepted_stock_qty,returned_qty';

export interface MaterialPoBatchDraftLineInput {
  purchaseOrderLineId: string;
  itemId: string;
  purchaseQty: number;
  purchaseUnit: string;
  stockQty: number;
  stockUnit: string;
  purchaseUnitPrice: number;
  stockUnitPrice: number;
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

export interface SaveMaterialPoBatchDraftInput {
  purchaseOrderId: string;
  deliveryBatchId?: string | null;
  plannedDeliveryDate?: string | null;
  vatRate: number;
  varianceReason?: string | null;
  note?: string | null;
  actorUserId: string;
  lines: MaterialPoBatchDraftLineInput[];
}

export interface PurchaseDeliveryQrLookup {
  purchaseOrder: PurchaseOrder;
  deliveryBatch: PurchaseOrderDeliveryBatch;
}

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

const getDeliveryLookupBy = async (
  field: 'qr_token' | 'wms_transaction_id',
  value: string,
): Promise<PurchaseDeliveryQrLookup | null> => {
  if (!value) return null;
  const { data: batchRow, error: batchError } = await supabase
    .from('purchase_order_delivery_batches')
    .select(PURCHASE_DELIVERY_BATCH_SELECT)
    .eq(field, value)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batchRow) return null;

  const lineRows = await fetchAllPages<any, string>({
    pageSize: 1000,
    maxRows: 20_000,
    loadPage: async cursor => {
      let query = supabase
        .from('purchase_order_delivery_lines')
        .select(PURCHASE_DELIVERY_LINE_SELECT)
        .eq('delivery_batch_id', batchRow.id)
        .order('id', { ascending: true })
        .limit(1001);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw error;
      return takeCursorPage(data || [], 1000, row => row.id);
    },
  });

  const { data: poRow, error: poError } = await supabase
    .from('purchase_orders')
    .select(PURCHASE_PACKAGE_PO_SELECT)
    .eq('id', batchRow.purchase_order_id)
    .single();
  if (poError) throw poError;

  const lines = lineRows.map(row => ({
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
};

export const purchasePackageService = {
  async getDeliveryByQrToken(token: string): Promise<PurchaseDeliveryQrLookup | null> {
    return getDeliveryLookupBy('qr_token', token);
  },

  async getDeliveryByWmsTransactionId(transactionId: string): Promise<PurchaseDeliveryQrLookup | null> {
    return getDeliveryLookupBy('wms_transaction_id', transactionId);
  },

  async getWmsTransactionById(transactionId: string): Promise<Transaction | null> {
    return wmsTransactionListService.getById(transactionId);
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

  async setBatchVarianceReason(input: {
    deliveryBatchId: string;
    varianceReason?: string | null;
    actorUserId: string;
  }): Promise<{ deliveryBatchId: string; varianceReason: string | null }> {
    const { data, error } = await supabase.rpc('set_material_po_batch_variance_reason', {
      p_delivery_batch_id: input.deliveryBatchId,
      p_variance_reason: input.varianceReason ?? null,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
    return data as { deliveryBatchId: string; varianceReason: string | null };
  },

  async saveBatchDraft(input: SaveMaterialPoBatchDraftInput): Promise<MaterialPoBatchDecisionResult> {
    const { data, error } = await supabase.rpc('save_material_po_batch_draft', {
      p_purchase_order_id: input.purchaseOrderId,
      p_delivery_batch_id: input.deliveryBatchId ?? null,
      p_planned_delivery_date: input.plannedDeliveryDate ?? null,
      p_vat_rate: input.vatRate,
      p_variance_reason: input.varianceReason ?? null,
      p_note: input.note ?? null,
      p_actor_user_id: input.actorUserId,
      p_lines: input.lines,
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
