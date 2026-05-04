import { supabase } from './supabase';
import { ProjectPermissionType, ProjectStaff, ProjectStaffPermission } from '../types';
import { fromDb, toDb } from './dbMapping';
import { auditService } from './auditService';

// ══════════════════════════════════════════════════════════════
//  PROJECT STAFF SERVICE — Phân bổ nhân sự + quyền nghiệp vụ
// ══════════════════════════════════════════════════════════════

const STAFF_TABLE = 'project_staff';
const PERM_TABLE = 'project_staff_permissions';
const PERM_TYPE_TABLE = 'project_permission_types';

export type ProjectPermissionCode = 'view' | 'edit' | 'submit' | 'verify' | 'confirm' | 'approve';

export const PROJECT_PERMISSION_LABELS: Record<ProjectPermissionCode, string> = {
  view: 'xem dữ liệu',
  edit: 'sửa dữ liệu',
  submit: 'gửi yêu cầu',
  verify: 'xác nhận kết quả',
  confirm: 'xác nhận nghiệp vụ',
  approve: 'phê duyệt',
};

const PROJECT_PERMISSION_CODES = new Set<ProjectPermissionCode>([
  'view',
  'edit',
  'submit',
  'verify',
  'confirm',
  'approve',
]);

export const normalizeProjectPermissionCode = (code: string): ProjectPermissionCode | null => {
  if (code === 'reject' || code === 'returned') return 'verify';
  if (code === 'paid') return 'confirm';
  return PROJECT_PERMISSION_CODES.has(code as ProjectPermissionCode) ? (code as ProjectPermissionCode) : null;
};

const isActiveStaff = (staff: ProjectStaff) => !staff.endDate;

const getPermissionDeniedMessage = (code: ProjectPermissionCode, actionLabel?: string) => {
  const label = actionLabel || PROJECT_PERMISSION_LABELS[code];
  return `Bạn cần quyền "${code}" (${PROJECT_PERMISSION_LABELS[code]}) để ${label}.`;
};

const isMissingRpcError = (error: any) => {
  const msg = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return error?.code === 'PGRST202' || error?.code === 'PGRST203' || error?.code === '42883' || msg.includes('replace_project_staff_permissions');
};

const hydrateStaffRows = async (staffRows: any[]): Promise<ProjectStaff[]> => {
  if (!staffRows?.length) return [];

  const staffIds = staffRows.map(r => r.id);

  // Load permissions cho tất cả staff
  const { data: permRows, error: permErr } = await supabase
    .from(PERM_TABLE)
    .select('*, permission_type:project_permission_types(code, name)')
    .in('staff_id', staffIds);
  if (permErr) throw permErr;

  // Load positions
  const positionIds = [...new Set(staffRows.map(r => r.position_id).filter(Boolean))];
  const { data: posRows } = positionIds.length > 0
    ? await supabase
      .from('hrm_positions')
      .select('id, name, level')
      .in('id', positionIds)
    : { data: [] as any[] };
  const posMap = new Map((posRows || []).map(p => [p.id, p]));

  // Load user info
  const userIds = [...new Set(staffRows.map(r => r.user_id).filter(Boolean))];
  const { data: userRows } = userIds.length > 0
    ? await supabase
      .from('users')
      .select('id, name, avatar')
      .in('id', userIds)
    : { data: [] as any[] };
  const userMap = new Map((userRows || []).map(u => [u.id, u]));

  // Assemble
  return staffRows.map(row => {
    const pos = posMap.get(row.position_id);
    const usr = userMap.get(row.user_id);
    const perms = (permRows || [])
      .filter(p => p.staff_id === row.id)
      .map(p => ({
        ...fromDb(p),
        permissionCode: p.permission_type?.code,
        permissionName: p.permission_type?.name,
      }));

    return {
      ...fromDb(row),
      positionName: pos?.name,
      positionLevel: pos?.level,
      userName: usr?.name,
      userAvatar: usr?.avatar,
      permissions: perms,
    } as ProjectStaff;
  });
};

// ── Permission Types (Master Data CRUD) ──

export const projectPermissionTypeService = {
  async list(): Promise<ProjectPermissionType[]> {
    const { data, error } = await supabase
      .from(PERM_TYPE_TABLE)
      .select('*')
      .order('sort_order');
    if (error) throw error;
    return (data || []).map(fromDb);
  },

  async upsert(item: Partial<ProjectPermissionType> & { id?: string }): Promise<void> {
    const dbData = toDb(item);
    if (item.id) {
      const { error } = await supabase.from(PERM_TYPE_TABLE).update(dbData).eq('id', item.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(PERM_TYPE_TABLE).insert(dbData);
      if (error) throw error;
    }
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from(PERM_TYPE_TABLE).delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Project Staff (per Construction Site) ──

export const projectStaffService = {
  /** Load tất cả staff của 1 CT kèm vị trí + quyền */
  async listBySite(constructionSiteId: string): Promise<ProjectStaff[]> {
    const { data: staffRows, error: staffErr } = await supabase
      .from(STAFF_TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('sort_order');
    if (staffErr) throw staffErr;
    return hydrateStaffRows(staffRows || []);
  },

  /** Load staff theo Project master, kèm fallback dữ liệu cũ theo construction site nếu có */
  async listByProject(projectId: string, constructionSiteId?: string): Promise<ProjectStaff[]> {
    const queries = [
      supabase
        .from(STAFF_TABLE)
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order'),
    ];

    if (constructionSiteId) {
      queries.push(
        supabase
          .from(STAFF_TABLE)
          .select('*')
          .eq('construction_site_id', constructionSiteId)
          .order('sort_order')
      );
    }

    const results = await Promise.all(queries);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    const byId = new Map<string, any>();
    for (const result of results) {
      for (const row of result.data || []) {
        byId.set(row.id, row);
      }
    }

    const rows = [...byId.values()].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return hydrateStaffRows(rows);
  },

  async add(staff: {
    projectId?: string;
    constructionSiteId?: string | null;
    userId: string;
    positionId: string;
    permissionTypeIds: string[];
    startDate?: string;
    note?: string;
    grantedBy?: string;
    operatorName?: string;
  }): Promise<string> {
    // Insert staff record
    const { data, error } = await supabase.from(STAFF_TABLE).insert({
      project_id: staff.projectId || null,
      construction_site_id: staff.constructionSiteId || null,
      user_id: staff.userId,
      position_id: staff.positionId,
      start_date: staff.startDate || new Date().toISOString().slice(0, 10),
      note: staff.note || null,
    }).select('id').single();
    if (error) throw error;

    const staffId = data.id;

    try {
      if (staff.permissionTypeIds.length > 0) {
        await this.setPermissions(staffId, staff.permissionTypeIds, staff.grantedBy, staff.operatorName);
      }
    } catch (permErr) {
      await supabase.from(STAFF_TABLE).delete().eq('id', staffId);
      throw permErr;
    }

    await auditService.log({
      tableName: 'project_staff',
      recordId: staffId,
      action: 'INSERT',
      newData: { userId: staff.userId, positionId: staff.positionId, projectId: staff.projectId },
      userId: staff.grantedBy || 'system',
      userName: staff.operatorName || 'System',
      description: `Thêm nhân sự vào dự án`,
    });

    return staffId;
  },

  async update(staffId: string, updates: {
    positionId?: string;
    startDate?: string;
    endDate?: string | null;
    note?: string;
    sortOrder?: number;
  }, operatorId?: string, operatorName?: string): Promise<void> {
    const { data: old } = await supabase.from(STAFF_TABLE).select('*').eq('id', staffId).single();

    const dbData: any = { updated_at: new Date().toISOString() };
    if (updates.positionId !== undefined) dbData.position_id = updates.positionId;
    if (updates.startDate !== undefined) dbData.start_date = updates.startDate;
    if (updates.endDate !== undefined) dbData.end_date = updates.endDate;
    if (updates.note !== undefined) dbData.note = updates.note;
    if (updates.sortOrder !== undefined) dbData.sort_order = updates.sortOrder;

    const { error } = await supabase.from(STAFF_TABLE).update(dbData).eq('id', staffId);
    if (error) throw error;

    await auditService.log({
      tableName: 'project_staff',
      recordId: staffId,
      action: 'UPDATE',
      oldData: old || {},
      newData: { ...old, ...dbData },
      userId: operatorId || 'system',
      userName: operatorName || 'System',
      description: `Cập nhật nhân sự dự án`,
    });
  },

  async remove(staffId: string, operatorId?: string, operatorName?: string): Promise<void> {
    const { data: old } = await supabase.from(STAFF_TABLE).select('*').eq('id', staffId).single();
    // CASCADE sẽ xoá permissions
    const { error } = await supabase.from(STAFF_TABLE).delete().eq('id', staffId);
    if (error) throw error;

    await auditService.log({
      tableName: 'project_staff',
      recordId: staffId,
      action: 'DELETE',
      oldData: old || {},
      userId: operatorId || 'system',
      userName: operatorName || 'System',
      description: `Xoá nhân sự khỏi dự án`,
    });
  },

  /** Cập nhật toàn bộ quyền cho 1 staff (replace all) */
  async setPermissions(staffId: string, permissionTypeIds: string[], grantedBy?: string, operatorName?: string): Promise<void> {
    const nextPermissionTypeIds = [...new Set(permissionTypeIds.filter(Boolean))];
    const { data: oldPerms, error: oldPermsError } = await supabase
      .from(PERM_TABLE)
      .select('permission_type_id')
      .eq('staff_id', staffId);
    if (oldPermsError) throw oldPermsError;

    const rpcResult = await supabase.rpc('replace_project_staff_permissions', {
      p_staff_id: staffId,
      p_permission_type_ids: nextPermissionTypeIds,
      p_granted_by: grantedBy || null,
    });

    if (rpcResult.error) {
      if (!isMissingRpcError(rpcResult.error)) throw rpcResult.error;

      const { error: deleteError } = await supabase.from(PERM_TABLE).delete().eq('staff_id', staffId);
      if (deleteError) throw deleteError;

      if (nextPermissionTypeIds.length > 0) {
        const inserts = nextPermissionTypeIds.map(ptId => ({
          staff_id: staffId,
          permission_type_id: ptId,
          is_active: true,
          granted_by: grantedBy || null,
        }));
        const { error: insertError } = await supabase.from(PERM_TABLE).insert(inserts);
        if (insertError) throw insertError;
      }
    }

    await auditService.log({
      tableName: 'project_staff_permissions',
      recordId: staffId,
      action: 'UPDATE',
      oldData: { permissions: (oldPerms || []).map(p => p.permission_type_id) },
      newData: { permissions: nextPermissionTypeIds },
      userId: grantedBy || 'system',
      userName: operatorName || 'System',
      description: `Cập nhật quyền nhân sự dự án (${oldPerms?.length || 0} → ${nextPermissionTypeIds.length} quyền)`,
    });
  },

  /**
   * PBAC check — user có quyền action tại CT không?
   * Returns: true/false + matched staff record
   */
  async checkPermission(
    userId: string,
    constructionSiteId: string,
    actionCode: string, // 'verify' | 'confirm' | 'approve' | 'submit' | 'edit' | 'view'
  ): Promise<{ allowed: boolean; staffRecord?: ProjectStaff }> {
    const normalizedCode = normalizeProjectPermissionCode(actionCode);
    if (!normalizedCode) return { allowed: false };

    // Load staff records for this user at this site
    const { data: staffRows, error } = await supabase
      .from(STAFF_TABLE)
      .select('id')
      .eq('construction_site_id', constructionSiteId)
      .eq('user_id', userId)
      .is('end_date', null); // Chỉ active staff
    if (error) throw error;
    if (!staffRows?.length) return { allowed: false };

    const staffIds = staffRows.map(r => r.id);

    // Tìm permission type ID cho action code
    const { data: permType, error: permTypeError } = await supabase
      .from(PERM_TYPE_TABLE)
      .select('id')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle();
    if (permTypeError) throw permTypeError;
    if (!permType) return { allowed: false };

    // Check nếu bất kỳ staff record nào có permission này
    const { data: permMatch, error: permMatchError } = await supabase
      .from(PERM_TABLE)
      .select('staff_id')
      .in('staff_id', staffIds)
      .eq('permission_type_id', permType.id)
      .eq('is_active', true)
      .limit(1);
    if (permMatchError) throw permMatchError;

    return { allowed: (permMatch?.length || 0) > 0 };
  },

  /**
   * PBAC check theo project master. Nếu project chưa backfill đủ, có thể fallback theo CT liên kết.
   */
  async checkProjectPermission(
    userId: string,
    projectId: string,
    actionCode: string,
    constructionSiteId?: string,
  ): Promise<{ allowed: boolean; staffRecord?: ProjectStaff }> {
    const normalizedCode = normalizeProjectPermissionCode(actionCode);
    if (!normalizedCode) return { allowed: false };

    let { data: staffRows, error } = await supabase
      .from(STAFF_TABLE)
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .is('end_date', null);
    if (error) throw error;

    if ((!staffRows || staffRows.length === 0) && constructionSiteId) {
      const fallback = await supabase
        .from(STAFF_TABLE)
        .select('id')
        .eq('construction_site_id', constructionSiteId)
        .eq('user_id', userId)
        .is('end_date', null);
      if (fallback.error) throw fallback.error;
      staffRows = fallback.data || [];
    }

    if (!staffRows?.length) return { allowed: false };

    const staffIds = staffRows.map(r => r.id);
    const { data: permType, error: permTypeError } = await supabase
      .from(PERM_TYPE_TABLE)
      .select('id')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle();
    if (permTypeError) throw permTypeError;
    if (!permType) return { allowed: false };

    const { data: permMatch, error: permMatchError } = await supabase
      .from(PERM_TABLE)
      .select('staff_id')
      .in('staff_id', staffIds)
      .eq('permission_type_id', permType.id)
      .eq('is_active', true)
      .limit(1);
    if (permMatchError) throw permMatchError;

    return { allowed: (permMatch?.length || 0) > 0 };
  },

  /** Check nhanh: CT này đã setup staff chưa? */
  async hasSiteStaff(constructionSiteId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('construction_site_id', constructionSiteId)
      .is('end_date', null);
    if (error) throw error;
    return (count || 0) > 0;
  },

  /** Check nhanh: project này đã setup staff chưa? */
  async hasProjectStaff(projectId: string, constructionSiteId?: string): Promise<boolean> {
    const { count, error } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('end_date', null);
    if (error) throw error;
    if ((count || 0) > 0) return true;
    if (!constructionSiteId) return false;
    const { count: fallbackCount, error: fallbackError } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('construction_site_id', constructionSiteId)
      .is('end_date', null);
    if (fallbackError) throw fallbackError;
    return (fallbackCount || 0) > 0;
  },

  async hasProjectPbac(projectId?: string, constructionSiteId?: string | null): Promise<boolean> {
    if (projectId) return this.hasProjectStaff(projectId, constructionSiteId || undefined);
    if (constructionSiteId) return this.hasSiteStaff(constructionSiteId);
    return false;
  },

  async requireProjectPermission(params: {
    userId?: string;
    projectId?: string;
    constructionSiteId?: string | null;
    code: string;
    actionLabel?: string;
  }): Promise<void> {
    const normalizedCode = normalizeProjectPermissionCode(params.code);
    if (!normalizedCode) {
      throw new Error(`Quyền "${params.code}" chưa được cấu hình trong danh mục quyền nghiệp vụ.`);
    }

    const hasPbac = await this.hasProjectPbac(params.projectId, params.constructionSiteId);
    if (!hasPbac) return;
    if (!params.userId) throw new Error('Không xác định được người dùng đang thao tác.');

    const result = params.projectId
      ? await this.checkProjectPermission(params.userId, params.projectId, normalizedCode, params.constructionSiteId || undefined)
      : params.constructionSiteId
        ? await this.checkPermission(params.userId, params.constructionSiteId, normalizedCode)
        : { allowed: false };

    if (!result.allowed) {
      throw new Error(getPermissionDeniedMessage(normalizedCode, params.actionLabel));
    }
  },

  async listProjectStaffWithPermissions(
    projectId: string | undefined,
    constructionSiteId: string | null | undefined,
    permissionCodes: string[],
  ): Promise<ProjectStaff[]> {
    const normalizedCodes = new Set(
      permissionCodes
        .map(code => normalizeProjectPermissionCode(code))
        .filter(Boolean) as ProjectPermissionCode[],
    );
    if (normalizedCodes.size === 0) return [];

    const staffList = projectId
      ? await this.listByProject(projectId, constructionSiteId || undefined)
      : constructionSiteId
        ? await this.listBySite(constructionSiteId)
        : [];

    return staffList.filter(staff =>
      isActiveStaff(staff) &&
      staff.permissions?.some(permission =>
        permission.isActive &&
        !!permission.permissionCode &&
        normalizedCodes.has(normalizeProjectPermissionCode(permission.permissionCode) as ProjectPermissionCode)
      )
    );
  },
};
