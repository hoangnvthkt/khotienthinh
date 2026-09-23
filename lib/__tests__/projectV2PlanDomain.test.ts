import { describe, expect, it } from 'vitest';
import {
  calculateMaterialRequirement,
  getProjectV2AllowedActions,
  groupMaterialRequirementLines,
  validateProjectV2PlanDraft,
} from '../projectV2/planDomain';
import type { ProjectV2MaterialCandidate, ProjectV2PlanDraft } from '../../types/projectV2';

const allCapabilities = {
  edit: true, submit: true, approve: true, return: true, revise: true, cancel: true,
} as const;

function materialCandidate(overrides: Partial<ProjectV2MaterialCandidate> = {}): ProjectV2MaterialCandidate {
  const lineId = overrides.lineId ?? 'line-1';
  return {
    lineId, itemId: 'steel', unit: 'kg', quantity: '2.000000',
    neededDate: '2026-10-01', destinationId: 'site-a',
    derivations: [{ sourcePlanId: 'construction-1', sourceRevision: 1,
      sourceLineId: lineId.replace('line', 'work'), sourceWorkQuantity: '2.000000',
      normResourceId: 'norm-1', normRevision: 'rev-3', normFactor: '1.000000',
      coefficient: '1.000000', conversionNumerator: '1.000000',
      conversionDenominator: '1.000000', derivedQuantity: '2.000000' }],
    ...overrides,
  };
}

describe('Project V2 planning domain', () => {
  it('allows editing only drafts and returned plans and revisions only after approval', () => {
    expect(getProjectV2AllowedActions({ status: 'draft', capabilities: allCapabilities, actorId: 'author' }).edit).toBe(true);
    expect(getProjectV2AllowedActions({ status: 'returned', capabilities: allCapabilities, actorId: 'author' }).edit).toBe(true);
    expect(getProjectV2AllowedActions({ status: 'pending_approval', capabilities: allCapabilities, actorId: 'reviewer' }).edit).toBe(false);
    expect(getProjectV2AllowedActions({ status: 'approved', capabilities: allCapabilities, actorId: 'reviewer' }).revise).toBe(true);
    expect(getProjectV2AllowedActions({ status: 'superseded', capabilities: allCapabilities, actorId: 'reviewer' }).revise).toBe(false);
  });

  it('disallows self approval by either creator or submitter', () => {
    for (const actorId of ['creator', 'submitter']) {
      expect(getProjectV2AllowedActions({ status: 'pending_approval', capabilities: allCapabilities,
        actorId, creatorId: 'creator', submitterId: 'submitter' }).approve).toBe(false);
    }
    expect(getProjectV2AllowedActions({ status: 'pending_approval', capabilities: allCapabilities,
      actorId: 'reviewer', creatorId: 'creator', submitterId: 'submitter' }).approve).toBe(true);
    expect(getProjectV2AllowedActions({ status: 'pending_approval', capabilities: allCapabilities,
      actorId: 'reviewer' }).approve).toBe(false);
  });

  it('derives exact six-decimal material quantity from work, norm and conversion', () => {
    expect(calculateMaterialRequirement({ workQty: '12.500000', normFactor: '8.000000',
      coefficient: '1.050000', conversionNumerator: '1.000000',
      conversionDenominator: '1.000000' })).toBe('105.000000');
    expect(calculateMaterialRequirement({ workQty: '0.100000', normFactor: '0.200000',
      coefficient: '1.000000', conversionNumerator: '1.000000',
      conversionDenominator: '1.000000' })).toBe('0.020000');
  });

  it('keeps missing norms and conversions unknown and rejects invalid denominators', () => {
    expect(calculateMaterialRequirement({ workQty: '12.500000', normFactor: null,
      coefficient: '1.000000', conversionNumerator: '1.000000',
      conversionDenominator: '1.000000' })).toBeNull();
    expect(calculateMaterialRequirement({ workQty: '12.500000', normFactor: '8.000000',
      coefficient: '1.000000', conversionNumerator: null,
      conversionDenominator: '1.000000' })).toBeNull();
    expect(() => calculateMaterialRequirement({ workQty: '1.000000', normFactor: '1.000000',
      coefficient: '1.000000', conversionNumerator: '1.000000',
      conversionDenominator: '0.000000' })).toThrow('INVALID_CONVERSION');
  });

  it('groups only identical material, unit, date and destination while retaining each source', () => {
    const groups = groupMaterialRequirementLines([
      materialCandidate(),
      materialCandidate({ lineId: 'line-2', quantity: '0.100000',
        derivations: [{ ...materialCandidate().derivations[0], sourceLineId: 'work-2', derivedQuantity: '0.100000' }] }),
      materialCandidate({ lineId: 'line-3', neededDate: '2026-10-08' }),
      materialCandidate({ lineId: 'line-4', destinationId: 'site-b' }),
      materialCandidate({ lineId: 'line-5', unit: 't' }),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups[0].quantity).toBe('2.100000');
    expect(groups[0].derivations.map(source => source.sourceLineId)).toEqual(['work-1', 'work-2']);
  });

  it('does not silently count the same derivation twice', () => {
    expect(() => groupMaterialRequirementLines([
      materialCandidate(), materialCandidate({ lineId: 'line-2', derivations: materialCandidate().derivations }),
    ])).toThrow('DUPLICATE_SOURCE');
  });

  it('allows one source work line to be scheduled for different delivery dates', () => {
    expect(groupMaterialRequirementLines([
      materialCandidate(), materialCandidate({ lineId: 'line-2', neededDate: '2026-10-08',
        derivations: materialCandidate().derivations }),
    ])).toHaveLength(2);
  });

  it('blocks invalid date-only values and incomplete derivation lineage', () => {
    const draft: ProjectV2PlanDraft = {
      type: 'material', projectId: 'project-1', periodStart: '2026-02-01', periodEnd: '2026-02-31',
      lines: [materialCandidate({ derivations: [{ ...materialCandidate().derivations[0],
        sourcePlanId: '', normRevision: null }] })],
    };
    const fields = validateProjectV2PlanDraft(draft).map(issue => issue.field);
    expect(fields).toContain('periodEnd');
    expect(fields).toContain('lines.line-1.derivations.0.sourcePlanId');
    expect(fields).toContain('lines.line-1.derivations.0.normFactor');
  });

  it('blocks a material line whose stated quantity differs from its source derivations', () => {
    const draft: ProjectV2PlanDraft = {
      type: 'material', projectId: 'project-1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      lines: [materialCandidate({ quantity: '3.000000' })],
    };
    expect(validateProjectV2PlanDraft(draft)).toContainEqual({
      field: 'lines.line-1.quantity', code: 'derived_quantity_mismatch', blocking: true,
    });
  });

  it('accepts a reasoned partial allocation while preserving the full calculation', () => {
    const draft: ProjectV2PlanDraft = {
      type: 'material', projectId: 'project-1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      lines: [materialCandidate({ quantity: '1.500000', calculatedQuantity: '2.000000',
        overrideReason: 'Chỉ cần đợt đầu', derivations: [{ ...materialCandidate().derivations[0],
          allocatedQuantity: '1.500000' }] })],
    };
    expect(validateProjectV2PlanDraft(draft)).toEqual([]);
  });

  it('blocks a derivation whose stated quantity differs from exact norm calculation', () => {
    const draft: ProjectV2PlanDraft = {
      type: 'material', projectId: 'project-1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      lines: [materialCandidate({ quantity: '3.000000',
        derivations: [{ ...materialCandidate().derivations[0], derivedQuantity: '3.000000' }] })],
    };
    expect(validateProjectV2PlanDraft(draft)).toContainEqual({
      field: 'lines.line-1.derivations.0.derivedQuantity', code: 'derived_quantity_mismatch', blocking: true,
    });
  });

  it('returns field-addressable blockers for missing material facts and source lineage', () => {
    const draft: ProjectV2PlanDraft = {
      type: 'material', projectId: 'project-1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      lines: [materialCandidate({ itemId: null, quantity: null, neededDate: null,
        destinationId: null, derivations: [] })],
    };
    const issues = validateProjectV2PlanDraft(draft);
    expect(issues.map(issue => issue.field)).toEqual(expect.arrayContaining([
      'lines.line-1.itemId', 'lines.line-1.quantity', 'lines.line-1.neededDate',
      'lines.line-1.destinationId', 'lines.line-1.derivations',
    ]));
    expect(issues.every(issue => issue.blocking)).toBe(true);
  });

  it('allows a reasoned construction baseline exception but rejects an empty reason', () => {
    const draft: ProjectV2PlanDraft = { type: 'construction', projectId: 'p',
      periodStart: '2026-09-01', periodEnd: '2026-09-07', lines: [{ lineId: 'l', kind: 'construction',
        workItemId: 'contract-1', unit: 'm3', quantity: '2.000000',
        workStart: '2026-09-02', workEnd: '2026-09-05', crewId: null, sources: [],
        baselineRevision: '2026-09-01T00:00:00Z', baselineExceptionReason: 'Làm trước kỳ tháng',
      }] };
    expect(validateProjectV2PlanDraft(draft).some(issue => issue.code === 'missing_source')).toBe(false);
    draft.lines[0].baselineExceptionReason = ' ';
    expect(validateProjectV2PlanDraft(draft)).toContainEqual({ field: 'lines.l.sources',
      code: 'missing_source', blocking: true });
  });
});
