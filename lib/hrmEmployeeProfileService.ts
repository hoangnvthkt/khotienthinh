import type { Employee } from '../types';
import type { WorkStatusInput } from './hrmWorkStatus';
import { supabase } from './supabase';

const nullable = (value: string | undefined) => value?.trim() || null;

export const hrmEmployeeProfileService = {
  /** `statusChange` is required by the server when `employee.status` differs from the saved one. */
  async update(employee: Employee, statusChange?: WorkStatusInput): Promise<void> {
    const { error } = await supabase.rpc('update_hrm_employee_core_profile', {
      p_employee_id: employee.id,
      p_full_name: employee.fullName.trim(),
      p_gender: employee.gender || null,
      p_phone: nullable(employee.phone),
      p_email: nullable(employee.email),
      p_date_of_birth: nullable(employee.dateOfBirth),
      p_start_date: nullable(employee.startDate),
      p_official_date: nullable(employee.officialDate),
      p_status: employee.status || 'Đang làm việc',
      p_linked_user_id: nullable(employee.userId),
      p_area_id: nullable(employee.areaId),
      p_office_id: nullable(employee.officeId),
      p_employee_type_id: nullable(employee.employeeTypeId),
      p_work_schedule_id: nullable(employee.workScheduleId),
      p_marital_status: nullable(employee.maritalStatus),
      p_avatar_url: nullable(employee.avatarUrl),
      p_reason: `Cập nhật hồ sơ nhân sự ${employee.employeeCode}`,
      p_status_date: statusChange?.date || null,
      p_status_note: statusChange?.note.trim() || null,
      p_status_reference: statusChange?.reference.trim() || null,
    });
    if (error) throw new Error(error.message || 'Không thể cập nhật hồ sơ nhân sự.');
  },
};
