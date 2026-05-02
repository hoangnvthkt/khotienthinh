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

    // Insert permissions
    if (staff.permissionTypeIds.length > 0) {
      const permInserts = staff.permissionTypeIds.map(ptId => ({
        staff_id: staffId,
        permission_type_id: ptId,
        is_active: true,
        granted_by: staff.grantedBy || null,
      }));
      const { error: permErr } = await supabase.from(PERM_TABLE).insert(permInserts);
      if (permErr) throw permErr;
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
    const { data: oldPerms } = await supabase.from(PERM_TABLE).select('permission_type_id').eq('staff_id', staffId);
    // Xoá hết cũ
    await supabase.from(PERM_TABLE).delete().eq('staff_id', staffId);

    // Insert mới
    if (permissionTypeIds.length > 0) {
      const inserts = permissionTypeIds.map(ptId => ({
        staff_id: staffId,
        permission_type_id: ptId,
        is_active: true,
        granted_by: grantedBy || null,
      }));
      const { error } = await supabase.from(PERM_TABLE).insert(inserts);
      if (error) throw error;
    }

    await auditService.log({
      tableName: 'project_staff_permissions',
      recordId: staffId,
      action: 'UPDATE',
      oldData: { permissions: (oldPerms || []).map(p => p.permission_type_id) },
      newData: { permissions: permissionTypeIds },
      userId: grantedBy || 'system',
      userName: operatorName || 'System',
      description: `Cập nhật quyền nhân sự dự án (${oldPerms?.length || 0} → ${permissionTypeIds.length} quyền)`,
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
    const { data: permType } = await supabase
      .from(PERM_TYPE_TABLE)
      .select('id')
      .eq('code', actionCode)
      .eq('is_active', true)
      .single();
    if (!permType) return { allowed: false };

    // Check nếu bất kỳ staff record nào có permission này
    const { data: permMatch } = await supabase
      .from(PERM_TABLE)
      .select('staff_id')
      .in('staff_id', staffIds)
      .eq('permission_type_id', permType.id)
      .eq('is_active', true)
      .limit(1);

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
    const { data: permType } = await supabase
      .from(PERM_TYPE_TABLE)
      .select('id')
      .eq('code', actionCode)
      .eq('is_active', true)
      .single();
    if (!permType) return { allowed: false };

    const { data: permMatch } = await supabase
      .from(PERM_TABLE)
      .select('staff_id')
      .in('staff_id', staffIds)
      .eq('permission_type_id', permType.id)
      .eq('is_active', true)
      .limit(1);

    return { allowed: (permMatch?.length || 0) > 0 };
  },

  /** Check nhanh: CT này đã setup staff chưa? */
  async hasSiteStaff(constructionSiteId: string): Promise<boolean> {
    const { count } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('construction_site_id', constructionSiteId);
    return (count || 0) > 0;
  },

  /** Check nhanh: project này đã setup staff chưa? */
  async hasProjectStaff(projectId: string, constructionSiteId?: string): Promise<boolean> {
    const { count } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);
    if ((count || 0) > 0) return true;
    if (!constructionSiteId) return false;
    const { count: fallbackCount } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('construction_site_id', constructionSiteId);
    return (fallbackCount || 0) > 0;
  },
};
