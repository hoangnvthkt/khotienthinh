// Thay AppContext cho fixture Ngày nghỉ việc: kho nhân sự nhỏ trong bộ nhớ. Lưu hồ sơ đi qua service thật
// (RPC do Playwright giả lập), giống updateEmployee của AppContext thật.
import { useSyncExternalStore } from 'react';
import type { Employee } from '../../types';
import { hrmEmployeeProfileService } from '../../lib/hrmEmployeeProfileService';
import type { WorkStatusInput } from '../../lib/hrmWorkStatus';

const base = { title: '', gender: 'Nam' as const, phone: '', email: '' };
let employees: Employee[] = [
  { ...base, id: 'e-active', employeeCode: 'TT101', fullName: 'Nguyễn Văn An', status: 'Đang làm việc', startDate: '2025-03-10', title: 'Kỹ sư hiện trường' },
  { ...base, id: 'e-nostart', employeeCode: 'TT102', fullName: 'Lê Thị Bình', status: 'Đang làm việc', startDate: '', title: 'Kế toán kho' },
  { ...base, id: 'e-noexit', employeeCode: 'TT103', fullName: 'Trần Văn Cường', status: 'Đã nghỉ việc', startDate: '2024-06-03' },
  { ...base, id: 'e-exited', employeeCode: 'TT104', fullName: 'Phạm Thu Dung', status: 'Đã nghỉ việc', startDate: '2023-02-01', exitDate: '2026-03-31' },
];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export const replaceEmployeeLocal = (employee: Employee) => {
  employees = employees.map(item => item.id === employee.id ? employee : item);
  emit();
};

const updateEmployee = async (employee: Employee, statusChange?: WorkStatusInput) => {
  const old = employees.find(item => item.id === employee.id);
  await hrmEmployeeProfileService.update(employee, statusChange);
  const next = { ...employee };
  if (statusChange && old && old.status !== next.status) next.exitDate = next.status === 'Đã nghỉ việc' ? statusChange.date : '';
  replaceEmployeeLocal(next);
};

export const useApp = () => {
  const list = useSyncExternalStore(subscribe, () => employees);
  return {
    employees: list, users: [], warehouses: [], hrmAreas: [], hrmOffices: [], hrmEmployeeTypes: [], hrmSalaryPolicies: [],
    hrmWorkSchedules: [], leaveBalances: [], addEmployee: async () => undefined, updateEmployee, replaceEmployeeLocal,
  };
};
