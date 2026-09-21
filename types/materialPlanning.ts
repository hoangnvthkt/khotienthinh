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

