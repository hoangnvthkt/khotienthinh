import type { Employee } from '../types';
import { supabase } from './supabase';
import { toEmployeeProfileUpdatePayload } from './hrmEmployeeProfileModel';

export const hrmEmployeeProfileService = {
  async update(employee: Employee): Promise<void> {
    const { error } = await supabase
      .from('employees')
      .update(toEmployeeProfileUpdatePayload(employee))
      .eq('id', employee.id);
    if (error) throw new Error(error.message || 'Không thể cập nhật hồ sơ nhân sự.');
  },
};
