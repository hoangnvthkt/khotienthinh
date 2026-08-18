import { describe, expect, it } from 'vitest';
import {
  buildHrmStaffingRows,
  getHrmEmployeeOrganizationSummary,
} from '../hrmSharedCatalogModel';
import type {
  HrmEmployeeSlotAssignment,
  HrmOrgPositionSlot,
  HrmSharedOrgUnit,
} from '../../types/hrmSharedCatalog';

const slot = (overrides: Partial<HrmOrgPositionSlot> & Pick<HrmOrgPositionSlot, 'id'>): HrmOrgPositionSlot => ({
  id: overrides.id,
  code: overrides.code || `SLOT-${overrides.id}`,
  orgUnitId: overrides.orgUnitId || 'u1',
  positionId: overrides.positionId || 'p1',
  levelCode: overrides.levelCode ?? 'E4',
  reportsToSlotId: overrides.reportsToSlotId ?? null,
  slotType: overrides.slotType || 'STANDARD',
  status: overrides.status || 'ACTIVE',
  description: overrides.description ?? null,
  effectiveFrom: overrides.effectiveFrom || '2026-08-01',
  effectiveTo: overrides.effectiveTo ?? null,
  sortOrder: overrides.sortOrder || 0,
  source: overrides.source || 'workforce_plan',
});

const assignment = (
  overrides: Partial<HrmEmployeeSlotAssignment> & Pick<HrmEmployeeSlotAssignment, 'id' | 'slotId' | 'employeeId'>,
): HrmEmployeeSlotAssignment => ({
  id: overrides.id,
  slotId: overrides.slotId,
  employeeId: overrides.employeeId,
  assignmentType: overrides.assignmentType || 'PRIMARY',
  status: overrides.status || 'ACTIVE',
  effectiveFrom: overrides.effectiveFrom || '2026-08-01',
  effectiveTo: overrides.effectiveTo ?? null,
  note: overrides.note ?? null,
  source: overrides.source || 'manual',
});

const unit = (overrides: Partial<HrmSharedOrgUnit> & Pick<HrmSharedOrgUnit, 'id'>): HrmSharedOrgUnit => ({
  id: overrides.id,
  code: overrides.code || overrides.id.toUpperCase(),
  name: overrides.name || `Đơn vị ${overrides.id}`,
  type: overrides.type || 'department',
  customTypeLabel: overrides.customTypeLabel ?? null,
  parentId: overrides.parentId ?? null,
  blockCode: overrides.blockCode ?? null,
  managerSlotId: overrides.managerSlotId ?? null,
  description: overrides.description ?? null,
  orderIndex: overrides.orderIndex || 0,
  isActive: overrides.isActive ?? true,
});

describe('HRM workforce planning model', () => {
  it('groups only official active slots into business-facing staffing rows', () => {
    const rows = buildHrmStaffingRows(
      [
        slot({ id: 's1' }),
        slot({ id: 's2' }),
        slot({ id: 'legacy', source: 'employee_backfill' }),
        slot({ id: 'archived', status: 'ARCHIVED' }),
      ],
      [assignment({ id: 'a1', slotId: 's1', employeeId: 'e1' })],
      [unit({ id: 'u1', managerSlotId: 's1' })],
      '2026-08-18',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgUnitId: 'u1',
      positionId: 'p1',
      levelCode: 'E4',
      plannedCount: 2,
      occupiedCount: 1,
      vacantCount: 1,
      isManager: true,
    });
    expect(rows[0].slots.map(item => item.id)).toEqual(['s1', 's2']);
  });

  it('keeps staffing with different reporting lines in separate rows', () => {
    const rows = buildHrmStaffingRows(
      [
        slot({ id: 's1', reportsToSlotId: 'manager-a' }),
        slot({ id: 's2', reportsToSlotId: 'manager-b' }),
      ],
      [],
      [unit({ id: 'u1' })],
      '2026-08-18',
    );

    expect(rows.map(row => row.reportsToSlotId)).toEqual(['manager-a', 'manager-b']);
    expect(rows.every(row => row.plannedCount === 1)).toBe(true);
  });

  it('marks employees without an official active assignment as pending', () => {
    const slots = [
      slot({ id: 'official' }),
      slot({ id: 'legacy', source: 'employee_backfill' }),
    ];
    const assignments = [
      assignment({ id: 'old', slotId: 'legacy', employeeId: 'e1', status: 'ENDED', effectiveTo: '2026-08-18' }),
    ];

    expect(getHrmEmployeeOrganizationSummary('e1', slots, assignments, [unit({ id: 'u1' })], '2026-08-18'))
      .toEqual({
        status: 'PENDING',
        employeeId: 'e1',
        assignmentId: null,
        slotId: null,
        orgUnitId: null,
        positionId: null,
        levelCode: null,
        managerEmployeeId: null,
      });
  });

  it('resolves the employee and manager occupying the unit manager slot', () => {
    const slots = [
      slot({ id: 'staff', positionId: 'p-staff', reportsToSlotId: 'manager' }),
      slot({ id: 'manager', positionId: 'p-manager', levelCode: 'E7' }),
    ];
    const assignments = [
      assignment({ id: 'staff-assignment', slotId: 'staff', employeeId: 'e1' }),
      assignment({ id: 'manager-assignment', slotId: 'manager', employeeId: 'manager-employee' }),
    ];

    expect(getHrmEmployeeOrganizationSummary(
      'e1', slots, assignments, [unit({ id: 'u1', managerSlotId: 'manager' })], '2026-08-18',
    )).toEqual({
      status: 'ASSIGNED',
      employeeId: 'e1',
      assignmentId: 'staff-assignment',
      slotId: 'staff',
      orgUnitId: 'u1',
      positionId: 'p-staff',
      levelCode: 'E4',
      managerEmployeeId: 'manager-employee',
    });
  });
});
