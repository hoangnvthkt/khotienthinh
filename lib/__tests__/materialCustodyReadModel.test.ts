import { describe, expect, it } from 'vitest';
import { deriveMaterialCustodyLine } from '../materialCustodyReadModel';

describe('deriveMaterialCustodyLine', () => {
  it('derives open custody without losing work and budget attribution', () => {
    expect(deriveMaterialCustodyLine({
      issued: '60',
      consumed: '40',
      returned: '10',
      lost: '0',
      workBoqItemId: 'work-a',
      materialBudgetItemId: 'budget-a',
    })).toEqual({
      custody: '10',
      allocationComplete: true,
      workBoqItemId: 'work-a',
      materialBudgetItemId: 'budget-a',
    });
  });

  it('keeps a legacy unallocated issue explicit', () => {
    expect(deriveMaterialCustodyLine({
      issued: '5', consumed: '0', returned: '0', lost: '0',
      workBoqItemId: null, materialBudgetItemId: null,
    })).toEqual(expect.objectContaining({ custody: '5', allocationComplete: false }));
  });
});
