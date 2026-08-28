import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BadgeDollarSign, BriefcaseBusiness, CalendarDays, Contact,
  FileBadge, FileText, GraduationCap, IdCard, Loader2, LockKeyhole,
  PencilLine, Plus, RefreshCcw, Save, ShieldAlert, UserRound, X,
} from 'lucide-react';
import { hrmPersonnelProfileService } from '../../lib/hrmPersonnelProfileService';
import type {
  HrmPersonnelDetailSectionKey,
  HrmPersonnelOverview,
  HrmPersonnelSectionKey,
  HrmPersonnelSectionPayload,
} from '../../types/hrmPersonnelProfile';
import { HRM_PERSONNEL_SECTION_KEYS } from '../../types/hrmPersonnelProfile';

const SECTION_META: Array<{
  key: HrmPersonnelSectionKey;
  label: string;
  shortLabel: string;
  icon: typeof UserRound;
}> = [
  { key: 'overview', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: UserRound },
  { key: 'personal_contact', label: 'Cá nhân & liên hệ', shortLabel: 'Cá nhân', icon: Contact },
  { key: 'work_organization', label: 'Công việc & tổ chức', shortLabel: 'Công việc', icon: BriefcaseBusiness },
  { key: 'attendance_leave', label: 'Chấm công & nghỉ phép', shortLabel: 'Công & phép', icon: CalendarDays },
  { key: 'contracts_employment', label: 'Hợp đồng & quá trình', shortLabel: 'Hợp đồng', icon: FileText },
  { key: 'legal_insurance', label: 'Pháp lý & bảo hiểm', shortLabel: 'Pháp lý', icon: IdCard },
  { key: 'compensation_tax_bank', label: 'Lương, thuế & ngân hàng', shortLabel: 'Lương & thuế', icon: BadgeDollarSign },
  { key: 'qualifications_documents', label: 'Trình độ & hồ sơ', shortLabel: 'Trình độ', icon: GraduationCap },
];

type ProfileEditorKind =
  | 'employment' | 'identity' | 'insurance' | 'dependent'
  | 'bank' | 'tax' | 'qualification' | 'certification';

interface EditorField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'checkbox';
  required?: boolean;
}

const EDITOR_META: Record<ProfileEditorKind, { label: string; fields: EditorField[] }> = {
  employment: { label: 'Quá trình làm việc', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'eventTypeCode', label: 'Loại sự kiện', required: true },
    { key: 'eventDate', label: 'Ngày sự kiện', type: 'date', required: true },
    { key: 'titleSnapshot', label: 'Chức danh tại thời điểm' },
    { key: 'sourceReference', label: 'Nguồn tham chiếu', required: true },
    { key: 'eventReason', label: 'Nội dung sự kiện' },
  ] },
  identity: { label: 'Giấy tờ định danh', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'documentTypeCode', label: 'Loại giấy tờ', required: true },
    { key: 'documentNumber', label: 'Số giấy tờ', required: true },
    { key: 'issuedDate', label: 'Ngày cấp', type: 'date' },
    { key: 'issuedPlace', label: 'Nơi cấp' },
    { key: 'expiryDate', label: 'Ngày hết hạn', type: 'date' },
    { key: 'isPrimary', label: 'Giấy tờ chính', type: 'checkbox' },
  ] },
  insurance: { label: 'Bảo hiểm', fields: [
    { key: 'socialInsuranceNumber', label: 'Số BHXH' },
    { key: 'healthInsuranceNumber', label: 'Số BHYT' },
    { key: 'registeredClinicCode', label: 'Mã nơi khám chữa bệnh' },
    { key: 'participationStatusCode', label: 'Trạng thái tham gia' },
    { key: 'effectiveFrom', label: 'Hiệu lực từ', type: 'date' },
    { key: 'effectiveTo', label: 'Hiệu lực đến', type: 'date' },
  ] },
  dependent: { label: 'Người phụ thuộc', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'fullName', label: 'Họ và tên', required: true },
    { key: 'relationshipCode', label: 'Quan hệ', required: true },
    { key: 'dateOfBirth', label: 'Ngày sinh', type: 'date' },
    { key: 'taxCode', label: 'Mã số thuế' },
    { key: 'deductionFrom', label: 'Giảm trừ từ', type: 'date' },
    { key: 'deductionTo', label: 'Giảm trừ đến', type: 'date' },
  ] },
  bank: { label: 'Tài khoản ngân hàng', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'bankCode', label: 'Mã ngân hàng', required: true },
    { key: 'branchName', label: 'Chi nhánh' },
    { key: 'accountNumber', label: 'Số tài khoản', required: true },
    { key: 'accountHolder', label: 'Chủ tài khoản', required: true },
    { key: 'isPayrollAccount', label: 'Tài khoản nhận lương', type: 'checkbox' },
  ] },
  tax: { label: 'Thông tin thuế', fields: [
    { key: 'taxCode', label: 'Mã số thuế' },
    { key: 'taxResidencyCode', label: 'Mã cư trú thuế' },
    { key: 'registrationDate', label: 'Ngày đăng ký', type: 'date' },
  ] },
  qualification: { label: 'Trình độ', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'educationLevelCode', label: 'Mã trình độ' },
    { key: 'institutionName', label: 'Cơ sở đào tạo', required: true },
    { key: 'majorName', label: 'Chuyên ngành' },
    { key: 'degreeName', label: 'Văn bằng' },
    { key: 'graduationYear', label: 'Năm tốt nghiệp', type: 'number' },
  ] },
  certification: { label: 'Chứng chỉ', fields: [
    { key: 'recordCode', label: 'Mã bản ghi', required: true },
    { key: 'certificationTypeCode', label: 'Loại chứng chỉ' },
    { key: 'certificationName', label: 'Tên chứng chỉ', required: true },
    { key: 'certificateNumber', label: 'Số chứng chỉ' },
    { key: 'issuerName', label: 'Đơn vị cấp' },
    { key: 'issuedDate', label: 'Ngày cấp', type: 'date' },
    { key: 'expiryDate', label: 'Ngày hết hạn', type: 'date' },
  ] },
};

const SECTION_EDITORS: Partial<Record<HrmPersonnelSectionKey, ProfileEditorKind[]>> = {
  contracts_employment: ['employment'],
  legal_insurance: ['identity', 'insurance', 'dependent'],
  compensation_tax_bank: ['bank', 'tax'],
  qualifications_documents: ['qualification', 'certification'],
};

const FIELD_LABELS: Record<string, string> = {
  employeeId: 'Nhân sự', employeeCode: 'Mã nhân viên', fullName: 'Họ và tên',
  title: 'Chức danh', status: 'Trạng thái', gender: 'Giới tính',
  dateOfBirth: 'Ngày sinh', maritalStatus: 'Tình trạng hôn nhân',
  workPhone: 'Điện thoại công việc', workEmail: 'Email công việc',
  personalPhone: 'Điện thoại cá nhân', personalEmail: 'Email cá nhân',
  nationalityCode: 'Quốc tịch', placeOfBirth: 'Nơi sinh', hometown: 'Quê quán',
  addresses: 'Địa chỉ', emergencyContacts: 'Liên hệ khẩn cấp', personal: 'Liên hệ riêng',
  orgUnit: 'Đơn vị tổ chức', position: 'Vị trí công việc',
  primaryAssignment: 'Phân bổ chính', directManager: 'Quản lý trực tiếp',
  attendance: 'Chấm công', leaveBalance: 'Số dư phép', leaveRequests: 'Đơn nghỉ phép',
  contracts: 'Hợp đồng lao động', employmentEvents: 'Quá trình làm việc',
  identityDocuments: 'Giấy tờ định danh', insuranceProfile: 'Bảo hiểm', dependents: 'Người phụ thuộc',
  taxProfile: 'Thông tin thuế', bankAccounts: 'Tài khoản ngân hàng',
  salaryHistory: 'Lịch sử lương', recentPayrolls: 'Bảng lương gần đây',
  qualifications: 'Trình độ', certifications: 'Chứng chỉ', documents: 'Tài liệu hồ sơ',
  recordCode: 'Mã bản ghi', addressType: 'Loại địa chỉ', addressLine: 'Địa chỉ',
  fullNameContact: 'Họ và tên', relationshipCode: 'Quan hệ', phone: 'Điện thoại', email: 'Email',
  documentTypeCode: 'Loại giấy tờ', documentNumber: 'Số giấy tờ',
  issuedDate: 'Ngày cấp', issuedPlace: 'Nơi cấp', expiryDate: 'Ngày hết hạn',
  contractNumber: 'Số hợp đồng', type: 'Loại', effectiveFrom: 'Hiệu lực từ', effectiveTo: 'Hiệu lực đến',
  eventTypeCode: 'Loại sự kiện', eventDate: 'Ngày sự kiện', reason: 'Lý do',
  sourceReference: 'Nguồn tham chiếu', institutionName: 'Cơ sở đào tạo',
  majorName: 'Chuyên ngành', degreeName: 'Văn bằng', graduationYear: 'Năm tốt nghiệp',
  certificationName: 'Tên chứng chỉ', certificateNumber: 'Số chứng chỉ', issuerName: 'Đơn vị cấp',
  socialInsuranceNumber: 'Số BHXH', healthInsuranceNumber: 'Số BHYT',
  taxCode: 'Mã số thuế', bankCode: 'Ngân hàng', branchName: 'Chi nhánh',
  accountNumber: 'Số tài khoản', accountHolder: 'Chủ tài khoản',
  isPayrollAccount: 'Tài khoản nhận lương', month: 'Tháng', year: 'Năm',
  grossSalary: 'Tổng thu nhập', netSalary: 'Thực nhận', paidDate: 'Ngày trả',
};

const humanize = (key: string) => FIELD_LABELS[key]
  || key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());

const isEmptyValue = (value: unknown): boolean => {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['employeeId', 'maskedFields'].includes(key))
    .every(([, nested]) => isEmptyValue(nested));
  return false;
};

const formatValue = (value: unknown): string => {
  if (value == null || value === '') return 'Chưa cập nhật';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return new Intl.NumberFormat('vi-VN').format(value);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('vi-VN');
  }
  return text;
};

const DataFields: React.FC<{ value: Record<string, unknown> }> = ({ value }) => (
  <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
    {Object.entries(value)
      .filter(([key]) => !['employeeId', 'maskedFields'].includes(key))
      .map(([key, fieldValue]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">{humanize(key)}</dt>
          <dd className="mt-1 break-words text-sm font-bold text-slate-800 dark:text-slate-100">
            {formatValue(fieldValue)}
          </dd>
        </div>
      ))}
  </dl>
);

const PayloadGroup: React.FC<{ name: string; value: unknown }> = ({ name, value }) => {
  if (Array.isArray(value)) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-black text-slate-900 dark:text-white">{humanize(name)}</h3>
          <span className="text-xs font-bold text-slate-500">{value.length} bản ghi</span>
        </div>
        {value.length === 0 ? (
          <p className="py-5 text-sm font-semibold text-slate-500">Chưa có dữ liệu trong nhóm này.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {value.map((item, index) => (
              <article key={`${name}-${index}`} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
                {item && typeof item === 'object'
                  ? <DataFields value={item as Record<string, unknown>} />
                  : <p className="text-sm font-bold text-slate-800 dark:text-white">{formatValue(item)}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="mb-4 font-black text-slate-900 dark:text-white">{humanize(name)}</h3>
      {value && typeof value === 'object'
        ? <DataFields value={value as Record<string, unknown>} />
        : <p className="text-sm font-bold text-slate-800 dark:text-white">{formatValue(value)}</p>}
    </section>
  );
};

const SectionSkeleton = () => (
  <div className="space-y-4" aria-label="Đang tải hồ sơ">
    {[0, 1].map(item => (
      <div key={item} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map(line => <div key={line} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800" />)}
        </div>
      </div>
    ))}
  </div>
);

const HrmPersonnelProfile: React.FC = () => {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section') as HrmPersonnelSectionKey | null;
  const [overview, setOverview] = useState<HrmPersonnelOverview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<HrmPersonnelSectionKey>(
    requestedSection && HRM_PERSONNEL_SECTION_KEYS.includes(requestedSection) ? requestedSection : 'overview',
  );
  const [sectionData, setSectionData] = useState<Partial<Record<HrmPersonnelDetailSectionKey, HrmPersonnelSectionPayload>>>({});
  const [sectionLoading, setSectionLoading] = useState<HrmPersonnelDetailSectionKey | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<HrmPersonnelDetailSectionKey, string>>>({});
  const [editingContact, setEditingContact] = useState(false);
  const [contactForm, setContactForm] = useState({ personalPhone: '', personalEmail: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [editorKind, setEditorKind] = useState<ProfileEditorKind | null>(null);
  const [editorForm, setEditorForm] = useState<Record<string, string | boolean>>({});
  const [editorReason, setEditorReason] = useState('');
  const [savingEditor, setSavingEditor] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!employeeId) return;
    setOverviewLoading(true);
    setOverviewError('');
    try {
      setOverview(await hrmPersonnelProfileService.getOverview(employeeId));
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Không thể tải hồ sơ nhân sự.');
    } finally {
      setOverviewLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const visibleSections = useMemo(
    () => new Set(overview?.visibleSections || []),
    [overview?.visibleSections],
  );

  const loadSection = useCallback(async (section: HrmPersonnelDetailSectionKey, force = false) => {
    if (!employeeId || (!force && sectionData[section])) return;
    setSectionLoading(section);
    setSectionErrors(current => ({ ...current, [section]: '' }));
    try {
      const payload = await hrmPersonnelProfileService.getSection(section, employeeId);
      setSectionData(current => ({ ...current, [section]: payload }));
      if (section === 'personal_contact') {
        const personal = (payload.personal || {}) as Record<string, unknown>;
        setContactForm({
          personalPhone: String(personal.personalPhone || ''),
          personalEmail: String(personal.personalEmail || ''),
        });
      }
    } catch (error) {
      setSectionErrors(current => ({
        ...current,
        [section]: error instanceof Error ? error.message : 'Không thể tải phần hồ sơ này.',
      }));
    } finally {
      setSectionLoading(null);
    }
  }, [employeeId, sectionData]);

  useEffect(() => {
    if (!overview || activeSection === 'overview' || !visibleSections.has(activeSection)) return;
    void loadSection(activeSection);
  }, [activeSection, loadSection, overview, visibleSections]);

  const selectSection = (section: HrmPersonnelSectionKey) => {
    setActiveSection(section);
    setSearchParams(section === 'overview' ? {} : { section });
  };

  const savePersonalContact = async () => {
    if (!employeeId) return;
    setSavingContact(true);
    try {
      const payload = await hrmPersonnelProfileService.updatePersonalContact({
        employeeId,
        personalPhone: contactForm.personalPhone,
        personalEmail: contactForm.personalEmail,
        reason: 'Cập nhật liên hệ từ hồ sơ nhân sự',
      });
      setSectionData(current => ({ ...current, personal_contact: payload }));
      setEditingContact(false);
    } catch (error) {
      setSectionErrors(current => ({
        ...current,
        personal_contact: error instanceof Error ? error.message : 'Không thể lưu liên hệ cá nhân.',
      }));
    } finally {
      setSavingContact(false);
    }
  };

  const openEditor = (kind: ProfileEditorKind) => {
    setEditorKind(kind);
    setEditorForm({});
    setEditorReason('');
  };

  const saveDomainRecord = async () => {
    if (!employeeId || !editorKind) return;
    const textValue = (key: string) => String(editorForm[key] || '').trim();
    const optional = (key: string) => textValue(key) || null;
    setSavingEditor(true);
    setSectionErrors(current => ({ ...current, [activeSection]: '' }));
    try {
      let payload: HrmPersonnelSectionPayload;
      switch (editorKind) {
        case 'employment':
          payload = await hrmPersonnelProfileService.upsertEmploymentEvent({
            employeeId, recordCode: textValue('recordCode'), eventTypeCode: textValue('eventTypeCode'),
            eventDate: textValue('eventDate'), titleSnapshot: optional('titleSnapshot'),
            eventReason: optional('eventReason'), sourceReference: textValue('sourceReference'),
            reason: editorReason,
          });
          break;
        case 'identity':
          payload = await hrmPersonnelProfileService.upsertIdentityDocument({
            employeeId, recordCode: textValue('recordCode'),
            documentTypeCode: textValue('documentTypeCode'), documentNumber: textValue('documentNumber'),
            issuedDate: optional('issuedDate'), issuedPlace: optional('issuedPlace'),
            expiryDate: optional('expiryDate'), isPrimary: editorForm.isPrimary === true,
            reason: editorReason,
          });
          break;
        case 'insurance':
          payload = await hrmPersonnelProfileService.upsertInsuranceProfile({
            employeeId, socialInsuranceNumber: optional('socialInsuranceNumber'),
            healthInsuranceNumber: optional('healthInsuranceNumber'),
            registeredClinicCode: optional('registeredClinicCode'),
            participationStatusCode: optional('participationStatusCode'),
            effectiveFrom: optional('effectiveFrom'), effectiveTo: optional('effectiveTo'),
            reason: editorReason,
          });
          break;
        case 'dependent':
          payload = await hrmPersonnelProfileService.upsertDependent({
            employeeId, recordCode: textValue('recordCode'), fullName: textValue('fullName'),
            relationshipCode: textValue('relationshipCode'), dateOfBirth: optional('dateOfBirth'),
            taxCode: optional('taxCode'), deductionFrom: optional('deductionFrom'),
            deductionTo: optional('deductionTo'), reason: editorReason,
          });
          break;
        case 'bank':
          payload = await hrmPersonnelProfileService.upsertBankAccount({
            employeeId, recordCode: textValue('recordCode'), bankCode: textValue('bankCode'),
            branchName: optional('branchName'), accountNumber: textValue('accountNumber'),
            accountHolder: textValue('accountHolder'), isPayrollAccount: editorForm.isPayrollAccount === true,
            reason: editorReason,
          });
          break;
        case 'tax':
          payload = await hrmPersonnelProfileService.upsertTaxProfile({
            employeeId, taxCode: optional('taxCode'), taxResidencyCode: optional('taxResidencyCode'),
            registrationDate: optional('registrationDate'), reason: editorReason,
          });
          break;
        case 'qualification': {
          const graduationYear = textValue('graduationYear');
          payload = await hrmPersonnelProfileService.upsertQualification({
            employeeId, recordCode: textValue('recordCode'),
            educationLevelCode: optional('educationLevelCode'), institutionName: textValue('institutionName'),
            majorName: optional('majorName'), degreeName: optional('degreeName'),
            graduationYear: graduationYear ? Number(graduationYear) : null,
            startDate: null, endDate: null, reason: editorReason,
          });
          break;
        }
        case 'certification':
          payload = await hrmPersonnelProfileService.upsertCertification({
            employeeId, recordCode: textValue('recordCode'),
            certificationTypeCode: optional('certificationTypeCode'),
            certificationName: textValue('certificationName'),
            certificateNumber: optional('certificateNumber'), issuerName: optional('issuerName'),
            issuedDate: optional('issuedDate'), expiryDate: optional('expiryDate'),
            reason: editorReason,
          });
          break;
      }
      setSectionData(current => ({ ...current, [activeSection]: payload }));
      setEditorKind(null);
    } catch (error) {
      setSectionErrors(current => ({
        ...current,
        [activeSection]: error instanceof Error ? error.message : 'Không thể lưu thay đổi hồ sơ.',
      }));
    } finally {
      setSavingEditor(false);
    }
  };

  if (overviewLoading) return <SectionSkeleton />;
  if (overviewError || !overview) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-950/30">
        <ShieldAlert className="mx-auto text-rose-600" size={30} />
        <h1 className="mt-3 text-lg font-black text-rose-900 dark:text-rose-100">Không mở được hồ sơ</h1>
        <p className="mt-1 text-sm font-semibold text-rose-700 dark:text-rose-300">{overviewError || 'Hồ sơ không tồn tại.'}</p>
        <button type="button" onClick={() => void loadOverview()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-black text-white active:scale-[0.98]">
          <RefreshCcw size={15} /> Thử lại
        </button>
      </div>
    );
  }

  const canEditActive = overview.canEditSections.includes(activeSection);
  const selectedPayload = activeSection === 'overview' ? null : sectionData[activeSection];
  const selectedError = activeSection === 'overview' ? '' : sectionErrors[activeSection];
  const hasPermission = visibleSections.has(activeSection);

  return (
    <main className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <button type="button" onClick={() => navigate('/ep')} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-sky-700 dark:text-slate-300 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> Danh sách nhân sự
      </button>

      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="h-1.5 bg-sky-600" />
        <div className="grid gap-5 p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
          <img
            src={overview.avatarUrl || `https://i.pravatar.cc/160?u=${overview.employeeId}`}
            alt={overview.fullName}
            className="h-20 w-20 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
              <span>{overview.employeeCode || 'Chưa có mã'}</span>
              <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
              <span>{overview.status || 'Chưa cập nhật trạng thái'}</span>
            </div>
            <h1 className="mt-1 truncate text-2xl font-black text-slate-950 dark:text-white">{overview.fullName}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{overview.title || 'Chưa cập nhật chức danh'}</p>
          </div>
          <div className="rounded-xl bg-slate-100 px-4 py-3 text-right dark:bg-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Mức truy cập</p>
            <p className="mt-1 text-sm font-black text-sky-700 dark:text-sky-300">{overview.accessLevel}</p>
          </div>
        </div>
      </header>

      <nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900" aria-label="Nhóm thông tin hồ sơ">
        <div className="flex min-w-max gap-1">
          {SECTION_META.map(section => {
            const Icon = section.icon;
            const allowed = visibleSections.has(section.key);
            const selected = activeSection === section.key;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => selectSection(section.key)}
                aria-disabled={!allowed}
                title={allowed ? section.label : `${section.label}: không có quyền xem`}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-black transition active:scale-[0.98] ${
                  selected
                    ? 'bg-sky-700 text-white'
                    : allowed
                      ? 'text-slate-600 hover:bg-sky-50 hover:text-sky-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-sky-300'
                      : 'text-slate-400 dark:text-slate-600'
                }`}
              >
                {allowed ? <Icon size={15} /> : <LockKeyhole size={14} />}
                <span className="hidden xl:inline">{section.label}</span>
                <span className="xl:hidden">{section.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {!hasPermission ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <LockKeyhole className="mx-auto text-slate-400" size={30} />
          <h2 className="mt-3 text-lg font-black text-slate-900 dark:text-white">Không có quyền xem</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm font-semibold text-slate-500">
            Phần hồ sơ này không thuộc phạm vi được cấp. Hệ thống chưa tải dữ liệu của tab.
          </p>
        </section>
      ) : activeSection === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-5 text-lg font-black text-slate-950 dark:text-white">Thông tin hiện tại</h2>
            <DataFields value={{
              employeeCode: overview.employeeCode,
              fullName: overview.fullName,
              title: overview.title,
              status: overview.status,
              ...overview.summary,
            }} />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="text-lg font-black text-slate-950 dark:text-white">Phạm vi hồ sơ</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
              Có thể xem {overview.visibleSections.length}/8 nhóm thông tin. Mỗi nhóm chỉ tải khi được mở.
            </p>
            {overview.maskedFields.length > 0 && (
              <p className="mt-4 rounded-xl bg-white p-3 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Một số trường đang được che theo vai trò hiện tại.
              </p>
            )}
          </section>
        </div>
      ) : sectionLoading === activeSection && !selectedPayload ? (
        <SectionSkeleton />
      ) : selectedError ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-7 dark:border-amber-900 dark:bg-amber-950/20">
          <ShieldAlert className="text-amber-700 dark:text-amber-400" size={24} />
          <h2 className="mt-3 font-black text-amber-950 dark:text-amber-100">Không tải được phần hồ sơ</h2>
          <p className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-300">{selectedError}</p>
          <button type="button" onClick={() => void loadSection(activeSection, true)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-800 px-4 py-2 text-sm font-black text-white active:scale-[0.98]">
            <RefreshCcw size={15} /> Tải lại
          </button>
        </section>
      ) : !selectedPayload || isEmptyValue(selectedPayload) ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <FileBadge className="mx-auto text-slate-400" size={30} />
          <h2 className="mt-3 text-lg font-black text-slate-900 dark:text-white">Chưa có dữ liệu</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Nhóm thông tin này chưa có bản ghi phù hợp.</p>
        </section>
      ) : (
        <div className="space-y-4">
          {canEditActive && (
            <div className="flex flex-wrap justify-end gap-2">
              {activeSection === 'personal_contact' && (
                <button type="button" onClick={() => setEditingContact(true)} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white active:scale-[0.98]">
                  <PencilLine size={15} /> Cập nhật liên hệ
                </button>
              )}
              {(SECTION_EDITORS[activeSection] || []).map(kind => (
                <button key={kind} type="button" onClick={() => openEditor(kind)} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white active:scale-[0.98]">
                  <Plus size={15} /> {EDITOR_META[kind].label}
                </button>
              ))}
              {activeSection === 'contracts_employment' && (
                <button type="button" onClick={() => navigate('/hrm/contracts')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <FileText size={15} /> Quản lý hợp đồng
                </button>
              )}
              {activeSection === 'qualifications_documents' && (
                <button type="button" onClick={() => navigate('/hrm/documents')} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <FileBadge size={15} /> Quản lý tài liệu
                </button>
              )}
            </div>
          )}
          {Object.entries(selectedPayload)
            .filter(([key]) => !['employeeId', 'maskedFields'].includes(key))
            .map(([key, value]) => <PayloadGroup key={key} name={key} value={value} />)}
        </div>
      )}

      {editingContact && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Cập nhật liên hệ cá nhân">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950 dark:text-white">Cập nhật liên hệ</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Chỉ thay đổi điện thoại và email cá nhân.</p>
              </div>
              <button type="button" onClick={() => setEditingContact(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
            </div>
            <div className="mt-6 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Điện thoại cá nhân</span>
                <input value={contactForm.personalPhone} onChange={event => setContactForm(current => ({ ...current, personalPhone: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Email cá nhân</span>
                <input type="email" value={contactForm.personalEmail} onChange={event => setContactForm(current => ({ ...current, personalEmail: event.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditingContact(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200">Hủy</button>
              <button type="button" onClick={() => void savePersonalContact()} disabled={savingContact} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50 active:scale-[0.98]">
                {savingContact ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Lưu liên hệ
              </button>
            </div>
          </div>
        </div>
      )}

      {editorKind && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label={`Cập nhật ${EDITOR_META[editorKind].label}`}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950 dark:text-white">{EDITOR_META[editorKind].label}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">Mỗi bản ghi dùng mã ổn định để cập nhật đúng dữ liệu.</p>
              </div>
              <button type="button" onClick={() => setEditorKind(null)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {EDITOR_META[editorKind].fields.map(field => field.type === 'checkbox' ? (
                <label key={field.key} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={editorForm[field.key] === true}
                    onChange={event => setEditorForm(current => ({ ...current, [field.key]: event.target.checked }))}
                    className="h-4 w-4 accent-sky-700"
                  />
                  {field.label}
                </label>
              ) : (
                <label key={field.key} className="block space-y-2">
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{field.label}{field.required ? ' *' : ''}</span>
                  <input
                    type={field.type || 'text'}
                    value={String(editorForm[field.key] || '')}
                    onChange={event => setEditorForm(current => ({ ...current, [field.key]: event.target.value }))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </label>
              ))}
            </div>
            <label className="mt-5 block space-y-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Lý do thay đổi *</span>
              <textarea
                value={editorReason}
                onChange={event => setEditorReason(event.target.value)}
                rows={3}
                placeholder="Tối thiểu 10 ký tự để phục vụ kiểm toán"
                className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditorKind(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200">Hủy</button>
              <button
                type="button"
                onClick={() => void saveDomainRecord()}
                disabled={savingEditor || editorReason.trim().length < 10 || EDITOR_META[editorKind].fields.some(field => field.required && !String(editorForm[field.key] || '').trim())}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
              >
                {savingEditor ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Lưu bản ghi
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default HrmPersonnelProfile;
