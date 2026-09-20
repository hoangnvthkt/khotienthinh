import { describe, expect, it } from 'vitest';
import { normalizeProjectMaterialRequestSnapshot } from '../procurement/sourceAdapters';

const approval = {
  kind: 'material_request_event' as const,
  requestId: 'mr-1',
  action: 'APPROVED',
  toStep: 'batch_planning',
  sourceRevision: '2',
  sourceHash: 'hash-2',
};

describe('project material request source adapter', () => {
  it('normalizes stable line identities and preserves zero approved quantity', () => {
    const snapshot = normalizeProjectMaterialRequestSnapshot({
      id: 'mr-1', code: 'MR-1', requestOrigin: 'project', status: 'APPROVED', workflowStep: 'batch_planning',
      projectId: 'project-1', constructionSiteId: 'site-1', contentRevision: 2, contentHash: 'hash-2',
      approvalEvidence: approval,
      lines: [
        { lineId: 'line-a', itemId: 'item-a', title: 'Thép', requestedQty: '0', unit: 'kg', workBoqItemId: 'work-1' },
        { lineId: 'line-b', itemId: 'item-b', title: 'Xi măng', requestedQty: '25', unit: 'bao', materialBudgetItemId: 'budget-1' },
      ],
    });

    expect(snapshot.ownerContext).toEqual({ logicalKey: 'company_default', resolution: 'server_registry_required' });
    expect(snapshot.lines).toEqual([
      expect.objectContaining({ sourceLineId: 'line-a', requestedQty: '0', approvedQty: '0', unit: 'kg' }),
      expect.objectContaining({ sourceLineId: 'line-b', requestedQty: '25', approvedQty: '25', unit: 'bao' }),
    ]);
  });

  it.each([
    [[{ lineId: '', itemId: 'item-a', requestedQty: '1', unit: 'kg' }], 'SOURCE_LINE_ID_REQUIRED'],
    [[{ lineId: 'same', itemId: 'item-a', requestedQty: '1', unit: 'kg' }, { lineId: 'same', itemId: 'item-b', requestedQty: '1', unit: 'kg' }], 'SOURCE_LINE_ID_DUPLICATE'],
    [[{ lineId: 'line-a', itemId: '', requestedQty: '1', unit: 'kg' }], 'SOURCE_LINE_ITEM_REQUIRED'],
    [[{ lineId: 'line-a', itemId: 'item-a', requestedQty: '1', unit: '' }], 'SOURCE_LINE_UNIT_REQUIRED'],
  ])('rejects invalid line identity input', (lines, error) => {
    expect(() => normalizeProjectMaterialRequestSnapshot({
      id: 'mr-1', code: 'MR-1', requestOrigin: 'project', status: 'APPROVED', workflowStep: 'batch_planning',
      projectId: 'project-1', constructionSiteId: null, contentRevision: 2, contentHash: 'hash-2',
      approvalEvidence: approval,
      lines,
    })).toThrow(error);
  });
});
