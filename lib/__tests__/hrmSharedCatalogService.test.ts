import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { from, rpc } }));

import { hrmSharedCatalogService } from '../hrmSharedCatalogService';

describe('hrmSharedCatalogService', () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it('loads and maps the linked HRM catalog bundle', async () => {
    const rows: Record<string, unknown[]> = {
      org_units: [{ id: 'u1', code: 'K1', name: 'Khối VP', type: 'custom', parent_id: null, order_index: 1, is_active: true }],
      hrm_org_position_slots: [{ id: 's1', code: 'K1-HCNS-01', org_unit_id: 'u1', position_id: 'p1', slot_type: 'STANDARD', status: 'ACTIVE', effective_from: '2026-08-18', sort_order: 1, source: 'manual' }],
      hrm_employee_slot_assignments: [],
      hrm_positions: [{ id: 'p1', code: 'TP', name: 'Trưởng phòng', group_code: 'QL', level_code: 'E7', is_active: true, sort_order: 1, source: 'catalog' }],
      hrm_position_groups: [{ id: 'g1', code: 'CG', name: 'Chuyên gia', is_active: true, sort_order: 7 }],
      hrm_position_levels: [{ id: 'l1', code: 'E7', name: 'Level E7', is_active: true, sort_order: 7 }],
      hrm_competency_groups: [],
      hrm_competency_levels: [],
      hrm_catalog_items: [
        { id: 'c1', catalog_key: 'employment_status', code: 'TS', name: 'Thai sản', is_active: true, sort_order: 4 },
        { id: 'c2', catalog_key: 'education_level', code: 'DH', name: 'Đại học', is_active: true, sort_order: 4 },
        { id: 'c3', catalog_key: 'labor_contract_type', code: '36T', name: '36 tháng', is_active: true, sort_order: 4 },
      ],
    };
    from.mockImplementation((table: string) => ({
      select: vi.fn().mockResolvedValue({ data: rows[table] || [], error: null }),
    }));
    rpc.mockResolvedValue({
      data: [{ id: 'e1', employee_code: 'TT001', full_name: 'Nguyễn A', status: 'Đang làm việc', org_unit_id: 'u1', position_id: 'p1' }],
      error: null,
    });

    const bundle = await hrmSharedCatalogService.load();

    expect(bundle.orgUnits[0]).toEqual(expect.objectContaining({ id: 'u1', parentId: null, orderIndex: 1 }));
    expect(bundle.slots[0]).toEqual(expect.objectContaining({ orgUnitId: 'u1', levelCode: null }));
    expect(bundle.employmentStatuses.map(item => item.code)).toEqual(['TS']);
    expect(bundle.educationLevels.map(item => item.code)).toEqual(['DH']);
    expect(bundle.contractTypes.map(item => item.code)).toEqual(['36T']);
    expect(bundle.positionGroups[0].code).toBe('CG');
    expect(bundle.employees[0].id).toBe('e1');
    expect(rpc).toHaveBeenCalledWith('list_hrm_employee_directory');
    expect(from.mock.calls.map(([table]) => table)).not.toContain('employees');
  });

  it('saves a new position slot using database column names', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 's1', code: 'HCNS-TP-01', org_unit_id: 'u1', position_id: 'p1', slot_type: 'STANDARD', status: 'ACTIVE', effective_from: '2026-08-18', sort_order: 0, source: 'manual' },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    from.mockReturnValue({ insert });

    const slot = await hrmSharedCatalogService.createSlot({
      code: 'HCNS-TP-01', orgUnitId: 'u1', positionId: 'p1',
      levelCode: 'E7', reportsToSlotId: null, slotType: 'STANDARD',
      effectiveFrom: '2026-08-18', description: '', actorId: 'actor-1',
    });

    expect(from).toHaveBeenCalledWith('hrm_org_position_slots');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      code: 'HCNS-TP-01', org_unit_id: 'u1', position_id: 'p1',
      level_code: 'E7', created_by: 'actor-1', updated_by: 'actor-1',
    }));
    expect(slot.orgUnitId).toBe('u1');
  });

  it('updates and safely archives job positions', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn(() => ({ eq }));
    from.mockReturnValue({ update });

    await hrmSharedCatalogService.updatePosition('p1', {
      code: 'TP-HCNS', name: 'Trưởng phòng HCNS', groupCode: 'QLCT',
      levelCode: 'E7', suggestedOrgUnitCode: 'HCNS',
    });
    await hrmSharedCatalogService.archivePosition('p1');

    expect(update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      code: 'TP-HCNS', name: 'Trưởng phòng HCNS', group_code: 'QLCT',
      level_code: 'E7', suggested_org_unit_code: 'HCNS',
    }));
    expect(update).toHaveBeenNthCalledWith(2, { is_active: false });
    expect(eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('migrates a legacy position through the atomic database operation', async () => {
    rpc.mockResolvedValue({
      data: { legacy_position_id: 'legacy-1', target_position_id: 'target-1', employees_migrated: 4, slots_migrated: 5 },
      error: null,
    });

    const result = await hrmSharedCatalogService.migrateLegacyPosition('legacy-1', 'target-1');

    expect(rpc).toHaveBeenCalledWith('migrate_hrm_legacy_position', {
      p_legacy_position_id: 'legacy-1', p_target_position_id: 'target-1',
    });
    expect(result).toEqual(expect.objectContaining({ employeesMigrated: 4, slotsMigrated: 5 }));
  });

  it('adjusts staffing without exposing technical slot codes', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        org_unit_id: 'u1', position_id: 'p1', level_code: 'E4',
        reports_to_slot_id: null, planned_count: 3, occupied_count: 1, vacant_count: 2,
      },
      error: null,
    });

    const result = await hrmSharedCatalogService.adjustStaffing({
      orgUnitId: 'u1', positionId: 'p1', levelCode: 'E4',
      reportsToSlotId: null, targetCount: 3, note: 'Định biên QLDA', sourceReference: 'manual-admin',
    });

    expect(rpc).toHaveBeenCalledWith('adjust_hrm_staffing', {
      p_org_unit_id: 'u1', p_position_id: 'p1', p_level_code: 'E4',
      p_reports_to_slot_id: null, p_target_count: 3, p_note: 'Định biên QLDA',
      p_source_reference: 'manual-admin',
    });
    expect(result).toEqual(expect.objectContaining({ targetCount: 3, occupiedCount: 1, vacantCount: 2 }));
    expect(result).not.toHaveProperty('code');
  });

  it('assigns an employee to a staffing row through the atomic operation', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        employee_id: 'e1', status: 'ASSIGNED', assignment_id: 'a1', slot_id: 's1',
        org_unit_id: 'u1', position_id: 'p1', level_code: 'E4',
      },
      error: null,
    });

    const result = await hrmSharedCatalogService.assignEmployeeToStaffing({
      employeeId: 'e1', orgUnitId: 'u1', positionId: 'p1', levelCode: 'E4',
      reportsToSlotId: null, effectiveFrom: '2026-08-18', note: 'Điều chuyển chính thức', sourceReference: 'manual-admin',
    });

    expect(rpc).toHaveBeenCalledWith('assign_hrm_employee_to_staffing', {
      p_employee_id: 'e1', p_org_unit_id: 'u1', p_position_id: 'p1',
      p_level_code: 'E4', p_reports_to_slot_id: null,
      p_effective_from: '2026-08-18', p_note: 'Điều chuyển chính thức',
      p_source_reference: 'manual-admin',
    });
    expect(result).toEqual(expect.objectContaining({ status: 'ASSIGNED', employeeId: 'e1', slotId: 's1' }));
  });

  it('unassigns an employee while returning the pending state', async () => {
    rpc.mockResolvedValueOnce({
      data: { employee_id: 'e1', status: 'PENDING_ALLOCATION' },
      error: null,
    });

    const result = await hrmSharedCatalogService.unassignEmployeeFromOrganization({
      employeeId: 'e1', effectiveTo: '2026-08-18', note: 'Chờ phân bổ lại', sourceReference: 'manual-admin',
    });

    expect(rpc).toHaveBeenCalledWith('unassign_hrm_employee_from_organization', {
      p_employee_id: 'e1', p_effective_to: '2026-08-18', p_note: 'Chờ phân bổ lại',
      p_source_reference: 'manual-admin',
    });
    expect(result).toEqual(expect.objectContaining({ status: 'PENDING', employeeId: 'e1' }));
  });

  it('sets the unique staffing row as the unit manager', async () => {
    rpc.mockResolvedValueOnce({
      data: { org_unit_id: 'u1', manager_slot_id: 's-manager' },
      error: null,
    });

    const result = await hrmSharedCatalogService.setUnitManagerStaffing({
      orgUnitId: 'u1', positionId: 'p-manager', levelCode: 'E7', reportsToSlotId: null,
      reason: 'Bổ nhiệm quản lý đơn vị', sourceReference: 'manual-admin',
    });

    expect(rpc).toHaveBeenCalledWith('set_hrm_unit_manager_staffing', {
      p_org_unit_id: 'u1', p_position_id: 'p-manager',
      p_level_code: 'E7', p_reports_to_slot_id: null,
      p_reason: 'Bổ nhiệm quản lý đơn vị', p_source_reference: 'manual-admin',
    });
    expect(result).toEqual({ orgUnitId: 'u1', managerSlotId: 's-manager' });
  });

  it('uses a Vietnamese fallback when a workforce RPC has no message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: {} });

    await expect(hrmSharedCatalogService.adjustStaffing({
      orgUnitId: 'u1', positionId: 'p1', targetCount: 1,
      note: 'Điều chỉnh theo kế hoạch', sourceReference: 'manual-admin',
    })).rejects.toThrow('Không thể điều chỉnh định biên nhân sự.');
  });

  it('loads the lightweight organization bundle without unrelated HRM catalogs', async () => {
    const rows: Record<string, unknown[]> = {
      org_units: [{ id: 'u1', name: 'QLDA', type: 'department', is_active: true }],
      hrm_org_position_slots: [],
      hrm_employee_slot_assignments: [],
      hrm_positions: [{ id: 'p1', name: 'Chuyên viên', is_active: true }],
    };
    from.mockImplementation((table: string) => ({
      select: vi.fn().mockResolvedValue({ data: rows[table] || [], error: null }),
    }));
    rpc.mockResolvedValue({
      data: [{ id: 'e1', employee_code: 'TT001', full_name: 'Nguyễn A', status: 'Đang làm việc' }],
      error: null,
    });

    const bundle = await hrmSharedCatalogService.loadOrganizationBundle();

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      'org_units', 'hrm_org_position_slots', 'hrm_employee_slot_assignments', 'hrm_positions',
    ]);
    expect(rpc).toHaveBeenCalledWith('list_hrm_employee_directory');
    expect(bundle.employees[0].id).toBe('e1');
    expect(bundle).not.toHaveProperty('competencyGroups');
  });
});
