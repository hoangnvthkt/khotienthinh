import type {
  InventoryItem,
  MaterialBudgetItem,
  MaterialRequest,
  MaterialRequestFulfillmentSummary,
  ProjectWorkBoqItem,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderRequestLineLink,
  RequestItem,
} from '../types';
import {
  buildPoUnitSnapshot,
  getPoLineStockUnit,
  poLinePurchaseToStockQty,
  poLineStockToPurchaseQty,
  stockUnitPriceToPurchaseUnitPrice,
} from './materialUnitConversion';

export type PurchaseOrderRequestCartRow = {
  key: string;
  request: MaterialRequest;
  line: RequestItem;
  requestLineId: string;
  remainingQty: number;
};

type SupplierPatch = Pick<PurchaseOrderItem, 'vendorId' | 'vendorName'>;

const newId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getPurchaseOrderRequestCartKey = (requestId?: string | null, requestLineId?: string | null) =>
  requestId && requestLineId ? `${requestId}:${requestLineId}` : '';

export const filterRequestRowsForPoCart = <T extends PurchaseOrderRequestCartRow>(
  rows: T[],
  existingItems: PurchaseOrderItem[],
) => {
  const existingKeys = new Set(
    existingItems
      .map(item => getPurchaseOrderRequestCartKey(item.requestId, item.requestLineId))
      .filter(Boolean),
  );
  return rows.filter(row => !existingKeys.has(row.key));
};

export const hasRequestRowDefaultSupplierMismatch = (
  row: PurchaseOrderRequestCartRow,
  inventory: InventoryItem | undefined,
  currentVendorId?: string | null,
) => Boolean(currentVendorId && inventory?.supplierId && inventory.supplierId !== currentVendorId);

export const buildPurchaseOrderItemFromRequestCartRow = ({
  row,
  inventory,
  budget,
  work,
  supplierPatch,
  lineId = newId(),
}: {
  row: PurchaseOrderRequestCartRow;
  inventory?: InventoryItem;
  budget?: MaterialBudgetItem;
  work?: ProjectWorkBoqItem;
  supplierPatch: SupplierPatch;
  lineId?: string;
}): PurchaseOrderItem => {
  const unitSnapshot = inventory?.unit || row.line.unitSnapshot || budget?.unit || '';
  const unitPatch = buildPoUnitSnapshot(inventory);
  const purchaseUnitSnapshot = unitPatch.purchaseUnitSnapshot || inventory?.purchaseUnit || inventory?.unit || row.line.unitSnapshot || budget?.unit || '';
  const conversionLine = {
    itemId: row.line.itemId,
    lineId,
    sku: inventory?.sku || row.line.skuSnapshot || '',
    name: inventory?.name || row.line.itemNameSnapshot || row.line.materialBudgetItemName || '',
    unit: purchaseUnitSnapshot,
    qty: 0,
    unitPrice: 0,
    unitSnapshot,
    stockUnitSnapshot: unitSnapshot,
    purchaseUnitSnapshot,
    purchaseConversionFactor: toNumber(unitPatch.purchaseConversionFactor || inventory?.purchaseConversionFactor || 1) || 1,
  } as PurchaseOrderItem;

  const stockUnitPrice = toNumber(inventory?.priceIn || budget?.budgetUnitPrice || 0);

  return {
    ...conversionLine,
    ...supplierPatch,
    qty: poLineStockToPurchaseQty(conversionLine, row.remainingQty, inventory),
    unitPrice: stockUnitPriceToPurchaseUnitPrice(stockUnitPrice, inventory),
    receivedQty: 0,
    neededDate: row.line.neededDate || '',
    workBoqItemId: row.line.workBoqItemId || null,
    workBoqItemName: row.line.workBoqItemName || work?.name || null,
    materialBudgetItemId: row.line.materialBudgetItemId || null,
    materialBudgetItemName: row.line.materialBudgetItemName || budget?.itemName || null,
    requestId: row.request.id,
    requestCode: row.request.code,
    requestLineId: row.requestLineId,
    budgetQtySnapshot: row.line.budgetQtySnapshot,
    reservedBeforeQtySnapshot: row.line.reservedBeforeQtySnapshot,
    previousRequestedQtySnapshot: row.line.previousRequestedQtySnapshot,
    isOverBoq: row.line.isOverBoq,
    overQty: row.line.overQty,
    overPercent: row.line.overPercent,
    overReason: row.line.overReason || row.line.overBudgetReason,
    overBudgetQtySnapshot: row.line.overBudgetQtySnapshot,
    overBudgetPercentSnapshot: row.line.overBudgetPercentSnapshot,
    overBudgetReason: row.line.overBudgetReason,
    isManualItem: false,
    itemNameSnapshot: inventory?.name || row.line.itemNameSnapshot,
    unitSnapshot,
    stockUnitSnapshot: unitSnapshot,
    purchaseUnitSnapshot,
    purchaseConversionFactor: toNumber(unitPatch.purchaseConversionFactor || inventory?.purchaseConversionFactor || 1) || 1,
    specification: row.line.specification,
    manualReason: '',
    note: row.line.note || `Từ đề xuất ${row.request.code}`,
  };
};

export const appendRequestRowsToPoItems = ({
  existingItems,
  rows,
  inventoryItems,
  materialBudgetItems,
  workBoqItems = [],
  supplierPatch,
  lineIdFactory = newId,
}: {
  existingItems: PurchaseOrderItem[];
  rows: PurchaseOrderRequestCartRow[];
  inventoryItems: InventoryItem[];
  materialBudgetItems: MaterialBudgetItem[];
  workBoqItems?: ProjectWorkBoqItem[];
  supplierPatch: SupplierPatch;
  lineIdFactory?: () => string;
}) => {
  const inventoryById = new Map(inventoryItems.map(item => [item.id, item]));
  const budgetById = new Map(materialBudgetItems.map(item => [item.id, item]));
  const workById = new Map(workBoqItems.map(item => [item.id, item]));
  const availableRows = filterRequestRowsForPoCart(rows, existingItems);

  return [
    ...existingItems,
    ...availableRows.map(row => buildPurchaseOrderItemFromRequestCartRow({
      row,
      inventory: inventoryById.get(row.line.itemId),
      budget: row.line.materialBudgetItemId ? budgetById.get(row.line.materialBudgetItemId) : undefined,
      work: row.line.workBoqItemId ? workById.get(row.line.workBoqItemId) : undefined,
      supplierPatch,
      lineId: lineIdFactory(),
    })),
  ];
};

export const buildPurchaseOrderRequestLineLinks = ({
  po,
  items,
  requests,
  inventoryItems,
  projectId,
  scopedSiteId,
  targetWarehouseId,
  summariesByRequestId,
}: {
  po: PurchaseOrder;
  items: PurchaseOrderItem[];
  requests: MaterialRequest[];
  inventoryItems: InventoryItem[];
  projectId?: string | null;
  scopedSiteId?: string | null;
  targetWarehouseId?: string | null;
  summariesByRequestId: Record<string, MaterialRequestFulfillmentSummary | undefined>;
}): PurchaseOrderRequestLineLink[] => {
  return items
    .filter(item => item.requestId && item.requestLineId && item.lineId)
    .map(item => {
      const sourceRequest = requests.find(req => req.id === item.requestId);
      const sourceLine = sourceRequest?.items.find((line, index) => (line.lineId || `${sourceRequest.id}-${index}`) === item.requestLineId);
      const sourceSummaryLine = sourceRequest
        ? summariesByRequestId[sourceRequest.id]?.lineSummaries.find(summary => summary.requestLineId === item.requestLineId)
        : undefined;
      const inventory = inventoryItems.find(inv => inv.id === item.itemId);
      const orderedStockQty = poLinePurchaseToStockQty(item, toNumber(item.qty), inventory);
      return {
        projectId: projectId || null,
        constructionSiteId: sourceRequest?.constructionSiteId || scopedSiteId || null,
        sourceConstructionSiteId: sourceRequest?.constructionSiteId || scopedSiteId || null,
        targetWarehouseId: sourceRequest?.siteWarehouseId || targetWarehouseId || null,
        allocationStatus: 'open',
        purchaseOrderId: po.id,
        purchaseOrderLineId: item.lineId!,
        materialRequestId: item.requestId!,
        materialRequestCode: item.requestCode || null,
        requestLineId: item.requestLineId!,
        itemId: item.itemId,
        workBoqItemId: item.workBoqItemId || null,
        materialBudgetItemId: item.materialBudgetItemId || null,
        requestedQty: toNumber(sourceLine?.requestQty || orderedStockQty || 0),
        orderedQty: orderedStockQty,
        requestedQtySnapshot: toNumber(sourceLine?.requestQty || orderedStockQty || 0),
        orderedStockQtySnapshot: orderedStockQty,
        actualReceivedQtySnapshot: toNumber(sourceSummaryLine?.receivedQty || 0),
        unit: getPoLineStockUnit(item, inventory) || null,
        note: item.note || null,
      };
    });
};
