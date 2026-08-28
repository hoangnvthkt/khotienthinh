import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaborContract } from '../../types';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase', () => ({ supabase: { rpc } }));

import { hrmContractService } from '../hrmContractService';

const contract: LaborContract = {
  id: 'contract-1', employeeId: 'employee-1', contractNumber: 'HD-001',
  type: 'fixed_term', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31',
  baseSalary: 20_000_000, allowancePosition: 2_000_000, allowanceOther: 500_000,
  signedBy: 'Giám đốc', note: 'Bản chính', createdAt: '2026-01-01T00:00:00Z',
};

describe('hrmContractService', () => {
  beforeEach(() => rpc.mockReset());

  it('sends compensation only through the field-aware contract command', async () => {
    rpc.mockResolvedValueOnce({ error: null });

    await hrmContractService.upsert({
      id: contract.id, employeeId: contract.employeeId,
      contractNumber: contract.contractNumber, type: contract.type, status: contract.status,
      startDate: contract.startDate, endDate: contract.endDate,
      baseSalary: contract.baseSalary, allowancePosition: contract.allowancePosition,
      allowanceOther: contract.allowanceOther, reason: 'Điều chỉnh hợp đồng định kỳ',
    });

    expect(rpc).toHaveBeenCalledWith('upsert_hrm_employee_contract', expect.objectContaining({
      p_id: 'contract-1', p_base_salary: 20_000_000,
      p_allowance_position: 2_000_000, p_allowance_other: 500_000,
      p_reason: 'Điều chỉnh hợp đồng định kỳ',
    }));
  });

  it('does not resend C4 values when terminating a contract', async () => {
    rpc.mockResolvedValueOnce({ error: null });

    await hrmContractService.terminate(contract);

    expect(rpc).toHaveBeenCalledWith('upsert_hrm_employee_contract', expect.objectContaining({
      p_status: 'terminated',
      p_base_salary: null,
      p_allowance_position: null,
      p_allowance_other: null,
    }));
  });
});
