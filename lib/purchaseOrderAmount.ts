import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../types';

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getPurchaseOrderDisplayAmount = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): number => {
  const itemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
  const activeLines = deliveryBatches
    .filter(batch => batch.status !== 'cancelled')
    .flatMap(batch => batch.lines || [])
    .filter(line => toNumber(line.plannedQty) > 0);

  if (activeLines.length === 0) return toNumber(po.totalAmount);

  return Math.round(activeLines.reduce((sum, line) => {
    const sourceItem = itemByLineId.get(line.purchaseOrderLineId);
    const plannedQty = toNumber(line.plannedQty);
    const unitPrice = toNumber(line.deliveryUnitPrice ?? sourceItem?.unitPrice);
    return sum + plannedQty * unitPrice;
  }, 0));
};
