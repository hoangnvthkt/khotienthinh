import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '../../types';

const eq = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn((_payload: Record<string, unknown>) => ({ eq })));
const from = vi.hoisted(() => vi.fn(() => ({ update })));
vi.mock('../supabase', () => ({ supabase: { from } }));

import { hrmEmployeeProfileService } from '../hrmEmployeeProfileService';

const employee: Employee = {
  id: 'e1', employeeCode: 'TT001', fullName: 'Nguyễn A', title: 'Cố vấn',
  gender: 'Nam', phone: '0900000000', email: 'a@example.com', status: 'Đang làm việc',
  orgUnitId: 'u1', positionId: 'p1', departmentId: 'd1', constructionSiteId: 'c1', factoryId: 'f1',
};

describe('hrmEmployeeProfileService', () => {
  beforeEach(() => {
    from.mockClear();
    update.mockClear();
    eq.mockReset();
  });

  it('updates only profile-managed columns for the selected employee', async () => {
    eq.mockResolvedValueOnce({ error: null });

    await hrmEmployeeProfileService.update(employee);

    expect(from).toHaveBeenCalledWith('employees');
    expect(eq).toHaveBeenCalledWith('id', 'e1');
    const payload = update.mock.calls[0][0];
    expect(payload).toMatchObject({ full_name: 'Nguyễn A' });
    expect(payload).not.toHaveProperty('org_unit_id');
    expect(payload).not.toHaveProperty('position_id');
    expect(payload).not.toHaveProperty('title');
  });

  it('uses a Vietnamese fallback database error', async () => {
    eq.mockResolvedValueOnce({ error: {} });

    await expect(hrmEmployeeProfileService.update(employee))
      .rejects.toThrow('Không thể cập nhật hồ sơ nhân sự.');
  });
});
