import type { PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../types';
import { calculateLineTotal } from './poSpecsUtils';

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const usesDeliveryScheduleForDisplay = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
) => deliveryBatches.length > 0 || (po.sourceMode === 'from_request' && po.approvedTotalAmount == null);

export const getPurchaseOrderDisplayLineAmount = (
  po: PurchaseOrder,
  item: PurchaseOrderItem,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
) => {
  const lineKey = item.lineId || item.itemId;
  const activeLines = deliveryBatches
    .filter(batch => batch.status !== 'cancelled')
    .flatMap(batch => batch.lines || [])
    .filter(line => line.purchaseOrderLineId === lineKey && toNumber(line.plannedQty) > 0);

  if (activeLines.length === 0) {
    return usesDeliveryScheduleForDisplay(po, deliveryBatches)
      ? { unitPrice: 0, totalAmount: 0, scheduledQty: 0 }
      : {
        unitPrice: toNumber(item.unitPrice),
        totalAmount: Math.round(calculateLineTotal(item)),
        scheduledQty: toNumber(item.qty),
      };
  }

  const scheduledQty = activeLines.reduce((sum, line) => sum + toNumber(line.plannedQty), 0);
  const totalAmount = Math.round(activeLines.reduce((sum, line) => {
    const plannedQty = toNumber(line.plannedQty);
    const unitPrice = toNumber(line.deliveryUnitPrice ?? item.unitPrice);
    return sum + plannedQty * unitPrice;
  }, 0));
  const unitPrice = scheduledQty > 0 ? Math.round((totalAmount / scheduledQty) * 100000) / 100000 : 0;

  return { unitPrice, totalAmount, scheduledQty };
};

export const getPurchaseOrderDisplayAmount = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): number => {
  const itemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
  const usesDeliverySchedule = usesDeliveryScheduleForDisplay(po, deliveryBatches);
  const activeLines = deliveryBatches
    .filter(batch => batch.status !== 'cancelled')
    .flatMap(batch => batch.lines || [])
    .filter(line => toNumber(line.plannedQty) > 0);

  if (activeLines.length === 0) return usesDeliverySchedule ? 0 : toNumber(po.totalAmount);

  return Math.round(activeLines.reduce((sum, line) => {
    const sourceItem = itemByLineId.get(line.purchaseOrderLineId);
    const plannedQty = toNumber(line.plannedQty);
    const unitPrice = toNumber(line.deliveryUnitPrice ?? sourceItem?.unitPrice);
    return sum + plannedQty * unitPrice;
  }, 0));
};
