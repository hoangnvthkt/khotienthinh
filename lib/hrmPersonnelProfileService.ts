import type {
  HrmPersonnelDetailSectionKey,
  HrmPersonnelOverview,
  HrmPersonnelSectionPayload,
} from '../types/hrmPersonnelProfile';
import { supabase } from './supabase';

const SECTION_RPC: Record<HrmPersonnelDetailSectionKey, string> = {
  personal_contact: 'get_hrm_employee_personal_contact',
  work_organization: 'get_hrm_employee_work_organization',
  attendance_leave: 'get_hrm_employee_attendance_leave',
  contracts_employment: 'get_hrm_employee_contract_employment',
  legal_insurance: 'get_hrm_employee_legal_insurance',
  compensation_tax_bank: 'get_hrm_employee_compensation_tax_bank',
  qualifications_documents: 'get_hrm_employee_qualifications_documents',
};

const requireData = <T>(data: T | null, error: { message?: string } | null, fallback: string): T => {
  if (error) throw new Error(error.message || fallback);
  if (data == null) throw new Error(fallback);
  return data;
};

const nullable = (value: string | null | undefined) => value?.trim() || null;

const runProfileCommand = async (
  rpcName: string,
  params: Record<string, unknown>,
  fallback: string,
): Promise<HrmPersonnelSectionPayload> => {
  const { data, error } = await supabase.rpc(rpcName, params);
  return requireData(data as HrmPersonnelSectionPayload | null, error, fallback);
};

export const hrmPersonnelProfileService = {
  async getOverview(employeeId: string): Promise<HrmPersonnelOverview> {
    const { data, error } = await supabase.rpc('get_hrm_employee_overview', {
      p_employee_id: employeeId,
    });
    return requireData(data as HrmPersonnelOverview | null, error, 'Không thể tải tổng quan hồ sơ nhân sự.');
  },

  async getSection(
    section: HrmPersonnelDetailSectionKey,
    employeeId: string,
    period?: { year: number; month: number },
  ): Promise<HrmPersonnelSectionPayload> {
    const params: Record<string, unknown> = { p_employee_id: employeeId };
    if (section === 'attendance_leave' && period) {
      params.p_year = period.year;
      params.p_month = period.month;
    }
    const { data, error } = await supabase.rpc(SECTION_RPC[section], params);
    return requireData(data as HrmPersonnelSectionPayload | null, error, 'Không thể tải phần hồ sơ nhân sự.');
  },

  async updatePersonalContact(input: {
    employeeId: string;
    personalPhone: string;
    personalEmail: string;
    addressRecordCode?: string | null;
    addressType?: 'PERMANENT' | 'CURRENT' | 'CONTACT' | null;
    addressLine?: string | null;
    reason?: string | null;
  }): Promise<HrmPersonnelSectionPayload> {
    const { data, error } = await supabase.rpc('update_hrm_employee_personal_contact', {
      p_employee_id: input.employeeId,
      p_personal_phone: input.personalPhone,
      p_personal_email: input.personalEmail,
      p_address_record_code: input.addressRecordCode || null,
      p_address_type: input.addressType || null,
      p_address_line: input.addressLine || null,
      p_reason: input.reason || null,
    });
    return requireData(data as HrmPersonnelSectionPayload | null, error, 'Không thể cập nhật liên hệ cá nhân.');
  },

  async upsertIdentityDocument(input: {
    employeeId: string; recordCode: string; documentTypeCode: string;
    documentNumber: string; issuedDate?: string | null; issuedPlace?: string | null;
    expiryDate?: string | null; isPrimary: boolean; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_identity_document', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_document_type_code: input.documentTypeCode, p_document_number: input.documentNumber,
      p_issued_date: input.issuedDate || null, p_issued_place: nullable(input.issuedPlace),
      p_expiry_date: input.expiryDate || null, p_is_primary: input.isPrimary,
      p_reason: input.reason,
    }, 'Không thể cập nhật giấy tờ định danh.');
  },

  async upsertInsuranceProfile(input: {
    employeeId: string; socialInsuranceNumber?: string | null;
    healthInsuranceNumber?: string | null; registeredClinicCode?: string | null;
    participationStatusCode?: string | null; effectiveFrom?: string | null;
    effectiveTo?: string | null; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_insurance_profile', {
      p_employee_id: input.employeeId,
      p_social_insurance_number: nullable(input.socialInsuranceNumber),
      p_health_insurance_number: nullable(input.healthInsuranceNumber),
      p_registered_clinic_code: nullable(input.registeredClinicCode),
      p_participation_status_code: nullable(input.participationStatusCode),
      p_effective_from: input.effectiveFrom || null, p_effective_to: input.effectiveTo || null,
      p_reason: input.reason,
    }, 'Không thể cập nhật bảo hiểm.');
  },

  async upsertDependent(input: {
    employeeId: string; recordCode: string; fullName: string; relationshipCode: string;
    dateOfBirth?: string | null; taxCode?: string | null; deductionFrom?: string | null;
    deductionTo?: string | null; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_dependent', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_full_name: input.fullName, p_relationship_code: input.relationshipCode,
      p_date_of_birth: input.dateOfBirth || null, p_tax_code: nullable(input.taxCode),
      p_deduction_from: input.deductionFrom || null, p_deduction_to: input.deductionTo || null,
      p_reason: input.reason,
    }, 'Không thể cập nhật người phụ thuộc.');
  },

  async upsertEmploymentEvent(input: {
    employeeId: string; recordCode: string; eventTypeCode: string; eventDate: string;
    orgUnitId?: string | null; positionId?: string | null; titleSnapshot?: string | null;
    eventReason?: string | null; sourceReference: string; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_employment_event', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_event_type_code: input.eventTypeCode, p_event_date: input.eventDate,
      p_org_unit_id: input.orgUnitId || null, p_position_id: input.positionId || null,
      p_title_snapshot: nullable(input.titleSnapshot), p_event_reason: nullable(input.eventReason),
      p_source_reference: input.sourceReference, p_reason: input.reason,
    }, 'Không thể cập nhật quá trình làm việc.');
  },

  async upsertBankAccount(input: {
    employeeId: string; recordCode: string; bankCode: string; branchName?: string | null;
    accountNumber: string; accountHolder: string; isPayrollAccount: boolean; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_bank_account', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_bank_code: input.bankCode, p_branch_name: nullable(input.branchName),
      p_account_number: input.accountNumber, p_account_holder: input.accountHolder,
      p_is_payroll_account: input.isPayrollAccount, p_reason: input.reason,
    }, 'Không thể cập nhật tài khoản ngân hàng.');
  },

  async upsertTaxProfile(input: {
    employeeId: string; taxCode?: string | null; taxResidencyCode?: string | null;
    registrationDate?: string | null; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_tax_profile', {
      p_employee_id: input.employeeId, p_tax_code: nullable(input.taxCode),
      p_tax_residency_code: nullable(input.taxResidencyCode),
      p_registration_date: input.registrationDate || null, p_reason: input.reason,
    }, 'Không thể cập nhật thông tin thuế.');
  },

  async upsertQualification(input: {
    employeeId: string; recordCode: string; educationLevelCode?: string | null;
    institutionName: string; majorName?: string | null; degreeName?: string | null;
    graduationYear?: number | null; startDate?: string | null; endDate?: string | null;
    reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_qualification', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_education_level_code: nullable(input.educationLevelCode),
      p_institution_name: input.institutionName, p_major_name: nullable(input.majorName),
      p_degree_name: nullable(input.degreeName), p_graduation_year: input.graduationYear ?? null,
      p_start_date: input.startDate || null, p_end_date: input.endDate || null,
      p_reason: input.reason,
    }, 'Không thể cập nhật trình độ.');
  },

  async upsertCertification(input: {
    employeeId: string; recordCode: string; certificationTypeCode?: string | null;
    certificationName: string; certificateNumber?: string | null; issuerName?: string | null;
    issuedDate?: string | null; expiryDate?: string | null; reason: string;
  }): Promise<HrmPersonnelSectionPayload> {
    return runProfileCommand('upsert_hrm_employee_certification', {
      p_employee_id: input.employeeId, p_record_code: input.recordCode,
      p_certification_type_code: nullable(input.certificationTypeCode),
      p_certification_name: input.certificationName,
      p_certificate_number: nullable(input.certificateNumber), p_issuer_name: nullable(input.issuerName),
      p_issued_date: input.issuedDate || null, p_expiry_date: input.expiryDate || null,
      p_reason: input.reason,
    }, 'Không thể cập nhật chứng chỉ.');
  },
};
