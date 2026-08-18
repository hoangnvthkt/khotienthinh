export type HrmSlotType = 'STANDARD' | 'RESERVE' | 'TEMPORARY';
export type HrmSlotStatus = 'ACTIVE' | 'FROZEN' | 'ARCHIVED';
export type HrmAssignmentType = 'PRIMARY' | 'SECONDARY' | 'ACTING';
export type HrmAssignmentStatus = 'PLANNED' | 'ACTIVE' | 'ENDED';

export interface HrmSharedOrgUnit {
  id: string;
  code?: string | null;
  name: string;
  type: string;
  customTypeLabel?: string | null;
  parentId?: string | null;
  blockCode?: string | null;
  managerSlotId?: string | null;
  description?: string | null;
  orderIndex: number;
  isActive: boolean;
}

export interface HrmOrgPositionSlot {
  id: string;
  code: string;
  orgUnitId: string;
  positionId: string;
  levelCode?: string | null;
  reportsToSlotId?: string | null;
  slotType: HrmSlotType;
  status: HrmSlotStatus;
  description?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  sortOrder: number;
  source: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HrmEmployeeSlotAssignment {
  id: string;
  employeeId: string;
  slotId: string;
  assignmentType: HrmAssignmentType;
  status: HrmAssignmentStatus;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
  source?: string;
}

export interface HrmSharedEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
  title?: string | null;
  status: string;
  userId?: string | null;
  orgUnitId?: string | null;
  positionId?: string | null;
}

export interface HrmSharedPosition {
  id: string;
  code?: string | null;
  name: string;
  groupCode?: string | null;
  levelCode?: string | null;
  suggestedOrgUnitCode?: string | null;
  isActive: boolean;
  sortOrder: number;
  source: string;
}

export interface HrmSharedCodeItem {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  groupCode?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface HrmSharedCatalogBundle {
  orgUnits: HrmSharedOrgUnit[];
  slots: HrmOrgPositionSlot[];
  assignments: HrmEmployeeSlotAssignment[];
  employees: HrmSharedEmployee[];
  positions: HrmSharedPosition[];
  positionGroups: HrmSharedCodeItem[];
  positionLevels: HrmSharedCodeItem[];
  competencyGroups: HrmSharedCodeItem[];
  competencyLevels: HrmSharedCodeItem[];
  employmentStatuses: HrmSharedCodeItem[];
  contractTypes: HrmSharedCodeItem[];
  educationLevels: HrmSharedCodeItem[];
  socialInsuranceStatuses: HrmSharedCodeItem[];
}

export interface HrmStaffingRow {
  key: string;
  orgUnitId: string;
  positionId: string;
  levelCode: string | null;
  reportsToSlotId: string | null;
  slots: HrmOrgPositionSlot[];
  plannedCount: number;
  occupiedCount: number;
  vacantCount: number;
  isManager: boolean;
}

export interface HrmEmployeeOrganizationSummary {
  status: 'ASSIGNED' | 'PENDING';
  employeeId: string;
  assignmentId: string | null;
  slotId: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  levelCode: string | null;
  managerEmployeeId: string | null;
}

export interface HrmStaffingMutationResult {
  orgUnitId: string;
  positionId: string;
  levelCode: string | null;
  reportsToSlotId: string | null;
  targetCount: number;
  occupiedCount: number;
  vacantCount: number;
}

export interface HrmOrgTreeNode extends HrmSharedOrgUnit {
  children: HrmOrgTreeNode[];
}

export type HrmSlotOccupancyStatus = 'OCCUPIED' | 'PLANNED' | 'VACANT';
