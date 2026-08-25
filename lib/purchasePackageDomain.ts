import type { PurchaseMode, PurchaseOrder, PurchaseOrderDeliveryBatch } from '../types';
import { getPurchaseOrderScheduleLineUnitPrice } from './purchaseOrderSchedulePricing';
import { isPurchaseOrderFlowV3 } from './purchaseOrderFlow';

export type { PurchaseMode };

export type PurchasePackageUiStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'waiting_delivery'
  | 'partially_received'
  | 'fulfilled'
  | 'over_received'
  | 'closed_short'
  | 'cancelled';

export type PurchaseDeliveryUiStatus =
  | 'waiting_delivery'
  | 'receiving'
  | 'quality_approved'
  | 'received'
  | 'received_short'
  | 'received_over'
  | 'cancelled';

export interface PurchasePackageSummary {
  referenceQty: number;
  releasedQty: number;
  acceptedQty: number;
  returnedQty: number;
  receivedNetQty: number;
  releasedVarianceQty: number;
  needVarianceQty: number;
  remainingNeedQty: number;
  referenceGross: number;
  releasedGross: number;
  receivedGross: number;
  releasedGrossVariance: number;
  uiStatus: PurchasePackageUiStatus;
}

const numberValue = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const gross = (qty: number, price: number, vatRate: number) =>
  Math.round(qty * price * (1 + vatRate / 100) * 100) / 100;

const activeBatch = (batch: PurchaseOrderDeliveryBatch) =>
  batch.status !== 'cancelled';

const isIndependentMultipleDelivery = (po: PurchaseOrder) =>
  isPurchaseOrderFlowV3(po);

const hasReferencePackageAmount = (po: PurchaseOrder, referenceQty: number) =>
  po.sourceMode === 'from_request'
  && (po.purchaseMode === 'single' || po.purchaseMode === 'multiple')
  && referenceQty > 0
  && numberValue(po.referenceGrossAmount) > 0;

const allocatedReferenceGross = (
  po: PurchaseOrder,
  referenceQty: number,
  qty: number,
) => {
  if (!hasReferencePackageAmount(po, referenceQty)) return null;
  return Math.round((numberValue(po.referenceGrossAmount) * Math.max(0, qty) / referenceQty) * 100) / 100;
};

const derivePurchasePackageUiStatus = (
  po: PurchaseOrder,
  context: {
    referenceQty: number;
    receivedNetQty: number;
    closedNeedQty: number;
    hasActiveDelivery: boolean;
  },
): PurchasePackageUiStatus => {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'draft') return 'draft';
  if (po.status === 'sent') return 'pending_approval';
  if (context.closedNeedQty > 0 || po.status === 'closed') return 'closed_short';
  if (context.receivedNetQty > context.referenceQty) return 'over_received';
  if (context.referenceQty > 0 && context.receivedNetQty >= context.referenceQty) return 'fulfilled';
  if (context.receivedNetQty > 0) return 'partially_received';
  if (po.status === 'confirmed' && !context.hasActiveDelivery) return 'approved';
  if (context.hasActiveDelivery || po.status === 'in_transit' || po.status === 'partial') return 'waiting_delivery';
  if (po.status === 'delivered') return 'fulfilled';
  return 'approved';
};

export const getPurchasePackageSummary = (
  po: PurchaseOrder,
  batches: PurchaseOrderDeliveryBatch[],
): PurchasePackageSummary => {
  const active = batches.filter(activeBatch);
  const activeLines = active.flatMap(batch => batch.lines || []);
  const itemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
  const usesMrUnit = isIndependentMultipleDelivery(po);
  const referenceQty = po.items.reduce((sum, line) => sum + numberValue(usesMrUnit ? line.requestedQtySnapshot : line.qty), 0);
  const releasedQty = activeLines.reduce((sum, line) => sum + numberValue(usesMrUnit ? line.stockPlannedQty : line.plannedQty), 0);
  const acceptedQty = activeLines.reduce((sum, line) => sum + numberValue(usesMrUnit ? line.acceptedStockQty ?? line.acceptedQty : line.acceptedQty), 0);
  const returnedQty = activeLines.reduce((sum, line) => sum + numberValue(line.returnedQty), 0);
  const receivedNetQty = Math.max(0, acceptedQty - returnedQty);
  const closedNeedQty = numberValue(po.closedNeedQty);
  const referenceGross = usesMrUnit ? 0 : numberValue(po.referenceGrossAmount)
    || po.items.reduce(
      (sum, line) => sum + gross(numberValue(line.qty), numberValue(line.unitPrice), numberValue(po.vatRate)),
      0,
    );
  const scheduleReleasedGross = active.reduce(
    (sum, batch) => sum + (batch.lines || []).reduce(
      (batchSum, line) => batchSum + gross(
        numberValue(line.plannedQty),
        getPurchaseOrderScheduleLineUnitPrice({ po, item: itemByLineId.get(line.purchaseOrderLineId), line }),
        numberValue(batch.vatRate),
      ),
      0,
    ),
    0,
  );
  const scheduleReceivedGross = active.reduce(
    (sum, batch) => sum + (batch.lines || []).reduce(
      (batchSum, line) => batchSum + gross(
        numberValue(line.acceptedQty) - numberValue(line.returnedQty),
        getPurchaseOrderScheduleLineUnitPrice({ po, item: itemByLineId.get(line.purchaseOrderLineId), line }),
        numberValue(batch.vatRate),
      ),
      0,
    ),
    0,
  );
  const referenceReleasedGross = usesMrUnit ? null : allocatedReferenceGross(po, referenceQty, releasedQty);
  const referenceReceivedGross = usesMrUnit ? null : allocatedReferenceGross(po, referenceQty, receivedNetQty);
  const releasedGross = referenceReleasedGross == null
    ? scheduleReleasedGross
    : Math.max(scheduleReleasedGross, referenceReleasedGross);
  const receivedGross = referenceReceivedGross == null
    ? scheduleReceivedGross
    : Math.max(scheduleReceivedGross, referenceReceivedGross);

  return {
    referenceQty,
    releasedQty,
    acceptedQty,
    returnedQty,
    receivedNetQty,
    releasedVarianceQty: releasedQty - referenceQty,
    needVarianceQty: receivedNetQty - referenceQty,
    remainingNeedQty: Math.max(0, referenceQty - receivedNetQty - closedNeedQty),
    referenceGross,
    releasedGross,
    receivedGross,
    releasedGrossVariance: releasedGross - referenceGross,
    uiStatus: derivePurchasePackageUiStatus(po, {
      referenceQty,
      receivedNetQty,
      closedNeedQty,
      hasActiveDelivery: active.length > 0,
    }),
  };
};
