import { describe, expect, it } from 'vitest';
import { normalizeMaterialPlanSnapshot } from '../procurement/materialPlanSourceAdapter';

const approved = {
  id: 'plan-1', code: 'VT-01', revision: 2, sourceHash: 'a'.repeat(64),
  status: 'approved' as const, projectId: 'project-1', constructionSiteId: 'site-1',
  lines: [{ id: 'line-1', itemId: 'item-1', title: 'Xi măng', quantity: '105.000000',
    unit: 'kg', workBoqItemId: 'work-1', materialBudgetItemId: 'budget-1',
    neededDate: '2026-10-08', destinationId: 'site-1', calculatedQuantity: '105.000000' }],
};

describe('Project V2 material plan procurement adapter', () => {
  it('normalizes approved plan quantities and exact line identity', () => {
    const snapshot = normalizeMaterialPlanSnapshot(approved);
    expect(snapshot.adapter).toBe('material_plan');
    expect(snapshot.sourceDocumentId).toBe('plan-1');
    expect(snapshot.sourceRevision).toBe('2');
    expect(snapshot.lines[0].approvedQty).toBe('105.000000');
    expect(snapshot.lines[0].sourceLineId).toBe(approved.lines[0].id);
    expect(snapshot.intakeState).toBe('ready');
  });

  it('rejects missing identity, duplicate source lines and unknown approved quantity', () => {
    expect(() => normalizeMaterialPlanSnapshot({ ...approved, lines: [approved.lines[0], approved.lines[0]] }))
      .toThrow('SOURCE_LINE_ID_DUPLICATE');
    expect(() => normalizeMaterialPlanSnapshot({ ...approved, lines: [{ ...approved.lines[0], itemId: '' }] }))
      .toThrow('SOURCE_LINE_ITEM_REQUIRED');
    expect(() => normalizeMaterialPlanSnapshot({ ...approved, lines: [{ ...approved.lines[0], quantity: null }] }))
      .toThrow('SOURCE_LINE_APPROVED_QTY_REQUIRED');
  });

  it('does not infer business approval from an automated status', () => {
    expect(() => normalizeMaterialPlanSnapshot({ ...approved, status: 'pending_approval' as 'approved' }))
      .toThrow('SOURCE_APPROVAL_REQUIRED');
  });
});
