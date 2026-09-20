import { formatDecimal6, parseQuantity6 } from './decimal';

export type ProjectMaterialRequestApprovalEvidence =
  | {
      kind: 'material_request_event';
      requestId: string;
      action: string;
      toStep: string;
      sourceRevision: string;
      sourceHash: string;
    }
  | {
      kind: 'dynamic_workflow';
      subjectType: string;
      subjectId: string;
      subjectStatus: string;
      instanceStatus: string;
      sourceRevision: string;
      sourceHash: string;
    };

export interface ProjectMaterialRequestAuthorityInput {
  requestOrigin: string;
  sourceDocumentId: string;
  status: string;
  workflowStep: string | null;
  projectId: string | null;
  constructionSiteId: string | null;
  requestedQty: string;
  rawApprovedQty: string | null;
  sourceRevision: string;
  sourceHash: string;
  approvalEvidence: ProjectMaterialRequestApprovalEvidence | null;
  claimedOwnerContextId?: unknown;
}

export interface ProjectMaterialRequestAuthority {
  ownerContext: { logicalKey: 'company_default'; resolution: 'server_registry_required' };
  scope: { projectId: string; constructionSiteId: string | null };
  intakeState: 'preliminary' | 'ready' | 'needs_information' | 'source_changed' | 'withdrawn';
  healthState: 'healthy' | 'reconciliation_required';
  approvedQty: string | null;
  releaseEligibility: 'blocked_preliminary' | 'eligible' | 'blocked_reconciliation' | 'blocked_source_changed' | 'blocked_source_state';
  diagnostics: string[];
}

const hasFinalApproval = (sourceDocumentId: string, evidence: ProjectMaterialRequestApprovalEvidence | null) => {
  if (!evidence) return false;
  if (evidence.kind === 'material_request_event') {
    return evidence.requestId === sourceDocumentId
      && evidence.action === 'APPROVED'
      && evidence.toStep === 'batch_planning';
  }
  return evidence.subjectType === 'material_request'
    && evidence.subjectId === sourceDocumentId
    && evidence.subjectStatus === 'COMPLETED'
    && evidence.instanceStatus === 'COMPLETED';
};

export function classifyProjectMaterialRequestSource(
  input: ProjectMaterialRequestAuthorityInput,
): ProjectMaterialRequestAuthority {
  if (input.requestOrigin !== 'project') throw new Error('UNSUPPORTED_SOURCE_ORIGIN');
  if (input.claimedOwnerContextId !== undefined) throw new Error('UNTRUSTED_OWNER_CONTEXT');
  if (!input.sourceDocumentId.trim()) throw new Error('SOURCE_DOCUMENT_ID_REQUIRED');
  if (!input.projectId?.trim()) throw new Error('PROJECT_SCOPE_REQUIRED');
  if (!input.sourceRevision.trim() || !input.sourceHash.trim()) throw new Error('SOURCE_REVISION_REQUIRED');

  const requestedQty = formatDecimal6(parseQuantity6(input.requestedQty));
  const diagnostics = input.rawApprovedQty === null ? [] : ['LEGACY_RAW_APPROVED_QTY_IGNORED'];
  const common = {
    ownerContext: { logicalKey: 'company_default' as const, resolution: 'server_registry_required' as const },
    scope: { projectId: input.projectId, constructionSiteId: input.constructionSiteId },
    diagnostics,
  };

  if (input.status === 'PENDING' && input.workflowStep === 'material_department_review') {
    return { ...common, intakeState: 'preliminary', healthState: 'healthy', approvedQty: null, releaseEligibility: 'blocked_preliminary' };
  }

  if (['APPROVED', 'IN_TRANSIT', 'COMPLETED'].includes(input.status) && hasFinalApproval(input.sourceDocumentId, input.approvalEvidence)) {
    if (input.approvalEvidence!.sourceRevision !== input.sourceRevision
      || input.approvalEvidence!.sourceHash !== input.sourceHash) {
      return {
        ...common,
        intakeState: 'source_changed',
        healthState: 'reconciliation_required',
        approvedQty: null,
        releaseEligibility: 'blocked_source_changed',
      };
    }
    return { ...common, intakeState: 'ready', healthState: 'healthy', approvedQty: requestedQty, releaseEligibility: 'eligible' };
  }

  if (['APPROVED', 'IN_TRANSIT', 'COMPLETED'].includes(input.status)) {
    return {
      ...common,
      intakeState: 'needs_information',
      healthState: 'reconciliation_required',
      approvedQty: null,
      releaseEligibility: 'blocked_reconciliation',
    };
  }

  return {
    ...common,
    intakeState: input.status === 'REJECTED' ? 'withdrawn' : 'needs_information',
    healthState: 'healthy',
    approvedQty: null,
    releaseEligibility: 'blocked_source_state',
  };
}
