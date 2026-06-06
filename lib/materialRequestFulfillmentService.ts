import { supabase } from './supabase';
import {
  MaterialRequest,
  MaterialRequestFulfillmentBatch,
  MaterialRequestFulfillmentMode,
  MaterialRequestLineFulfillmentSummary,
  MaterialRequestFulfillmentSourceType,
  MaterialRequestFulfillmentSummary,
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderRequestLineLink,
  RequestItem,
  RequestStatus,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types';
import { createFulfillmentBatchQrToken } from './fulfillmentBatchQr';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  getPoLineStockUnitPrice,
  hasPurchaseUnitConversion,
  poLinePurchaseToStockQty,
  poLineStockToPurchaseQty,
} from './materialUnitConversion';

const BATCH_TABLE = 'material_request_fulfillment_batches';
const LINE_TABLE = 'material_request_fulfillment_lines';

const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

const mapKeys = (obj: any, fn: (k: string) => string): any => {
  if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
  }
  return obj;
};

const toDb = (obj: any) => mapKeys(obj, toSnake);
const fromDb = (obj: any) => mapKeys(obj, toCamel);

const isMissingFulfillmentTable = (error: any): boolean =>
  error?.code === '42P01' || String(error?.message || '').includes(BATCH_TABLE) || String(error?.message || '').includes(LINE_TABLE);

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const formatPoNumber = (poNumber?: string | null): string => {
  const trimmed = String(poNumber || '').trim();
  if (!trimmed) return 'PO';
  return /^PO[\s-]/i.test(trimmed) ? trimmed : `PO ${trimmed}`;
};

const mapInventoryItem = (row: any): InventoryItem => ({
  ...fromDb(row),
  purchaseConversionFactor: Number(row.purchase_conversion_factor ?? row.purchaseConversionFactor ?? 1),
  stockByWarehouse: row.stock_by_warehouse || row.stockByWarehouse || {},
}) as InventoryItem;

const loadInventoryByIds = async (ids: string[]): Promise<Map<string, InventoryItem>> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('items')
    .select('id, sku, name, category, unit, purchase_unit, purchase_conversion_factor, price_in, price_out, min_stock, supplier_id, image_url, location, stock_by_warehouse')
    .in('id', uniqueIds);
  if (error) throw error;
  return new Map((data || []).map(row => {
    const item = mapInventoryItem(row);
    return [item.id, item] as const;
  }));
};

const loadInventoryForPo = (po: PurchaseOrder): Promise<Map<string, InventoryItem>> =>
  loadInventoryByIds((po.items || []).map(item => item.itemId));

const shouldStorePoAccountingUnit = (line: PurchaseOrderItem, inventory?: InventoryItem | null) =>
  hasPurchaseUnitConversion({
    unit: getPoLineStockUnit(line, inventory),
    purchaseUnit: getPoLinePurchaseUnit(line, inventory),
    purchaseConversionFactor: line.purchaseConversionFactor ?? inventory?.purchaseConversionFactor ?? 1,
  });

const buildPoReceiptTransactionItem = (
  poItem: PurchaseOrderItem | undefined,
  stockQty: number,
  inventory: InventoryItem | undefined,
  extra: Record<string, any> = {},
) => {
  const purchaseQty = poItem ? poLineStockToPurchaseQty(poItem, stockQty, inventory) : stockQty;
  const purchaseUnit = poItem ? getPoLinePurchaseUnit(poItem, inventory) : inventory?.unit || '';
  const stockUnitPrice = poItem ? getPoLineStockUnitPrice(poItem, inventory) : Number(inventory?.priceIn || 0);
  const useAccountingUnit = poItem ? shouldStorePoAccountingUnit(poItem, inventory) : false;
  return {
    itemId: poItem?.itemId || inventory?.id || extra.itemId,
    quantity: stockQty,
    price: stockUnitPrice,
    ...(useAccountingUnit ? {
      accountingQty: purchaseQty,
      accountingUnit: purchaseUnit,
      accountingPrice: Number(poItem?.unitPrice || 0),
    } : {}),
    ...extra,
  };
};

export const getRequestLineId = (request: MaterialRequest, line: RequestItem, index = 0): string =>
  line.lineId || `${request.id}-${index}`;

export const getCommittedQty = (line: RequestItem): number => {
  return Number(line.requestQty || 0);
};

const lineName = (line: RequestItem): string =>
  line.itemNameSnapshot || line.materialBudgetItemName || line.itemId;

const normalizeBatch = (batch: any, lines: any[]): MaterialRequestFulfillmentBatch => ({
  ...fromDb(batch),
  fulfillmentMode: (batch.fulfillment_mode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK) as MaterialRequestFulfillmentMode,
  sourceType: (batch.source_type || 'stock') as MaterialRequestFulfillmentSourceType,
  lines: lines.map(fromDb),
});

const syncPurchaseOrderReceiptFromBatch = async (
  batch: MaterialRequestFulfillmentBatch,
  receivedByLineId: Map<string, { receivedQty: number; varianceReason?: string }>,
) => {
  const poLines = (batch.lines || []).filter(line => line.poId && line.poLineId);
  if (poLines.length === 0) return;

  const receiptStockByPo = new Map<string, Map<string, number>>();
  poLines.forEach(line => {
    const received = Number(receivedByLineId.get(line.id)?.receivedQty ?? line.receivedQty ?? 0);
    if (received <= 0 || !line.poId || !line.poLineId) return;
    const poReceipt = receiptStockByPo.get(line.poId) || new Map<string, number>();
    poReceipt.set(line.poLineId, (poReceipt.get(line.poLineId) || 0) + received);
    receiptStockByPo.set(line.poId, poReceipt);
  });

  for (const [poId, stockReceiptByLineId] of receiptStockByPo.entries()) {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();
    if (error) throw error;

    const po = fromDb(data) as PurchaseOrder;
    const inventoryById = await loadInventoryForPo(po);
    let hasReceipt = false;
    const nextItems = (po.items || []).map(item => {
      const key = item.lineId || item.itemId;
      const stockReceivedNow = stockReceiptByLineId.get(key) || 0;
      const inventory = inventoryById.get(item.itemId);
      const receivedNow = poLineStockToPurchaseQty(item, stockReceivedNow, inventory);
      if (receivedNow <= 0) return item;
      const orderedQty = Number(item.qty || 0);
      const currentReceivedQty = Number(item.receivedQty || 0);
      const remainingQty = Math.max(orderedQty - currentReceivedQty, 0);
      const acceptedQty = Math.min(receivedNow, remainingQty);
      if (acceptedQty <= 0) return item;
      hasReceipt = true;
      return { ...item, receivedQty: currentReceivedQty + acceptedQty };
    });

    if (!hasReceipt) continue;
    const isDelivered = nextItems.every(item => Number(item.receivedQty || 0) >= Number(item.qty || 0));
    const receivedTransactionIds = Array.from(new Set([
      ...(po.receivedTransactionIds || []),
      ...(batch.transactionId ? [batch.transactionId] : []),
    ]));

    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        items: nextItems,
        status: isDelivered ? 'delivered' : 'partial',
        actual_delivery_date: isDelivered ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate || null,
        received_transaction_ids: receivedTransactionIds,
      })
      .eq('id', poId);
    if (updateError) throw updateError;
  }
};

export interface IssueFulfillmentLineInput {
  requestLineId: string;
  itemId: string;
  issuedQty: number;
  varianceReason?: string;
  poId?: string | null;
  poLineId?: string | null;
}

export interface IssueFulfillmentBatchInput {
  request: MaterialRequest;
  sourceWarehouseId: string;
  sourceType: MaterialRequestFulfillmentSourceType;
  actorUserId: string;
  note?: string;
  overrideReason?: string;
  allowOverCommit?: boolean;
  lines: IssueFulfillmentLineInput[];
}

export interface ReceiveFulfillmentLineInput {
  lineId: string;
  receivedQty: number;
  varianceReason?: string;
}

export interface ReceiveFulfillmentBatchInput {
  request: MaterialRequest;
  batch: MaterialRequestFulfillmentBatch;
  actorUserId: string;
  overrideReason?: string;
  allowOverCommit?: boolean;
  lines: ReceiveFulfillmentLineInput[];
}

export interface ResolveFulfillmentVarianceInput {
  batch: MaterialRequestFulfillmentBatch;
  actorUserId: string;
}

export interface ReturnFulfillmentBatchInput {
  batch: MaterialRequestFulfillmentBatch;
  actorUserId: string;
  reason?: string;
}

export interface ReturnReceivedFulfillmentBatchInput {
  batch: MaterialRequestFulfillmentBatch;
  actorUserId: string;
  reason?: string;
  returnTransactionId?: string;
}

export interface RecordPoReceiptLineInput {
  itemId: string;
  quantity: number;
  lineId?: string | null;
}

export interface RecordPoReceiptInput {
  po: PurchaseOrder;
  transactionId: string;
  actorUserId: string;
  receiptLines: RecordPoReceiptLineInput[];
}

export interface EnsurePoDeliveryBatchesInput {
  po: PurchaseOrder;
  actorUserId: string;
}

export interface PreparePoReceiptForQualityReviewInput {
  po: PurchaseOrder;
  receiptLines: RecordPoReceiptLineInput[];
}

export interface PreparePoReceiptForQualityReviewResult {
  transactionIds: string[];
  materialRequestIds: string[];
}

export interface UpdateTransactionReceiptQuantityLineInput {
  index: number;
  quantity: number;
  reason?: string;
}

export interface UpdateTransactionReceiptQuantitiesInput {
  transaction: Transaction;
  stage: 'approval' | 'receipt';
  lines: UpdateTransactionReceiptQuantityLineInput[];
}

export interface SyncFulfillmentReceiptForTransactionInput {
  transactionId: string;
  actorUserId: string;
}

const emptySummary = (request: MaterialRequest): MaterialRequestFulfillmentSummary => {
  const lineSummaries = (request.items || []).map((line, index) => {
    const requestedQty = Number(line.requestQty || 0);
    const committedQty = getCommittedQty(line);
    const orderedQty = Number(line.orderedQty || 0);
    return {
      materialRequestId: request.id,
      requestLineId: getRequestLineId(request, line, index),
      itemId: line.itemId,
      requestedQty,
      committedQty,
      orderedQty,
      issuedQty: 0,
      receivedQty: 0,
      remainingToIssue: committedQty,
      remainingToReceive: committedQty,
    };
  });
  const totals = lineSummaries.reduce((sum, line) => ({
    requestedQty: sum.requestedQty + line.requestedQty,
    committedQty: sum.committedQty + line.committedQty,
    orderedQty: sum.orderedQty + line.orderedQty,
    issuedQty: sum.issuedQty + line.issuedQty,
    receivedQty: sum.receivedQty + line.receivedQty,
    remainingToIssue: sum.remainingToIssue + line.remainingToIssue,
    remainingToReceive: sum.remainingToReceive + line.remainingToReceive,
  }), {
    requestedQty: 0,
    committedQty: 0,
    orderedQty: 0,
    issuedQty: 0,
    receivedQty: 0,
    remainingToIssue: 0,
    remainingToReceive: 0,
  });

  return { materialRequestId: request.id, ...totals, lineSummaries };
};

export const materialRequestFulfillmentService = {
  async listPurchaseOrderSourceLabels(poIds: string[]): Promise<Record<string, string>> {
    const uniqueIds = Array.from(new Set(poIds.filter(Boolean)));
    if (uniqueIds.length === 0) return {};

    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id,po_number,vendor_name')
      .in('id', uniqueIds);
    if (error) throw error;

    return (data || []).reduce<Record<string, string>>((map, row: any) => {
      const poNo = formatPoNumber(row.po_number);
      map[row.id] = row.vendor_name ? `${row.vendor_name} (${poNo})` : poNo;
      return map;
    }, {});
  },

  async listByRequest(materialRequestId: string): Promise<MaterialRequestFulfillmentBatch[]> {
    const { data: batchRows, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .eq('material_request_id', materialRequestId)
      .order('batch_date', { ascending: false });
    if (batchError) {
      if (isMissingFulfillmentTable(batchError)) return [];
      throw batchError;
    }
    const batches = batchRows || [];
    if (batches.length === 0) return [];

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .in('batch_id', batches.map(batch => batch.id))
      .order('created_at', { ascending: true });
    if (lineError) {
      if (isMissingFulfillmentTable(lineError)) return [];
      throw lineError;
    }

    const linesByBatch = new Map<string, any[]>();
    (lineRows || []).forEach(line => {
      const key = line.batch_id;
      linesByBatch.set(key, [...(linesByBatch.get(key) || []), line]);
    });

    return batches.map(batch => normalizeBatch(batch, linesByBatch.get(batch.id) || []));
  },

  async getByQrToken(token: string): Promise<MaterialRequestFulfillmentBatch | null> {
    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .eq('qr_token', token)
      .maybeSingle();
    if (batchError) {
      if (isMissingFulfillmentTable(batchError)) return null;
      throw batchError;
    }
    if (!batchRow) return null;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', batchRow.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return normalizeBatch(batchRow, lineRows || []);
  },

  async getByTransactionId(transactionId: string): Promise<MaterialRequestFulfillmentBatch | null> {
    if (!transactionId) return null;

    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .eq('transaction_id', transactionId)
      .maybeSingle();
    if (batchError) {
      if (isMissingFulfillmentTable(batchError)) return null;
      throw batchError;
    }
    if (!batchRow) return null;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', batchRow.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return normalizeBatch(batchRow, lineRows || []);
  },

  async ensureQrToken(batch: MaterialRequestFulfillmentBatch): Promise<MaterialRequestFulfillmentBatch> {
    if (batch.qrToken) return batch;
    const qrToken = createFulfillmentBatchQrToken();
    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({ qr_token: qrToken })
      .eq('id', batch.id)
      .select('*')
      .single();
    if (batchError) throw batchError;
    return normalizeBatch(batchRow, batch.lines || []);
  },

  async listByRequests(materialRequestIds: string[]): Promise<Record<string, MaterialRequestFulfillmentBatch[]>> {
    const ids = Array.from(new Set(materialRequestIds.filter(Boolean)));
    if (ids.length === 0) return {};

    const { data: batchRows, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .in('material_request_id', ids)
      .order('batch_date', { ascending: false });
    if (batchError) {
      if (isMissingFulfillmentTable(batchError)) return {};
      throw batchError;
    }
    const batches = batchRows || [];
    if (batches.length === 0) return {};

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .in('batch_id', batches.map(batch => batch.id))
      .order('created_at', { ascending: true });
    if (lineError) {
      if (isMissingFulfillmentTable(lineError)) return {};
      throw lineError;
    }

    const linesByBatch = new Map<string, any[]>();
    (lineRows || []).forEach(line => {
      const key = line.batch_id;
      linesByBatch.set(key, [...(linesByBatch.get(key) || []), line]);
    });

    return batches.reduce<Record<string, MaterialRequestFulfillmentBatch[]>>((map, batch) => {
      const requestId = batch.material_request_id;
      map[requestId] = [...(map[requestId] || []), normalizeBatch(batch, linesByBatch.get(batch.id) || [])];
      return map;
    }, {});
  },

  summarizeRequest(request: MaterialRequest, batches: MaterialRequestFulfillmentBatch[] = []): MaterialRequestFulfillmentSummary {
    const summary = emptySummary(request);
    const lineMap = new Map(summary.lineSummaries.map(line => [line.requestLineId, line]));

    batches
      .filter(batch => !['cancelled', 'draft', 'returned'].includes(batch.status))
      .forEach(batch => {
        batch.lines.forEach(line => {
          const target = lineMap.get(line.requestLineId);
          if (!target) return;
          target.issuedQty += Number(line.issuedQty || 0);
          if (batch.status === 'received') {
            target.receivedQty += Number(line.receivedQty || 0);
            (target as any).allocatedQty = Number((target as any).allocatedQty || 0) + Number(line.receivedQty || 0);
          } else if (batch.status === 'variance_pending') {
            (target as any).allocatedQty = Number((target as any).allocatedQty || 0) + Number(line.receivedQty || 0);
          } else if (batch.status === 'issued') {
            (target as any).allocatedQty = Number((target as any).allocatedQty || 0) + Number(line.issuedQty || 0);
          }
        });
      });

    summary.lineSummaries.forEach(line => {
      const allocatedQty = Number((line as any).allocatedQty || 0);
      line.remainingToIssue = Math.max(0, line.committedQty - allocatedQty);
      line.remainingToReceive = Math.max(0, line.committedQty - line.receivedQty);
      delete (line as any).allocatedQty;
    });

    const totals = summary.lineSummaries.reduce((sum, line) => ({
      requestedQty: sum.requestedQty + line.requestedQty,
      committedQty: sum.committedQty + line.committedQty,
      orderedQty: sum.orderedQty + line.orderedQty,
      issuedQty: sum.issuedQty + line.issuedQty,
      receivedQty: sum.receivedQty + line.receivedQty,
      remainingToIssue: sum.remainingToIssue + line.remainingToIssue,
      remainingToReceive: sum.remainingToReceive + line.remainingToReceive,
    }), {
      requestedQty: 0,
      committedQty: 0,
      orderedQty: 0,
      issuedQty: 0,
      receivedQty: 0,
      remainingToIssue: 0,
      remainingToReceive: 0,
    });

    return { ...summary, ...totals };
  },

  nextRequestStatus(request: MaterialRequest, batches: MaterialRequestFulfillmentBatch[]): RequestStatus {
    if (request.status === RequestStatus.REJECTED || request.status === RequestStatus.PENDING || request.status === RequestStatus.DRAFT) {
      return request.status;
    }
    const summary = this.summarizeRequest(request, batches);
    if (summary.committedQty > 0 && summary.receivedQty >= summary.committedQty) return RequestStatus.COMPLETED;
    if (summary.issuedQty > 0 || summary.receivedQty > 0) return RequestStatus.IN_TRANSIT;
    return RequestStatus.APPROVED;
  },

  async createIssuedBatch(input: IssueFulfillmentBatchInput): Promise<MaterialRequestFulfillmentBatch> {
    const validLines = input.lines
      .map(line => ({ ...line, issuedQty: Number(line.issuedQty || 0) }))
      .filter(line => line.issuedQty > 0);
    if (validLines.length === 0) throw new Error('Chưa có dòng vật tư nào có số lượng cấp.');
    if (!input.sourceWarehouseId) throw new Error('Chưa chọn kho nguồn để cấp vật tư.');

    const existingBatches = await this.listByRequest(input.request.id);
    const currentSummary = this.summarizeRequest(input.request, existingBatches);
    const currentByLine = new Map<string, MaterialRequestLineFulfillmentSummary>(currentSummary.lineSummaries.map(line => [line.requestLineId, line]));
    const requestLineMap = new Map<string, RequestItem>((input.request.items || []).map((line, index) => [getRequestLineId(input.request, line, index), line]));

    validLines.forEach(line => {
      const requestLine = requestLineMap.get(line.requestLineId);
      if (!requestLine) throw new Error('Không tìm thấy dòng yêu cầu cần cấp.');
      const current = currentByLine.get(line.requestLineId);
      const requestQty = Number(current?.requestedQty || requestLine.requestQty || 0);
      const remainingToIssue = Number(current?.remainingToIssue ?? requestQty);
      if (line.issuedQty > remainingToIssue) {
        throw new Error(`Số lượng cấp lũy kế của "${lineName(requestLine)}" vượt số lượng công trường đề xuất. Vui lòng tạo đề xuất bổ sung nếu cần cấp thêm.`);
      }
      if (line.issuedQty !== remainingToIssue && !line.varianceReason?.trim()) {
        throw new Error(`Dòng "${lineName(requestLine)}" cấp lệch phần còn lại phải nhập lý do.`);
      }
    });

    const batchId = newId();
    const transactionId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const isDirectConsumption = input.request.fulfillmentMode === MaterialRequestFulfillmentMode.DIRECT_CONSUMPTION;
    const targetWarehouseId = isDirectConsumption ? null : input.request.siteWarehouseId;
    const batchNumber = `${input.request.code}-DOT-${existingBatches.length + 1}`;
    const now = new Date().toISOString();

    const transactionPayload = {
      id: transactionId,
      type: isDirectConsumption ? TransactionType.EXPORT : TransactionType.TRANSFER,
      date: now,
      items: validLines.map(line => ({
        itemId: line.itemId,
        quantity: line.issuedQty,
        materialRequestId: input.request.id,
        requestLineId: line.requestLineId,
        fulfillmentBatchId: batchId,
      })),
      sourceWarehouseId: input.sourceWarehouseId,
      targetWarehouseId,
      requesterId: input.request.requesterId,
      approverId: input.actorUserId,
      status: TransactionStatus.PENDING,
      note: `Đợt cấp vật tư ${batchNumber} từ phiếu ${input.request.code}${input.note ? ` - ${input.note}` : ''}`,
      relatedRequestId: input.request.id,
    };

    const batchPayload = {
      id: batchId,
      projectId: input.request.projectId || null,
      constructionSiteId: input.request.constructionSiteId || null,
      materialRequestId: input.request.id,
      batchNo: batchNumber,
      batchDate: now,
      sourceWarehouseId: input.sourceWarehouseId,
      targetWarehouseId,
      fulfillmentMode: input.request.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
      sourceType: input.sourceType,
      status: 'issued',
      transactionId,
      qrToken: createFulfillmentBatchQrToken(),
      reason: input.overrideReason || null,
      note: input.note || null,
      createdBy: input.actorUserId,
      issuedBy: input.actorUserId,
      issuedAt: now,
    };

    const linePayloads = validLines.map(line => {
      const requestLine = requestLineMap.get(line.requestLineId)!;
      return {
        id: newId(),
        batchId,
        materialRequestId: input.request.id,
        requestLineId: line.requestLineId,
        itemId: line.itemId,
        materialBudgetItemId: requestLine.materialBudgetItemId || null,
        workBoqItemId: requestLine.workBoqItemId || null,
        poId: line.poId || null,
        poLineId: line.poLineId || null,
        requestedQtySnapshot: Number(requestLine.requestQty || 0),
        committedQtySnapshot: getCommittedQty(requestLine),
        issuedQty: line.issuedQty,
        receivedQty: 0,
        unit: requestLine.unitSnapshot || null,
        varianceReason: line.varianceReason || null,
      };
    });

    let transactionCreated = false;
    let batchCreated = false;
    try {
      const { error: txError } = await supabase
        .from('transactions')
        .insert({
          id: transactionPayload.id,
          type: transactionPayload.type,
          date: transactionPayload.date,
          items: transactionPayload.items,
          source_warehouse_id: transactionPayload.sourceWarehouseId,
          target_warehouse_id: transactionPayload.targetWarehouseId,
          requester_id: transactionPayload.requesterId,
          approver_id: transactionPayload.approverId,
          status: transactionPayload.status,
          note: transactionPayload.note,
          related_request_id: transactionPayload.relatedRequestId,
        });
      if (txError) throw txError;
      transactionCreated = true;

      const { data: batchRow, error: batchError } = await supabase
        .from(BATCH_TABLE)
        .insert(toDb(batchPayload))
        .select('*')
        .single();
      if (batchError) throw batchError;
      batchCreated = true;

      const { data: lineRows, error: lineError } = await supabase
        .from(LINE_TABLE)
        .insert(linePayloads.map(toDb))
        .select('*');
      if (lineError) throw lineError;

      return normalizeBatch(batchRow, lineRows || []);
    } catch (error) {
      if (batchCreated) {
        await supabase.from(BATCH_TABLE).delete().eq('id', batchId);
      }
      if (transactionCreated) {
        await supabase.from('transactions').delete().eq('id', transactionId);
      }
      throw error;
    }
  },

  async recordPoReceipt(input: RecordPoReceiptInput): Promise<string[]> {
    if (!input.po.id || !input.transactionId) return [];
    const poSourceSuffix = input.po.vendorName ? ` - ${input.po.vendorName}` : '';
    const poNumber = formatPoNumber(input.po.poNumber);

    const { data: existingRows, error: existingError } = await supabase
      .from(BATCH_TABLE)
      .select('material_request_id')
      .eq('transaction_id', input.transactionId);
    if (existingError) {
      if (isMissingFulfillmentTable(existingError)) return [];
      throw existingError;
    }
    if ((existingRows || []).length > 0) {
      return Array.from(new Set((existingRows || []).map(row => row.material_request_id).filter(Boolean)));
    }

    const { data: linkRows, error: linkError } = await supabase
      .from('purchase_order_request_lines')
      .select('*')
      .eq('purchase_order_id', input.po.id);
    if (linkError) throw linkError;

    const links = (linkRows || []).map(fromDb) as PurchaseOrderRequestLineLink[];
    if (links.length === 0) return [];

    const receiptByPoLine = new Map<string, number>();
    input.receiptLines.forEach(line => {
      const qty = Number(line.quantity || 0);
      if (qty <= 0) return;
      const key = line.lineId || line.itemId;
      receiptByPoLine.set(key, (receiptByPoLine.get(key) || 0) + qty);
    });

    const poItemByLineId = new Map((input.po.items || []).map(item => [item.lineId || item.itemId, item]));
    const inventoryById = await loadInventoryForPo(input.po);
    const linksByRequest = new Map<string, PurchaseOrderRequestLineLink[]>();
    links.forEach(link => {
      const receiptQty = receiptByPoLine.get(link.purchaseOrderLineId) || 0;
      if (receiptQty <= 0) return;
      linksByRequest.set(link.materialRequestId, [...(linksByRequest.get(link.materialRequestId) || []), link]);
    });
    if (linksByRequest.size === 0) return [];

    const now = new Date().toISOString();
    const affectedRequestIds: string[] = [];

    for (const [materialRequestId, requestLinks] of linksByRequest.entries()) {
      const batchId = newId();
      const requestCode = requestLinks[0]?.materialRequestCode || materialRequestId;
      const batchPayload = {
        id: batchId,
        projectId: input.po.projectId || requestLinks[0]?.projectId || null,
        constructionSiteId: input.po.constructionSiteId || requestLinks[0]?.constructionSiteId || null,
        materialRequestId,
        batchNo: `${requestCode}-PO-${input.po.poNumber}-${input.transactionId.slice(-5)}`,
        batchDate: now,
        sourceWarehouseId: null,
        targetWarehouseId: input.po.targetWarehouseId || null,
        fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
        sourceType: 'po_receipt',
        status: 'received',
        transactionId: input.transactionId,
        reason: null,
        note: `Thực nhận từ ${poNumber}${poSourceSuffix}`,
        createdBy: input.actorUserId,
        issuedBy: input.actorUserId,
        issuedAt: now,
        receivedBy: input.actorUserId,
        receivedAt: now,
      };

      const linePayloads = requestLinks.map(link => {
        const poItem = poItemByLineId.get(link.purchaseOrderLineId);
        const purchaseReceivedQty = receiptByPoLine.get(link.purchaseOrderLineId) || 0;
        const inventory = inventoryById.get(link.itemId);
        const receivedQty = poItem ? poLinePurchaseToStockQty(poItem, purchaseReceivedQty, inventory) : purchaseReceivedQty;
        return {
          id: newId(),
          batchId,
          materialRequestId,
          requestLineId: link.requestLineId,
          itemId: link.itemId,
          materialBudgetItemId: link.materialBudgetItemId || poItem?.materialBudgetItemId || null,
          workBoqItemId: link.workBoqItemId || poItem?.workBoqItemId || null,
          poId: input.po.id,
          poLineId: link.purchaseOrderLineId,
          requestedQtySnapshot: Number(link.requestedQty || poItem?.qty || 0),
          committedQtySnapshot: Number(link.requestedQty || poItem?.qty || 0),
          issuedQty: receivedQty,
          receivedQty,
          unit: getPoLineStockUnit(poItem || ({} as PurchaseOrderItem), inventory) || link.unit || poItem?.unit || null,
          varianceReason: null,
          note: `Nhập thực nhận ${poNumber}${poSourceSuffix}`,
        };
      }).filter(line => line.receivedQty > 0);

      if (linePayloads.length === 0) continue;

      const { error: batchError } = await supabase
        .from(BATCH_TABLE)
        .insert(toDb(batchPayload));
      if (batchError) throw batchError;

      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .insert(linePayloads.map(toDb));
      if (lineError) {
        await supabase.from(BATCH_TABLE).delete().eq('id', batchId);
        throw lineError;
      }

      affectedRequestIds.push(materialRequestId);
    }

    return Array.from(new Set(affectedRequestIds));
  },

  async preparePoReceiptForQualityReview(
    input: PreparePoReceiptForQualityReviewInput,
  ): Promise<PreparePoReceiptForQualityReviewResult> {
    if (!input.po.id) throw new Error('Không xác định được PO cần nhận hàng.');
    if (!input.po.targetWarehouseId) throw new Error('PO chưa có kho nhận.');

    const { data: linkRows, error: linkError } = await supabase
      .from('purchase_order_request_lines')
      .select('purchase_order_line_id,material_request_id')
      .eq('purchase_order_id', input.po.id);
    if (linkError) throw linkError;
    if ((linkRows || []).length === 0) {
      throw new Error('PO chưa liên kết đề xuất vật tư nên chưa có phiếu chờ duyệt SL/CL. Vui lòng tạo đợt giao trước khi quét nhận.');
    }

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('po_id', input.po.id);
    if (lineError) throw lineError;

    const batchIds = Array.from(new Set((lineRows || []).map(line => line.batch_id).filter(Boolean)));
    if (batchIds.length === 0) {
      throw new Error('PO chưa có đợt giao đang chờ nhận. Vui lòng chuyển PO sang trạng thái Đang giao trước.');
    }

    const { data: batchRows, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .select('*')
      .in('id', batchIds)
      .order('batch_date', { ascending: true });
    if (batchError) throw batchError;

    const activeBatches = (batchRows || []).filter(batch =>
      batch.status === 'issued'
      && batch.source_type === 'po_receipt'
      && !!batch.transaction_id
    );
    if (activeBatches.length === 0) {
      throw new Error('PO không còn đợt giao đang chờ duyệt SL/CL.');
    }

    const wrongWarehouseBatch = activeBatches.find(batch =>
      batch.target_warehouse_id
      && batch.target_warehouse_id !== input.po.targetWarehouseId
    );
    if (wrongWarehouseBatch) {
      throw new Error('Kho nhận của PO không khớp kho nhận trên đợt giao đang mở.');
    }

    const transactionIds = Array.from(new Set(activeBatches.map(batch => batch.transaction_id).filter(Boolean)));
    const { data: transactionRows, error: transactionError } = await supabase
      .from('transactions')
      .select('*')
      .in('id', transactionIds);
    if (transactionError) throw transactionError;

    const transactions = (transactionRows || []).map(row => fromDb(row) as Transaction);
    const pendingTransactions = transactions.filter(tx => tx.status === TransactionStatus.PENDING);
    if (pendingTransactions.length === 0) {
      if (transactions.some(tx => tx.status === TransactionStatus.APPROVED)) {
        throw new Error('Phiếu nhận hàng đã được duyệt SL/CL. Vui lòng vào Quản lý phiếu đơn hàng để xác nhận nhận lần cuối.');
      }
      throw new Error('Không tìm thấy phiếu nhập kho đang chờ duyệt SL/CL cho PO này.');
    }

    const pendingTransactionIds = new Set(pendingTransactions.map(tx => tx.id));
    const pendingBatches = activeBatches.filter(batch => pendingTransactionIds.has(batch.transaction_id));
    const pendingBatchIds = new Set(pendingBatches.map(batch => batch.id));
    const pendingLines = (lineRows || []).filter(line => pendingBatchIds.has(line.batch_id));

    const poItemByLineId = new Map((input.po.items || []).map(item => [item.lineId || item.itemId, item]));
    const inventoryById = await loadInventoryForPo(input.po);
    const poLineIdsByItemId = new Map<string, string[]>();
    (input.po.items || []).forEach(item => {
      const lineId = item.lineId || item.itemId;
      poLineIdsByItemId.set(item.itemId, [...(poLineIdsByItemId.get(item.itemId) || []), lineId]);
    });
    const resolveReceiptKey = (line: RecordPoReceiptLineInput): string => {
      if (line.lineId) return line.lineId;
      const lineIds = poLineIdsByItemId.get(line.itemId) || [];
      return lineIds.length === 1 ? lineIds[0] : line.itemId;
    };

    const receiptByPoLine = new Map<string, number>();
    input.receiptLines.forEach(line => {
      const quantity = Number(line.quantity || 0);
      if (quantity <= 0) return;
      const key = resolveReceiptKey(line);
      const poItem = poItemByLineId.get(key);
      const inventory = inventoryById.get(line.itemId || poItem?.itemId || '');
      const stockQuantity = poItem ? poLinePurchaseToStockQty(poItem, quantity, inventory) : quantity;
      receiptByPoLine.set(key, (receiptByPoLine.get(key) || 0) + stockQuantity);
    });
    if (receiptByPoLine.size === 0) throw new Error('Chưa có số lượng thực nhận hợp lệ.');

    const batchOrder = new Map(pendingBatches.map((batch, index) => [batch.id, index]));
    const sortedLines = [...pendingLines].sort((left, right) =>
      (batchOrder.get(left.batch_id) || 0) - (batchOrder.get(right.batch_id) || 0)
    );
    const allocationByFulfillmentLineId = new Map<string, number>();
    const unallocatedByPoLine = new Map(receiptByPoLine);

    sortedLines.forEach(line => {
      const poLineId = line.po_line_id || line.item_id;
      const remaining = unallocatedByPoLine.get(poLineId) || 0;
      const allocated = Math.min(remaining, Number(line.issued_qty || 0));
      allocationByFulfillmentLineId.set(line.id, allocated);
      unallocatedByPoLine.set(poLineId, Math.max(remaining - allocated, 0));
    });

    const unallocated = Array.from(unallocatedByPoLine.entries()).find(([, quantity]) => quantity > 1e-9);
    if (unallocated) {
      throw new Error('Số lượng thực nhận vượt số lượng của đợt giao đang mở. Vui lòng kiểm tra lại đợt giao hoặc tạo đợt bổ sung.');
    }

    for (const transaction of pendingTransactions) {
      const transactionBatch = pendingBatches.find(batch => batch.transaction_id === transaction.id);
      if (!transactionBatch) continue;
      const batchLines = pendingLines.filter(line => line.batch_id === transactionBatch.id);

      const nextItems = transaction.items.map(item => {
        const fulfillmentLine = batchLines.find(line =>
          line.request_line_id === item.requestLineId
          || (!item.requestLineId && line.item_id === item.itemId)
        );
        if (!fulfillmentLine) return item;

        const quantity = allocationByFulfillmentLineId.get(fulfillmentLine.id) || 0;
        if (quantity <= 0) {
          throw new Error('Mỗi dòng trong đợt giao phải có số lượng thực nhận lớn hơn 0. Nếu NCC chưa giao dòng này, hãy tách thành đợt giao khác.');
        }
        const poLineId = fulfillmentLine.po_line_id || fulfillmentLine.item_id;
        const poItem = poItemByLineId.get(poLineId);
        const inventory = inventoryById.get(item.itemId || poItem?.itemId || fulfillmentLine.item_id);
        const receiptItem = buildPoReceiptTransactionItem(poItem, quantity, inventory, { itemId: item.itemId });
        return {
          ...item,
          quantity: receiptItem.quantity,
          price: receiptItem.price,
          accountingQty: receiptItem.accountingQty,
          accountingUnit: receiptItem.accountingUnit,
          accountingPrice: receiptItem.accountingPrice,
          varianceReason: quantity === Number(fulfillmentLine.issued_qty || 0)
            ? item.varianceReason
            : 'Thủ kho công trường ghi nhận thực nhận từ QR lệch số lượng đợt giao.',
        };
      });

      const { error } = await supabase.rpc('update_transaction_items_for_receipt', {
        p_transaction_id: transaction.id,
        p_items: nextItems,
      });
      if (error) throw error;
    }

    return {
      transactionIds: pendingTransactions.map(tx => tx.id),
      materialRequestIds: Array.from(new Set(pendingBatches.map(batch => batch.material_request_id).filter(Boolean))),
    };
  },

  async ensurePoDeliveryBatches(input: EnsurePoDeliveryBatchesInput): Promise<string[]> {
    if (!input.po.id) return [];
    if (!input.po.targetWarehouseId) {
      throw new Error('PO chưa có kho nhận nên không thể tạo phiếu chờ nhập kho.');
    }
    const poSourceSuffix = input.po.vendorName ? ` - ${input.po.vendorName}` : '';
    const poNumber = formatPoNumber(input.po.poNumber);

    const { data: existingLineRows, error: existingLineError } = await supabase
      .from(LINE_TABLE)
      .select('batch_id, material_request_id')
      .eq('po_id', input.po.id);
    if (existingLineError) {
      if (isMissingFulfillmentTable(existingLineError)) return [];
      throw existingLineError;
    }

    const existingBatchIds = Array.from(new Set((existingLineRows || []).map(row => row.batch_id).filter(Boolean)));
    if (existingBatchIds.length > 0) {
      const { data: existingBatches, error: existingBatchError } = await supabase
        .from(BATCH_TABLE)
        .select('id,status,material_request_id')
        .in('id', existingBatchIds);
      if (existingBatchError) throw existingBatchError;
      const activeBatches = (existingBatches || []).filter(batch => batch.status === 'issued');
      if (activeBatches.length > 0) {
        return Array.from(new Set(activeBatches.map(batch => batch.material_request_id).filter(Boolean)));
      }
    }

    const { data: linkRows, error: linkError } = await supabase
      .from('purchase_order_request_lines')
      .select('*')
      .eq('purchase_order_id', input.po.id);
    if (linkError) throw linkError;

    const links = (linkRows || []).map(fromDb) as PurchaseOrderRequestLineLink[];
    if (links.length === 0) return [];

    const poItemByLineId = new Map((input.po.items || []).map(item => [item.lineId || item.itemId, item]));
    const inventoryById = await loadInventoryForPo(input.po);
    const remainingByPoLine = new Map<string, number>();
    (input.po.items || []).forEach(item => {
      const key = item.lineId || item.itemId;
      const orderedQty = Number(item.qty || 0);
      const receivedQty = Number(item.receivedQty || 0);
      const remainingQty = Math.max(orderedQty - receivedQty, 0);
      if (remainingQty > 0) remainingByPoLine.set(key, remainingQty);
    });

    const linksByRequest = new Map<string, PurchaseOrderRequestLineLink[]>();
    links.forEach(link => {
      const remainingQty = remainingByPoLine.get(link.purchaseOrderLineId) || 0;
      if (remainingQty <= 0) return;
      linksByRequest.set(link.materialRequestId, [...(linksByRequest.get(link.materialRequestId) || []), link]);
    });
    if (linksByRequest.size === 0) return [];

    const now = new Date().toISOString();
    const affectedRequestIds: string[] = [];

    for (const [materialRequestId, requestLinks] of linksByRequest.entries()) {
      const batchId = newId();
      const transactionId = `tx-po-delivery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const requestCode = requestLinks[0]?.materialRequestCode || materialRequestId;
      const linePayloads = requestLinks.map(link => {
        const poItem = poItemByLineId.get(link.purchaseOrderLineId);
        const inventory = inventoryById.get(link.itemId || poItem?.itemId || '');
        const remainingPurchaseQty = remainingByPoLine.get(link.purchaseOrderLineId) || 0;
        const remainingStockQty = poItem ? poLinePurchaseToStockQty(poItem, remainingPurchaseQty, inventory) : remainingPurchaseQty;
        const linkedStockQty = Number(link.orderedQty || (poItem ? poLinePurchaseToStockQty(poItem, Number(poItem.qty || 0), inventory) : 0));
        const deliveryQty = Math.min(remainingStockQty, linkedStockQty || remainingStockQty);
        const stockUnit = poItem ? getPoLineStockUnit(poItem, inventory) : inventory?.unit || link.unit || null;
        return {
          id: newId(),
          batchId,
          materialRequestId,
          requestLineId: link.requestLineId,
          itemId: link.itemId,
          materialBudgetItemId: link.materialBudgetItemId || poItem?.materialBudgetItemId || null,
          workBoqItemId: link.workBoqItemId || poItem?.workBoqItemId || null,
          poId: input.po.id,
          poLineId: link.purchaseOrderLineId,
          requestedQtySnapshot: Number(link.requestedQty || linkedStockQty || deliveryQty || 0),
          committedQtySnapshot: Number(link.requestedQty || linkedStockQty || deliveryQty || 0),
          issuedQty: deliveryQty,
          receivedQty: 0,
          unit: stockUnit,
          varianceReason: null,
          note: `Chờ nhận hàng từ ${poNumber}${poSourceSuffix}`,
        };
      }).filter(line => line.issuedQty > 0);

      if (linePayloads.length === 0) continue;

      const transactionPayload = {
        id: transactionId,
        type: TransactionType.IMPORT,
        date: now,
        items: linePayloads.map(line => {
          const poItem = poItemByLineId.get(line.poLineId);
          const inventory = inventoryById.get(line.itemId || poItem?.itemId || '');
          return buildPoReceiptTransactionItem(poItem, line.issuedQty, inventory, {
            materialRequestId,
            requestLineId: line.requestLineId,
            fulfillmentBatchId: batchId,
          });
        }),
        targetWarehouseId: input.po.targetWarehouseId,
        requesterId: input.actorUserId,
        approverId: input.actorUserId,
        status: TransactionStatus.PENDING,
        note: `${poNumber} đang giao${poSourceSuffix}`,
        relatedRequestId: materialRequestId,
      };

      const batchPayload = {
        id: batchId,
        projectId: input.po.projectId || requestLinks[0]?.projectId || null,
        constructionSiteId: input.po.constructionSiteId || requestLinks[0]?.constructionSiteId || null,
        materialRequestId,
        batchNo: `${requestCode}-PO-${input.po.poNumber}`,
        batchDate: now,
        sourceWarehouseId: null,
        targetWarehouseId: input.po.targetWarehouseId,
        fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
        sourceType: 'po_receipt',
        status: 'issued',
        transactionId,
        reason: null,
        note: `${poNumber}${poSourceSuffix} đang giao, chờ thủ kho kiểm tra SL/CL và xác nhận nhập.`,
        createdBy: input.actorUserId,
        issuedBy: input.actorUserId,
        issuedAt: now,
      };

      let transactionCreated = false;
      let batchCreated = false;
      try {
        const { error: txError } = await supabase
          .from('transactions')
          .insert({
            id: transactionPayload.id,
            type: transactionPayload.type,
            date: transactionPayload.date,
            items: transactionPayload.items,
            target_warehouse_id: transactionPayload.targetWarehouseId,
            requester_id: transactionPayload.requesterId,
            approver_id: transactionPayload.approverId,
            status: transactionPayload.status,
            note: transactionPayload.note,
            related_request_id: transactionPayload.relatedRequestId,
          });
        if (txError) throw txError;
        transactionCreated = true;

        const { error: batchError } = await supabase
          .from(BATCH_TABLE)
          .insert(toDb(batchPayload));
        if (batchError) throw batchError;
        batchCreated = true;

        const { error: lineError } = await supabase
          .from(LINE_TABLE)
          .insert(linePayloads.map(toDb));
        if (lineError) throw lineError;

        affectedRequestIds.push(materialRequestId);
      } catch (error) {
        if (batchCreated) await supabase.from(BATCH_TABLE).delete().eq('id', batchId);
        if (transactionCreated) await supabase.from('transactions').delete().eq('id', transactionId);
        throw error;
      }
    }

    return Array.from(new Set(affectedRequestIds));
  },

  async markPoReceiptBatchesReturned(poId: string, reason?: string): Promise<string[]> {
    if (!poId) return [];

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('batch_id, material_request_id')
      .eq('po_id', poId);
    if (lineError) {
      if (isMissingFulfillmentTable(lineError)) return [];
      throw lineError;
    }

    const batchIds = Array.from(new Set((lineRows || []).map(row => row.batch_id).filter(Boolean)));
    const requestIds = Array.from(new Set((lineRows || []).map(row => row.material_request_id).filter(Boolean)));
    if (batchIds.length === 0) return requestIds;

    const { error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'returned',
        cancel_reason: reason || 'PO đã trả lại/hoàn hàng',
        reason: reason || 'PO đã trả lại/hoàn hàng',
      })
      .in('id', batchIds)
      .eq('source_type', 'po_receipt');
    if (batchError) throw batchError;

    return requestIds;
  },

  async updateTransactionReceiptQuantities(input: UpdateTransactionReceiptQuantitiesInput): Promise<void> {
    const lineDrafts = new Map(input.lines.map(line => [line.index, line]));
    const nextItems = input.transaction.items.map((item, index) => {
      const draft = lineDrafts.get(index);
      if (!draft) return item;
      return {
        ...item,
        quantity: Number(draft.quantity || 0),
        varianceReason: draft.reason?.trim() || undefined,
      };
    });

    const { error } = await supabase.rpc('update_transaction_items_for_receipt', {
      p_transaction_id: input.transaction.id,
      p_items: nextItems,
    });
    if (error) throw error;

    if (input.stage !== 'approval') return;

    for (const line of input.lines) {
      const originalItem = input.transaction.items[line.index];
      const nextItem = nextItems[line.index];
      if (!originalItem || !nextItem?.fulfillmentBatchId || !nextItem.requestLineId) continue;

      const nextQty = Number(nextItem.quantity || 0);
      const originalQty = Number(originalItem.quantity || 0);
      const reason = line.reason?.trim();
      if (nextQty === originalQty && !reason) continue;

      const { error: lineError } = await supabase
        .from(LINE_TABLE)
        .update({
          issued_qty: nextQty,
          variance_reason: reason || (nextQty === originalQty ? null : 'Thủ kho công trường duyệt số lượng/chất lượng lệch phiếu kho.'),
        })
        .eq('batch_id', nextItem.fulfillmentBatchId)
        .eq('request_line_id', nextItem.requestLineId);
      if (lineError) throw lineError;
    }
  },

  async syncFulfillmentReceiptForTransaction(input: SyncFulfillmentReceiptForTransactionInput): Promise<void> {
    const { error } = await supabase.rpc('sync_fulfillment_receipt_for_transaction', {
      p_transaction_id: input.transactionId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) throw error;
  },

  async receiveBatch(input: ReceiveFulfillmentBatchInput): Promise<MaterialRequestFulfillmentBatch> {
    if (input.batch.status !== 'issued') {
      throw new Error('Chỉ xác nhận nhận hàng cho đợt đang ở trạng thái đã xuất.');
    }

    const receivedByLineId = new Map(input.lines.map(line => [line.lineId, {
      receivedQty: Number(line.receivedQty || 0),
      varianceReason: line.varianceReason || '',
    }]));

    input.batch.lines.forEach(line => {
      const received = receivedByLineId.get(line.id);
      if (!received) throw new Error('Thiếu dữ liệu nhận hàng cho một dòng trong đợt cấp.');
      if (received.receivedQty < 0) throw new Error('Số lượng nhận không được âm.');
      if (received.receivedQty !== Number(line.issuedQty || 0) && !received.varianceReason.trim()) {
        throw new Error('Dòng nhận lệch số lượng xuất phải nhập lý do.');
      }
    });

    const existingBatches = await this.listByRequest(input.request.id);
    const requestLineMap = new Map<string, RequestItem>((input.request.items || []).map((line, index) => [getRequestLineId(input.request, line, index), line]));
    const receivedByRequestLine = new Map<string, number>();
    existingBatches
      .filter(batch => batch.id !== input.batch.id && (batch.status === 'received' || batch.status === 'variance_pending'))
      .forEach(batch => {
        batch.lines.forEach(line => {
          receivedByRequestLine.set(line.requestLineId, (receivedByRequestLine.get(line.requestLineId) || 0) + Number(line.receivedQty || 0));
        });
      });

    let hasVariance = false;
    input.batch.lines.forEach(line => {
      const received = receivedByLineId.get(line.id)!;
      if (received.receivedQty !== Number(line.issuedQty || 0)) hasVariance = true;
      const requestLine = requestLineMap.get(line.requestLineId);
      const requestQty = Number(requestLine?.requestQty || line.requestedQtySnapshot || 0);
      const nextReceived = (receivedByRequestLine.get(line.requestLineId) || 0) + received.receivedQty;
      if (nextReceived > requestQty) {
        throw new Error(`Số lượng nhận lũy kế của "${requestLine ? lineName(requestLine) : line.itemId}" vượt số lượng công trường đề xuất. Vui lòng tạo đề xuất bổ sung nếu cần nhận thêm.`);
      }
      receivedByRequestLine.set(line.requestLineId, nextReceived);
    });

    const now = new Date().toISOString();
    for (const line of input.batch.lines) {
      const received = receivedByLineId.get(line.id)!;
      const { error } = await supabase
        .from(LINE_TABLE)
        .update({
          received_qty: received.receivedQty,
          variance_reason: received.varianceReason.trim() || line.varianceReason || null,
        })
        .eq('id', line.id)
        .select('id')
        .single();
      if (error) throw error;
    }

    if (input.batch.transactionId) {
      const { data: txRow, error: txReadError } = await supabase
        .from('transactions')
        .select('status, items')
        .eq('id', input.batch.transactionId)
        .maybeSingle();
      if (txReadError) throw txReadError;

      if (txRow?.status === TransactionStatus.PENDING) {
        throw new Error('Đợt cấp cần được thủ kho công trường duyệt số lượng/chất lượng trước khi xác nhận nhập kho.');
      }
      if (txRow?.status && txRow.status !== TransactionStatus.APPROVED && txRow.status !== TransactionStatus.COMPLETED) {
        throw new Error('Phiếu kho của đợt cấp không còn ở trạng thái có thể xác nhận nhập kho.');
      }

      if (hasVariance && txRow?.status !== TransactionStatus.COMPLETED) {
        const receivedQtyByRequestLine = new Map(
          input.batch.lines.map(line => [line.requestLineId, receivedByLineId.get(line.id)?.receivedQty ?? Number(line.issuedQty || 0)])
        );
        const adjustedItems = (txRow?.items || []).map((item: any) => ({
          ...item,
          quantity: receivedQtyByRequestLine.get(item.requestLineId) ?? Number(item.quantity || 0),
        }));
        const { error: updateTxError } = await supabase
          .from('transactions')
          .update({ items: adjustedItems })
          .eq('id', input.batch.transactionId);
        if (updateTxError) throw updateTxError;
      }

      if (txRow?.status !== TransactionStatus.COMPLETED) {
        const { error: txError } = await supabase.rpc('process_transaction_status', {
          p_transaction_id: input.batch.transactionId,
          p_status: TransactionStatus.COMPLETED,
          p_approver_id: input.actorUserId,
        });
        if (txError) throw txError;
      }
    }

    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'received',
        received_by: input.actorUserId,
        received_at: now,
        reason: input.overrideReason || input.batch.reason || (hasVariance ? 'Thủ kho công trường xác nhận nhận lệch theo thực tế.' : null),
      })
      .eq('id', input.batch.id)
      .select('*')
      .single();
    if (batchError) throw batchError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', input.batch.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    await syncPurchaseOrderReceiptFromBatch(input.batch, receivedByLineId);

    return normalizeBatch(batchRow, lineRows || []);
  },

  async returnIssuedBatch(input: ReturnFulfillmentBatchInput): Promise<MaterialRequestFulfillmentBatch> {
    if (input.batch.status !== 'issued') {
      throw new Error('Chỉ trả lại/hoàn hàng cho đợt đang vận chuyển.');
    }

    if (input.batch.transactionId) {
      const { data: txRow, error: txReadError } = await supabase
        .from('transactions')
        .select('status')
        .eq('id', input.batch.transactionId)
        .maybeSingle();
      if (txReadError) throw txReadError;

      if (txRow && txRow.status !== TransactionStatus.CANCELLED) {
        if (txRow.status === TransactionStatus.COMPLETED) {
          throw new Error('Đợt cấp đã cập nhật tồn kho, không thể trả lại bằng thao tác này.');
        }
        const { error: txError } = await supabase.rpc('process_transaction_status', {
          p_transaction_id: input.batch.transactionId,
          p_status: TransactionStatus.CANCELLED,
          p_approver_id: input.actorUserId,
        });
        if (txError) throw txError;
      }
    }

    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'returned',
        cancel_reason: input.reason || 'Công trường trả lại/hoàn hàng đợt cấp đang vận chuyển',
        reason: input.reason || input.batch.reason || null,
      })
      .eq('id', input.batch.id)
      .select('*')
      .single();
    if (batchError) throw batchError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', input.batch.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return normalizeBatch(batchRow, lineRows || []);
  },

  async returnReceivedBatch(input: ReturnReceivedFulfillmentBatchInput): Promise<MaterialRequestFulfillmentBatch> {
    if (input.batch.status !== 'received') {
      throw new Error('Chỉ Admin được hoàn trả đợt cấp đã nhận ở trạng thái Đã nhận.');
    }

    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'returned',
        cancel_reason: input.reason || 'Admin hoàn trả đợt cấp đã nhận',
        reason: input.reason || input.batch.reason || null,
        note: input.returnTransactionId
          ? `${input.batch.note || ''}${input.batch.note ? ' | ' : ''}Phiếu hoàn kho: ${input.returnTransactionId}`
          : input.batch.note || null,
      })
      .eq('id', input.batch.id)
      .select('*')
      .single();
    if (batchError) throw batchError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', input.batch.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return normalizeBatch(batchRow, lineRows || []);
  },

  async resolveVarianceBatch(input: ResolveFulfillmentVarianceInput): Promise<MaterialRequestFulfillmentBatch> {
    if (input.batch.status !== 'variance_pending') {
      throw new Error('Chỉ chốt lệch cho đợt đang chờ xử lý lệch.');
    }

    if (input.batch.transactionId) {
      const { data: txRow, error: txReadError } = await supabase
        .from('transactions')
        .select('status, items')
        .eq('id', input.batch.transactionId)
        .maybeSingle();
      if (txReadError) throw txReadError;

      if (txRow && txRow.status !== TransactionStatus.COMPLETED) {
        const receivedQtyByLine = new Map(input.batch.lines.map(line => [line.requestLineId, Number(line.receivedQty || 0)]));
        const adjustedItems = (txRow.items || []).map((item: any) => ({
          ...item,
          quantity: receivedQtyByLine.get(item.requestLineId) ?? Number(item.quantity || 0),
        }));
        const { error: updateTxError } = await supabase
          .from('transactions')
          .update({ items: adjustedItems })
          .eq('id', input.batch.transactionId);
        if (updateTxError) throw updateTxError;

        const { error: txError } = await supabase.rpc('process_transaction_status', {
          p_transaction_id: input.batch.transactionId,
          p_status: TransactionStatus.COMPLETED,
          p_approver_id: input.actorUserId,
        });
        if (txError) throw txError;
      }
    }

    const { data: batchRow, error: batchError } = await supabase
      .from(BATCH_TABLE)
      .update({
        status: 'received',
        reason: input.batch.reason || 'Đã chốt lệch theo số lượng công trường thực nhận',
      })
      .eq('id', input.batch.id)
      .select('*')
      .single();
    if (batchError) throw batchError;

    const { data: lineRows, error: lineError } = await supabase
      .from(LINE_TABLE)
      .select('*')
      .eq('batch_id', input.batch.id)
      .order('created_at', { ascending: true });
    if (lineError) throw lineError;

    return normalizeBatch(batchRow, lineRows || []);
  },
};
