import { describe, expect, it } from 'vitest';
import { buildMaterialPlanLines } from '../../components/project-v2/ProjectV2MaterialPlanDialog';
import { groupMaterialCandidates, type MaterialCandidate } from '../projectV2/materialCandidateService';

const row = (patch: Partial<MaterialCandidate> = {}): MaterialCandidate => ({
  candidateId: 'a', workspaceId: 'w', itemId: 'item', itemCode: 'VT-01', itemName: 'Xi măng',
  unit: 'kg', calculatedQty: '50.000000', alreadyPlannedQty: '10.000000',
  availableQty: '40.000000', diagnostics: [], selectable: true,
  sourcePlanId: 'construction', sourceRevision: 1, sourcePlanHash: 'hash',
  sourceLineId: 'work-a', sourceWorkName: 'Móng', sourceWorkQuantity: '10.000000',
  sourceUnit: 'm3', normResourceId: 'g8:a', normRevision: 'rev-a', normFactor: '5.000000',
  coefficient: '1.000000', conversionNumerator: '1.000000', conversionDenominator: '1.000000',
  ...patch,
});
const entry = { quantity: '60.000000', neededDate: '2026-10-08', destinationId: 'site',
  note: 'Đợt một', overrideReason: 'Giao theo đợt' };

describe('Project V2 material draft allocation', () => {
  it('retains both exact derivations and distributes a partial request without changing calculation', () => {
    const groups = groupMaterialCandidates([row(), row({ candidateId: 'b', sourceLineId: 'work-b',
      normResourceId: 'g8:b', normRevision: 'rev-b', calculatedQty: '30.000000',
      alreadyPlannedQty: '0.000000', availableQty: '30.000000' })]);
    const [line] = buildMaterialPlanLines(groups, [groups[0].key], { [groups[0].key]: entry });
    expect(line.quantity).toBe('60.000000');
    expect(line.calculatedQuantity).toBe('80.000000');
    expect((line.derivations as { allocatedQuantity: string }[]).map(source => source.allocatedQuantity))
      .toEqual(['40.000000', '20.000000']);
    expect(line.overrideReason).toBe('Giao theo đợt');
  });

  it('blocks requests above available capacity and unexplained overrides', () => {
    const groups = groupMaterialCandidates([row()]);
    expect(() => buildMaterialPlanLines(groups, [groups[0].key], {
      [groups[0].key]: { ...entry, quantity: '41.000000' },
    })).toThrow('vượt khả dụng');
    expect(() => buildMaterialPlanLines(groups, [groups[0].key], {
      [groups[0].key]: { ...entry, quantity: '30.000000', overrideReason: '' },
    })).toThrow('lý do điều chỉnh');
  });

  it('does not allocate the same resource twice across delivery rows', () => {
    const original = groupMaterialCandidates([row()])[0];
    const groups = [{ ...original, key: 'delivery-a' }, { ...original, key: 'delivery-b' }];
    expect(() => buildMaterialPlanLines(groups, groups.map(group => group.key), {
      'delivery-a': { ...entry, quantity: '30.000000' },
      'delivery-b': { ...entry, quantity: '30.000000', neededDate: '2026-10-09' },
    })).toThrow('cùng nguồn đã được phân bổ');
  });
});
