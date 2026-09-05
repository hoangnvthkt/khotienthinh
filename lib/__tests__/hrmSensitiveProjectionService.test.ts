import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { hrmSensitiveProjectionService } from '../hrmSensitiveProjectionService';

describe('hrmSensitiveProjectionService', () => {
  beforeEach(() => rpc.mockReset());

  it('loads sensitive collections exclusively through governed projections', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await Promise.all([
      hrmSensitiveProjectionService.listEmployees(),
      hrmSensitiveProjectionService.listPayrolls(),
      hrmSensitiveProjectionService.listLaborContracts(),
      hrmSensitiveProjectionService.listSalaryHistory(),
    ]);

    expect(rpc).toHaveBeenCalledWith('list_hrm_employee_directory');
    expect(rpc).toHaveBeenCalledWith('list_hrm_payrolls');
    expect(rpc).toHaveBeenCalledWith('list_hrm_labor_contracts');
    expect(rpc).toHaveBeenCalledWith('list_hrm_salary_history');
  });

  it('looks up only the requested employee identifiers', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });

    await hrmSensitiveProjectionService.lookupEmployees({ userIds: ['u1', 'u2'] });

    expect(rpc).toHaveBeenCalledWith('lookup_hrm_employee_directory', {
      p_employee_ids: null,
      p_user_ids: ['u1', 'u2'],
    });
  });

  it('lets the database generate the employee code when the form leaves it empty', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        id: 'e1', employee_code: 'TT001', full_name: 'Nguyễn A',
        status: 'Đang làm việc',
      },
      error: null,
    });

    await hrmSensitiveProjectionService.createEmployee({
      id: 'e1', employeeCode: '', fullName: 'Nguyễn A', title: '',
      gender: 'Nam', phone: '', email: '', status: 'Đang làm việc',
    }, 'Tạo hồ sơ nhân sự từ màn hình quản lý');

    expect(rpc).toHaveBeenCalledWith('create_hrm_employee_core', expect.objectContaining({
      p_employee_code: null,
      p_full_name: 'Nguyễn A',
    }));
  });

  it('uses domain commands with a reason for employee and payroll mutations', async () => {
    rpc.mockResolvedValue({ data: { id: 'record-1' }, error: null });

    await hrmSensitiveProjectionService.archiveEmployee('e1', 'Lưu hồ sơ nhân sự đã nghỉ việc');
    await hrmSensitiveProjectionService.upsertPayroll({
      id: 'p1', employeeId: 'e1', month: 8, year: 2026,
      workingDays: 26, standardDays: 26, overtimeHours: 0,
      baseSalary: 1, allowancePosition: 0, allowanceMeal: 0,
      allowanceTransport: 0, allowancePhone: 0, allowanceOther: 0,
      deductionInsurance: 0, deductionTax: 0, deductionAdvance: 0,
      deductionOther: 0, grossSalary: 1, netSalary: 1,
      status: 'draft', createdAt: '2026-08-28T00:00:00Z',
    }, 'Tạo phiếu lương tháng 08/2026');

    expect(rpc).toHaveBeenNthCalledWith(1, 'archive_hrm_employee', {
      p_employee_id: 'e1', p_reason: 'Lưu hồ sơ nhân sự đã nghỉ việc',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'upsert_hrm_payroll', {
      p_payroll: expect.objectContaining({ employeeId: 'e1', month: 8, year: 2026 }),
      p_reason: 'Tạo phiếu lương tháng 08/2026',
    });
  });

  it('surfaces projection failures instead of silently returning empty sensitive data', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });

    await expect(hrmSensitiveProjectionService.listPayrolls()).rejects.toThrow('permission denied');
  });
});
