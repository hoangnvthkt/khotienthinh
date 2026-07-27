import type { PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../types';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  getPurchaseConversionFactor,
  purchaseToStockQty,
} from './materialUnitConversion';

export interface PurchaseDeliveryLineDraft {
  included: boolean;
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
  conversionFactor: number;
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
  const purchaseUnit = cloneLine?.unit || getPoLinePurchaseUnit(item) || item.unit;
  const stockUnit = cloneLine?.stockUnit || getPoLineStockUnit(item) || item.unit;
  const conversionFactor = getPurchaseConversionFactor({
    unit: stockUnit,
    purchaseUnit,
    purchaseConversionFactor: item.purchaseConversionFactor,
  });
  const stockQty = cloneLine
    ? numberValue(cloneLine.stockPlannedQty || cloneLine.plannedQty)
    : purchaseToStockQty(purchaseQty, { unit: stockUnit, purchaseUnit, purchaseConversionFactor: conversionFactor });
  const purchaseUnitPrice = numberValue(cloneLine?.deliveryUnitPrice ?? item.unitPrice);
  const included = cloneLine ? purchaseQty > 0 : remainingQty > 0;

  return {
    included,
    purchaseOrderLineId,
    itemId: item.itemId,
    itemName: item.name || item.sku || item.itemId,
    orderedQty,
    alreadyReleasedQty,
    remainingQty,
    purchaseQty,
    purchaseUnit,
    stockQty,
    stockUnit,
    conversionFactor,
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
  const selectedLines = getSelectedPurchaseDeliveryLinesForSave(draftLines);
  const draftQty = selectedLines.reduce((sum, line) => sum + numberValue(line.purchaseQty), 0);
  const draftAmount = selectedLines.reduce(
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

export const getSelectedPurchaseDeliveryLinesForSave = (
  draftLines: PurchaseDeliveryLineDraft[],
) => draftLines.filter(line => line.included && numberValue(line.purchaseQty) > 0);

export const getStockQtyForPurchaseDeliveryLine = (
  line: PurchaseDeliveryLineDraft,
  purchaseQty: number,
) => purchaseToStockQty(purchaseQty, {
  unit: line.stockUnit,
  purchaseUnit: line.purchaseUnit,
  purchaseConversionFactor: line.conversionFactor,
});
