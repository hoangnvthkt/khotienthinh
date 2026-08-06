import { describe, expect, it } from 'vitest';
import {
  calculateSequentialPoBudgetSnapshots,
  ensurePurchaseOrderLineIds,
} from '../purchaseOrderBudgetSnapshots';

describe('calculateSequentialPoBudgetSnapshots', () => {
  it('assigns a shared budget overage only to the later PO line that crosses the budget', () => {
    const snapshots = calculateSequentialPoBudgetSnapshots([
      { lineId: 'line-a', materialBudgetItemId: 'budget-1', stockQty: 60 },
      { lineId: 'line-b', materialBudgetItemId: 'budget-1', stockQty: 60 },
    ], new Map([
      ['budget-1', { budgetQty: 100, previousRequestedQty: 0, previousOrderedQty: 0 }],
    ]));

    expect(snapshots.get('line-a')).toEqual({
      reservedBeforeQtySnapshot: 0,
      overBudgetQtySnapshot: 0,
      overBudgetPercentSnapshot: 0,
    });
    expect(snapshots.get('line-b')).toEqual({
      reservedBeforeQtySnapshot: 60,
      overBudgetQtySnapshot: 20,
      overBudgetPercentSnapshot: 20,
    });
    expect([...snapshots.values()].reduce((total, snapshot) => total + snapshot.overBudgetQtySnapshot, 0)).toBe(20);
  });

  it('uses prior requested and ordered quantities as the shared budget baseline', () => {
    const snapshots = calculateSequentialPoBudgetSnapshots([
      { lineId: 'line-a', materialBudgetItemId: 'budget-1', stockQty: 5 },
      { lineId: 'line-b', materialBudgetItemId: 'budget-1', stockQty: 10 },
    ], new Map([
      ['budget-1', { budgetQty: 100, previousRequestedQty: 90, previousOrderedQty: 0 }],
    ]));

    expect(snapshots.get('line-a')).toEqual({
      reservedBeforeQtySnapshot: 90,
      overBudgetQtySnapshot: 0,
      overBudgetPercentSnapshot: 0,
    });
    expect(snapshots.get('line-b')).toEqual({
      reservedBeforeQtySnapshot: 95,
      overBudgetQtySnapshot: 5,
      overBudgetPercentSnapshot: 5,
    });
  });

  it('tracks unrelated material budgets independently', () => {
    const snapshots = calculateSequentialPoBudgetSnapshots([
      { lineId: 'line-a', materialBudgetItemId: 'budget-1', stockQty: 60 },
      { lineId: 'line-b', materialBudgetItemId: 'budget-2', stockQty: 15 },
      { lineId: 'line-c', materialBudgetItemId: 'budget-1', stockQty: 60 },
    ], new Map([
      ['budget-1', { budgetQty: 100, previousRequestedQty: 0, previousOrderedQty: 0 }],
      ['budget-2', { budgetQty: 10, previousRequestedQty: 0, previousOrderedQty: 0 }],
    ]));

    expect(snapshots.get('line-b')).toEqual({
      reservedBeforeQtySnapshot: 0,
      overBudgetQtySnapshot: 5,
      overBudgetPercentSnapshot: 50,
    });
    expect(snapshots.get('line-c')).toEqual({
      reservedBeforeQtySnapshot: 60,
      overBudgetQtySnapshot: 20,
      overBudgetPercentSnapshot: 20,
    });
  });

  it('keeps repeated item rows distinct through preview and save snapshot builds', () => {
    let generatedId = 0;
    const formRows = ensurePurchaseOrderLineIds([
      { lineId: null, itemId: 'same-item', materialBudgetItemId: 'budget-1', stockQty: 60 },
      { lineId: null, itemId: 'same-item', materialBudgetItemId: 'budget-1', stockQty: 60 },
    ], () => `generated-row-${++generatedId}`);
    const baselines = new Map([
      ['budget-1', { budgetQty: 100, previousRequestedQty: 0, previousOrderedQty: 0 }],
    ]);

    const previewSnapshots = calculateSequentialPoBudgetSnapshots(formRows, baselines);
    const savedSnapshots = calculateSequentialPoBudgetSnapshots(formRows, baselines);

    expect(formRows.map(row => row.lineId)).toEqual(['generated-row-1', 'generated-row-2']);
    expect(previewSnapshots.get('generated-row-1')?.overBudgetQtySnapshot).toBe(0);
    expect(previewSnapshots.get('generated-row-2')?.overBudgetQtySnapshot).toBe(20);
    expect(savedSnapshots).toEqual(previewSnapshots);
  });
});
