import { supabase } from './supabase';
import type {
  HrmEmployeeSlotAssignment,
  HrmOrgPositionSlot,
  HrmEmployeeOrganizationSummary,
  HrmStaffingMutationResult,
  HrmSharedCatalogBundle,
  HrmSharedCodeItem,
  HrmSharedEmployee,
  HrmSharedOrgUnit,
  HrmSharedPosition,
  HrmSlotType,
} from '../types/hrmSharedCatalog';

const throwIfError = (error: { message?: string } | null, fallback: string) => {
  if (error) throw new Error(error.message || fallback);
};

const mapCodeItem = (row: any): HrmSharedCodeItem => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description ?? null,
  groupCode: row.group_code ?? null,
  isActive: row.is_active !== false,
  sortOrder: Number(row.sort_order || 0),
});

const mapOrgUnit = (row: any): HrmSharedOrgUnit => ({
  id: row.id,
  code: row.code ?? null,
  name: row.name,
  type: row.type,
  customTypeLabel: row.customTypeLabel ?? row.custom_type_label ?? null,
  parentId: row.parent_id ?? null,
  blockCode: row.block_code ?? null,
  managerSlotId: row.manager_slot_id ?? null,
  description: row.description ?? null,
  orderIndex: Number(row.order_index || 0),
  isActive: row.is_active !== false,
});

const mapSlot = (row: any): HrmOrgPositionSlot => ({
  id: row.id,
  code: row.code,
  orgUnitId: row.org_unit_id,
  positionId: row.position_id,
  levelCode: row.level_code ?? null,
  reportsToSlotId: row.reports_to_slot_id ?? null,
  slotType: row.slot_type,
  status: row.status,
  description: row.description ?? null,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to ?? null,
  sortOrder: Number(row.sort_order || 0),
  source: row.source || 'manual',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapAssignment = (row: any): HrmEmployeeSlotAssignment => ({
  id: row.id,
  employeeId: row.employee_id,
  slotId: row.slot_id,
  assignmentType: row.assignment_type,
  status: row.status,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to ?? null,
  note: row.note ?? null,
  source: row.source,
});

const mapEmployee = (row: any): HrmSharedEmployee => ({
  id: row.id,
  employeeCode: row.employee_code,
  fullName: row.full_name,
  title: row.title ?? null,
  avatarUrl: row.avatar_url ?? row.avatar ?? null,
  status: row.status,
  userId: row.user_id ?? null,
  orgUnitId: row.org_unit_id ?? null,
  positionId: row.position_id ?? null,
});

const mapPosition = (row: any): HrmSharedPosition => ({
  id: row.id,
  code: row.code ?? null,
  name: row.name,
  groupCode: row.group_code ?? null,
  levelCode: row.level_code ?? null,
  suggestedOrgUnitCode: row.suggested_org_unit_code ?? null,
  isActive: row.is_active !== false,
  sortOrder: Number(row.sort_order || 0),
  source: row.source || 'legacy',
});

const mapStaffingMutationResult = (row: any): HrmStaffingMutationResult => ({
  orgUnitId: row.org_unit_id,
  positionId: row.position_id,
  levelCode: row.level_code ?? null,
  reportsToSlotId: row.reports_to_slot_id ?? null,
  targetCount: Number(row.target_count ?? row.planned_count ?? 0),
  occupiedCount: Number(row.occupied_count || 0),
  vacantCount: Number(row.vacant_count || 0),
});

const mapEmployeeOrganizationSummary = (row: any): HrmEmployeeOrganizationSummary => ({
  status: row.status === 'ASSIGNED' ? 'ASSIGNED' : 'PENDING',
  employeeId: row.employee_id,
  assignmentId: row.assignment_id ?? null,
  slotId: row.slot_id ?? null,
  orgUnitId: row.org_unit_id ?? null,
  positionId: row.position_id ?? null,
  levelCode: row.level_code ?? null,
  managerEmployeeId: row.manager_employee_id ?? null,
});

const bySortOrder = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi');

export interface CreateHrmSlotInput {
  code: string;
  orgUnitId: string;
  positionId: string;
  levelCode?: string | null;
  reportsToSlotId?: string | null;
  slotType: HrmSlotType;
  effectiveFrom: string;
  description?: string;
  actorId?: string | null;
}

export type HrmCodeCatalogTable =
  | 'hrm_position_groups'
  | 'hrm_position_levels'
  | 'hrm_competency_groups'
  | 'hrm_competency_levels';

export const hrmSharedCatalogService = {
  async load(): Promise<HrmSharedCatalogBundle> {
    const tables = [
      'org_units', 'hrm_org_position_slots', 'hrm_employee_slot_assignments',
      'employees', 'hrm_positions', 'hrm_position_groups', 'hrm_position_levels',
      'hrm_competency_groups', 'hrm_competency_levels', 'hrm_catalog_items',
    ] as const;
    const responses = await Promise.all(tables.map(table => supabase.from(table).select('*')));
    responses.forEach((response, index) => throwIfError(response.error, `Không thể tải ${tables[index]}.`));
    const [orgs, slots, assignments, employees, positions, positionGroups, positionLevels,
      competencyGroups, competencyLevels, catalogItems] = responses.map(response => response.data || []);
    const catalog = (key: string) => (catalogItems as any[])
      .filter(row => row.catalog_key === key && row.is_active !== false)
      .map(mapCodeItem).sort(bySortOrder);

    return {
      orgUnits: (orgs as any[]).filter(row => row.is_active !== false).map(mapOrgUnit),
      slots: (slots as any[]).map(mapSlot),
      assignments: (assignments as any[]).map(mapAssignment),
      employees: (employees as any[]).filter(row => row.status === 'Đang làm việc').map(mapEmployee),
      positions: (positions as any[]).map(mapPosition).sort(bySortOrder),
      positionGroups: (positionGroups as any[]).map(mapCodeItem).sort(bySortOrder),
      positionLevels: (positionLevels as any[]).map(mapCodeItem).sort(bySortOrder),
      competencyGroups: (competencyGroups as any[]).map(mapCodeItem).sort(bySortOrder),
      competencyLevels: (competencyLevels as any[]).map(mapCodeItem).sort(bySortOrder),
      employmentStatuses: catalog('employment_status'),
      contractTypes: catalog('labor_contract_type'),
      educationLevels: catalog('education_level'),
      socialInsuranceStatuses: catalog('social_insurance_status'),
    };
  },

  async loadOrganizationBundle(): Promise<Pick<
    HrmSharedCatalogBundle,
    'orgUnits' | 'slots' | 'assignments' | 'employees' | 'positions'
  >> {
    const tables = [
      'org_units', 'hrm_org_position_slots', 'hrm_employee_slot_assignments',
      'employees', 'hrm_positions',
    ] as const;
    const responses = await Promise.all(tables.map(table => supabase.from(table).select('*')));
    responses.forEach((response, index) =>
      throwIfError(response.error, `Không thể tải ${tables[index]}.`));
    const [orgs, slots, assignments, employees, positions] = responses
      .map(response => response.data || []);

    return {
      orgUnits: (orgs as any[]).filter(row => row.is_active !== false).map(mapOrgUnit),
      slots: (slots as any[]).map(mapSlot),
      assignments: (assignments as any[]).map(mapAssignment),
      employees: (employees as any[])
        .filter(row => row.status === 'Đang làm việc')
        .map(mapEmployee),
      positions: (positions as any[]).map(mapPosition).sort(bySortOrder),
    };
  },

  async adjustStaffing(input: {
    orgUnitId: string;
    positionId: string;
    levelCode?: string | null;
    reportsToSlotId?: string | null;
    targetCount: number;
    note: string;
  }): Promise<HrmStaffingMutationResult> {
    const { data, error } = await supabase.rpc('adjust_hrm_staffing', {
      p_org_unit_id: input.orgUnitId,
      p_position_id: input.positionId,
      p_level_code: input.levelCode || null,
      p_reports_to_slot_id: input.reportsToSlotId || null,
      p_target_count: input.targetCount,
      p_note: input.note.trim() || null,
    });
    throwIfError(error, 'Không thể điều chỉnh định biên nhân sự.');
    return mapStaffingMutationResult(Array.isArray(data) ? data[0] : data);
  },

  async assignEmployeeToStaffing(input: {
    employeeId: string;
    orgUnitId: string;
    positionId: string;
    levelCode?: string | null;
    reportsToSlotId?: string | null;
    effectiveFrom: string;
    note: string;
  }): Promise<HrmEmployeeOrganizationSummary> {
    const { data, error } = await supabase.rpc('assign_hrm_employee_to_staffing', {
      p_employee_id: input.employeeId,
      p_org_unit_id: input.orgUnitId,
      p_position_id: input.positionId,
      p_level_code: input.levelCode || null,
      p_reports_to_slot_id: input.reportsToSlotId || null,
      p_effective_from: input.effectiveFrom,
      p_note: input.note.trim() || null,
    });
    throwIfError(error, 'Không thể phân bổ hoặc chuyển vị trí nhân sự.');
    return mapEmployeeOrganizationSummary(Array.isArray(data) ? data[0] : data);
  },

  async unassignEmployeeFromOrganization(input: {
    employeeId: string;
    effectiveTo: string;
    note: string;
  }): Promise<HrmEmployeeOrganizationSummary> {
    const { data, error } = await supabase.rpc('unassign_hrm_employee_from_organization', {
      p_employee_id: input.employeeId,
      p_effective_to: input.effectiveTo,
      p_note: input.note.trim() || null,
    });
    throwIfError(error, 'Không thể gỡ nhân sự khỏi cơ cấu tổ chức.');
    return mapEmployeeOrganizationSummary(Array.isArray(data) ? data[0] : data);
  },

  async setUnitManagerStaffing(input: {
    orgUnitId: string;
    positionId: string;
    levelCode?: string | null;
    reportsToSlotId?: string | null;
  }): Promise<{ orgUnitId: string; managerSlotId: string | null }> {
    const { data, error } = await supabase.rpc('set_hrm_unit_manager_staffing', {
      p_org_unit_id: input.orgUnitId,
      p_position_id: input.positionId,
      p_level_code: input.levelCode || null,
      p_reports_to_slot_id: input.reportsToSlotId || null,
    });
    throwIfError(error, 'Không thể thiết lập quản lý trực tiếp.');
    const row = Array.isArray(data) ? data[0] : data;
    return { orgUnitId: row.org_unit_id, managerSlotId: row.manager_slot_id ?? null };
  },

  async createSlot(input: CreateHrmSlotInput): Promise<HrmOrgPositionSlot> {
    const { data, error } = await supabase.from('hrm_org_position_slots').insert({
      code: input.code.trim().toUpperCase(),
      org_unit_id: input.orgUnitId,
      position_id: input.positionId,
      level_code: input.levelCode || null,
      reports_to_slot_id: input.reportsToSlotId || null,
      slot_type: input.slotType,
      status: 'ACTIVE',
      effective_from: input.effectiveFrom,
      description: input.description?.trim() || null,
      source: 'manual',
      created_by: input.actorId || null,
      updated_by: input.actorId || null,
    }).select('*').single();
    throwIfError(error, 'Không thể tạo slot tổ chức.');
    return mapSlot(data);
  },

  async createOrgUnit(input: {
    code: string;
    name: string;
    type: string;
    parentId?: string | null;
    blockCode?: string | null;
    description?: string;
  }): Promise<void> {
    const { error } = await supabase.from('org_units').insert({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      type: input.type,
      customTypeLabel: input.type === 'custom' ? 'Khối' : null,
      parent_id: input.parentId || null,
      block_code: input.blockCode || null,
      description: input.description?.trim() || null,
      source: 'manual',
      is_active: true,
    });
    throwIfError(error, 'Không thể tạo đơn vị tổ chức.');
  },

  async createPosition(input: {
    code: string;
    name: string;
    groupCode: string;
    levelCode: string;
    suggestedOrgUnitCode?: string | null;
  }): Promise<void> {
    const { error } = await supabase.from('hrm_positions').insert({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      group_code: input.groupCode || null,
      level_code: input.levelCode || null,
      suggested_org_unit_code: input.suggestedOrgUnitCode || null,
      source: 'manual',
      is_active: true,
    });
    throwIfError(error, 'Không thể tạo vị trí công việc.');
  },

  async updatePosition(positionId: string, input: {
    code: string;
    name: string;
    groupCode: string;
    levelCode: string;
    suggestedOrgUnitCode?: string | null;
  }): Promise<void> {
    const { error } = await supabase.from('hrm_positions').update({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      group_code: input.groupCode || null,
      level_code: input.levelCode || null,
      suggested_org_unit_code: input.suggestedOrgUnitCode || null,
    }).eq('id', positionId);
    throwIfError(error, 'Không thể cập nhật vị trí công việc.');
  },

  async archivePosition(positionId: string): Promise<void> {
    const { error } = await supabase.from('hrm_positions')
      .update({ is_active: false })
      .eq('id', positionId);
    throwIfError(error, 'Không thể ngưng sử dụng vị trí công việc.');
  },

  async migrateLegacyPosition(legacyPositionId: string, targetPositionId: string): Promise<{
    legacyPositionId: string;
    targetPositionId: string;
    employeesMigrated: number;
    slotsMigrated: number;
  }> {
    const { data, error } = await supabase.rpc('migrate_hrm_legacy_position', {
      p_legacy_position_id: legacyPositionId,
      p_target_position_id: targetPositionId,
    });
    throwIfError(error, 'Không thể chuyển đổi vị trí LEGACY.');
    return {
      legacyPositionId: data.legacy_position_id,
      targetPositionId: data.target_position_id,
      employeesMigrated: Number(data.employees_migrated || 0),
      slotsMigrated: Number(data.slots_migrated || 0),
    };
  },

  async createCodeItem(input: {
    table: HrmCodeCatalogTable;
    code: string;
    name: string;
    description?: string;
  }): Promise<void> {
    const { error } = await supabase.from(input.table).insert({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      source: 'manual',
      is_active: true,
    });
    throwIfError(error, 'Không thể thêm danh mục HRM.');
  },

  async createCatalogItem(input: {
    catalogKey: 'employment_status' | 'labor_contract_type' | 'education_level' | 'social_insurance_status';
    code: string;
    name: string;
    description?: string;
  }): Promise<void> {
    const { error } = await supabase.from('hrm_catalog_items').insert({
      catalog_key: input.catalogKey,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      source: 'manual',
      is_active: true,
    });
    throwIfError(error, 'Không thể thêm danh mục HRM.');
  },

  async setUnitManagerSlot(orgUnitId: string, managerSlotId: string | null): Promise<void> {
    const { error } = await supabase.from('org_units')
      .update({ manager_slot_id: managerSlotId })
      .eq('id', orgUnitId);
    throwIfError(error, 'Không thể cập nhật người quản lý trực tiếp.');
  },

  async assignEmployee(input: {
    employeeId: string;
    slotId: string;
    effectiveFrom: string;
    note?: string;
    actorId?: string | null;
  }): Promise<HrmEmployeeSlotAssignment> {
    const { data, error } = await supabase.rpc('assign_hrm_employee_to_slot', {
      p_employee_id: input.employeeId,
      p_slot_id: input.slotId,
      p_effective_from: input.effectiveFrom,
      p_note: input.note?.trim() || null,
      p_actor_id: input.actorId || null,
    });
    throwIfError(error, 'Không thể phân bổ nhân sự vào slot.');
    return mapAssignment(Array.isArray(data) ? data[0] : data);
  },

  async archiveSlot(slotId: string, actorId?: string | null): Promise<void> {
    const { error } = await supabase.from('hrm_org_position_slots')
      .update({ status: 'ARCHIVED', effective_to: new Date().toISOString().slice(0, 10), updated_by: actorId || null })
      .eq('id', slotId);
    throwIfError(error, 'Không thể lưu trữ slot tổ chức.');
  },
};
