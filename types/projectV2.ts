export type ProjectV2PlanType = 'month' | 'construction' | 'material';
export type ProjectV2PlanStatus = 'draft' | 'pending_approval' | 'returned' | 'approved' | 'superseded' | 'cancelled';
export type ProjectV2Action = 'edit' | 'submit' | 'approve' | 'return' | 'revise' | 'cancel';

export type ProjectV2Quantity =
  | { state: 'known'; value: string }
  | { state: 'unknown' }
  | { state: 'incomplete'; reason: string };

export interface ProjectV2LineSource {
  sourcePlanId: string;
  sourceRevision: number;
  sourceLineId: string;
  sourceQuantity: string;
  sourceUnit: string;
}

export interface ProjectV2MonthLine {
  lineId: string;
  kind: 'month';
  contractItemId: string | null;
  baselineRevision: string | null;
  unit: string | null;
  quantity: string | null;
  unitPriceSnapshot?: string | null;
  currency?: string | null;
}

export interface ProjectV2ConstructionLine {
  lineId: string;
  kind: 'construction';
  workItemId: string | null;
  unit: string | null;
  quantity: string | null;
  workStart: string | null;
  workEnd: string | null;
  crewId: string | null;
  sources: ProjectV2LineSource[];
}

export interface ProjectV2MaterialDerivation {
  sourcePlanId: string;
  sourceRevision: number;
  sourceLineId: string;
  sourceWorkQuantity: string;
  normResourceId: string | null;
  normRevision: number | null;
  normFactor: string | null;
  coefficient: string | null;
  conversionNumerator: string | null;
  conversionDenominator: string | null;
  derivedQuantity: string | null;
}

export interface ProjectV2MaterialLine {
  lineId: string;
  kind: 'material';
  itemId: string | null;
  unit: string | null;
  quantity: string | null;
  neededDate: string | null;
  destinationId: string | null;
  derivations: ProjectV2MaterialDerivation[];
}

export type ProjectV2PlanLine = ProjectV2MonthLine | ProjectV2ConstructionLine | ProjectV2MaterialLine;
export type ProjectV2MaterialCandidate = Omit<ProjectV2MaterialLine, 'kind'>;

interface ProjectV2DraftBase {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}

export type ProjectV2PlanDraft =
  | (ProjectV2DraftBase & { type: 'month'; lines: ProjectV2MonthLine[] })
  | (ProjectV2DraftBase & { type: 'construction'; lines: ProjectV2ConstructionLine[] })
  | (ProjectV2DraftBase & { type: 'material'; lines: ProjectV2MaterialCandidate[] });

export interface ProjectV2PlanRevision {
  planId: string;
  revision: number;
  predecessorRevision: number | null;
  status: ProjectV2PlanStatus;
  creatorId: string;
  submitterId: string | null;
  approverId: string | null;
  approvedAt: string | null;
  lines: ProjectV2PlanLine[];
}

export interface ProjectV2CapabilitySet {
  edit: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  revise: boolean;
  cancel: boolean;
}

export interface ProjectV2AllowedActionsInput {
  status: ProjectV2PlanStatus;
  capabilities: ProjectV2CapabilitySet;
  actorId: string;
  creatorId?: string | null;
  submitterId?: string | null;
}

export type ProjectV2AllowedActions = Record<ProjectV2Action, boolean>;

export interface ProjectV2ValidationIssue {
  field: string;
  code: string;
  blocking: boolean;
}

export interface ProjectV2MaterialRequirementInput {
  workQty: string | null;
  normFactor: string | null;
  coefficient: string | null;
  conversionNumerator: string | null;
  conversionDenominator: string | null;
}

export interface ProjectV2MaterialGroup {
  itemId: string | null;
  unit: string | null;
  neededDate: string | null;
  destinationId: string | null;
  quantity: string | null;
  lineIds: string[];
  derivations: ProjectV2MaterialDerivation[];
}
