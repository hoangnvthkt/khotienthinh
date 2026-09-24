import { describe, expect, it } from 'vitest';
import { buildPurchaseBoqLineSnapshots, evaluatePurchaseBoqWarning, sumMaterialProposalQuantity, sumProjectMaterialBoq } from '../purchaseBoqWarning';

describe('new purchase proposal against project BOQ and site stock', () => {
  it('warns at 51 when project BOQ is 100 and verified on-hand stock is 50', () => {
    expect(evaluatePurchaseBoqWarning('50', '100', '50')).toEqual({ state: 'within_boq', excess: null });
    expect(evaluatePurchaseBoqWarning('51', '100', '50')).toEqual({ state: 'over_boq', excess: '1' });
  });

  it('does not turn an unknown BOQ or stock quantity into zero', () => {
    expect(evaluatePurchaseBoqWarning('51', null, '50')).toEqual({ state: 'unknown', excess: null });
    expect(evaluatePurchaseBoqWarning('51', '100', null)).toEqual({ state: 'unknown', excess: null });
  });

  it('counts every line for the same material in one proposal', () => {
    const proposal = sumMaterialProposalQuantity([
      { itemId: 'sand', qty: '30' }, { itemId: 'sand', qty: '21' }, { itemId: 'stone', qty: '8' },
    ], 'sand');
    expect(proposal).toBe('51');
    expect(evaluatePurchaseBoqWarning(proposal, '100', '50')).toEqual({ state: 'over_boq', excess: '1' });
  });

  it('stores only the incremental overage on the line that crosses the BOQ limit', () => {
    const snapshots = buildPurchaseBoqLineSnapshots([
      { lineId: 'one', itemId: 'sand', unit: 'tấn', qty: '30' },
      { lineId: 'two', itemId: 'sand', unit: 'tấn', qty: '21' },
    ], [{ inventoryItemId: 'sand', unit: 'tấn', budgetQty: 100, sourceType: 'g8_norm' }], { sand: '50' });
    expect(snapshots.get('one')).toEqual({ state: 'known', boqQuantity: 100, stockBefore: 50, overQuantity: 0, overPercent: 0 });
    expect(snapshots.get('two')).toEqual({ state: 'known', boqQuantity: 100, stockBefore: 80, overQuantity: 1, overPercent: 1 });
  });

  it('keeps stored BOQ overage unknown without verified stock', () => {
    const snapshots = buildPurchaseBoqLineSnapshots([
      { lineId: 'one', itemId: 'sand', unit: 'tấn', qty: '51' },
    ], [{ inventoryItemId: 'sand', unit: 'tấn', budgetQty: 100, sourceType: 'g8_norm' }], { sand: null });
    expect(snapshots.get('one')).toEqual({ state: 'unknown', boqQuantity: null, stockBefore: null, overQuantity: null, overPercent: null });
  });

  it('sums the material across work items and rejects mixed units or source types', () => {
    const rows = [
      { inventoryItemId: 'sand', unit: 'tấn', budgetQty: 60, sourceType: 'g8_norm' },
      { inventoryItemId: 'sand', unit: 'tấn', budgetQty: 40, sourceType: 'g8_norm' },
      { inventoryItemId: 'other', unit: 'tấn', budgetQty: 900, sourceType: 'g8_norm' },
    ];
    expect(sumProjectMaterialBoq(rows, 'sand', 'tấn')).toBe('100');
    expect(sumProjectMaterialBoq([...rows, { inventoryItemId: 'sand', unit: 'm3', budgetQty: 1, sourceType: 'g8_norm' }], 'sand', 'tấn')).toBeNull();
    expect(sumProjectMaterialBoq([...rows, { inventoryItemId: 'sand', unit: 'tấn', budgetQty: 1, sourceType: 'manual' }], 'sand', 'tấn')).toBeNull();
    expect(sumProjectMaterialBoq([...rows, { inventoryItemId: 'sand', unit: 'tấn', budgetQty: 0, sourceType: 'g8_norm' }], 'sand', 'tấn')).toBeNull();
    expect(sumProjectMaterialBoq(rows, 'missing', 'tấn')).toBeNull();
  });
});
