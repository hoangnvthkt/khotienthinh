import type { InventoryItem, PurchaseOrder, PurchaseOrderRequestLineLink } from '../types';
import { poLineStockToPurchaseQty } from './materialUnitConversion';

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
