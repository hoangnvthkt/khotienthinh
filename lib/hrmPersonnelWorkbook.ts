import { loadXlsx } from './loadXlsx';

export interface HrmWorkbookSheetDefinition {
  code: string;
  name: string;
  label: string;
  importRecordTypes: readonly string[];
  headers: readonly string[];
  readOnly?: boolean;
}

const BASE_HEADERS = ['record_type', 'employee_code', 'record_code'] as const;

export const HRM_PERSONNEL_WORKBOOK_SHEETS: readonly HrmWorkbookSheetDefinition[] = [
  {
    code: 'OVERVIEW', name: '01_Tong_quan', label: 'Tổng quan',
    importRecordTypes: ['EMPLOYEE_CORE'],
    headers: [...BASE_HEADERS, 'full_name', 'gender', 'phone', 'email', 'date_of_birth',
      'start_date', 'official_date', 'status', 'marital_status', 'avatar_url'],
  },
  {
    code: 'PERSONAL_CONTACT', name: '02_Ca_nhan_lien_he', label: 'Cá nhân & liên hệ',
    importRecordTypes: ['PERSONAL_CONTACT', 'ADDRESS', 'EMERGENCY_CONTACT'],
    headers: [...BASE_HEADERS, 'personal_phone', 'personal_email', 'address_type', 'address_line',
      'full_name', 'relationship_code', 'phone', 'email', 'address', 'is_primary'],
  },
  {
    code: 'WORK_ORGANIZATION', name: '03_Cong_viec_to_chuc', label: 'Công việc & tổ chức',
    importRecordTypes: [], readOnly: true,
    headers: [...BASE_HEADERS, 'title', 'org_unit_code', 'org_unit_name', 'position_code',
      'position_name', 'direct_manager_code', 'effective_from'],
  },
  {
    code: 'ATTENDANCE_LEAVE', name: '04_Cham_cong_nghi_phep', label: 'Chấm công & nghỉ phép',
    importRecordTypes: [], readOnly: true,
    headers: [...BASE_HEADERS, 'year', 'month', 'attendance_status', 'leave_accrued_days',
      'leave_used_paid_days', 'leave_remaining_days'],
  },
  {
    code: 'CONTRACTS_EMPLOYMENT', name: '05_Hop_dong_qua_trinh', label: 'Hợp đồng & quá trình',
    importRecordTypes: ['CONTRACT', 'EMPLOYMENT_EVENT'],
    headers: [...BASE_HEADERS, 'contract_number', 'type', 'status', 'effective_from',
      'effective_to', 'signed_by', 'note', 'base_salary', 'allowance_position',
      'allowance_other', 'event_type_code', 'event_date', 'org_unit_code', 'position_code',
      'title_snapshot', 'event_reason', 'source_reference'],
  },
  {
    code: 'LEGAL_INSURANCE', name: '06_Phap_ly_bao_hiem', label: 'Pháp lý & bảo hiểm',
    importRecordTypes: ['IDENTITY_DOCUMENT', 'INSURANCE', 'DEPENDENT'],
    headers: [...BASE_HEADERS, 'document_type_code', 'document_number', 'issued_date',
      'issued_place', 'expiry_date', 'is_primary', 'social_insurance_number',
      'health_insurance_number', 'registered_clinic_code', 'participation_status_code',
      'effective_from', 'effective_to', 'full_name', 'relationship_code', 'date_of_birth',
      'tax_code', 'deduction_from', 'deduction_to'],
  },
  {
    code: 'COMPENSATION_TAX_BANK', name: '07_Luong_thue_ngan_hang', label: 'Lương, thuế & ngân hàng',
    importRecordTypes: ['BANK_ACCOUNT', 'TAX_PROFILE'],
    headers: [...BASE_HEADERS, 'bank_code', 'branch_name', 'account_number', 'account_holder',
      'is_payroll_account', 'tax_code', 'tax_residency_code', 'registration_date',
      'salary_effective_from', 'new_salary', 'new_allowance'],
  },
  {
    code: 'QUALIFICATIONS_DOCUMENTS', name: '08_Trinh_do_ho_so', label: 'Trình độ & hồ sơ',
    importRecordTypes: ['QUALIFICATION', 'CERTIFICATION'],
    headers: [...BASE_HEADERS, 'education_level_code', 'institution_name', 'major_name',
      'degree_name', 'graduation_year', 'start_date', 'end_date', 'certification_type_code',
      'certification_name', 'certificate_number', 'issuer_name', 'issued_date', 'expiry_date'],
  },
] as const;

export interface HrmImportStagingRow {
  sheetCode: string;
  rowNumber: number;
  employeeCode: string;
  recordCode: string | null;
  recordType: string;
  payload: Record<string, unknown>;
}

const HEADER_TO_PAYLOAD: Record<string, string> = {
  full_name: 'fullName', gender: 'gender', phone: 'phone', email: 'email',
  date_of_birth: 'dateOfBirth', start_date: 'startDate', official_date: 'officialDate',
  status: 'status', marital_status: 'maritalStatus', avatar_url: 'avatarUrl',
  personal_phone: 'personalPhone', personal_email: 'personalEmail', address_type: 'addressType',
  address_line: 'addressLine', relationship_code: 'relationshipCode', address: 'address',
  is_primary: 'isPrimary', contract_number: 'contractNumber', type: 'type',
  effective_from: 'effectiveFrom', effective_to: 'effectiveTo', signed_by: 'signedBy', note: 'note',
  base_salary: 'baseSalary', allowance_position: 'allowancePosition', allowance_other: 'allowanceOther',
  event_type_code: 'eventTypeCode', event_date: 'eventDate', org_unit_code: 'orgUnitCode',
  position_code: 'positionCode', title_snapshot: 'titleSnapshot', event_reason: 'eventReason',
  source_reference: 'sourceReference', document_type_code: 'documentTypeCode',
  document_number: 'documentNumber', issued_date: 'issuedDate', issued_place: 'issuedPlace',
  expiry_date: 'expiryDate', social_insurance_number: 'socialInsuranceNumber',
  health_insurance_number: 'healthInsuranceNumber', registered_clinic_code: 'registeredClinicCode',
  participation_status_code: 'participationStatusCode', tax_code: 'taxCode',
  deduction_from: 'deductionFrom', deduction_to: 'deductionTo', bank_code: 'bankCode',
  branch_name: 'branchName', account_number: 'accountNumber', account_holder: 'accountHolder',
  is_payroll_account: 'isPayrollAccount', tax_residency_code: 'taxResidencyCode',
  registration_date: 'registrationDate', education_level_code: 'educationLevelCode',
  institution_name: 'institutionName', major_name: 'majorName', degree_name: 'degreeName',
  graduation_year: 'graduationYear', end_date: 'endDate', certification_type_code: 'certificationTypeCode',
  certification_name: 'certificationName', certificate_number: 'certificateNumber', issuer_name: 'issuerName',
};

const PAYLOAD_TO_HEADER = Object.fromEntries(
  Object.entries(HEADER_TO_PAYLOAD).map(([header, payloadKey]) => [payloadKey, header]),
);

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim();
  return value;
};

export const mapWorkbookRowsToStaging = (
  sheetName: string,
  rows: Record<string, unknown>[],
): HrmImportStagingRow[] => {
  const definition = HRM_PERSONNEL_WORKBOOK_SHEETS.find(sheet => sheet.name === sheetName);
  if (!definition) throw new Error('HRM_WORKBOOK_SHEET_UNSUPPORTED');
  if (definition.readOnly) return [];
  return rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => Object.values(row).some(value => value !== '' && value != null))
    .filter(({ row }) => !String(row.record_type || '').trim().toUpperCase().endsWith('_PROJECTION'))
    .map(({ row, rowNumber }) => {
      const payload = Object.entries(row).reduce<Record<string, unknown>>((result, [header, rawValue]) => {
        const payloadKey = HEADER_TO_PAYLOAD[header];
        const value = normalizeValue(rawValue);
        if (payloadKey && value !== '' && value != null) result[payloadKey] = value;
        return result;
      }, {});
      return {
        sheetCode: definition.code,
        rowNumber,
        employeeCode: String(row.employee_code || '').trim(),
        recordCode: String(row.record_code || '').trim() || null,
        recordType: String(row.record_type || '').trim().toUpperCase(),
        payload,
      };
    });
};

export const readHrmPersonnelWorkbook = async (file: File): Promise<HrmImportStagingRow[]> => {
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const requiredNames = new Set(HRM_PERSONNEL_WORKBOOK_SHEETS.map(sheet => sheet.name));
  if ([...requiredNames].some(name => !workbook.SheetNames.includes(name))) {
    throw new Error('HRM_WORKBOOK_EIGHT_SHEETS_REQUIRED');
  }
  return HRM_PERSONNEL_WORKBOOK_SHEETS.flatMap(definition => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[definition.name], {
      defval: '', raw: true,
    });
    return mapWorkbookRowsToStaging(definition.name, rows);
  });
};

const GUIDE_ROWS = [
  ['BỘ KHUNG HỒ SƠ NHÂN SỰ 8 NHÓM', 'Phiên bản 1'],
  ['Nguyên tắc định danh', 'Mỗi dòng phải có employee_code. Dữ liệu 1:N phải có record_code ổn định. Không đối chiếu bằng họ tên.'],
  ['Ngày', 'Dùng giá trị ngày thực hoặc định dạng yyyy-mm-dd.'],
  ['Tiền và số', 'Dùng ô số, không thêm ký hiệu tiền tệ vào giá trị.'],
  ['Danh mục', 'Dùng đúng code đã có trên hệ thống. Import không tự tạo và không fuzzy-match danh mục.'],
  ['Sheet chỉ đọc', '03_Cong_viec_to_chuc và 04_Cham_cong_nghi_phep là projection; thay đổi qua luồng tổ chức, chấm công hoặc nghỉ phép.'],
  ['Dữ liệu không import', 'Thâm niên, hợp đồng/lương hiện tại, tổng phép và lần thăng tiến gần nhất do hệ thống tính.'],
  ['Không hỗ trợ', 'Có ký quỹ không? không thuộc mô hình V1 và sẽ bị báo lỗi.'],
  ['Người phụ thuộc', 'Mỗi người là một dòng DEPENDENT có record_code; không dùng số tổng hoặc chuỗi tự do.'],
  ['C4', 'BANK_ACCOUNT, TAX_PROFILE và các trường lương trong CONTRACT chỉ HR Manage được apply.'],
  ['Lưu trữ', 'File nguồn và staging là private, mặc định hết hạn sau 30 ngày.'],
  [],
  ['record_type', 'Sheet', 'Ý nghĩa'],
  ['EMPLOYEE_CORE', '01_Tong_quan', 'Thông tin lõi C1/C2'],
  ['PERSONAL_CONTACT / ADDRESS / EMERGENCY_CONTACT', '02_Ca_nhan_lien_he', 'Liên hệ và địa chỉ'],
  ['CONTRACT / EMPLOYMENT_EVENT', '05_Hop_dong_qua_trinh', 'Hợp đồng và sự kiện công việc'],
  ['IDENTITY_DOCUMENT / INSURANCE / DEPENDENT', '06_Phap_ly_bao_hiem', 'Pháp lý, bảo hiểm và người phụ thuộc'],
  ['BANK_ACCOUNT / TAX_PROFILE', '07_Luong_thue_ngan_hang', 'Ngân hàng và thuế C4'],
  ['QUALIFICATION / CERTIFICATION', '08_Trinh_do_ho_so', 'Trình độ và chứng chỉ'],
];

const appendPayloadRow = (
  target: Record<string, unknown>[],
  recordType: string,
  employeeCode: string,
  recordCode: string | null,
  payload: Record<string, unknown> | null | undefined,
) => {
  if (!payload) return;
  const row: Record<string, unknown> = {
    record_type: recordType,
    employee_code: employeeCode,
    record_code: recordCode || '',
  };
  Object.entries(payload).forEach(([key, value]) => {
    const header = PAYLOAD_TO_HEADER[key];
    if (header && (typeof value !== 'object' || value == null)) row[header] = value ?? '';
  });
  target.push(row);
};

const buildExportRows = (manifest: Record<string, unknown>): Map<string, Record<string, unknown>[]> => {
  const data = new Map(HRM_PERSONNEL_WORKBOOK_SHEETS.map(sheet => [sheet.name, [] as Record<string, unknown>[]]));
  const employees = Array.isArray(manifest.employees) ? manifest.employees as Array<Record<string, any>> : [];
  employees.forEach(employee => {
    const overview = employee.overview || {};
    const employeeCode = String(overview.employeeCode || '');
    appendPayloadRow(data.get('01_Tong_quan')!, 'EMPLOYEE_CORE', employeeCode, null, {
      fullName: overview.fullName, status: overview.status,
      ...(overview.summary || {}),
    });

    const personal = employee.personalContact || {};
    appendPayloadRow(data.get('02_Ca_nhan_lien_he')!, 'PERSONAL_CONTACT', employeeCode, null, personal.personal);
    (personal.addresses || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('02_Ca_nhan_lien_he')!, 'ADDRESS', employeeCode, String(row.recordCode || ''), row));
    (personal.emergencyContacts || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('02_Ca_nhan_lien_he')!, 'EMERGENCY_CONTACT', employeeCode, String(row.recordCode || ''), row));

    const work = employee.workOrganization || {};
    data.get('03_Cong_viec_to_chuc')!.push({
      record_type: 'WORK_ORGANIZATION_PROJECTION', employee_code: employeeCode, record_code: '',
      title: work.title || '', org_unit_code: work.orgUnit?.code || '', org_unit_name: work.orgUnit?.name || '',
      position_code: work.position?.code || '', position_name: work.position?.name || '',
      direct_manager_code: work.directManager?.employeeCode || '',
      effective_from: work.primaryAssignment?.effectiveFrom || '',
    });

    const attendance = employee.attendanceLeave || {};
    data.get('04_Cham_cong_nghi_phep')!.push({
      record_type: 'ATTENDANCE_LEAVE_PROJECTION', employee_code: employeeCode, record_code: '',
      year: attendance.year || '', month: attendance.month || '',
      leave_accrued_days: attendance.leaveBalance?.accruedDays ?? '',
      leave_used_paid_days: attendance.leaveBalance?.usedPaidDays ?? '',
      leave_remaining_days: attendance.leaveBalance?.remainingDays ?? '',
    });

    const contracts = employee.contractsEmployment || {};
    (contracts.contracts || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('05_Hop_dong_qua_trinh')!, 'CONTRACT', employeeCode, String(row.contractNumber || ''), row));
    (contracts.employmentEvents || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('05_Hop_dong_qua_trinh')!, 'EMPLOYMENT_EVENT', employeeCode, String(row.recordCode || ''), row));

    const legal = employee.legalInsurance || {};
    (legal.identityDocuments || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('06_Phap_ly_bao_hiem')!, 'IDENTITY_DOCUMENT', employeeCode, String(row.recordCode || ''), row));
    appendPayloadRow(data.get('06_Phap_ly_bao_hiem')!, 'INSURANCE', employeeCode, null, legal.insuranceProfile);
    (legal.dependents || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('06_Phap_ly_bao_hiem')!, 'DEPENDENT', employeeCode, String(row.recordCode || ''), row));

    const compensation = employee.compensationTaxBank || {};
    appendPayloadRow(data.get('07_Luong_thue_ngan_hang')!, 'TAX_PROFILE', employeeCode, null, compensation.taxProfile);
    (compensation.bankAccounts || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('07_Luong_thue_ngan_hang')!, 'BANK_ACCOUNT', employeeCode, String(row.recordCode || ''), row));
    (compensation.salaryHistory || []).forEach((row: Record<string, unknown>) => {
      data.get('07_Luong_thue_ngan_hang')!.push({
        record_type: 'SALARY_PROJECTION', employee_code: employeeCode, record_code: String(row.id || ''),
        salary_effective_from: row.effectiveFrom || '', new_salary: row.newSalary ?? '',
        new_allowance: row.newAllowance ?? '',
      });
    });

    const qualifications = employee.qualificationsDocuments || {};
    (qualifications.qualifications || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('08_Trinh_do_ho_so')!, 'QUALIFICATION', employeeCode, String(row.recordCode || ''), row));
    (qualifications.certifications || []).forEach((row: Record<string, unknown>) =>
      appendPayloadRow(data.get('08_Trinh_do_ho_so')!, 'CERTIFICATION', employeeCode, String(row.recordCode || ''), row));
  });
  return data;
};

const createWorkbookBytes = async (
  dataRows: Map<string, Record<string, unknown>[]>,
  manifest?: Record<string, unknown>,
): Promise<ArrayBuffer> => {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();
  for (const definition of HRM_PERSONNEL_WORKBOOK_SHEETS) {
    const rows = dataRows.get(definition.name) || [];
    const matrix = [
      [...definition.headers],
      ...rows.map(row => definition.headers.map(header => row[header] ?? '')),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(matrix, { cellDates: true });
    worksheet['!cols'] = definition.headers.map(header => ({ wch: Math.min(28, Math.max(14, header.length + 2)) }));
    worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(definition.headers.length - 1)}${Math.max(1, matrix.length)}` };
    XLSX.utils.book_append_sheet(workbook, worksheet, definition.name);
  }
  const manifestRows = manifest ? [
    [], ['EXPORT MANIFEST', ''],
    ['Watermark', String(manifest.watermark || '')],
    ['Generated at', String(manifest.generatedAt || '')],
    ['Employee count', Number(manifest.employeeCount || 0)],
    ['Manifest hash', String(manifest.manifestHash || '')],
  ] : [];
  const guide = XLSX.utils.aoa_to_sheet([...GUIDE_ROWS, ...manifestRows]);
  guide['!cols'] = [{ wch: 52 }, { wch: 110 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, guide, 'Huong_dan');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellDates: true }) as ArrayBuffer;
};

export const createHrmPersonnelTemplateBytes = async (): Promise<ArrayBuffer> => {
  return createWorkbookBytes(new Map());
};

export const createHrmPersonnelExportBytes = async (
  manifest: Record<string, unknown>,
): Promise<ArrayBuffer> => createWorkbookBytes(buildExportRows(manifest), manifest);

export const calculateFileSha256 = async (file: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
