// Profile record forms shared by HR direct edits and employee change requests (G3a/G3b).
// Choices instead of typed codes; the stored code stays stable for reports and imports.

export type ProfileEditorKind =
  | 'employment' | 'identity' | 'insurance' | 'dependent'
  | 'bank' | 'tax' | 'qualification' | 'certification' | 'address';

export type ProfileChangeKind = Exclude<ProfileEditorKind, 'employment'> | 'other';

export interface EditorField {
  key: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'checkbox' | 'select';
  required?: boolean;
  options?: Array<[code: string, label: string]>;
  placeholder?: string;
  hint?: string;
  /** Filled by default on employee requests (e.g. "payroll account"). */
  hiddenOnRequest?: boolean;
}

// Two-tier local government from 01/07/2025: 34 provinces / cities, no districts.
const PROVINCES: Array<[string, string]> = ([
  ['AN_GIANG', 'An Giang'], ['BAC_NINH', 'Bắc Ninh'], ['CA_MAU', 'Cà Mau'], ['CAO_BANG', 'Cao Bằng'],
  ['CAN_THO', 'TP. Cần Thơ'], ['DA_NANG', 'TP. Đà Nẵng'], ['DAK_LAK', 'Đắk Lắk'], ['DIEN_BIEN', 'Điện Biên'],
  ['DONG_NAI', 'Đồng Nai'], ['DONG_THAP', 'Đồng Tháp'], ['GIA_LAI', 'Gia Lai'], ['HA_NOI', 'TP. Hà Nội'],
  ['HA_TINH', 'Hà Tĩnh'], ['HAI_PHONG', 'TP. Hải Phòng'], ['HO_CHI_MINH', 'TP. Hồ Chí Minh'], ['HUE', 'TP. Huế'],
  ['HUNG_YEN', 'Hưng Yên'], ['KHANH_HOA', 'Khánh Hòa'], ['LAI_CHAU', 'Lai Châu'], ['LAM_DONG', 'Lâm Đồng'],
  ['LANG_SON', 'Lạng Sơn'], ['LAO_CAI', 'Lào Cai'], ['NGHE_AN', 'Nghệ An'], ['NINH_BINH', 'Ninh Bình'],
  ['PHU_THO', 'Phú Thọ'], ['QUANG_NGAI', 'Quảng Ngãi'], ['QUANG_NINH', 'Quảng Ninh'], ['QUANG_TRI', 'Quảng Trị'],
  ['SON_LA', 'Sơn La'], ['TAY_NINH', 'Tây Ninh'], ['THAI_NGUYEN', 'Thái Nguyên'], ['THANH_HOA', 'Thanh Hóa'],
  ['TUYEN_QUANG', 'Tuyên Quang'], ['VINH_LONG', 'Vĩnh Long'],
] as Array<[string, string]>).sort((a, b) => a[1].replace(/^TP\. /, '').localeCompare(b[1].replace(/^TP\. /, ''), 'vi'));

export const CODE_OPTIONS: Record<string, Array<[string, string]>> = {
  eventTypeCode: [
    ['TIEP_NHAN', 'Tiếp nhận'], ['THU_VIEC', 'Thử việc'], ['CHINH_THUC', 'Lên chính thức'],
    ['DIEU_CHUYEN', 'Điều chuyển'], ['BO_NHIEM', 'Bổ nhiệm'], ['MIEN_NHIEM', 'Miễn nhiệm'],
    ['DIEU_CHINH_LUONG', 'Điều chỉnh lương'], ['KHEN_THUONG', 'Khen thưởng'], ['KY_LUAT', 'Kỷ luật'],
    ['TAM_HOAN', 'Tạm hoãn hợp đồng'], ['NGHI_VIEC', 'Nghỉ việc'],
  ],
  documentTypeCode: [['CCCD', 'Căn cước / CCCD'], ['CMND', 'Chứng minh nhân dân (cũ)'], ['HO_CHIEU', 'Hộ chiếu'], ['GPLD', 'Giấy phép lao động']],
  participationStatusCode: [['TG', 'Đang tham gia'], ['1P', 'Tham gia một phần'], ['CTG', 'Chưa tham gia'], ['TS', 'Thai sản'], ['ĐĐ', 'Ốm đau'], ['HT', 'Hưu trí']],
  relationshipCode: [['VO', 'Vợ'], ['CHONG', 'Chồng'], ['CON', 'Con'], ['BO', 'Bố'], ['ME', 'Mẹ'], ['ANH_CHI_EM', 'Anh / chị / em'], ['KHAC', 'Khác']],
  bankCode: [
    ['VCB', 'Vietcombank'], ['BIDV', 'BIDV'], ['CTG', 'VietinBank'], ['AGRIBANK', 'Agribank'], ['TCB', 'Techcombank'],
    ['MB', 'MB Bank'], ['ACB', 'ACB'], ['VPB', 'VPBank'], ['TPB', 'TPBank'], ['SHB', 'SHB'], ['STB', 'Sacombank'],
    ['HDB', 'HDBank'], ['VIB', 'VIB'], ['MSB', 'MSB'], ['OCB', 'OCB'], ['SEAB', 'SeABank'], ['LPB', 'LPBank'],
    ['EIB', 'Eximbank'], ['KHAC', 'Ngân hàng khác'],
  ],
  taxResidencyCode: [['CU_TRU', 'Cá nhân cư trú'], ['KHONG_CU_TRU', 'Cá nhân không cư trú']],
  educationLevelCode: [['TS', 'Tiến sĩ'], ['Ths', 'Thạc sĩ'], ['ĐH', 'Đại học'], ['CĐ', 'Cao đẳng'], ['TC', 'Trung cấp'], ['SC', 'Sơ cấp'], ['LĐPT', 'Lao động phổ thông']],
  certificationTypeCode: [
    ['ATLD', 'Thẻ / chứng chỉ an toàn lao động'], ['HANH_NGHE_XD', 'Chứng chỉ hành nghề xây dựng'], ['THO_HAN', 'Chứng chỉ thợ hàn'],
    ['VAN_HANH', 'Vận hành thiết bị nâng / máy'], ['GPLX', 'Giấy phép lái xe'], ['PCCC', 'Phòng cháy chữa cháy'],
    ['SO_CAP_CUU', 'Sơ cấp cứu'], ['KHAC', 'Khác'],
  ],
  addressType: [['PERMANENT', 'Thường trú'], ['CURRENT', 'Nơi ở hiện tại'], ['CONTACT', 'Địa chỉ liên hệ']],
  provinceCode: PROVINCES,
};

export const codeLabel = (key: string, value: unknown): string | null => {
  const match = CODE_OPTIONS[key]?.find(([code]) => code === value);
  return match ? match[1] : null;
};

export const EDITOR_META: Record<ProfileEditorKind, { label: string; fields: EditorField[] }> = {
  employment: { label: 'Quá trình làm việc', fields: [
    { key: 'eventTypeCode', label: 'Loại sự kiện', type: 'select', required: true, options: CODE_OPTIONS.eventTypeCode },
    { key: 'eventDate', label: 'Ngày hiệu lực', type: 'date', required: true },
    { key: 'titleSnapshot', label: 'Chức danh tại thời điểm' },
    { key: 'sourceReference', label: 'Số quyết định / căn cứ', placeholder: 'Ví dụ: QĐ 12/2026/QĐ-TT' },
    { key: 'eventReason', label: 'Nội dung' },
  ] },
  address: { label: 'Địa chỉ', fields: [
    { key: 'addressType', label: 'Loại địa chỉ', type: 'select', required: true, options: CODE_OPTIONS.addressType },
    { key: 'provinceCode', label: 'Tỉnh / thành phố', type: 'select', required: true, options: CODE_OPTIONS.provinceCode },
    { key: 'wardName', label: 'Xã / phường', required: true, placeholder: 'Ví dụ: Phường Cầu Giấy', hint: 'Từ 01/07/2025 không còn cấp quận / huyện.' },
    { key: 'addressLine', label: 'Số nhà, đường, thôn / xóm', required: true, placeholder: 'Ví dụ: Số 12 ngõ 5 Trần Thái Tông' },
  ] },
  identity: { label: 'Giấy tờ định danh', fields: [
    { key: 'documentTypeCode', label: 'Loại giấy tờ', type: 'select', required: true, options: CODE_OPTIONS.documentTypeCode },
    { key: 'documentNumber', label: 'Số giấy tờ', required: true, hint: 'Số CCCD đồng thời là mã số thuế cá nhân (từ 01/07/2025).' },
    { key: 'issuedDate', label: 'Ngày cấp', type: 'date' },
    { key: 'issuedPlace', label: 'Nơi cấp' },
    { key: 'expiryDate', label: 'Ngày hết hạn', type: 'date' },
    { key: 'isPrimary', label: 'Giấy tờ chính', type: 'checkbox', hiddenOnRequest: true },
  ] },
  insurance: { label: 'Bảo hiểm', fields: [
    { key: 'socialInsuranceNumber', label: 'Số sổ BHXH' },
    { key: 'healthInsuranceNumber', label: 'Số thẻ BHYT' },
    { key: 'registeredClinicCode', label: 'Nơi đăng ký khám chữa bệnh' },
    { key: 'participationStatusCode', label: 'Tình trạng tham gia', type: 'select', options: CODE_OPTIONS.participationStatusCode, hiddenOnRequest: true },
    { key: 'effectiveFrom', label: 'Tham gia từ', type: 'date', hiddenOnRequest: true },
    { key: 'effectiveTo', label: 'Đến', type: 'date', hiddenOnRequest: true },
  ] },
  dependent: { label: 'Người phụ thuộc', fields: [
    { key: 'fullName', label: 'Họ và tên', required: true },
    { key: 'relationshipCode', label: 'Quan hệ', type: 'select', required: true, options: CODE_OPTIONS.relationshipCode },
    { key: 'dateOfBirth', label: 'Ngày sinh', type: 'date' },
    { key: 'taxCode', label: 'Số CCCD / mã số thuế' },
    { key: 'deductionFrom', label: 'Giảm trừ từ', type: 'date' },
    { key: 'deductionTo', label: 'Giảm trừ đến', type: 'date', hiddenOnRequest: true },
  ] },
  bank: { label: 'Tài khoản ngân hàng', fields: [
    { key: 'bankCode', label: 'Ngân hàng', type: 'select', required: true, options: CODE_OPTIONS.bankCode },
    { key: 'branchName', label: 'Chi nhánh' },
    { key: 'accountNumber', label: 'Số tài khoản', required: true },
    { key: 'accountHolder', label: 'Chủ tài khoản', required: true, placeholder: 'Viết hoa không dấu như trên thẻ' },
    { key: 'isPayrollAccount', label: 'Tài khoản nhận lương', type: 'checkbox', hiddenOnRequest: true },
  ] },
  tax: { label: 'Thông tin thuế', fields: [
    { key: 'taxCode', label: 'Mã số thuế', hint: 'Từ 01/07/2025 dùng số CCCD.' },
    { key: 'taxResidencyCode', label: 'Tình trạng cư trú', type: 'select', options: CODE_OPTIONS.taxResidencyCode },
    { key: 'registrationDate', label: 'Ngày đăng ký', type: 'date' },
  ] },
  qualification: { label: 'Trình độ', fields: [
    { key: 'educationLevelCode', label: 'Trình độ', type: 'select', options: CODE_OPTIONS.educationLevelCode },
    { key: 'institutionName', label: 'Cơ sở đào tạo', required: true },
    { key: 'majorName', label: 'Chuyên ngành' },
    { key: 'degreeName', label: 'Văn bằng' },
    { key: 'graduationYear', label: 'Năm tốt nghiệp', type: 'number' },
  ] },
  certification: { label: 'Chứng chỉ', fields: [
    { key: 'certificationTypeCode', label: 'Loại chứng chỉ', type: 'select', options: CODE_OPTIONS.certificationTypeCode },
    { key: 'certificationName', label: 'Tên chứng chỉ', required: true },
    { key: 'certificateNumber', label: 'Số chứng chỉ' },
    { key: 'issuerName', label: 'Đơn vị cấp' },
    { key: 'issuedDate', label: 'Ngày cấp', type: 'date' },
    { key: 'expiryDate', label: 'Ngày hết hạn', type: 'date', hint: 'Hệ thống sẽ nhắc trước khi hết hạn.' },
  ] },
};

/** What an employee can ask HR to change, in the order people usually need it. */
export const REQUEST_KINDS: Array<{ kind: ProfileChangeKind; label: string; hint: string; evidence: string }> = [
  { kind: 'address', label: 'Địa chỉ', hint: 'Chuyển nhà, đổi địa chỉ thường trú', evidence: 'Không bắt buộc' },
  { kind: 'identity', label: 'CCCD / giấy tờ', hint: 'Làm lại CCCD, hộ chiếu', evidence: 'Ảnh 2 mặt giấy tờ' },
  { kind: 'bank', label: 'Tài khoản nhận lương', hint: 'Đổi ngân hàng hoặc số tài khoản', evidence: 'Ảnh thẻ hoặc sao kê có tên' },
  { kind: 'dependent', label: 'Người phụ thuộc', hint: 'Đăng ký giảm trừ gia cảnh', evidence: 'Giấy khai sinh / CCCD người phụ thuộc' },
  { kind: 'insurance', label: 'BHXH / BHYT', hint: 'Số sổ BHXH, nơi khám chữa bệnh', evidence: 'Ảnh sổ hoặc thẻ BHYT' },
  { kind: 'qualification', label: 'Bằng cấp', hint: 'Bổ sung văn bằng mới', evidence: 'Ảnh văn bằng' },
  { kind: 'certification', label: 'Chứng chỉ', hint: 'An toàn lao động, hành nghề, lái xe…', evidence: 'Ảnh chứng chỉ' },
  { kind: 'other', label: 'Thông tin khác', hint: 'Sai tên, ngày sinh, thông tin khác', evidence: 'Giấy tờ liên quan' },
];

export const kindLabel = (kind: string): string =>
  REQUEST_KINDS.find(item => item.kind === kind)?.label || (EDITOR_META as Record<string, { label: string }>)[kind]?.label || kind;

/** Missing required fields for a form, as labels. */
export const missingRequired = (fields: EditorField[], form: Record<string, unknown>): string[] =>
  fields.filter(field => field.required && !String(form[field.key] ?? '').trim()).map(field => field.label);

const formatFieldValue = (field: EditorField, value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  const text = String(value ?? '').trim();
  if (field.options) return codeLabel(field.key, text) || text;
  if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(text)) return text.split('-').reverse().join('/');
  return text;
};

/** Proposed values as label → text, in form order, skipping blanks. */
export const describePayload = (kind: string, payload: Record<string, unknown>): Array<[string, string]> => {
  const fields = (EDITOR_META as Record<string, { fields: EditorField[] } | undefined>)[kind]?.fields || [];
  return fields
    .filter(field => payload[field.key] !== undefined && payload[field.key] !== '' && payload[field.key] !== null)
    .map(field => [field.label, formatFieldValue(field, payload[field.key])]);
};
