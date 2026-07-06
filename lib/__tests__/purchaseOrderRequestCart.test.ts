import { describe, expect, it } from 'vitest';
import type { InventoryItem, MaterialBudgetItem, MaterialRequest, PurchaseOrder, PurchaseOrderItem } from '../../types';
import { RequestStatus } from '../../types';
import {
  appendRequestRowsToPoItems,
  buildPurchaseOrderItemFromRequestCartRow,
  buildPurchaseOrderRequestLineLinks,
  filterRequestRowsForPoCart,
  type PurchaseOrderRequestCartRow,
} from '../purchaseOrderRequestCart';

const inventory: InventoryItem = {
  id: 'item-1',
  sku: 'VT000111',
  name: 'Bien bao chu A',
  category: 'Vat tu',
  unit: 'Cai',
  purchaseUnit: 'Hop',
  purchaseConversionFactor: 2,
  priceIn: 1000,
  priceOut: 0,
  minStock: 0,
  supplierId: 'vendor-po',
  stockByWarehouse: {},
};

const budget: MaterialBudgetItem = {
  id: 'budget-1',
  category: 'Vat tu',
  itemName: 'Bien bao chu A',
  unit: 'Cai',
  budgetQty: 100,
  budgetUnitPrice: 1200,
  actualQty: 0,
  wasteThreshold: 0,
};

const request = (id: string, code: string): MaterialRequest => ({
  id,
  code,
  title: code,
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  requestOrigin: 'project',
  siteWarehouseId: 'warehouse-site',
  requesterId: 'user-1',
  status: RequestStatus.PENDING,
  createdDate: '2026-07-06',
  expectedDate: '2026-07-07',
  logs: [],
  items: [],
});

const cartRow = (materialRequestId: string, requestLineId: string): PurchaseOrderRequestCartRow => ({
  key: `${materialRequestId}:${requestLineId}`,
  request: request(materialRequestId, materialRequestId.toUpperCase()),
  requestLineId,
  remainingQty: 10,
  line: {
    lineId: requestLineId,
    itemId: inventory.id,
    requestQty: 10,
    approvedQty: 10,
    materialBudgetItemId: budget.id,
    materialBudgetItemName: budget.itemName,
    neededDate: '2026-07-08',
    note: 'Can bo sung',
    itemNameSnapshot: 'Bien bao chu A',
    unitSnapshot: 'Cai',
    skuSnapshot: 'VT000111',
  },
});

const existingPoItem: PurchaseOrderItem = {
  lineId: 'po-line-a',
  itemId: inventory.id,
  vendorId: 'vendor-po',
  vendorName: 'NCC PO',
  sku: inventory.sku,
  name: inventory.name,
  unit: inventory.purchaseUnit || inventory.unit,
  qty: 5,
  unitPrice: 2000,
  requestId: 'mr-a',
  requestCode: 'MR-A',
  requestLineId: 'line-a',
};

describe('purchaseOrderRequestCart', () => {
  it('filters request lines already present in the edited PO', () => {
    const rows = [cartRow('mr-a', 'line-a'), cartRow('mr-b', 'line-b')];

    const available = filterRequestRowsForPoCart(rows, [existingPoItem]);

    expect(available.map(row => row.key)).toEqual(['mr-b:line-b']);
  });

  it('converts a selected request line into a traceable PO item for the current PO supplier', () => {
    const item = buildPurchaseOrderItemFromRequestCartRow({
      row: cartRow('mr-b', 'line-b'),
      inventory,
      budget,
      supplierPatch: { vendorId: 'vendor-po', vendorName: 'NCC PO' },
      lineId: 'po-line-b',
    });

    expect(item).toMatchObject({
      lineId: 'po-line-b',
      itemId: inventory.id,
      vendorId: 'vendor-po',
      vendorName: 'NCC PO',
      requestId: 'mr-b',
      requestCode: 'MR-B',
      requestLineId: 'line-b',
      qty: 5,
      unitPrice: 2000,
      unit: 'Hop',
      stockUnitSnapshot: 'Cai',
      purchaseUnitSnapshot: 'Hop',
      materialBudgetItemId: 'budget-1',
      materialBudgetItemName: 'Bien bao chu A',
      note: 'Can bo sung',
    });
  });

  it('appends new request rows without mutating existing PO items', () => {
    const before = [existingPoItem];

    const next = appendRequestRowsToPoItems({
      existingItems: before,
      rows: [cartRow('mr-b', 'line-b')],
      inventoryItems: [inventory],
      materialBudgetItems: [budget],
      supplierPatch: { vendorId: 'vendor-po', vendorName: 'NCC PO' },
      lineIdFactory: () => 'po-line-b',
    });

    expect(before).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(existingPoItem);
    expect(next[1]).toMatchObject({ lineId: 'po-line-b', requestId: 'mr-b', requestLineId: 'line-b' });
  });

  it('builds request line links for both existing and newly appended PO items', () => {
    const po: PurchaseOrder = {
      id: 'po-1',
      vendorId: 'vendor-po',
      vendorName: 'NCC PO',
      poNumber: 'PO-102',
      items: [],
      totalAmount: 0,
      orderDate: '2026-07-06',
      status: 'draft',
      sourceMode: 'from_request',
      createdAt: '2026-07-06T00:00:00.000Z',
    };
    const appended = buildPurchaseOrderItemFromRequestCartRow({
      row: cartRow('mr-b', 'line-b'),
      inventory,
      budget,
      supplierPatch: { vendorId: 'vendor-po', vendorName: 'NCC PO' },
      lineId: 'po-line-b',
    });

    const links = buildPurchaseOrderRequestLineLinks({
      po,
      items: [existingPoItem, appended],
      requests: [request('mr-a', 'MR-A'), request('mr-b', 'MR-B')],
      inventoryItems: [inventory],
      projectId: 'project-1',
      scopedSiteId: 'site-1',
      targetWarehouseId: 'warehouse-site',
      summariesByRequestId: {},
    });

    expect(links.map(link => `${link.materialRequestId}:${link.requestLineId}:${link.purchaseOrderLineId}`)).toEqual([
      'mr-a:line-a:po-line-a',
      'mr-b:line-b:po-line-b',
    ]);
    expect(links.map(link => link.orderedQty)).toEqual([10, 10]);
  });
});
