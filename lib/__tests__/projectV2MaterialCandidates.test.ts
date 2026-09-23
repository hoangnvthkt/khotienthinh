import { describe, expect, it } from 'vitest';
import { groupMaterialCandidates, validateMaterialSelection,
  type MaterialCandidate } from '../projectV2/materialCandidateService';

const candidate = (overrides: Partial<MaterialCandidate> = {}): MaterialCandidate => ({
  candidateId: 'resource-a:work-1', itemId: 'item-a', itemCode: 'VT-01', itemName: 'Xi măng',
  unit: 'kg', calculatedQty: '10.000000', alreadyPlannedQty: '0.000000',
  availableQty: '10.000000', diagnostics: [], selectable: true,
  sourcePlanId: 'construction-a', sourceRevision: 1, sourcePlanHash: 'hash-a',
  sourceLineId: 'work-1', sourceWorkName: 'Đào móng', sourceWorkQuantity: '2.000000',
  sourceUnit: 'm3', normResourceId: 'resource-a', normRevision: 'rev-1',
  normFactor: '5.000000', coefficient: '1.000000',
  conversionNumerator: '1.000000', conversionDenominator: '1.000000',
  workspaceId: 'workspace-a', ...overrides,
});

describe('Project V2 material candidates', () => {
  it('keeps multiple material resources for one work line', () => {
    const groups = groupMaterialCandidates([candidate(), candidate({ candidateId: 'resource-b:work-1',
      normResourceId: 'resource-b', itemId: 'item-b', itemCode: 'VT-02', itemName: 'Cát' })]);
    expect(groups).toHaveLength(2);
  });

  it('groups the same material across work lines but keeps exact derivations', () => {
    const groups = groupMaterialCandidates([candidate(), candidate({ candidateId: 'resource-a:work-2',
      sourceLineId: 'work-2', calculatedQty: '6.000000', availableQty: '6.000000' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].calculatedQty).toBe('16.000000');
    expect(groups[0].derivations.map(row => row.sourceLineId)).toEqual(['work-1', 'work-2']);
  });

  it('never groups incompatible UOM', () => {
    expect(groupMaterialCandidates([candidate(), candidate({ candidateId: 'resource-c:work-1',
      unit: 'bao' })])).toHaveLength(2);
  });

  it('keeps missing identity, norm revision, and conversion as explicit blockers', () => {
    const rows = [candidate({ itemId: null, diagnostics: ['missing_inventory_identity'], selectable: false }),
      candidate({ candidateId: 'b', normRevision: null, diagnostics: ['missing_norm_revision'], selectable: false }),
      candidate({ candidateId: 'c', conversionNumerator: null, calculatedQty: null,
        availableQty: null, diagnostics: ['missing_conversion'], selectable: false })];
    expect(groupMaterialCandidates(rows)).toHaveLength(3);
    expect(rows.every(row => !row.selectable)).toBe(true);
    expect(rows[2].availableQty).toBeNull();
  });

  it('preserves previous allocation and rejects an exact repeated request', () => {
    const row = candidate({ alreadyPlannedQty: '4.000000', availableQty: '6.000000' });
    expect(validateMaterialSelection([row], [{ candidateId: row.candidateId, quantity: '6.000000' }])).toEqual([]);
    expect(validateMaterialSelection([row], [{ candidateId: row.candidateId, quantity: '10.000000' }]))
      .toContainEqual({ candidateId: row.candidateId, reason: 'Khối lượng vượt khả dụng (6.000000)' });
    expect(validateMaterialSelection([row], [{ candidateId: row.candidateId, quantity: '6.000000' },
      { candidateId: row.candidateId, quantity: '6.000000' }]))
      .toContainEqual({ candidateId: row.candidateId, reason: 'Nguồn đã được chọn hai lần' });
  });

  it('blocks stale source revision without clipping quantity', () => {
    const row = candidate({ sourceRevision: 2, sourcePlanHash: 'hash-b' });
    expect(validateMaterialSelection([row], [{ candidateId: row.candidateId, quantity: '11.000000',
      sourceRevision: 1, sourcePlanHash: 'hash-a' }])).toEqual(expect.arrayContaining([
      { candidateId: row.candidateId, reason: 'Kế hoạch thi công đã đổi phiên bản' },
      { candidateId: row.candidateId, reason: 'Khối lượng vượt khả dụng (10.000000)' },
    ]));
  });
});
