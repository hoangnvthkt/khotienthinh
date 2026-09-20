import type { ProcurementSourceSnapshot } from '../../types/procurementIdentity';
import {
  classifyProjectMaterialRequestSource,
  type ProjectMaterialRequestApprovalEvidence,
} from './projectMaterialRequestAuthority';
import { formatDecimal6, parseQuantity6 } from './decimal';

export interface RawProjectMaterialRequestSnapshot {
  id: string;
  code: string;
  requestOrigin: string;
  status: string;
  workflowStep: string | null;
  projectId: string | null;
  constructionSiteId: string | null;
  contentRevision: number;
  contentHash: string;
  approvalEvidence: ProjectMaterialRequestApprovalEvidence | null;
  lines: Array<{
    lineId: string;
    itemId: string;
    title?: string;
    requestedQty: string;
    approvedQty?: string | null;
    unit: string;
    workBoqItemId?: string | null;
    materialBudgetItemId?: string | null;
  }>;
}

export function normalizeProjectMaterialRequestSnapshot(
  raw: RawProjectMaterialRequestSnapshot,
): ProcurementSourceSnapshot {
  if (!Number.isInteger(raw.contentRevision) || raw.contentRevision < 1 || !raw.contentHash.trim()) {
    throw new Error('SOURCE_REVISION_REQUIRED');
  }
  const seen = new Set<string>();
  const normalizedLines = raw.lines.map(line => {
    const sourceLineId = line.lineId.trim();
    if (!sourceLineId) throw new Error('SOURCE_LINE_ID_REQUIRED');
    if (seen.has(sourceLineId)) throw new Error('SOURCE_LINE_ID_DUPLICATE');
    seen.add(sourceLineId);
    if (!line.itemId.trim()) throw new Error('SOURCE_LINE_ITEM_REQUIRED');
    if (!line.unit.trim() || line.unit.trim() !== line.unit) throw new Error('SOURCE_LINE_UNIT_REQUIRED');

    const authority = classifyProjectMaterialRequestSource({
      requestOrigin: raw.requestOrigin,
      sourceDocumentId: raw.id,
      status: raw.status,
      workflowStep: raw.workflowStep,
      projectId: raw.projectId,
      constructionSiteId: raw.constructionSiteId,
      requestedQty: line.requestedQty,
      rawApprovedQty: line.approvedQty ?? null,
      sourceRevision: String(raw.contentRevision),
      sourceHash: raw.contentHash,
      approvalEvidence: raw.approvalEvidence,
    });
    return {
      sourceLineId,
      itemId: line.itemId,
      title: line.title?.trim() || line.itemId,
      requestedQty: formatDecimal6(parseQuantity6(line.requestedQty)),
      approvedQty: authority.approvedQty,
      unit: line.unit,
      workBoqItemId: line.workBoqItemId || null,
      materialBudgetItemId: line.materialBudgetItemId || null,
      authority,
    };
  });

  const authorities = normalizedLines.map(line => line.authority);
  const first = authorities[0] || classifyProjectMaterialRequestSource({
    requestOrigin: raw.requestOrigin,
    sourceDocumentId: raw.id,
    status: raw.status,
    workflowStep: raw.workflowStep,
    projectId: raw.projectId,
    constructionSiteId: raw.constructionSiteId,
    requestedQty: '0',
    rawApprovedQty: null,
    sourceRevision: String(raw.contentRevision),
    sourceHash: raw.contentHash,
    approvalEvidence: raw.approvalEvidence,
  });

  return {
    adapter: 'project_material_request',
    sourceDocumentId: raw.id,
    sourceCode: raw.code,
    sourceRevision: String(raw.contentRevision),
    sourceHash: raw.contentHash,
    ownerContext: first.ownerContext,
    scope: first.scope,
    intakeState: first.intakeState,
    healthState: first.healthState,
    lines: normalizedLines.map(({ authority: _authority, ...line }) => line),
    diagnostics: Array.from(new Set(authorities.flatMap(authority => authority.diagnostics))),
  };
}
