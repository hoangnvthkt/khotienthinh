import type {
  PurchaseMode,
  PurchaseOrder,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderItem,
} from '../types';
import { getPurchaseOrderScheduleLineUnitPrice } from './purchaseOrderSchedulePricing';
import { isPurchaseOrderFlowV3 } from './purchaseOrderFlow';

const EPSILON = 0.000001;

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const money = (value: number) => Math.round(toNumber(value));

const getLineKey = (item: PurchaseOrderItem) => item.lineId || item.itemId;

export const isIndependentMultipleDeliveryPo = (po: PurchaseOrder) =>
  isPurchaseOrderFlowV3(po);

const getRequestedQty = (item: PurchaseOrderItem) =>
  toNumber(item.requestedQtySnapshot ?? item.qty);

const getReleasedQty = (
  po: PurchaseOrder,
  line: PurchaseOrderDeliveryBatch['lines'][number],
) => isIndependentMultipleDeliveryPo(po)
  ? toNumber(line.stockPlannedQty ?? line.plannedQty)
  : toNumber(line.plannedQty);

const getActiveBatches = (batches: PurchaseOrderDeliveryBatch[] = []) =>
  batches.filter(batch => batch.status !== 'cancelled');

const getBatchAmount = (
  po: PurchaseOrder,
  batch: PurchaseOrderDeliveryBatch,
) => {
  const itemByLineId = new Map((po.items || []).map(item => [getLineKey(item), item]));
  return money((batch.lines || []).reduce((sum, line) => {
    const sourceItem = itemByLineId.get(line.purchaseOrderLineId);
    const unitPrice = getPurchaseOrderScheduleLineUnitPrice({ po, item: sourceItem, line });
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

export type PurchaseOrderVarianceSeverity = 'none' | 'warning';

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
        toNumber(releasedQtyByLine.get(line.purchaseOrderLineId)) + getReleasedQty(po, line),
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
      const orderedQty = isIndependentMultipleDeliveryPo(po) ? getRequestedQty(item) : toNumber(item.qty);
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

export const getMultipleDeliveryOverageReason = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
): string | null => {
  if (!isIndependentMultipleDeliveryPo(po)) return null;
  const releasedByLine = new Map<string, number>();
  const itemByLine = new Map((po.items || []).map(item => [getLineKey(item), item]));

  for (const batch of getActiveBatches(batches)) {
    for (const line of batch.lines || []) {
      const nextReleased = toNumber(releasedByLine.get(line.purchaseOrderLineId)) + getReleasedQty(po, line);
      releasedByLine.set(line.purchaseOrderLineId, nextReleased);
      const item = itemByLine.get(line.purchaseOrderLineId);
      if (!item || nextReleased <= getRequestedQty(item) + EPSILON) continue;
      if (String(batch.varianceReason || '').trim()) continue;
      return `${item.name || item.sku || item.itemId} vượt nhu cầu MR ${Math.abs(nextReleased - getRequestedQty(item)).toLocaleString('vi-VN')}; phải nhập lý do vượt nhu cầu.`;
    }
  }
  return null;
};

export const getPurchaseOrderScheduleQuantityBlockReason = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
  options: { allowOverRelease?: boolean } = {},
): string | null => {
  if (options.allowOverRelease) return null;
  const exceededLine = getPurchaseOrderReleaseSummary(po, batches).lineSummaries
    .find(line => line.remainingQty < -EPSILON);
  if (!exceededLine) return null;
  return `${exceededLine.itemName} vượt khối lượng PO tổng ${Math.abs(exceededLine.remainingQty).toLocaleString('vi-VN')}.`;
};

export const getVarianceSeverity = (variance: number): PurchaseOrderVarianceSeverity =>
  Math.abs(toNumber(variance)) > EPSILON ? 'warning' : 'none';

export const shouldUseSupplementalApprovalForRelease = (purchaseMode?: PurchaseMode | null) =>
  purchaseMode !== 'single' && purchaseMode !== 'multiple';

export const applyPurchaseOrderSupplementalState = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[] = [],
  options: { enableSupplementalApproval?: boolean } = {},
): { batches: PurchaseOrderDeliveryBatch[]; supplementalRequests: PurchaseOrderSupplementalDraft[] } => {
  if (options.enableSupplementalApproval === false) {
    return {
      batches: batches.map(batch => batch.status === 'supplemental_pending'
        ? { ...batch, status: 'planned' as const, supplementalApprovalId: null }
        : batch),
      supplementalRequests: [],
    };
  }

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
