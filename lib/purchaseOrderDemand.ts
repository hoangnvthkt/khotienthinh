import type { InventoryItem, PurchaseOrder, PurchaseOrderRequestLineLink } from '../types';
import { poLineStockToPurchaseQty } from './materialUnitConversion';
import { isPurchaseOrderFlowV3 } from './purchaseOrderFlow';

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getPurchaseOrderLineDemandQty = (
  po: PurchaseOrder,
  lineKey: string,
  links: PurchaseOrderRequestLineLink[] = [],
  inventoryItems: InventoryItem[] = [],
): number => {
  const line = po.items.find(item => (item.lineId || item.itemId) === lineKey);
  if (!line) return 0;

  // Multiple-delivery MR POs keep their parent line in the MR unit.  The
  // commercial unit belongs only to a delivery batch and must never be used to
  // inflate the demand/progress shown to the site.
  if (isPurchaseOrderFlowV3(po)) {
    return toNumber(line.requestedQtySnapshot);
  }

  const inventory = inventoryItems.find(item => item.id === line.itemId);
  const linkedDemandQty = links
    .filter(link => link.purchaseOrderId === po.id && link.purchaseOrderLineId === lineKey)
    .reduce((sum, link) => {
      const requestedStockQty = toNumber(link.requestedQtySnapshot ?? link.requestedQty);
      return sum + poLineStockToPurchaseQty(line, requestedStockQty, inventory);
    }, 0);

  return Math.max(toNumber(line.qty), linkedDemandQty);
};

export const getPurchaseOrderDemandStats = (
  po: PurchaseOrder,
  links: PurchaseOrderRequestLineLink[] = [],
  inventoryItems: InventoryItem[] = [],
) => {
  const orderedQty = po.items.reduce((sum, item) => (
    sum + getPurchaseOrderLineDemandQty(po, item.lineId || item.itemId, links, inventoryItems)
  ), 0);
  const receivedQty = po.items.reduce((sum, item) => sum + toNumber(item.receivedQty), 0);

  return {
    orderedQty,
    receivedQty,
    remainingQty: Math.max(0, orderedQty - receivedQty),
  };
};
