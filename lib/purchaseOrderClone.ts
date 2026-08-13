import type {
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderDeliveryLine,
  PurchaseOrderItem,
} from '../types';
import { buildPurchaseOrderMaterialSummary } from './purchaseOrderDisplay';

export interface PurchaseOrderCloneDraft {
  poNumber: string;
  vendorId: string;
  vendorName?: string;
  sourceMode: 'proactive_project';
  purchaseMode: PurchaseOrder['purchaseMode'];
  targetWarehouseId?: string;
  vatRate?: number;
  orderDate: string;
  expectedDeliveryDate?: string;
  approvalRequestTitle: string;
  note?: string;
  status: 'draft';
  items: PurchaseOrderItem[];
  deliveryBatches: PurchaseOrderDeliveryBatch[];
}

export interface BuildPurchaseOrderCloneDraftInput {
  po: PurchaseOrder;
  nextPoNumber: string;
  deliveryBatches?: PurchaseOrderDeliveryBatch[];
  makeId?: () => string;
}

const defaultMakeId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const clonePlain = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const appendCopySuffix = (title: string) => `${title.trim()} Copy`;

export const canClonePurchaseOrder = (po: Pick<PurchaseOrder, 'sourceMode'>) =>
  po.sourceMode === 'proactive_project';

const buildCloneApprovalTitle = (po: PurchaseOrder) => {
  const sourceTitle = po.approvalRequestTitle?.trim() || buildPurchaseOrderMaterialSummary(po.items);
  return appendCopySuffix(sourceTitle || po.poNumber || 'PO');
};

const clonePurchaseOrderItem = (
  item: PurchaseOrderItem,
  makeId: () => string,
): { item: PurchaseOrderItem; sourceLineKey: string } => {
  const sourceLineKey = item.lineId || item.itemId;
  const cloned = clonePlain(item);
  return {
    sourceLineKey,
    item: {
      ...cloned,
      lineId: makeId(),
      requestId: null,
      requestCode: null,
      requestLineId: null,
      receivedQty: 0,
      returnedQty: 0,
    },
  };
};

const cloneDeliveryLine = ({
  line,
  batchId,
  lineIdBySourceKey,
  makeId,
}: {
  line: PurchaseOrderDeliveryLine;
  batchId: string;
  lineIdBySourceKey: Map<string, string>;
  makeId: () => string;
}): PurchaseOrderDeliveryLine | null => {
  const nextLineId = lineIdBySourceKey.get(line.purchaseOrderLineId);
  if (!nextLineId) return null;
  return {
    ...clonePlain(line),
    id: makeId(),
    deliveryBatchId: batchId,
    purchaseOrderId: '',
    purchaseOrderLineId: nextLineId,
    acceptedQty: 0,
    acceptedStockQty: 0,
    returnedQty: 0,
    createdAt: undefined,
    updatedAt: undefined,
  };
};

const cloneDeliveryBatch = ({
  batch,
  index,
  lineIdBySourceKey,
  makeId,
}: {
  batch: PurchaseOrderDeliveryBatch;
  index: number;
  lineIdBySourceKey: Map<string, string>;
  makeId: () => string;
}): PurchaseOrderDeliveryBatch | null => {
  const batchId = makeId();
  const lines = (batch.lines || [])
    .map(line => cloneDeliveryLine({ line, batchId, lineIdBySourceKey, makeId }))
    .filter((line): line is PurchaseOrderDeliveryLine => Boolean(line));
  if (lines.length === 0) return null;
  return {
    ...clonePlain(batch),
    id: batchId,
    purchaseOrderId: '',
    deliveryNo: index + 1,
    status: 'planned',
    qrToken: null,
    idempotencyKey: null,
    qualityResult: null,
    varianceReason: null,
    qualityApprovedBy: null,
    qualityApprovedAt: null,
    receivedBy: null,
    receivedAt: null,
    acceptedGrossAmount: undefined,
    fulfillmentBatchIds: [],
    wmsTransactionId: null,
    supplementalApprovalId: null,
    createdAt: undefined,
    updatedAt: undefined,
    lines,
  };
};

export const buildPurchaseOrderCloneDraft = ({
  po,
  nextPoNumber,
  deliveryBatches = [],
  makeId = defaultMakeId,
}: BuildPurchaseOrderCloneDraftInput): PurchaseOrderCloneDraft => {
  const clonedItems = po.items.map(item => clonePurchaseOrderItem(item, makeId));
  const lineIdBySourceKey = new Map<string, string>();
  clonedItems.forEach(({ sourceLineKey, item }) => {
    const nextLineId = item.lineId || item.itemId;
    lineIdBySourceKey.set(sourceLineKey, nextLineId);
    lineIdBySourceKey.set(item.itemId, nextLineId);
  });
  return {
    poNumber: nextPoNumber,
    vendorId: po.vendorId,
    vendorName: po.vendorName,
    sourceMode: 'proactive_project',
    purchaseMode: po.purchaseMode,
    targetWarehouseId: po.targetWarehouseId,
    vatRate: po.vatRate,
    orderDate: po.orderDate,
    expectedDeliveryDate: po.expectedDeliveryDate,
    approvalRequestTitle: buildCloneApprovalTitle(po),
    note: po.note,
    status: 'draft',
    items: clonedItems.map(({ item }) => item),
    deliveryBatches: deliveryBatches
      .map((batch, index) => cloneDeliveryBatch({ batch, index, lineIdBySourceKey, makeId }))
      .filter((batch): batch is PurchaseOrderDeliveryBatch => Boolean(batch)),
  };
};
