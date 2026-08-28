import type { Employee, LaborContract, PayrollRecord, HrmSalaryHistory } from '../types';
import { mapEmployeeFromDb } from './employeeSelfService';
import { supabase } from './supabase';

type EmployeeLookup = Pick<Employee, 'id' | 'employeeCode' | 'fullName' | 'title' | 'phone' | 'email' | 'status'> & {
  userId?: string;
  avatarUrl?: string;
};

const requireRows = <T>(data: unknown, error: { message?: string } | null, fallback: string): T[] => {
  if (error) throw new Error(error.message || fallback);
  if (!Array.isArray(data)) throw new Error(fallback);
  return data as T[];
};

const requireRow = <T>(data: unknown, error: { message?: string } | null, fallback: string): T => {
  if (error) throw new Error(error.message || fallback);
  if (!data || typeof data !== 'object') throw new Error(fallback);
  return data as T;
};

const toLaborContract = (row: any): LaborContract => ({
  id: row.id,
  employeeId: row.employee_id,
  contractNumber: row.contract_number,
  type: row.type,
  status: row.status,
  startDate: row.effective_from,
  endDate: row.effective_to || undefined,
  baseSalary: Number(row.base_salary || 0),
  allowancePosition: Number(row.allowance_position || 0),
  allowanceOther: Number(row.allowance_other || 0),
  signedBy: row.signed_by || undefined,
  note: row.note || undefined,
  createdAt: row.created_at,
});

const toSalaryHistory = (row: any): HrmSalaryHistory => ({
  id: row.id,
  employeeId: row.employee_id,
  contractId: row.contract_id,
  changeDate: row.effective_from,
  previousSalary: Number(row.previous_salary || 0),
  newSalary: Number(row.new_salary || 0),
  previousAllowance: Number(row.previous_allowance || 0),
  newAllowance: Number(row.new_allowance || 0),
  reason: row.reason,
  changedBy: row.changed_by_legacy,
  createdAt: row.created_at,
});

export const hrmSensitiveProjectionService = {
  async listEmployees(): Promise<Employee[]> {
    const { data, error } = await supabase.rpc('list_hrm_employee_directory');
    return requireRows<any>(data, error, 'Không thể tải danh bạ nhân sự.').map(mapEmployeeFromDb);
  },

  async lookupEmployees(input: { employeeIds?: string[]; userIds?: string[] }): Promise<EmployeeLookup[]> {
    const { data, error } = await supabase.rpc('lookup_hrm_employee_directory', {
      p_employee_ids: input.employeeIds?.length ? input.employeeIds : null,
      p_user_ids: input.userIds?.length ? input.userIds : null,
    });
    return requireRows<any>(data, error, 'Không thể tra cứu danh bạ nhân sự.').map(row => ({
      id: row.id,
      userId: row.user_id || undefined,
      employeeCode: row.employee_code,
      fullName: row.full_name,
      title: row.title || '',
      phone: row.phone || '',
      email: row.email || '',
      avatarUrl: row.avatar_url || undefined,
      status: row.status,
    }));
  },

  async listPayrolls(): Promise<PayrollRecord[]> {
    const { data, error } = await supabase.rpc('list_hrm_payrolls');
    return requireRows<PayrollRecord>(data, error, 'Không thể tải bảng lương.');
  },

  async listLaborContracts(): Promise<LaborContract[]> {
    const { data, error } = await supabase.rpc('list_hrm_labor_contracts');
    return requireRows<any>(data, error, 'Không thể tải hợp đồng lao động.').map(toLaborContract);
  },

  async listSalaryHistory(): Promise<HrmSalaryHistory[]> {
    const { data, error } = await supabase.rpc('list_hrm_salary_history');
    return requireRows<any>(data, error, 'Không thể tải lịch sử lương.').map(toSalaryHistory);
  },

  async createEmployee(employee: Employee, reason: string): Promise<Employee> {
    const { data, error } = await supabase.rpc('create_hrm_employee_core', {
      p_employee_id: employee.id || null,
      p_employee_code: employee.employeeCode,
      p_full_name: employee.fullName,
      p_gender: employee.gender || null,
      p_phone: employee.phone || null,
      p_email: employee.email || null,
      p_date_of_birth: employee.dateOfBirth || null,
      p_start_date: employee.startDate || null,
      p_official_date: employee.officialDate || null,
      p_status: employee.status || 'Đang làm việc',
      p_linked_user_id: employee.userId || null,
      p_area_id: employee.areaId || null,
      p_office_id: employee.officeId || null,
      p_employee_type_id: employee.employeeTypeId || null,
      p_work_schedule_id: employee.workScheduleId || null,
      p_marital_status: employee.maritalStatus || null,
      p_avatar_url: employee.avatarUrl || null,
      p_reason: reason,
    });
    return mapEmployeeFromDb(requireRow<any>(data, error, 'Không thể tạo hồ sơ nhân sự.'));
  },

  async archiveEmployee(employeeId: string, reason: string): Promise<Employee> {
    const { data, error } = await supabase.rpc('archive_hrm_employee', {
      p_employee_id: employeeId,
      p_reason: reason,
    });
    return mapEmployeeFromDb(requireRow<any>(data, error, 'Không thể lưu hồ sơ nhân sự đã nghỉ việc.'));
  },

  async upsertPayroll(payroll: PayrollRecord, reason: string): Promise<PayrollRecord> {
    const { data, error } = await supabase.rpc('upsert_hrm_payroll', {
      p_payroll: payroll,
      p_reason: reason,
    });
    return requireRow<PayrollRecord>(data, error, 'Không thể lưu phiếu lương.');
  },

  async deletePayroll(payrollId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('delete_hrm_payroll', {
      p_payroll_id: payrollId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message || 'Không thể xóa phiếu lương.');
  },
};
