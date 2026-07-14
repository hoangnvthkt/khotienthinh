import type {
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderItem,
} from '../types';

const EPSILON = 0.000001;

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const money = (value: number) => Math.round(toNumber(value));

const getLineKey = (item: PurchaseOrderItem) => item.lineId || item.itemId;

const getActiveBatches = (batches: PurchaseOrderDeliveryBatch[] = []) =>
  batches.filter(batch => batch.status !== 'cancelled');

const getBatchAmount = (
  po: PurchaseOrder,
  batch: PurchaseOrderDeliveryBatch,
) => {
  const itemByLineId = new Map((po.items || []).map(item => [getLineKey(item), item]));
  return money((batch.lines || []).reduce((sum, line) => {
    const sourceItem = itemByLineId.get(line.purchaseOrderLineId);
    const unitPrice = toNumber(line.deliveryUnitPrice ?? sourceItem?.unitPrice);
    return sum + toNumber(line.plannedQty) * unitPrice;
  }, 0));
};

export type PurchaseOrderReleaseLineSummary = {
  lineKey: string;
  itemId: string;
  itemName: string;
  orderedQty: number;
  releasedQty: number;
  remainingQty: number;
};

export type PurchaseOrderReleaseSummary = {
  approvedTotalAmount: number;
  actualPlannedAmount: number;
  overAmount: number;
  lineSummaries: PurchaseOrderReleaseLineSummary[];
};

export type PurchaseOrderSupplementalDraft = {
  purchaseOrderId: string;
  deliveryBatchId: string;
  previousApprovedAmount: number;
  requestedTotalAmount: number;
  overAmount: number;
};

export const getPurchaseOrderApprovedTotalAmount = (po: PurchaseOrder) =>
  money(po.approvedTotalAmount ?? po.totalAmount ?? 0);

export const getPurchaseOrderReleaseSummary = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderReleaseSummary => {
  const activeBatches = getActiveBatches(batches);
  const releasedQtyByLine = new Map<string, number>();
  activeBatches.forEach(batch => {
    (batch.lines || []).forEach(line => {
      releasedQtyByLine.set(
        line.purchaseOrderLineId,
        toNumber(releasedQtyByLine.get(line.purchaseOrderLineId)) + toNumber(line.plannedQty),
      );
    });
  });

  const actualPlannedAmount = money(activeBatches.reduce((sum, batch) => (
    sum + getBatchAmount(po, batch)
  ), 0));
  const approvedTotalAmount = getPurchaseOrderApprovedTotalAmount(po);

  return {
    approvedTotalAmount,
    actualPlannedAmount,
    overAmount: Math.max(0, actualPlannedAmount - approvedTotalAmount),
    lineSummaries: (po.items || []).map(item => {
      const lineKey = getLineKey(item);
      const orderedQty = toNumber(item.qty);
      const releasedQty = toNumber(releasedQtyByLine.get(lineKey));
      return {
        lineKey,
        itemId: item.itemId,
        itemName: item.name || item.sku || item.itemId,
        orderedQty,
        releasedQty,
        remainingQty: orderedQty - releasedQty,
      };
    }),
  };
};

export const getPurchaseOrderScheduleQuantityBlockReason = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
): string | null => {
  const exceededLine = getPurchaseOrderReleaseSummary(po, batches).lineSummaries
    .find(line => line.remainingQty < -EPSILON);
  if (!exceededLine) return null;
  return `${exceededLine.itemName} vượt khối lượng PO tổng ${Math.abs(exceededLine.remainingQty).toLocaleString('vi-VN')}.`;
};

export const applyPurchaseOrderSupplementalState = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
): { batches: PurchaseOrderDeliveryBatch[]; supplementalRequests: PurchaseOrderSupplementalDraft[] } => {
  const approvedTotalAmount = getPurchaseOrderApprovedTotalAmount(po);
  let runningAmount = 0;
  const supplementalRequests: PurchaseOrderSupplementalDraft[] = [];

  const nextBatches = batches.map(batch => {
    if (batch.status === 'cancelled' || batch.status === 'wms_pending' || batch.status === 'received') {
      if (batch.status !== 'cancelled') runningAmount += getBatchAmount(po, batch);
      return batch;
    }

    runningAmount += getBatchAmount(po, batch);
    if (runningAmount > approvedTotalAmount) {
      supplementalRequests.push({
        purchaseOrderId: po.id,
        deliveryBatchId: batch.id,
        previousApprovedAmount: approvedTotalAmount,
        requestedTotalAmount: runningAmount,
        overAmount: runningAmount - approvedTotalAmount,
      });
      return { ...batch, status: 'supplemental_pending' as const };
    }

    return batch.status === 'supplemental_pending'
      ? { ...batch, status: 'planned' as const, supplementalApprovalId: null }
      : batch;
  });

  return { batches: nextBatches, supplementalRequests };
};
