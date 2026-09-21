import type { ProcurementDecimal } from './procurementIdentity';

export type BoqPlanningCompleteness = 'complete' | 'partial' | 'unknown';

export interface BoqPlanningScope {
  projectId: string;
  constructionSiteId: string | null;
}

export interface BoqMaterialOpenBalance {
  awaitingApproval: ProcurementDecimal | null;
  awaitingArrangement: ProcurementDecimal | null;
  executing: ProcurementDecimal | null;
}

export interface BoqMaterialBalanceInput {
  unit: string;
  budget: ProcurementDecimal;
  issuedNet: ProcurementDecimal | null;
  open: BoqMaterialOpenBalance;
  closed: ProcurementDecimal | null;
  issues?: string[];
  blockingIssues?: string[];
}

export interface BoqMaterialBalance extends BoqMaterialBalanceInput {
  issues: string[];
  blockingIssues: string[];
  uncovered: ProcurementDecimal | null;
  excess: ProcurementDecimal | null;
  completeness: BoqPlanningCompleteness;
  selectable: boolean;
}

export interface BoqMaterialBudgetLine {
  id: string;
  workBoqItemId: string | null;
  taskId: string | null;
  itemId: string | null;
  sku: string | null;
  itemName: string;
  category: string;
  unit: string;
  suggestedQty30d: ProcurementDecimal | null;
  unitPrice: ProcurementDecimal | null;
  balance: BoqMaterialBalance;
  issues: string[];
}

export interface BoqMaterialQuantityGroup {
  unit: string;
  lineCount: number;
}

export interface BoqMaterialTreeNode {
  id: string;
  parentId: string | null;
  taskId: string | null;
  wbsCode: string | null;
  name: string;
  sortOrder: number;
  childCount: number;
  materials: BoqMaterialBudgetLine[];
  quantityGroups?: BoqMaterialQuantityGroup[];
  synthetic?: 'unallocated' | null;
}

export interface BoqMaterialTreeTotals {
  workNodeCount: number;
  materialLineCount: number;
  selectableLineCount: number;
  unallocatedEffectCount: number;
}

export interface BoqMaterialTreePage {
  scope: BoqPlanningScope;
  asOf: string;
  metricVersion: string;
  nodes: BoqMaterialTreeNode[];
  nextCursor: string | null;
  totals: BoqMaterialTreeTotals;
  capabilities: { canViewPrice: boolean };
}

export interface BoqMaterialDraftInput {
  line: BoqMaterialBudgetLine;
  draftQty: ProcurementDecimal;
  neededDate: string;
  destination: string;
}

export interface BoqMaterialPlanAllocation {
  sourceBudgetLineId: string;
  sourceWorkBoqItemId: string | null;
  sourceTaskId: string | null;
  quantity: ProcurementDecimal;
  neededDate: string;
  destination: string;
}

export interface BoqMaterialPlanPreviewGroup {
  key: string;
  itemId: string;
  sku: string | null;
  itemName: string;
  unit: string;
  totalQty: ProcurementDecimal;
  allocations: BoqMaterialPlanAllocation[];
}

export interface BoqMaterialPlanPreview {
  groups: BoqMaterialPlanPreviewGroup[];
  sourceLineCount: number;
}

export type MaterialPlanStatus = 'draft' | 'confirmed' | 'superseded' | 'cancelled';

export interface MaterialPlanAllocationDraft extends BoqMaterialPlanAllocation {
  id: string;
}

export interface MaterialPlanLineDraft {
  id: string;
  itemId: string;
  sku: string | null;
  itemName: string;
  unit: string;
  quantity: ProcurementDecimal;
  neededDate: string;
  destination: string;
  allocations: MaterialPlanAllocationDraft[];
}

export interface MaterialPlanAllocation extends MaterialPlanAllocationDraft {
  convertedQty: ProcurementDecimal;
  remainingQty: ProcurementDecimal;
}

export interface MaterialPlanLine extends Omit<MaterialPlanLineDraft, 'allocations'> {
  convertedQty: ProcurementDecimal;
  remainingQty: ProcurementDecimal;
  allocations: MaterialPlanAllocation[];
}

export interface MaterialPlanRevisionSummary {
  version: number;
  sourceHash: string;
  changedBy: string;
  createdAt: string;
}

export interface MaterialPlanConversionSummary {
  id: string;
  planVersion: number;
  requestId: string;
  requestCode: string;
  quantity: ProcurementDecimal;
  unit: string;
  state: 'active' | 'reversed';
  createdAt: string;
}

export interface MaterialPlanCapabilities {
  canEdit: boolean;
  canConvert: boolean;
}

export interface MaterialPlanDetail {
  id: string;
  planNo: string;
  projectId: string;
  constructionSiteId: string | null;
  title: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  status: MaterialPlanStatus;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  capabilities: MaterialPlanCapabilities;
  lines: MaterialPlanLine[];
  revisions: MaterialPlanRevisionSummary[];
  conversions: MaterialPlanConversionSummary[];
}

export interface MaterialPlanSummary {
  id: string;
  planNo: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  status: MaterialPlanStatus;
  version: number;
  lineCount: number;
  remainingAllocationCount: number;
  updatedAt: string;
}

export interface MaterialPlanCommandResult {
  commandId: string;
  outcome: 'committed' | 'replayed';
}

export interface SaveMaterialPlanInput {
  planId: string | null;
  projectId: string;
  constructionSiteId: string | null;
  expectedVersion: number | null;
  title: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  status: Extract<MaterialPlanStatus, 'draft' | 'confirmed'>;
  lines: MaterialPlanLineDraft[];
  payloadSchemaVersion: 1;
  idempotencyKey: string;
}

export interface ConvertMaterialPlanInput {
  planId: string;
  expectedVersion: number;
  siteWarehouseId: string;
  fulfillmentMode: 'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION';
  allocations: Array<{ allocationId: string; quantity: ProcurementDecimal }>;
  payloadSchemaVersion: 1;
  idempotencyKey: string;
}

export interface MaterialPlanConversionResult extends MaterialPlanCommandResult {
  planId: string;
  planVersion: number;
  requestId: string;
  requestCode: string;
  convertedQty: ProcurementDecimal;
}
