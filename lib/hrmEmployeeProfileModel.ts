import type { Employee } from '../types';

export type EmployeeProfileUpdatePayload = Pick<Employee,
  'fullName' | 'gender' | 'phone' | 'email' | 'dateOfBirth' |
  'startDate' | 'officialDate' | 'status' | 'userId' | 'areaId' |
  'officeId' | 'employeeTypeId' | 'salaryPolicyId' |
  'workScheduleId' | 'maritalStatus' | 'avatarUrl'
>;

const nullable = (value: string | undefined) => value?.trim() || null;

export const toEmployeeProfileUpdatePayload = (
  employee: EmployeeProfileUpdatePayload,
): Record<string, unknown> => ({
  full_name: employee.fullName.trim(),
  gender: employee.gender || null,
  phone: nullable(employee.phone),
  email: nullable(employee.email),
  date_of_birth: nullable(employee.dateOfBirth),
  start_date: nullable(employee.startDate),
  official_date: nullable(employee.officialDate),
  status: employee.status || 'Đang làm việc',
  user_id: nullable(employee.userId),
  area_id: nullable(employee.areaId),
  office_id: nullable(employee.officeId),
  employee_type_id: nullable(employee.employeeTypeId),
  salary_policy_id: nullable(employee.salaryPolicyId),
  work_schedule_id: nullable(employee.workScheduleId),
  marital_status: nullable(employee.maritalStatus),
  avatar_url: nullable(employee.avatarUrl),
});
