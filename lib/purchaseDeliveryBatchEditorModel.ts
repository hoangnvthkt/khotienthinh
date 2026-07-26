import type { PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../types';

export interface PurchaseDeliveryLineDraft {
  purchaseOrderLineId: string;
  itemId: string;
  itemName: string;
  orderedQty: number;
  alreadyReleasedQty: number;
  remainingQty: number;
  purchaseQty: number;
  purchaseUnit: string;
  stockQty: number;
  stockUnit: string;
  purchaseUnitPrice: number;
  stockUnitPrice: number;
}

export interface PurchaseDeliveryDraftSummary {
  orderedQty: number;
  alreadyReleasedQty: number;
  draftQty: number;
  nextReleasedQty: number;
  varianceQty: number;
  draftAmount: number;
}

const numberValue = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPoLineId = (item: PurchaseOrderItem) => item.lineId || item.itemId;

const isReleasedBatch = (batch: PurchaseOrderDeliveryBatch) => batch.status !== 'cancelled';

const getReleasedQtyForLine = (
  purchaseOrderLineId: string,
  existingBatches: PurchaseOrderDeliveryBatch[],
) => existingBatches
  .filter(isReleasedBatch)
  .flatMap(batch => batch.lines || [])
  .filter(line => line.purchaseOrderLineId === purchaseOrderLineId)
  .reduce((sum, line) => sum + numberValue(line.plannedQty), 0);

export const buildPurchaseDeliveryLineDrafts = ({
  purchaseOrder,
  existingBatches = [],
  cloneFromBatch = null,
}: {
  purchaseOrder: PurchaseOrder;
  existingBatches?: PurchaseOrderDeliveryBatch[];
  cloneFromBatch?: PurchaseOrderDeliveryBatch | null;
}): PurchaseDeliveryLineDraft[] => (purchaseOrder.items || []).map(item => {
  const purchaseOrderLineId = getPoLineId(item);
  const cloneLine = cloneFromBatch?.lines?.find(line => line.purchaseOrderLineId === purchaseOrderLineId);
  const orderedQty = numberValue(item.qty);
  const alreadyReleasedQty = getReleasedQtyForLine(purchaseOrderLineId, existingBatches);
  const remainingQty = Math.max(orderedQty - alreadyReleasedQty, 0);
  const purchaseQty = cloneLine ? numberValue(cloneLine.plannedQty) : remainingQty;
  const stockQty = cloneLine
    ? numberValue(cloneLine.stockPlannedQty || cloneLine.plannedQty)
    : purchaseQty;
  const purchaseUnitPrice = numberValue(cloneLine?.deliveryUnitPrice ?? item.unitPrice);

  return {
    purchaseOrderLineId,
    itemId: item.itemId,
    itemName: item.name || item.sku || item.itemId,
    orderedQty,
    alreadyReleasedQty,
    remainingQty,
    purchaseQty,
    purchaseUnit: cloneLine?.unit || item.purchaseUnitSnapshot || item.unit,
    stockQty,
    stockUnit: cloneLine?.stockUnit || item.stockUnitSnapshot || item.unit,
    purchaseUnitPrice,
    stockUnitPrice: purchaseUnitPrice,
  };
});

export const getPurchaseDeliveryDraftSummary = ({
  purchaseOrder,
  existingBatches = [],
  draftLines,
}: {
  purchaseOrder: PurchaseOrder;
  existingBatches?: PurchaseOrderDeliveryBatch[];
  draftLines: PurchaseDeliveryLineDraft[];
}): PurchaseDeliveryDraftSummary => {
  const orderedQty = (purchaseOrder.items || []).reduce((sum, item) => sum + numberValue(item.qty), 0);
  const alreadyReleasedQty = (purchaseOrder.items || []).reduce(
    (sum, item) => sum + getReleasedQtyForLine(getPoLineId(item), existingBatches),
    0,
  );
  const draftQty = draftLines.reduce((sum, line) => sum + numberValue(line.purchaseQty), 0);
  const draftAmount = draftLines.reduce(
    (sum, line) => sum + numberValue(line.purchaseQty) * numberValue(line.purchaseUnitPrice),
    0,
  );
  const nextReleasedQty = alreadyReleasedQty + draftQty;

  return {
    orderedQty,
    alreadyReleasedQty,
    draftQty,
    nextReleasedQty,
    varianceQty: nextReleasedQty - orderedQty,
    draftAmount,
  };
};
