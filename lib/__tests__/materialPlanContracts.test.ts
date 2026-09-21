import { describe, expect, it } from 'vitest';
import { buildMaterialPlanDraft } from '../materialPlanning/materialPlanService';

const preview = {
  sourceLineCount: 2,
  groups: [{
    key: 'item-1:kg', itemId: 'item-1', sku: 'STEEL', itemName: 'Thép', unit: 'kg', totalQty: '15',
    allocations: [
      { sourceBudgetLineId: 'budget-1', sourceWorkBoqItemId: 'work-1', sourceTaskId: 'task-1', quantity: '10', neededDate: '2026-10-01', destination: 'Kho A' },
      { sourceBudgetLineId: 'budget-2', sourceWorkBoqItemId: 'work-2', sourceTaskId: 'task-2', quantity: '5', neededDate: '2026-10-02', destination: 'Kho A' },
    ],
  }],
};

describe('material plan contracts', () => {
  it('keeps grouped quantity and exact BOQ allocations with stable identities', () => {
    let index = 0;
    const result = buildMaterialPlanDraft({
      preview,
      identity: () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`,
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ itemId: 'item-1', unit: 'kg', quantity: '15' });
    expect(result.lines[0].allocations.map(item => ({ budget: item.sourceBudgetLineId, quantity: item.quantity })))
      .toEqual([{ budget: 'budget-1', quantity: '10' }, { budget: 'budget-2', quantity: '5' }]);
    expect(new Set([
      result.lines[0].id,
      ...result.lines[0].allocations.map(item => item.id),
    ]).size).toBe(3);
  });

  it('rejects a preview whose grouped total does not equal its allocations', () => {
    expect(() => buildMaterialPlanDraft({
      preview: { ...preview, groups: [{ ...preview.groups[0], totalQty: '16' }] },
      identity: () => crypto.randomUUID(),
    })).toThrow('MATERIAL_PLAN_LINE_TOTAL_MISMATCH');
  });

  it('does not merge the same item across different units', () => {
    expect(() => buildMaterialPlanDraft({
      preview: {
        sourceLineCount: 2,
        groups: [{ ...preview.groups[0], totalQty: '15', unit: 'bao' }],
      },
      identity: () => crypto.randomUUID(),
    })).toThrow('MATERIAL_PLAN_ALLOCATION_UNIT_MISMATCH');
  });
});
