import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('../supabase', () => ({
  supabase: {
    rpc,
    auth: { getSession: vi.fn() },
    storage: { from: vi.fn() },
  },
  supabaseAnonKey: '',
  supabaseUrl: '',
}));

import { checkInService } from '../checkInService';
import { hrmSensitiveProjectionService } from '../hrmSensitiveProjectionService';

describe('HRM self-service data isolation', () => {
  beforeEach(() => rpc.mockReset());

  it('loads Check-in context without invoking the HRM payroll projection', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        employee: {
          id: 'employee-1',
          employee_code: 'TT001',
          full_name: 'Nguyễn Văn A',
          title: 'Kỹ sư',
          status: 'Đang làm việc',
          user_id: 'user-1',
        },
        attendanceRecords: [{
          id: 'attendance-1',
          employeeId: 'employee-1',
          date: '2026-09-11',
          status: 'present',
          checkIn: '08:00',
        }],
        constructionSites: [{
          id: 'site-1', name: 'Công trường A', latitude: 10.1, longitude: 106.1, checkInRadius: 200,
        }],
        offices: [{
          id: 'office-1', name: 'Văn phòng A', latitude: 10.2, longitude: 106.2, checkInRadius: 100,
        }],
      },
      error: null,
    });

    const result = await (checkInService as typeof checkInService & {
      loadMyContext: () => Promise<{
        employee: { id: string; employeeCode: string; fullName: string } | null;
        attendanceRecords: Array<{ employeeId: string }>;
      }>;
    }).loadMyContext();

    expect(result.employee).toMatchObject({
      id: 'employee-1', employeeCode: 'TT001', fullName: 'Nguyễn Văn A',
    });
    expect(result.attendanceRecords).toEqual([
      expect.objectContaining({ employeeId: 'employee-1' }),
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_my_checkin_context');
  });

  it('loads only the current actor payroll projection without accepting an employee id', async () => {
    rpc.mockResolvedValueOnce({
      data: [{
        id: 'payroll-1', employeeId: 'employee-1', month: 8, year: 2026,
        workingDays: 26, standardDays: 26, overtimeHours: 0,
        baseSalary: 10_000_000, allowancePosition: 0, allowanceMeal: 0,
        allowanceTransport: 0, allowancePhone: 0, allowanceOther: 0,
        deductionInsurance: 0, deductionTax: 0, deductionAdvance: 0,
        deductionOther: 0, grossSalary: 10_000_000, netSalary: 10_000_000,
        status: 'confirmed', createdAt: '2026-09-01T00:00:00Z',
      }],
      error: null,
    });

    const result = await (hrmSensitiveProjectionService as typeof hrmSensitiveProjectionService & {
      listMyPayrolls: () => Promise<Array<{ employeeId: string; status: string }>>;
    }).listMyPayrolls();

    expect(result).toEqual([
      expect.objectContaining({ employeeId: 'employee-1', status: 'confirmed' }),
    ]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('list_my_payrolls');
  });
});
