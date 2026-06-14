import type { Employee } from '../types';
import { isSupabaseConfigured, supabase } from './supabase';

export interface SelfEmployeeProfilePatch {
  fullName?: string;
  gender?: Employee['gender'];
  dateOfBirth?: string;
  maritalStatus?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
}

const mapEmployeeFromDb = (row: any): Employee => ({
  id: row.id,
  employeeCode: row.employee_code,
  fullName: row.full_name,
  title: row.title || '',
  gender: row.gender || 'Nam',
  phone: row.phone || '',
  email: row.email || '',
  dateOfBirth: row.date_of_birth || '',
  startDate: row.start_date || '',
  officialDate: row.official_date || '',
  status: row.status || 'Đang làm việc',
  userId: row.user_id || undefined,
  areaId: row.area_id || undefined,
  officeId: row.office_id || undefined,
  employeeTypeId: row.employee_type_id || undefined,
  positionId: row.position_id || undefined,
  salaryPolicyId: row.salary_policy_id || undefined,
  workScheduleId: row.work_schedule_id || undefined,
  constructionSiteId: row.construction_site_id || undefined,
  departmentId: row.department_id || undefined,
  factoryId: row.factory_id || undefined,
  maritalStatus: row.marital_status || '',
  avatarUrl: row.avatar_url || '',
  orgUnitId: row.org_unit_id || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildPatch = (patch: SelfEmployeeProfilePatch) => {
  return Object.entries(patch).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value || '';
    return acc;
  }, {});
};

export const employeeSelfService = {
  async updateMyProfile(patch: SelfEmployeeProfilePatch): Promise<Employee | null> {
    if (!isSupabaseConfigured) return null;

    const { data, error } = await supabase.rpc('update_my_employee_profile', {
      p_patch: buildPatch(patch),
    });

    if (error) throw error;
    if (!data) return null;

    return mapEmployeeFromDb(data);
  },
};
