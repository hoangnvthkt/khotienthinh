import type { ProcurementDocumentRef } from './procurementWorkbench';

export type ProcurementV2Source = 'project_material_request' | 'material_plan';
export type ProcurementV2Stage = 'reconcile' | 'plan_supply' | 'monitor_fulfillment' | 'withdrawn';

export interface ProcurementV2Filter {
  search?: string;
  projectId?: string;
  constructionSiteId?: string;
  source?: ProcurementV2Source;
  stage?: ProcurementV2Stage;
  neededFrom?: string;
  neededTo?: string;
  assigneeId?: string;
}

export interface ProcurementV2DossierCard {
  id: string;
  sourceAdapter: ProcurementV2Source;
  sourceCode: string;
  sourceDocumentId: string;
  projectId: string;
  constructionSiteId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  earliestNeededDate: string | null;
  destinationSummary: string | null;
  lineCount: number;
  stage: ProcurementV2Stage;
  nextAction: string;
  issueCount: number;
  version: string;
}

export interface ProcurementV2DossierLine {
  id: string;
  sourceLineId: string;
  itemId: string;
  title: string;
  unit: string;
  approvedQty: string | null;
  reservedQty: string | null;
  committedQty: string | null;
  fulfilledQty: string | null;
  closedQty: string | null;
  availableToPlanQty: string | null;
  neededDate: string | null;
  destinationId: string | null;
  balanceKnown: boolean;
  diagnostics: string[];
  documentRefs: ProcurementDocumentRef[];
}

export interface ProcurementV2Dossier extends ProcurementV2DossierCard {
  sourceRef: { adapter: ProcurementV2Source; id: string };
  lines: ProcurementV2DossierLine[];
  issues: Array<{ id: string; code: string; severity: string; sourceLineId: string | null }>;
  allowedActions: Array<'view' | 'assign' | 'plan_supply'>;
  asOf: string;
}

export interface ProcurementV2Page {
  items: ProcurementV2DossierCard[];
  nextCursor: string | null;
  snapshotToken: string;
  asOf: string;
  stale: boolean;
  counters: Array<{ key: string; count: number; grain: 'document' }>;
}
