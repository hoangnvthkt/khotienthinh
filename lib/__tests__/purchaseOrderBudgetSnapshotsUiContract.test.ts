import { describe, expect, it } from 'vitest';
import type { MaterialBudgetItem, PurchaseOrderItem } from '../../types';
import {
  calculateSequentialPoBudgetSnapshots,
  createPurchaseOrderBudgetSnapshotBuilder,
  ensurePurchaseOrderLineIds,
} from '../purchaseOrderBudgetSnapshots';

const poLine = (lineId: string): PurchaseOrderItem => ({
  lineId,
  itemId: 'same-item',
  materialBudgetItemId: 'budget-1',
  sku: 'SAME-SKU',
  name: 'Repeated material',
  unit: 'kg',
  qty: 60,
  unitPrice: 0,
});

describe('purchase order BOQ snapshot save and preview integration', () => {
  it('keeps repeated form rows stable and applies their distinct snapshots in preview and save', () => {
    let generatedId = 0;
    const initializedRows = ensurePurchaseOrderLineIds([
      { lineId: null },
      { lineId: null },
    ], () => `stable-row-${++generatedId}`);
    const formRows = ensurePurchaseOrderLineIds(
      initializedRows,
      () => `unexpected-row-${++generatedId}`,
    );
    const lines = formRows.map(row => poLine(row.lineId));
    const snapshotsByLineId = calculateSequentialPoBudgetSnapshots(
      lines.map(line => ({
        lineId: line.lineId,
        materialBudgetItemId: line.materialBudgetItemId,
        stockQty: line.qty,
      })),
      new Map([
        ['budget-1', { budgetQty: 100, previousRequestedQty: 0, previousOrderedQty: 0 }],
      ]),
    );
    const buildPoBudgetSnapshot = createPurchaseOrderBudgetSnapshotBuilder({
      materialBudgetMap: new Map([
        ['budget-1', { id: 'budget-1', budgetQty: 100, itemName: 'Repeated material' } as MaterialBudgetItem],
      ]),
      workBoqMap: new Map(),
      previousRequestedQtyByBudget: new Map(),
      previousOrderedQtyByBudget: new Map(),
      snapshotsByLineId,
    });

    const previewItems = lines.map(buildPoBudgetSnapshot);
    const savedItems = lines.map(buildPoBudgetSnapshot);

    expect(formRows.map(row => row.lineId)).toEqual(['stable-row-1', 'stable-row-2']);
    expect(generatedId).toBe(2);
    expect(previewItems.map(item => item.reservedBeforeQtySnapshot)).toEqual([0, 60]);
    expect(previewItems.map(item => item.overBudgetQtySnapshot)).toEqual([0, 20]);
    expect(savedItems).toEqual(previewItems);
  });
});
