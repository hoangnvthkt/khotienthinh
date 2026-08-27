import type { PurchaseOrder, PurchaseOrderDeliveryBatch, PurchaseOrderItem } from '../types';
import { calculateLineTotal } from './poSpecsUtils';
import { getPurchaseOrderScheduleLineUnitPrice } from './purchaseOrderSchedulePricing';

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const isPackageV2RequestPo = (po: PurchaseOrder) =>
  po.sourceMode === 'from_request'
  && po.purchaseMode === 'single'
  && toNumber(po.referenceGrossAmount) > 0;

const getPackageReferencePrintAmount = (po: PurchaseOrder) => {
  if (!isPackageV2RequestPo(po)) return null;
  const referenceGross = toNumber(po.referenceGrossAmount);
  const vatRate = toNumber(po.vatRate);
  const divisor = 1 + vatRate / 100;
  return Math.round(referenceGross / (divisor > 0 ? divisor : 1));
};

const alignLineAmountsToTarget = (
  lines: PurchaseOrderPrintLineAmount[],
  targetAmount: number,
): PurchaseOrderPrintLineAmount[] => {
  if (targetAmount <= 0 || lines.length === 0) return lines;
  const sourceAmount = lines.reduce((sum, line) => sum + toNumber(line.totalAmount), 0);
  if (sourceAmount <= 0) return lines;

  let allocated = 0;
  return lines.map((line, index) => {
    const totalAmount = index === lines.length - 1
      ? targetAmount - allocated
      : Math.round((line.totalAmount / sourceAmount) * targetAmount);
    allocated += totalAmount;
    const unitPrice = line.scheduledQty > 0
      ? Math.round((totalAmount / line.scheduledQty) * 100000) / 100000
      : 0;
    return { ...line, unitPrice, totalAmount };
  });
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
  if (getPackageReferencePrintAmount(po) != null) {
    const referenceLine = buildPurchaseOrderPrintLineAmounts(po, deliveryBatches)
      .find(line => line.lineKey === lineKey);
    if (referenceLine) {
      return {
        unitPrice: referenceLine.unitPrice,
        totalAmount: referenceLine.totalAmount,
        scheduledQty: referenceLine.scheduledQty,
      };
    }
  }

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
    const unitPrice = getPurchaseOrderScheduleLineUnitPrice({ po, item, line });
    return sum + plannedQty * unitPrice;
  }, 0));
  const unitPrice = scheduledQty > 0 ? Math.round((totalAmount / scheduledQty) * 100000) / 100000 : 0;

  return { unitPrice, totalAmount, scheduledQty };
};

export const getPurchaseOrderDisplayAmount = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): number => {
  const packageReferenceAmount = getPackageReferencePrintAmount(po);
  if (packageReferenceAmount != null) return packageReferenceAmount;

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
    const unitPrice = getPurchaseOrderScheduleLineUnitPrice({ po, item: sourceItem, line });
    return sum + plannedQty * unitPrice;
  }, 0));
};

export type PurchaseOrderPrintLineAmount = {
  item: PurchaseOrderItem;
  lineKey: string;
  scheduledQty: number;
  unitPrice: number;
  totalAmount: number;
};

export const buildPurchaseOrderPrintLineAmounts = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderPrintLineAmount[] => {
  const activeLines = deliveryBatches
    .filter(batch => batch.status !== 'cancelled')
    .flatMap(batch => batch.lines || [])
    .filter(line => toNumber(line.plannedQty) > 0);
  const hasActiveSchedule = activeLines.length > 0;

  const lines = (po.items || []).map(item => {
    const lineKey = item.lineId || item.itemId;
    if (!hasActiveSchedule) {
      return {
        item,
        lineKey,
        scheduledQty: toNumber(item.qty),
        unitPrice: toNumber(item.unitPrice),
        totalAmount: Math.round(calculateLineTotal(item)),
      };
    }

    const matchingLines = activeLines.filter(line => line.purchaseOrderLineId === lineKey);
    const scheduledQty = matchingLines.reduce((sum, line) => sum + toNumber(line.plannedQty), 0);
    const totalAmount = Math.round(matchingLines.reduce((sum, line) => {
      const plannedQty = toNumber(line.plannedQty);
      const unitPrice = getPurchaseOrderScheduleLineUnitPrice({ po, item, line });
      return sum + plannedQty * unitPrice;
    }, 0));
    const unitPrice = scheduledQty > 0 ? Math.round((totalAmount / scheduledQty) * 100000) / 100000 : 0;

    return {
      item,
      lineKey,
      scheduledQty,
      unitPrice,
      totalAmount,
    };
  });

  const packageReferenceAmount = getPackageReferencePrintAmount(po);
  return packageReferenceAmount == null
    ? lines
    : alignLineAmountsToTarget(lines, packageReferenceAmount);
};

export const getPurchaseOrderPrintAmount = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): number =>
  buildPurchaseOrderPrintLineAmounts(po, deliveryBatches)
    .reduce((sum, line) => sum + line.totalAmount, 0);

export type PurchaseOrderFinancialSummary = {
  netAmount: number;
  vatAmount: number;
  paymentTotal: number;
  vatBreakdown: Array<{ vatRate: number; amount: number }>;
};

const roundMoney = (value: number) => Math.round(toNumber(value) * 100) / 100;

/**
 * Multiple-delivery POs are commercialised by delivery batch, not by the
 * reference quantity/price kept on the PO lines. A batch owns one VAT rate,
 * so VAT must be calculated per batch before it is aggregated for the PO.
 */
export const getPurchaseOrderDeliveryFinancialSummary = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderFinancialSummary => {
  const itemByLineId = new Map((po.items || []).map(item => [item.lineId || item.itemId, item]));
  const vatByRate = new Map<number, number>();
  let netAmount = 0;
  let vatAmount = 0;

  deliveryBatches
    .filter(batch => batch.status !== 'cancelled')
    .forEach(batch => {
      const batchNetAmount = roundMoney((batch.lines || []).reduce((sum, line) => {
        const item = itemByLineId.get(line.purchaseOrderLineId);
        return sum + toNumber(line.plannedQty) * getPurchaseOrderScheduleLineUnitPrice({ po, item, line });
      }, 0));
      const vatRate = toNumber(batch.vatRate);
      const batchVatAmount = Math.round(batchNetAmount * vatRate / 100);

      netAmount += batchNetAmount;
      vatAmount += batchVatAmount;
      vatByRate.set(vatRate, (vatByRate.get(vatRate) || 0) + batchVatAmount);
    });

  return {
    netAmount: roundMoney(netAmount),
    vatAmount: roundMoney(vatAmount),
    paymentTotal: roundMoney(netAmount + vatAmount),
    vatBreakdown: [...vatByRate.entries()]
      .sort(([firstRate], [secondRate]) => firstRate - secondRate)
      .map(([vatRate, amount]) => ({ vatRate, amount: roundMoney(amount) })),
  };
};

export const getPurchaseOrderFinancialSummary = (
  po: PurchaseOrder,
  deliveryBatches: PurchaseOrderDeliveryBatch[] = [],
): PurchaseOrderFinancialSummary => {
  if (po.sourceMode === 'from_request' && po.purchaseMode === 'multiple') {
    return getPurchaseOrderDeliveryFinancialSummary(po, deliveryBatches);
  }

  const netAmount = getPurchaseOrderDisplayAmount(po, deliveryBatches);
  const vatRate = toNumber(po.vatRate);
  const vatAmount = Math.round(netAmount * vatRate / 100);
  return {
    netAmount,
    vatAmount,
    paymentTotal: roundMoney(netAmount + vatAmount),
    vatBreakdown: [{ vatRate, amount: vatAmount }],
  };
};
