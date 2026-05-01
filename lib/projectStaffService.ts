import { supabase } from './supabase';
import { ProjectPermissionType, ProjectStaff, ProjectStaffPermission } from '../types';
import { fromDb, toDb } from './dbMapping';

// ══════════════════════════════════════════════════════════════
//  PROJECT STAFF SERVICE — Phân bổ nhân sự + quyền nghiệp vụ
// ══════════════════════════════════════════════════════════════

const STAFF_TABLE = 'project_staff';
const PERM_TABLE = 'project_staff_permissions';
const PERM_TYPE_TABLE = 'project_permission_types';

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
    if (!staffRows?.length) return [];

    const staffIds = staffRows.map(r => r.id);

    // Load permissions cho tất cả staff
    const { data: permRows, error: permErr } = await supabase
      .from(PERM_TABLE)
      .select('*, permission_type:project_permission_types(code, name)')
      .in('staff_id', staffIds);
    if (permErr) throw permErr;

    // Load positions
    const positionIds = [...new Set(staffRows.map(r => r.position_id))];
    const { data: posRows } = await supabase
      .from('hrm_positions')
      .select('id, name, level')
      .in('id', positionIds);
    const posMap = new Map((posRows || []).map(p => [p.id, p]));

    // Load user info
    const userIds = [...new Set(staffRows.map(r => r.user_id))];
    const { data: userRows } = await supabase
      .from('users')
      .select('id, name, avatar')
      .in('id', userIds);
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
  },

  async add(staff: {
    constructionSiteId: string;
    userId: string;
    positionId: string;
    permissionTypeIds: string[];
    startDate?: string;
    note?: string;
    grantedBy?: string;
  }): Promise<string> {
    // Insert staff record
    const { data, error } = await supabase.from(STAFF_TABLE).insert({
      construction_site_id: staff.constructionSiteId,
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

    return staffId;
  },

  async update(staffId: string, updates: {
    positionId?: string;
    startDate?: string;
    endDate?: string | null;
    note?: string;
    sortOrder?: number;
  }): Promise<void> {
    const dbData: any = { updated_at: new Date().toISOString() };
    if (updates.positionId !== undefined) dbData.position_id = updates.positionId;
    if (updates.startDate !== undefined) dbData.start_date = updates.startDate;
    if (updates.endDate !== undefined) dbData.end_date = updates.endDate;
    if (updates.note !== undefined) dbData.note = updates.note;
    if (updates.sortOrder !== undefined) dbData.sort_order = updates.sortOrder;

    const { error } = await supabase.from(STAFF_TABLE).update(dbData).eq('id', staffId);
    if (error) throw error;
  },

  async remove(staffId: string): Promise<void> {
    // CASCADE sẽ xoá permissions
    const { error } = await supabase.from(STAFF_TABLE).delete().eq('id', staffId);
    if (error) throw error;
  },

  /** Cập nhật toàn bộ quyền cho 1 staff (replace all) */
  async setPermissions(staffId: string, permissionTypeIds: string[], grantedBy?: string): Promise<void> {
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

  /** Check nhanh: CT này đã setup staff chưa? */
  async hasSiteStaff(constructionSiteId: string): Promise<boolean> {
    const { count } = await supabase
      .from(STAFF_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('construction_site_id', constructionSiteId);
    return (count || 0) > 0;
  },
};
