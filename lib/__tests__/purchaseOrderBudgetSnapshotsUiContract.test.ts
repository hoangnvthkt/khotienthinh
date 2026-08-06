import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateSequentialPoBudgetSnapshots,
  getSequentialPoBudgetSnapshot,
} from '../purchaseOrderBudgetSnapshots';

const source = readFileSync(
  new URL('../../pages/project/SupplyChainTab.tsx', import.meta.url),
  'utf8',
);

const sourceSection = (start: string, end: string) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('purchase order BOQ snapshot UI contract', () => {
  it('keeps repeated same-item rows distinct when the preview and saved row read their line snapshots', () => {
    const snapshots = calculateSequentialPoBudgetSnapshots([
      { lineId: 'row-1', materialBudgetItemId: 'budget-1', stockQty: 60 },
      { lineId: 'row-2', materialBudgetItemId: 'budget-1', stockQty: 60 },
    ], new Map([
      ['budget-1', { budgetQty: 100, previousRequestedQty: 0, previousOrderedQty: 0 }],
    ]));

    const previewRow = getSequentialPoBudgetSnapshot(snapshots, 'row-2');
    const savedRow = getSequentialPoBudgetSnapshot(snapshots, 'row-2');

    expect(getSequentialPoBudgetSnapshot(snapshots, 'row-1')?.overBudgetQtySnapshot).toBe(0);
    expect(previewRow?.overBudgetQtySnapshot).toBe(20);
    expect(savedRow).toEqual(previewRow);
  });

  it('routes stable line IDs through both PO preview and save paths', () => {
    const snapshotBuilder = sourceSection('const poBudgetSnapshotsByLineId', 'const findInventoryForBudget');
    const buildSnapshot = sourceSection('const buildPoBudgetSnapshot', '// Vendor CRUD');
    const savePo = sourceSection('const handleSavePo', 'const updatePoStatus');
    const totalPreview = sourceSection('const poTotalCalc', 'const poReleaseSummaryPreview');
    const rowPreview = sourceSection('{pItems.map((item, i) => {', 'const overBudgetQty =');

    expect(source).toContain('const [pItems, setRawPItems]');
    expect(source).toContain('return ensurePurchaseOrderLineIds(next, () => crypto.randomUUID());');
    expect(snapshotBuilder).toContain('lineId: line.lineId,');
    expect(buildSnapshot).toContain('getSequentialPoBudgetSnapshot(poBudgetSnapshotsByLineId, line.lineId)');
    expect(savePo).toContain('} : buildPoBudgetSnapshot(i))');
    expect(totalPreview).toContain('buildPoBudgetSnapshot(item)');
    expect(rowPreview).toContain('buildPoBudgetSnapshot(normalizedLine)');
  });
});
