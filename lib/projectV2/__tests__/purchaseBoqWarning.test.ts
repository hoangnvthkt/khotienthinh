import { describe, expect, it } from 'vitest';
import { evaluatePurchaseBoqWarning, sumMaterialProposalQuantity, sumProjectMaterialBoq } from '../purchaseBoqWarning';

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
