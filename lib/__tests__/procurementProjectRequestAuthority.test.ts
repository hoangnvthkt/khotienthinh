import { describe, expect, it } from 'vitest';
import { classifyProjectMaterialRequestSource } from '../procurement/projectMaterialRequestAuthority';

const base = {
  requestOrigin: 'project',
  sourceDocumentId: 'mr-1',
  status: 'APPROVED',
  workflowStep: 'batch_planning',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  requestedQty: '100',
  rawApprovedQty: '100',
  sourceRevision: '1',
  sourceHash: 'hash-1',
};

describe('project material request authority', () => {
  it('releases only approval evidence bound to the current revision and hash', () => {
    expect(classifyProjectMaterialRequestSource({
      ...base,
      approvalEvidence: {
        kind: 'material_request_event', requestId: 'mr-1', action: 'APPROVED', toStep: 'batch_planning',
        sourceRevision: '1', sourceHash: 'hash-1',
      },
    })).toMatchObject({ intakeState: 'ready', approvedQty: '100', releaseEligibility: 'eligible' });
  });

  it('marks an edited source as changed instead of reusing approval for the old quantity', () => {
    expect(classifyProjectMaterialRequestSource({
      ...base,
      requestedQty: '150', sourceRevision: '2', sourceHash: 'hash-2',
      approvalEvidence: {
        kind: 'material_request_event', requestId: 'mr-1', action: 'APPROVED', toStep: 'batch_planning',
        sourceRevision: '1', sourceHash: 'hash-1',
      },
    })).toMatchObject({
      intakeState: 'source_changed', approvedQty: null, releaseEligibility: 'blocked_source_changed',
    });
  });

  it('does not trust a client-supplied owner context or raw approved quantity', () => {
    expect(() => classifyProjectMaterialRequestSource({
      ...base,
      claimedOwnerContextId: 'owner-from-client',
      approvalEvidence: null,
    })).toThrow('UNTRUSTED_OWNER_CONTEXT');

    expect(classifyProjectMaterialRequestSource({ ...base, approvalEvidence: null })).toMatchObject({
      intakeState: 'needs_information', approvedQty: null, diagnostics: ['LEGACY_RAW_APPROVED_QTY_IGNORED'],
    });
  });
});
