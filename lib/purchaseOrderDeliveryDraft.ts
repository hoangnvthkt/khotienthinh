import type { InventoryItem, PurchaseOrderDeliveryBatch, PurchaseOrderDeliveryLine, PurchaseOrderItem } from '../types';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  poLinePurchaseToStockQty,
} from './materialUnitConversion';

type MakePoDeliveryLineDraftInput = {
  id?: string;
  batchId: string;
  purchaseOrderId: string;
  item: PurchaseOrderItem;
  inventory?: InventoryItem | null;
  plannedQty: number;
  deliveryUnitPrice?: number;
  stockPlannedQty?: number | null;
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const makePoDeliveryLineDraft = ({
  id,
  batchId,
  purchaseOrderId,
  item,
  inventory,
  plannedQty,
  deliveryUnitPrice,
  stockPlannedQty,
}: MakePoDeliveryLineDraftInput): PurchaseOrderDeliveryLine => {
  const normalizedPlannedQty = toNumber(plannedQty);
  return {
    id: id || newId(),
    deliveryBatchId: batchId,
    purchaseOrderId,
    purchaseOrderLineId: item.lineId || item.itemId,
    itemId: item.itemId,
    plannedQty: normalizedPlannedQty,
    unit: getPoLinePurchaseUnit(item, inventory) || item.unit || null,
    deliveryUnitPrice: toNumber(deliveryUnitPrice ?? item.unitPrice),
    stockPlannedQty: stockPlannedQty == null
      ? poLinePurchaseToStockQty(item, normalizedPlannedQty, inventory)
      : toNumber(stockPlannedQty),
    stockUnit: getPoLineStockUnit(item, inventory) || null,
  };
};

export const syncPoItemsFromDeliverySchedule = (
  items: PurchaseOrderItem[],
  batches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderItem[] => {
  const activeBatches = batches.filter(batch => batch.status !== 'cancelled');
  if (activeBatches.length === 0) {
    return items.map(item => ({
      ...item,
      qty: toNumber(item.qty),
      unitPrice: toNumber(item.unitPrice),
    }));
  }

  return items.map(item => {
    const lineKey = item.lineId || item.itemId;
    const matchingLines = activeBatches.flatMap(batch =>
      (batch.lines || []).filter(line => line.purchaseOrderLineId === lineKey),
    );
    if (matchingLines.length === 0) {
      return {
        ...item,
        qty: toNumber(item.qty),
        unitPrice: toNumber(item.unitPrice),
      };
    }

    const scheduledQty = matchingLines.reduce((sum, line) => sum + Math.max(0, toNumber(line.plannedQty)), 0);
    const scheduledAmount = matchingLines.reduce((sum, line) => {
      const plannedQty = Math.max(0, toNumber(line.plannedQty));
      const unitPrice = toNumber(line.deliveryUnitPrice ?? item.unitPrice);
      return sum + plannedQty * unitPrice;
    }, 0);

    return {
      ...item,
      qty: scheduledQty,
      unitPrice: scheduledQty > 0 ? scheduledAmount / scheduledQty : toNumber(item.unitPrice),
    };
  });
};

export const syncPoItemPricesFromDeliverySchedule = (
  items: PurchaseOrderItem[],
  batches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderItem[] => {
  const activeBatches = batches.filter(batch => batch.status !== 'cancelled');
  if (activeBatches.length === 0) {
    return items.map(item => ({
      ...item,
      qty: toNumber(item.qty),
      unitPrice: toNumber(item.unitPrice),
    }));
  }

  return items.map(item => {
    const lineKey = item.lineId || item.itemId;
    const matchingLines = activeBatches.flatMap(batch =>
      (batch.lines || []).filter(line => line.purchaseOrderLineId === lineKey),
    );
    const scheduledQty = matchingLines.reduce((sum, line) => sum + Math.max(0, toNumber(line.plannedQty)), 0);
    if (scheduledQty <= 0) {
      return {
        ...item,
        qty: toNumber(item.qty),
        unitPrice: toNumber(item.unitPrice),
      };
    }

    const scheduledAmount = matchingLines.reduce((sum, line) => {
      const plannedQty = Math.max(0, toNumber(line.plannedQty));
      const unitPrice = toNumber(line.deliveryUnitPrice ?? item.unitPrice);
      return sum + plannedQty * unitPrice;
    }, 0);

    return {
      ...item,
      qty: toNumber(item.qty),
      unitPrice: scheduledAmount / scheduledQty,
    };
  });
};
