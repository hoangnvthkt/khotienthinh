import type { LaborContract, LaborContractStatus, LaborContractType } from '../types';
import { supabase } from './supabase';

export const hrmContractService = {
  async upsert(input: {
    id?: string | null;
    employeeId: string;
    contractNumber: string;
    type: LaborContractType;
    status: LaborContractStatus;
    startDate: string;
    endDate?: string | null;
    signedBy?: string | null;
    note?: string | null;
    baseSalary?: number | null;
    allowancePosition?: number | null;
    allowanceOther?: number | null;
    reason: string;
  }): Promise<void> {
    const { error } = await supabase.rpc('upsert_hrm_employee_contract', {
      p_id: input.id || null,
      p_employee_id: input.employeeId,
      p_contract_number: input.contractNumber,
      p_type: input.type,
      p_status: input.status,
      p_effective_from: input.startDate,
      p_effective_to: input.endDate || null,
      p_signed_by: input.signedBy || null,
      p_note: input.note || null,
      p_base_salary: input.baseSalary ?? null,
      p_allowance_position: input.allowancePosition ?? null,
      p_allowance_other: input.allowanceOther ?? null,
      p_reason: input.reason,
    });
    if (error) throw new Error(error.message || 'Không thể cập nhật hợp đồng lao động.');
  },

  async terminate(contract: LaborContract): Promise<void> {
    return this.upsert({
      id: contract.id,
      employeeId: contract.employeeId,
      contractNumber: contract.contractNumber,
      type: contract.type,
      status: 'terminated',
      startDate: contract.startDate,
      endDate: contract.endDate,
      signedBy: contract.signedBy,
      note: contract.note,
      reason: `Chấm dứt hợp đồng ${contract.contractNumber}`,
    });
  },
};
