import { describe, expect, it } from 'vitest';
import {
  buildHrmOrgForest,
  getHrmSlotOccupancy,
  wouldCreateSlotReportingCycle,
} from '../hrmSharedCatalogModel';

describe('hrmSharedCatalogModel', () => {
  it('builds an ordered organization forest and keeps orphan units visible', () => {
    const units = [
      { id: 'dept', name: 'Phòng HCNS', parentId: 'block', orderIndex: 20 },
      { id: 'root', name: 'Tiến Thịnh Group', parentId: null, orderIndex: 0 },
      { id: 'block', name: 'Khối văn phòng', parentId: 'root', orderIndex: 10 },
      { id: 'orphan', name: 'Đơn vị chưa phân nhánh', parentId: 'missing', orderIndex: 5 },
    ];

    const forest = buildHrmOrgForest(units);

    expect(forest.map(node => node.id)).toEqual(['root', 'orphan']);
    expect(forest[0].children[0].id).toBe('block');
    expect(forest[0].children[0].children[0].id).toBe('dept');
  });

  it('derives occupied, planned and vacant states from effective assignments', () => {
    const assignments = [
      {
        id: 'active', slotId: 'slot-active', employeeId: 'emp-1',
        assignmentType: 'PRIMARY' as const, status: 'ACTIVE' as const,
        effectiveFrom: '2026-08-01', effectiveTo: null,
      },
      {
        id: 'planned', slotId: 'slot-planned', employeeId: 'emp-2',
        assignmentType: 'PRIMARY' as const, status: 'PLANNED' as const,
        effectiveFrom: '2026-09-01', effectiveTo: null,
      },
    ];

    expect(getHrmSlotOccupancy('slot-active', assignments, '2026-08-18').status).toBe('OCCUPIED');
    expect(getHrmSlotOccupancy('slot-planned', assignments, '2026-08-18').status).toBe('PLANNED');
    expect(getHrmSlotOccupancy('slot-vacant', assignments, '2026-08-18').status).toBe('VACANT');
  });

  it('detects a reporting cycle before saving a manager slot', () => {
    const slots = [
      { id: 'director', reportsToSlotId: null },
      { id: 'manager', reportsToSlotId: 'director' },
      { id: 'staff', reportsToSlotId: 'manager' },
    ];

    expect(wouldCreateSlotReportingCycle(slots, 'director', 'staff')).toBe(true);
    expect(wouldCreateSlotReportingCycle(slots, 'staff', 'director')).toBe(false);
    expect(wouldCreateSlotReportingCycle(slots, 'staff', 'staff')).toBe(true);
  });
});
