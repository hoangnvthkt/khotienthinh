import type { PurchaseOrder, PurchaseOrderItem } from '../types';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  hasPurchaseUnitConversion,
  poLinePurchaseToStockQty,
} from './materialUnitConversion';
import { getPurchaseOrderScheduleLineUnitPrice } from './purchaseOrderSchedulePricing';

export type PurchaseOrderDeliveryPrintLineLike = {
  poLineId?: string | null;
  itemId?: string | null;
  issuedQty?: number | string | null;
  deliveryUnitPrice?: number | string | null;
  deliveryUnit?: string | null;
  unit?: string | null;
  stockPlannedQty?: number | string | null;
};

export type PurchaseOrderDeliveryPrintGroupLike = {
  label?: string | number | null;
  plannedDate?: string | null;
  lines: PurchaseOrderDeliveryPrintLineLike[];
};

export type PurchaseOrderApprovalDeliveryBatch = {
  deliveryNo?: string | number | null;
  plannedDeliveryDate?: string | null;
  lines: Array<{
    purchaseOrderLineId: string;
    plannedQty: number;
    stockPlannedQty?: number | null;
    unitPrice?: number | null;
  }>;
};

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLineKey = (item: PurchaseOrderItem) => item.lineId || item.itemId;

const getItemByLineId = (po: PurchaseOrder) => {
  const map = new Map<string, PurchaseOrderItem>();
  (po.items || []).forEach(item => {
    map.set(getLineKey(item), item);
    if (item.itemId) map.set(item.itemId, item);
  });
  return map;
};

const getPrintLineKey = (line: PurchaseOrderDeliveryPrintLineLike) =>
  line.poLineId || line.itemId || '';

export const getPurchaseOrderApprovalPrintQuantities = (
  item: PurchaseOrderItem,
  plannedQty: number,
  stockPlannedQty?: number | null,
) => {
  const stockUnit = getPoLineStockUnit(item);
  const purchaseUnit = getPoLinePurchaseUnit(item);
  const hasConversion = hasPurchaseUnitConversion({
    unit: stockUnit,
    purchaseUnit,
    purchaseConversionFactor: item.purchaseConversionFactor ?? 1,
  });
  const enteredStockQty = Number(stockPlannedQty);
  const stockQty = stockPlannedQty != null && Number.isFinite(enteredStockQty)
    ? enteredStockQty
    : poLinePurchaseToStockQty(item, plannedQty);
  return {
    stockUnit: hasConversion ? stockUnit : purchaseUnit,
    stockQty: hasConversion ? stockQty : plannedQty,
    purchaseUnit: hasConversion ? purchaseUnit : '—',
    purchaseQty: hasConversion ? plannedQty : null,
    hasConversion,
  };
};

export const getPurchaseOrderDeliveryPrintLineUnitPrice = (
  po: PurchaseOrder,
  line: PurchaseOrderDeliveryPrintLineLike,
) => {
  const item = getItemByLineId(po).get(getPrintLineKey(line));
  return getPurchaseOrderScheduleLineUnitPrice({
    po,
    item,
    deliveryUnitPrice: numberValue(line.deliveryUnitPrice),
  });
};

export const buildPurchaseOrderApprovalDeliveryBatches = (
  po: PurchaseOrder,
  groups: PurchaseOrderDeliveryPrintGroupLike[],
): PurchaseOrderApprovalDeliveryBatch[] => groups
  .map((group, index) => ({
    deliveryNo: group.label || index + 1,
    plannedDeliveryDate: group.plannedDate || null,
    lines: group.lines.map(line => ({
      purchaseOrderLineId: getPrintLineKey(line),
      plannedQty: numberValue(line.issuedQty),
      ...(line.stockPlannedQty == null ? {} : { stockPlannedQty: numberValue(line.stockPlannedQty) }),
      unitPrice: getPurchaseOrderDeliveryPrintLineUnitPrice(po, line),
    })).filter(line => line.purchaseOrderLineId && line.plannedQty > 0),
  }))
  .filter(batch => batch.lines.length > 0);

export const getPurchaseOrderDeliveryPrintGroupSummary = (
  po: PurchaseOrder,
  group: PurchaseOrderDeliveryPrintGroupLike,
) => {
  const totalQty = group.lines.reduce((sum, line) => sum + numberValue(line.issuedQty), 0);
  const totalAmount = group.lines.reduce((sum, line) => (
    sum + numberValue(line.issuedQty) * getPurchaseOrderDeliveryPrintLineUnitPrice(po, line)
  ), 0);
  const units = Array.from(new Set(group.lines.map(line => line.deliveryUnit || line.unit).filter(Boolean)));
  const prices = Array.from(
    new Set(
      group.lines
        .map(line => getPurchaseOrderDeliveryPrintLineUnitPrice(po, line))
        .filter(price => Number.isFinite(price)),
    ),
  );

  return {
    totalQty,
    totalAmount,
    unitLabel: units.length === 1 ? units[0] : units.length > 1 ? 'nhiều ĐVT' : '',
    unitPriceLabel: prices.length === 1 ? `${prices[0].toLocaleString('vi-VN')} đ` : prices.length > 1 ? 'Nhiều đơn giá' : '0 đ',
  };
};
