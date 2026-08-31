import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '../../types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { hrmEmployeeProfileService } from '../hrmEmployeeProfileService';

const employee: Employee = {
  id: 'e1', employeeCode: 'TT001', fullName: 'Nguyễn A', title: 'Cố vấn',
  gender: 'Nam', phone: '0900000000', email: 'a@example.com', status: 'Đang làm việc',
  orgUnitId: 'u1', positionId: 'p1', departmentId: 'd1', constructionSiteId: 'c1', factoryId: 'f1',
};

describe('hrmEmployeeProfileService', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('uses the explicit governed C2 command instead of a raw table update', async () => {
    rpc.mockResolvedValueOnce({ error: null });

    await hrmEmployeeProfileService.update(employee);

    expect(rpc).toHaveBeenCalledWith('update_hrm_employee_core_profile', expect.objectContaining({
      p_employee_id: 'e1',
      p_full_name: 'Nguyễn A',
      p_phone: '0900000000',
      p_reason: 'Cập nhật hồ sơ nhân sự TT001',
    }));
    const payload = rpc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('p_org_unit_id');
    expect(payload).not.toHaveProperty('p_position_id');
    expect(payload).not.toHaveProperty('p_salary_policy_id');
  });

  it('uses a Vietnamese fallback database error', async () => {
    rpc.mockResolvedValueOnce({ error: {} });

    await expect(hrmEmployeeProfileService.update(employee))
      .rejects.toThrow('Không thể cập nhật hồ sơ nhân sự.');
  });
});
