import type { InventoryItem, PurchaseOrderItem } from '../types';

type UnitConversionSource = {
  unit?: string | null;
  purchaseUnit?: string | null;
  purchaseConversionFactor?: number | null;
};

const normalizeUnit = (value?: string | null) => String(value || '').trim().toLowerCase();

export const roundMaterialQuantity = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

export const getPurchaseConversionFactor = (source?: UnitConversionSource | null) => {
  const factor = Number(source?.purchaseConversionFactor ?? 1);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
};

export const getStockUnit = (item?: Pick<InventoryItem, 'unit'> | null) => item?.unit || '';

export const getPurchaseUnit = (item?: Pick<InventoryItem, 'unit' | 'purchaseUnit'> | null) =>
  item?.purchaseUnit || item?.unit || '';

export const hasPurchaseUnitConversion = (item?: UnitConversionSource | null) => {
  const purchaseUnit = normalizeUnit(item?.purchaseUnit);
  const stockUnit = normalizeUnit(item?.unit);
  return Boolean(purchaseUnit && stockUnit && purchaseUnit !== stockUnit);
};

export const purchaseToStockQty = (purchaseQty: number, item?: UnitConversionSource | null) => {
  const qty = Number(purchaseQty || 0);
  if (qty <= 0) return 0;
  return roundMaterialQuantity(hasPurchaseUnitConversion(item) ? qty * getPurchaseConversionFactor(item) : qty);
};

export const stockToPurchaseQty = (stockQty: number, item?: UnitConversionSource | null) => {
  const qty = Number(stockQty || 0);
  if (qty <= 0) return 0;
  return roundMaterialQuantity(hasPurchaseUnitConversion(item) ? qty / getPurchaseConversionFactor(item) : qty);
};

export const stockUnitPriceToPurchaseUnitPrice = (stockUnitPrice: number, item?: UnitConversionSource | null) => {
  const price = Number(stockUnitPrice || 0);
  if (price <= 0) return 0;
  return roundMaterialQuantity(hasPurchaseUnitConversion(item) ? price * getPurchaseConversionFactor(item) : price);
};

export const buildPoUnitSnapshot = (item?: InventoryItem | null): Partial<PurchaseOrderItem> => {
  if (!item) return { purchaseConversionFactor: 1 };
  return {
    unit: getPurchaseUnit(item),
    unitSnapshot: item.unit || '',
    stockUnitSnapshot: item.unit || '',
    purchaseUnitSnapshot: getPurchaseUnit(item),
    purchaseConversionFactor: getPurchaseConversionFactor(item),
  };
};

export const getPoLineStockUnit = (line: PurchaseOrderItem, item?: InventoryItem | null) =>
  line.stockUnitSnapshot || line.unitSnapshot || item?.unit || line.unit || '';

export const getPoLinePurchaseUnit = (line: PurchaseOrderItem, item?: InventoryItem | null) =>
  line.purchaseUnitSnapshot || line.unit || item?.purchaseUnit || item?.unit || '';

export const poLinePurchaseToStockQty = (line: PurchaseOrderItem, purchaseQty: number, item?: InventoryItem | null) => {
  const conversionSource = {
    unit: getPoLineStockUnit(line, item),
    purchaseUnit: getPoLinePurchaseUnit(line, item),
    purchaseConversionFactor: line.purchaseConversionFactor ?? item?.purchaseConversionFactor ?? 1,
  };
  return purchaseToStockQty(purchaseQty, conversionSource);
};

export const poLineStockToPurchaseQty = (line: PurchaseOrderItem, stockQty: number, item?: InventoryItem | null) => {
  const conversionSource = {
    unit: getPoLineStockUnit(line, item),
    purchaseUnit: getPoLinePurchaseUnit(line, item),
    purchaseConversionFactor: line.purchaseConversionFactor ?? item?.purchaseConversionFactor ?? 1,
  };
  return stockToPurchaseQty(stockQty, conversionSource);
};

export const getPoLineStockUnitPrice = (line: PurchaseOrderItem, item?: InventoryItem | null) => {
  const conversionSource = {
    unit: getPoLineStockUnit(line, item),
    purchaseUnit: getPoLinePurchaseUnit(line, item),
    purchaseConversionFactor: line.purchaseConversionFactor ?? item?.purchaseConversionFactor ?? 1,
  };
  const factor = hasPurchaseUnitConversion(conversionSource) ? getPurchaseConversionFactor(conversionSource) : 1;
  return roundMaterialQuantity(Number(line.unitPrice || 0) / factor);
};
