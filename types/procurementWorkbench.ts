import type { ProcurementDemandBalance, ProcurementDemandBalanceInput, ProcurementDecimal } from './procurementIdentity';

export type ProcurementView = 'work' | 'demand' | 'orders' | 'receiving' | 'reconcile' | 'partners' | 'overview';
export type ProcurementStage = 'intake' | 'processing' | 'approval' | 'receiving' | 'reconcile';

export interface ProcurementQuery {
  view: ProcurementView;
  stage?: ProcurementStage;
  projectId?: string;
  constructionSiteId?: string;
  assigneeId?: string;
  source?: string;
  method?: string;
  search?: string;
  neededFrom?: string;
  neededTo?: string;
  demandId?: string;
}

export interface ProcurementTag {
  label: string;
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
}

export interface ProcurementDocumentRef {
  type: 'material_request' | 'purchase_order' | 'wms' | 'direct_purchase' | 'supplier_contract' | 'supplier_delivery' | 'supplier_statement' | 'payable';
  id: string;
  engine: string;
  label?: string;
}

export interface ProcurementWorkbenchRow {
  id: string;
  objectType: 'demand' | 'demand_line' | 'purchase_order' | 'receipt' | 'reconciliation_issue';
  objectId: string;
  actionKind: string;
  demandId: string;
  demandLineId: string | null;
  title: string;
  sourceLabel: string;
  sourceCode: string;
  projectId: string;
  constructionSiteId: string | null;
  destinationLabel: string | null;
  assigneeUserId: string | null;
  unit: string | null;
  balance: ProcurementDemandBalance;
  allowedActions: string[];
  version: string;
  neededDate: string | null;
  nextActionLabel: string;
  tags: ProcurementTag[];
}

export interface ProcurementWorkbenchPage {
  items: ProcurementWorkbenchRow[];
  nextCursor: string | null;
  snapshotToken: string;
  asOf: string;
  stale: boolean;
  counters: { key: string; count: number; grain: 'work' | 'demand' }[];
}

export interface ProcurementAllocationDetail {
  id: string;
  method: string;
  state: string;
  needQty: ProcurementDecimal;
  documentRefs: ProcurementDocumentRef[];
}

export interface ProcurementDemandDetailLine {
  id: string;
  itemId: string | null;
  title: string;
  unit: string;
  requestedQty: ProcurementDecimal;
  balanceInput: ProcurementDemandBalanceInput;
  balance: ProcurementDemandBalance;
  allocations: ProcurementAllocationDetail[];
}

export interface ProcurementDemandDetail {
  id: string;
  version: string;
  title: string;
  sourceCode: string;
  projectId: string;
  constructionSiteId: string | null;
  assigneeUserId: string | null;
  sourceRef: ProcurementDocumentRef | null;
  allowedActions: string[];
  lines: ProcurementDemandDetailLine[];
  issues: { id: string; code: string; message: string }[];
  asOf: string;
}
