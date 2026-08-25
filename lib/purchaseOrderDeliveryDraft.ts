import type {
  InventoryItem,
  PurchaseOrderDeliveryBatch,
  PurchaseOrderDeliveryLine,
  PurchaseOrderItem,
  PurchaseMode,
  PurchaseOrderSourceMode,
} from '../types';
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

export const shouldAutoCreatePoDeliveryScheduleForForm = ({
  isEditing,
}: {
  isEditing: boolean;
  sourceMode?: PurchaseOrderSourceMode | null;
}) => !isEditing;

export const getDefaultPurchaseMode = (
  sourceMode?: PurchaseOrderSourceMode | null,
): PurchaseMode => sourceMode === 'from_request' ? 'single' : 'multiple';

export const shouldCreateBatchDuringDraftSave = (purchaseMode?: PurchaseMode | null) =>
  purchaseMode === 'single' || purchaseMode === 'multiple';

export const shouldAutoCreateBatchOnApproval = (purchaseMode?: PurchaseMode | null) =>
  purchaseMode === 'single';

export const shouldEditInlineRequestUnitPrice = ({
  sourceMode,
  isPurchasePackageV2Form,
}: {
  sourceMode?: PurchaseOrderSourceMode | null;
  purchaseMode?: PurchaseMode | null;
  isPurchasePackageV2Form: boolean;
}) => sourceMode === 'from_request'
  && isPurchasePackageV2Form;

export const getPoDeliveryDraftInitialLineValues = ({
  remainingQty,
  unitPrice,
  sourceMode,
}: {
  remainingQty: number;
  unitPrice: number;
  sourceMode?: PurchaseOrderSourceMode | null;
}) => {
  if (sourceMode === 'from_request') {
    return { issuedQty: '', deliveryUnitPrice: '' };
  }

  return {
    issuedQty: toNumber(remainingQty) > 0 ? String(toNumber(remainingQty)) : '',
    deliveryUnitPrice: toNumber(unitPrice) > 0 ? String(toNumber(unitPrice)) : '',
  };
};

export const getPoDeliveryScheduleLineInitialValues = ({
  remainingQty,
  unitPrice,
  sourceMode,
}: {
  remainingQty: number;
  unitPrice: number;
  sourceMode?: PurchaseOrderSourceMode | null;
}) => {
  if (sourceMode === 'from_request') {
    return { plannedQty: 0, deliveryUnitPrice: 0 };
  }

  return {
    plannedQty: toNumber(remainingQty),
    deliveryUnitPrice: toNumber(unitPrice),
  };
};

export const getPoDeliveryScheduleUnitPriceForSave = ({
  item,
  sourceMode,
  purchaseMode,
  existingDeliveryUnitPrice,
}: {
  item: PurchaseOrderItem;
  sourceMode?: PurchaseOrderSourceMode | null;
  purchaseMode?: PurchaseMode | null;
  existingDeliveryUnitPrice?: number | null;
}) => {
  if (sourceMode === 'from_request' && purchaseMode === 'single') {
    return toNumber(item.unitPrice);
  }

  // A multiple-delivery MR PO has no commercial price on its parent line.
  // Preserve the price entered on the delivery itself.
  if (sourceMode === 'from_request' && purchaseMode === 'multiple') {
    return toNumber(existingDeliveryUnitPrice);
  }

  return toNumber(existingDeliveryUnitPrice ?? item.unitPrice);
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
  options: {
    emptyScheduleBehavior?: 'keep_items' | 'zero_qty_and_price';
    unmatchedLineBehavior?: 'keep_items' | 'zero_qty_and_price';
  } = {},
): PurchaseOrderItem[] => {
  const activeBatches = batches.filter(batch => batch.status !== 'cancelled');
  if (activeBatches.length === 0) {
    return items.map(item => ({
      ...item,
      qty: options.emptyScheduleBehavior === 'zero_qty_and_price' ? 0 : toNumber(item.qty),
      unitPrice: options.emptyScheduleBehavior === 'zero_qty_and_price' ? 0 : toNumber(item.unitPrice),
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
        qty: options.unmatchedLineBehavior === 'zero_qty_and_price' ? 0 : toNumber(item.qty),
        unitPrice: options.unmatchedLineBehavior === 'zero_qty_and_price' ? 0 : toNumber(item.unitPrice),
      };
    }

    const scheduledQty = matchingLines.reduce((sum, line) => sum + Math.max(0, toNumber(line.plannedQty)), 0);
    if (scheduledQty <= 0 && options.unmatchedLineBehavior === 'zero_qty_and_price') {
      return {
        ...item,
        qty: 0,
        unitPrice: 0,
      };
    }

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
  options: {
    emptyScheduleBehavior?: 'keep_items' | 'zero_price';
    unmatchedLineBehavior?: 'keep_price' | 'zero_price';
  } = {},
): PurchaseOrderItem[] => {
  const activeBatches = batches.filter(batch => batch.status !== 'cancelled');
  if (activeBatches.length === 0) {
    return items.map(item => ({
      ...item,
      qty: toNumber(item.qty),
      unitPrice: options.emptyScheduleBehavior === 'zero_price' ? 0 : toNumber(item.unitPrice),
    }));
  }

  return items.map(item => {
    const lineKey = item.lineId || item.itemId;
    const matchingLines = activeBatches.flatMap(batch =>
      (batch.lines || []).filter(line => line.purchaseOrderLineId === lineKey),
    );
    const scheduledQty = matchingLines.reduce((sum, line) => sum + Math.max(0, toNumber(line.plannedQty)), 0);
    if (matchingLines.length === 0 || scheduledQty <= 0) {
      return {
        ...item,
        qty: toNumber(item.qty),
        unitPrice: options.unmatchedLineBehavior === 'zero_price' ? 0 : toNumber(item.unitPrice),
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

export const resolvePurchaseOrderItemsForScheduledPricing = ({
  items,
  sourceMode,
}: {
  items: PurchaseOrderItem[];
  batches?: PurchaseOrderDeliveryBatch[];
  sourceMode?: PurchaseOrderSourceMode | null;
}): PurchaseOrderItem[] => {
  if (sourceMode !== 'from_request') return items;

  return items;
};
