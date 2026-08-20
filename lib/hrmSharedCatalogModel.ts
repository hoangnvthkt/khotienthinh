import type {
  HrmEmployeeSlotAssignment,
  HrmEmployeeOrganizationSummary,
  HrmOrgTreeNode,
  HrmOrgPositionSlot,
  HrmSharedOrgUnit,
  HrmStaffingRow,
  HrmSlotOccupancyStatus,
} from '../types/hrmSharedCatalog';

type OrgTreeInput = Pick<HrmSharedOrgUnit, 'id' | 'name' | 'parentId' | 'orderIndex'> &
  Partial<Omit<HrmSharedOrgUnit, 'id' | 'name' | 'parentId' | 'orderIndex'>>;

export const buildHrmOrgForest = (units: OrgTreeInput[]): HrmOrgTreeNode[] => {
  const nodes = new Map<string, HrmOrgTreeNode>();
  units.forEach(unit => nodes.set(unit.id, {
    code: null,
    type: 'custom',
    customTypeLabel: null,
    blockCode: null,
    managerSlotId: null,
    description: null,
    isActive: true,
    ...unit,
    children: [],
  }));

  const roots: HrmOrgTreeNode[] = [];
  nodes.forEach(node => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  });

  const sortNodes = (rows: HrmOrgTreeNode[]) => {
    rows.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name, 'vi'));
    rows.forEach(row => sortNodes(row.children));
  };
  sortNodes(roots);
  return roots;
};

const isEffectiveOn = (
  assignment: Pick<HrmEmployeeSlotAssignment, 'effectiveFrom' | 'effectiveTo'>,
  date: string,
) => assignment.effectiveFrom <= date && (!assignment.effectiveTo || assignment.effectiveTo >= date);

export const getHrmSlotOccupancy = (
  slotId: string,
  assignments: HrmEmployeeSlotAssignment[],
  date = new Date().toISOString().slice(0, 10),
): { status: HrmSlotOccupancyStatus; assignment: HrmEmployeeSlotAssignment | null } => {
  const rows = assignments.filter(row => row.slotId === slotId && row.status !== 'ENDED');
  const active = rows.find(row =>
    row.status === 'ACTIVE' &&
    (row.assignmentType === 'PRIMARY' || row.assignmentType === 'ACTING') &&
    isEffectiveOn(row, date));
  if (active) return { status: 'OCCUPIED', assignment: active };

  const planned = rows
    .filter(row => row.status === 'PLANNED' || row.effectiveFrom > date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  return planned
    ? { status: 'PLANNED', assignment: planned }
    : { status: 'VACANT', assignment: null };
};

export const wouldCreateSlotReportingCycle = (
  slots: Array<{ id: string; reportsToSlotId?: string | null }>,
  slotId: string,
  proposedManagerSlotId?: string | null,
): boolean => {
  if (!proposedManagerSlotId) return false;
  if (slotId === proposedManagerSlotId) return true;

  const managerBySlot = new Map(slots.map(slot => [slot.id, slot.reportsToSlotId || null]));
  managerBySlot.set(slotId, proposedManagerSlotId);
  const visited = new Set<string>();
  let cursor: string | null | undefined = slotId;
  while (cursor) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = managerBySlot.get(cursor);
  }
  return false;
};

const staffingKey = (slot: HrmOrgPositionSlot) => [
  slot.orgUnitId,
  slot.positionId,
  slot.levelCode || '',
  slot.reportsToSlotId || '',
].join('|');

export const buildHrmStaffingRows = (
  slots: HrmOrgPositionSlot[],
  assignments: HrmEmployeeSlotAssignment[],
  units: HrmSharedOrgUnit[],
  date = new Date().toISOString().slice(0, 10),
): HrmStaffingRow[] => {
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const rows = new Map<string, HrmStaffingRow>();

  slots
    .filter(slot => slot.source === 'workforce_plan' && slot.status === 'ACTIVE')
    .forEach(slot => {
      const key = staffingKey(slot);
      const row = rows.get(key) || {
        key,
        orgUnitId: slot.orgUnitId,
        positionId: slot.positionId,
        levelCode: slot.levelCode || null,
        reportsToSlotId: slot.reportsToSlotId || null,
        slots: [],
        plannedCount: 0,
        occupiedCount: 0,
        vacantCount: 0,
        isManager: false,
      };
      row.slots.push(slot);
      rows.set(key, row);
    });

  return Array.from(rows.values())
    .map(row => {
      row.slots.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
      const occupiedCount = row.slots.filter(slot =>
        getHrmSlotOccupancy(slot.id, assignments, date).status === 'OCCUPIED').length;
      return {
        ...row,
        plannedCount: row.slots.length,
        occupiedCount,
        vacantCount: row.slots.length - occupiedCount,
        isManager: row.slots.some(slot => unitById.get(row.orgUnitId)?.managerSlotId === slot.id),
      };
    })
    .sort((a, b) => {
      const unitOrder = (unitById.get(a.orgUnitId)?.orderIndex || 0) -
        (unitById.get(b.orgUnitId)?.orderIndex || 0);
      return unitOrder || a.key.localeCompare(b.key);
    });
};

const getActiveOfficialAssignment = (
  employeeId: string,
  slots: HrmOrgPositionSlot[],
  assignments: HrmEmployeeSlotAssignment[],
  date: string,
) => {
  const officialSlotIds = new Set(slots
    .filter(slot => slot.source === 'workforce_plan' && slot.status === 'ACTIVE')
    .map(slot => slot.id));
  return assignments.find(assignment =>
    assignment.employeeId === employeeId &&
    officialSlotIds.has(assignment.slotId) &&
    assignment.status === 'ACTIVE' &&
    (assignment.assignmentType === 'PRIMARY' || assignment.assignmentType === 'ACTING') &&
    isEffectiveOn(assignment, date));
};

const resolveManagerSlotId = (
  employeeSlot: HrmOrgPositionSlot,
  units: HrmSharedOrgUnit[],
) => {
  if (employeeSlot.reportsToSlotId) return employeeSlot.reportsToSlotId;
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const currentUnit = unitById.get(employeeSlot.orgUnitId);
  if (currentUnit?.managerSlotId && currentUnit.managerSlotId !== employeeSlot.id) {
    return currentUnit.managerSlotId;
  }

  let parentId = currentUnit?.parentId || null;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = unitById.get(parentId);
    if (!parent) break;
    if (parent.managerSlotId && parent.managerSlotId !== employeeSlot.id) return parent.managerSlotId;
    parentId = parent.parentId || null;
  }
  return null;
};

export const getHrmEmployeeOrganizationSummary = (
  employeeId: string,
  slots: HrmOrgPositionSlot[],
  assignments: HrmEmployeeSlotAssignment[],
  units: HrmSharedOrgUnit[],
  date = new Date().toISOString().slice(0, 10),
): HrmEmployeeOrganizationSummary => {
  const activeAssignment = getActiveOfficialAssignment(employeeId, slots, assignments, date);
  const employeeSlot = activeAssignment
    ? slots.find(slot => slot.id === activeAssignment.slotId)
    : null;
  if (!activeAssignment || !employeeSlot) {
    return {
      status: 'PENDING',
      employeeId,
      assignmentId: null,
      slotId: null,
      orgUnitId: null,
      positionId: null,
      levelCode: null,
      managerEmployeeId: null,
    };
  }

  const managerSlotId = resolveManagerSlotId(employeeSlot, units);
  const managerAssignment = managerSlotId
    ? assignments
      .filter(assignment =>
        assignment.slotId === managerSlotId &&
        assignment.status === 'ACTIVE' &&
        (assignment.assignmentType === 'PRIMARY' || assignment.assignmentType === 'ACTING') &&
        isEffectiveOn(assignment, date))
      .sort((a, b) => Number(b.assignmentType === 'ACTING') - Number(a.assignmentType === 'ACTING'))[0]
    : null;

  return {
    status: 'ASSIGNED',
    employeeId,
    assignmentId: activeAssignment.id,
    slotId: employeeSlot.id,
    orgUnitId: employeeSlot.orgUnitId,
    positionId: employeeSlot.positionId,
    levelCode: employeeSlot.levelCode || null,
    managerEmployeeId: managerAssignment?.employeeId || null,
  };
};
