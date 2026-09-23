/** Canonical base-10 strings at RPC boundaries. */
export type ProcurementDecimal = string;

export interface ProcurementDemandBalanceInput {
  approved: ProcurementDecimal | null;
  fulfilled: ProcurementDecimal;
  closed: ProcurementDecimal;
  reserved: ProcurementDecimal;
  committed: ProcurementDecimal;
}

export interface ProcurementDemandBalance {
  openNeed: ProcurementDecimal | null;
  availableToPlan: ProcurementDecimal | null;
  coverageExcess: ProcurementDecimal | null;
  receivedExcess: ProcurementDecimal | null;
}

export interface ProcurementSourceLineSnapshot {
  sourceLineId: string;
  itemId: string;
  title: string;
  requestedQty: ProcurementDecimal;
  approvedQty: ProcurementDecimal | null;
  unit: string;
  workBoqItemId: string | null;
  materialBudgetItemId: string | null;
  neededDate?: string | null;
  destinationId?: string | null;
  calculatedQty?: ProcurementDecimal | null;
}

export interface ProcurementSourceSnapshot {
  adapter: 'project_material_request' | 'material_plan';
  sourceDocumentId: string;
  sourceCode: string;
  sourceRevision: string;
  sourceHash: string;
  ownerContext: { logicalKey: 'company_default'; resolution: 'server_registry_required' };
  scope: { projectId: string; constructionSiteId: string | null };
  intakeState: 'preliminary' | 'ready' | 'needs_information' | 'source_changed' | 'withdrawn';
  healthState: 'healthy' | 'reconciliation_required';
  lines: ProcurementSourceLineSnapshot[];
  diagnostics: string[];
}

export interface ProcurementResourceVersion {
  type: string;
  id: string;
  version: string;
}

export interface ProcurementCommandRequest {
  idempotencyKey: string;
  expectedVersions: ProcurementResourceVersion[];
  payloadSchemaVersion: 1;
  payload: Record<string, unknown>;
  reason?: string;
}

export interface ProcurementCommandResult {
  commandId: string;
  outcome: 'committed' | 'replayed';
  committedAt: string;
  changedEntities: ProcurementResourceVersion[];
  createdDocumentIds: string[];
  warnings: { code: string; message: string }[];
  refreshScopes: string[];
}
