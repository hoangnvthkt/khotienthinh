import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { hrmPersonnelProfileService } from '../hrmPersonnelProfileService';

describe('hrmPersonnelProfileService', () => {
  beforeEach(() => rpc.mockReset());

  it('loads only the overview projection initially', async () => {
    rpc.mockResolvedValueOnce({
      data: { employeeId: 'e1', visibleSections: ['overview'] },
      error: null,
    });

    await hrmPersonnelProfileService.getOverview('e1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_hrm_employee_overview', { p_employee_id: 'e1' });
  });

  it('maps each lazy tab to its dedicated projection RPC', async () => {
    rpc.mockResolvedValue({ data: { employeeId: 'e1' }, error: null });

    await hrmPersonnelProfileService.getSection('legal_insurance', 'e1');
    await hrmPersonnelProfileService.getSection('attendance_leave', 'e1', { year: 2026, month: 8 });

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_hrm_employee_legal_insurance', { p_employee_id: 'e1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_hrm_employee_attendance_leave', {
      p_employee_id: 'e1', p_year: 2026, p_month: 8,
    });
  });

  it('updates only the explicit C2 personal-contact command', async () => {
    rpc.mockResolvedValueOnce({ data: { employeeId: 'e1' }, error: null });

    await hrmPersonnelProfileService.updatePersonalContact({
      employeeId: 'e1', personalPhone: '0901', personalEmail: 'a@example.com',
      reason: 'Cập nhật liên hệ cá nhân',
    });

    expect(rpc).toHaveBeenCalledWith('update_hrm_employee_personal_contact', {
      p_employee_id: 'e1', p_personal_phone: '0901', p_personal_email: 'a@example.com',
      p_address_record_code: null, p_address_type: null, p_address_line: null,
      p_reason: 'Cập nhật liên hệ cá nhân',
    });
  });

  it('maps C3 dependent data to a field-aware command with reason', async () => {
    rpc.mockResolvedValueOnce({ data: { employeeId: 'e1' }, error: null });

    await hrmPersonnelProfileService.upsertDependent({
      employeeId: 'e1', recordCode: 'NPT-01', fullName: 'Nguyễn B',
      relationshipCode: 'CON', dateOfBirth: '2015-02-03', taxCode: '',
      deductionFrom: '2026-01-01', deductionTo: null,
      reason: 'Bổ sung người phụ thuộc theo hồ sơ thuế',
    });

    expect(rpc).toHaveBeenCalledWith('upsert_hrm_employee_dependent', expect.objectContaining({
      p_employee_id: 'e1', p_record_code: 'NPT-01', p_relationship_code: 'CON',
      p_tax_code: null, p_reason: 'Bổ sung người phụ thuộc theo hồ sơ thuế',
    }));
  });

  it('maps C4 bank data to the compensation command', async () => {
    rpc.mockResolvedValueOnce({ data: { employeeId: 'e1' }, error: null });

    await hrmPersonnelProfileService.upsertBankAccount({
      employeeId: 'e1', recordCode: 'PAYROLL', bankCode: 'VCB', branchName: 'Hà Nội',
      accountNumber: '0123456789', accountHolder: 'NGUYEN A', isPayrollAccount: true,
      reason: 'Cập nhật tài khoản nhận lương',
    });

    expect(rpc).toHaveBeenCalledWith('upsert_hrm_employee_bank_account', expect.objectContaining({
      p_employee_id: 'e1', p_record_code: 'PAYROLL', p_is_payroll_account: true,
      p_reason: 'Cập nhật tài khoản nhận lương',
    }));
  });

  it('maps qualification records without using a generic JSON update', async () => {
    rpc.mockResolvedValueOnce({ data: { employeeId: 'e1' }, error: null });

    await hrmPersonnelProfileService.upsertQualification({
      employeeId: 'e1', recordCode: 'HV-01', educationLevelCode: 'DAI_HOC',
      institutionName: 'Đại học Xây dựng', majorName: 'Kỹ thuật xây dựng',
      degreeName: 'Kỹ sư', graduationYear: 2020, startDate: null, endDate: null,
      reason: 'Bổ sung văn bằng đã đối chiếu',
    });

    expect(rpc).toHaveBeenCalledWith('upsert_hrm_employee_qualification', expect.objectContaining({
      p_record_code: 'HV-01', p_graduation_year: 2020,
      p_reason: 'Bổ sung văn bằng đã đối chiếu',
    }));
  });
});
