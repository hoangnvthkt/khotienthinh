// Bảng nhân sự: one row per person with the company's standard columns (sheet "Data"),
// HR proposes changes for one or many people, HR Manage approves, the server applies them.
// This file holds the column registry, formatting, the Excel reader and the matching
// of an imported file against the current roster. No network calls here.

export type RosterValue = string | number | null;

export type RosterGroupKey = 'position' | 'contract' | 'personal' | 'pay' | 'other';

export type RosterCatalogKey = 'orgUnit' | 'position' | 'level' | 'education' | 'gender';

export type RosterFieldKey =
  | 'employeeCode' | 'fullName'
  | 'orgUnit' | 'position' | 'level'
  | 'startDate' | 'officialDate' | 'leaveRemaining'
  | 'phone' | 'dateOfBirth' | 'gender' | 'idNumber' | 'idIssuedDate' | 'idIssuedPlace'
  | 'permanentAddress' | 'education' | 'institution'
  | 'p1' | 'pctn' | 'phoneAllowance' | 'p3' | 'vehicleAllowance' | 'seniorityAllowance'
  | 'note' | 'legacyCode'
  /** Columns HR adds in Cấu hình (lib/hrmRosterConfig.ts). */
  | `custom:${string}`;

export interface RosterFieldDef {
  key: RosterFieldKey;
  label: string;
  group: RosterGroupKey;
  type: 'text' | 'date' | 'number' | 'money' | 'select';
  catalog?: RosterCatalogKey;
  /** Counted in "Thiếu thông tin". */
  required?: boolean;
  /** HR changes this through a change request; false = derived or read-only. */
  editable: boolean;
  /** Column width in px on the desktop table. */
  width: number;
  /** Shown and changed only by people who see pay (the note often carries salary decisions). */
  payOnly?: boolean;
  align?: 'right';
  /** Choices of a custom "Danh sách chọn" / "Có / Không" column. */
  options?: string[];
  /** Added by HR in Cấu hình. */
  custom?: boolean;
  hint?: string | null;
}

export const ROSTER_GROUPS: Array<{ key: RosterGroupKey; label: string; tone: string }> = [
  { key: 'position', label: 'Vị trí công việc', tone: 'bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100' },
  { key: 'contract', label: 'Hợp đồng', tone: 'bg-mint-50 text-mint-900 dark:bg-mint-950/40 dark:text-mint-100' },
  { key: 'personal', label: 'Liên hệ & giấy tờ', tone: 'bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100' },
  { key: 'pay', label: 'Lương & phụ cấp', tone: 'bg-leaf-50 text-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-100' },
  { key: 'other', label: 'Khác', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
];

export const ROSTER_FIELDS: RosterFieldDef[] = [
  { key: 'orgUnit', label: 'Bộ phận', group: 'position', type: 'select', catalog: 'orgUnit', required: true, editable: true, width: 200 },
  { key: 'position', label: 'Chức danh', group: 'position', type: 'select', catalog: 'position', required: true, editable: true, width: 230 },
  { key: 'level', label: 'Level', group: 'position', type: 'select', catalog: 'level', required: true, editable: true, width: 72 },
  { key: 'startDate', label: 'Ngày vào', group: 'contract', type: 'date', required: true, editable: true, width: 100 },
  { key: 'officialDate', label: 'Ngày chính thức', group: 'contract', type: 'date', editable: true, width: 110 },
  { key: 'leaveRemaining', label: 'Phép năm còn', group: 'contract', type: 'number', editable: true, width: 84, align: 'right' },
  { key: 'phone', label: 'SĐT', group: 'personal', type: 'text', required: true, editable: true, width: 112 },
  { key: 'dateOfBirth', label: 'Ngày sinh', group: 'personal', type: 'date', required: true, editable: true, width: 100 },
  { key: 'gender', label: 'Giới tính', group: 'personal', type: 'select', catalog: 'gender', editable: true, width: 70 },
  { key: 'idNumber', label: 'CCCD', group: 'personal', type: 'text', required: true, editable: true, width: 124 },
  { key: 'idIssuedDate', label: 'Ngày cấp', group: 'personal', type: 'date', editable: true, width: 100 },
  { key: 'idIssuedPlace', label: 'Nơi cấp', group: 'personal', type: 'text', editable: true, width: 180 },
  { key: 'permanentAddress', label: 'Địa chỉ thường trú', group: 'personal', type: 'text', editable: true, width: 240 },
  { key: 'education', label: 'Trình độ', group: 'personal', type: 'select', catalog: 'education', editable: true, width: 90 },
  { key: 'institution', label: 'Nơi đào tạo', group: 'personal', type: 'text', editable: true, width: 160 },
  { key: 'p1', label: 'Lương cơ bản (P1)', group: 'pay', type: 'money', editable: true, width: 110, align: 'right' },
  { key: 'pctn', label: 'PCTN (P2)', group: 'pay', type: 'money', editable: true, width: 96, align: 'right' },
  { key: 'phoneAllowance', label: 'PC điện thoại', group: 'pay', type: 'money', editable: true, width: 96, align: 'right' },
  { key: 'p3', label: 'P3 tiêu chuẩn', group: 'pay', type: 'money', editable: true, width: 104, align: 'right' },
  { key: 'vehicleAllowance', label: 'PC giữ gìn xe', group: 'pay', type: 'money', editable: true, width: 96, align: 'right' },
  { key: 'seniorityAllowance', label: 'Thâm niên (đ)', group: 'pay', type: 'money', editable: true, width: 96, align: 'right' },
  { key: 'note', label: 'Ghi chú (HR Manage)', group: 'other', type: 'text', editable: true, width: 220, payOnly: true },
  { key: 'legacyCode', label: 'Mã NV cũ', group: 'other', type: 'text', editable: false, width: 84 },
];

const STANDARD_BY_KEY = Object.fromEntries(ROSTER_FIELDS.map(field => [field.key, field])) as Record<string, RosterFieldDef>;

// Custom columns of the current company setup; set once the roster is loaded (setRosterCustomFields).
let customFieldDefs: RosterFieldDef[] = [];
let customByKey: Record<string, RosterFieldDef> = {};

export interface RosterCustomFieldInput {
  key: string; label: string; group: RosterGroupKey; type: 'text' | 'number' | 'money' | 'date' | 'select' | 'boolean';
  options: string[]; required: boolean; payOnly: boolean; hint: string | null; sortOrder: number; isActive: boolean;
}

const CUSTOM_WIDTH = { text: 180, number: 90, money: 110, date: 100, select: 150, boolean: 80 } as const;

export const customFieldToDef = (field: RosterCustomFieldInput): RosterFieldDef => ({
  key: field.key as RosterFieldKey,
  label: field.label,
  group: field.group,
  type: field.type === 'boolean' ? 'select' : field.type,
  options: field.type === 'boolean' ? ['Có', 'Không'] : field.type === 'select' ? field.options : undefined,
  required: field.required,
  editable: true,
  width: field.type === 'select'
    ? Math.min(240, Math.max(CUSTOM_WIDTH.select, 28 + 7 * Math.max(field.label.length, ...field.options.map(option => option.length))))
    : CUSTOM_WIDTH[field.type],
  align: field.type === 'money' || field.type === 'number' ? 'right' : undefined,
  payOnly: field.payOnly || field.group === 'pay',
  custom: true,
  hint: field.hint,
});

/** Registers the active custom columns; inactive ones keep their values but leave the table. */
export const setRosterCustomFields = (fields: RosterCustomFieldInput[] | null | undefined) => {
  const all = (fields || []).map(customFieldToDef);
  customFieldDefs = (fields || []).filter(field => field.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(customFieldToDef);
  customByKey = Object.fromEntries(all.map(def => [def.key, def]));
};

/** Standard columns followed by custom ones, each custom column at the end of its group. */
export const rosterFields = (): RosterFieldDef[] => ROSTER_GROUPS.flatMap(group => [
  ...ROSTER_FIELDS.filter(field => field.group === group.key),
  ...customFieldDefs.filter(field => field.group === group.key),
]);

const FALLBACK_DEF = (key: string): RosterFieldDef => ({ key: key as RosterFieldKey, label: key, group: 'other', type: 'text', editable: false, width: 120 });
export const fieldDef = (key: string): RosterFieldDef => STANDARD_BY_KEY[key] || customByKey[key] || FALLBACK_DEF(key);
/** Standard columns by key (custom ones go through fieldDef). */
export const FIELD_BY_KEY = STANDARD_BY_KEY as Record<string, RosterFieldDef>;

const EXTRA_LABELS: Record<string, string> = { employeeCode: 'Mã NV', fullName: 'Họ và tên' };
export const fieldLabel = (key: string): string => STANDARD_BY_KEY[key]?.label || customByKey[key]?.label || EXTRA_LABELS[key] || key;

/** Pay fields (and the note): only people with the compensation permission see and change them. */
export const PAY_FIELDS = ROSTER_FIELDS.filter(field => field.group === 'pay' || field.payOnly).map(field => field.key);
export const isPayField = (key: string): boolean => PAY_FIELDS.includes(key as RosterFieldKey) || Boolean(customByKey[key]?.payOnly);
/** Personal fields: CCCD, phone, address… visible to HR only. */
export const PERSONAL_FIELDS = ROSTER_FIELDS.filter(field => field.group === 'personal').map(field => field.key);

// ---------------------------------------------------------------------------
// Data coming from the server
// ---------------------------------------------------------------------------
export interface RosterOrgUnit { id: string; code: string | null; name: string; blockCode: string | null; sortOrder?: number | null; aliases?: string[] }
export interface RosterPosition { id: string; code: string | null; name: string; groupCode: string | null; levelCode: string | null }
export interface RosterOption { code: string; name: string }

export interface RosterCatalogs {
  orgUnits: RosterOrgUnit[];
  positions: RosterPosition[];
  levels: RosterOption[];
  groups: RosterOption[];
  education: RosterOption[];
  blocks: RosterOption[];
}

export interface RosterPending { batchId: string; batchCode: string; value: RosterValue }

export interface RosterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  status: string;
  /** Where the person works (văn phòng / công trường) — helps tell two people with the same name apart. */
  hint?: string | null;
  values: Partial<Record<RosterFieldKey, RosterValue>>;
  /** Changes waiting for approval, per field. */
  pending: Partial<Record<RosterFieldKey | 'fullName', RosterPending>>;
}

export interface RosterCapabilities {
  edit: boolean;
  viewPersonal: boolean;
  viewPay: boolean;
  editPay: boolean;
  approve: boolean;
  import: boolean;
  /** Admin / HR Manage: người duyệt and extra columns. */
  configure?: boolean;
  /** Not HR, but named as an approver in Cấu hình: sees only the requests given to them. */
  approverOnly?: boolean;
}

export interface RosterData {
  rows: RosterRow[];
  catalogs: RosterCatalogs;
  can: RosterCapabilities;
  /** Step-1 approvers of a request without pay (who a draft goes to). */
  approvers: Array<{ userId: string; name: string }>;
  /** Step-1 approvers of a request with pay, when different. */
  payApprovers?: Array<{ userId: string; name: string }>;
  customFields?: RosterCustomFieldInput[];
  today: string;
}

export type RosterBatchStatus = 'pending' | 'approved' | 'returned' | 'cancelled';
export type RosterBatchSource = 'grid' | 'import';

export interface RosterChangeItem {
  /** null = a new person created by this batch (import). */
  employeeId: string | null;
  /** Groups the items of one new person ("new:<row>"); the employee id otherwise. */
  personKey: string;
  employeeCode: string | null;
  fullName: string;
  field: RosterFieldKey | 'fullName' | 'employeeCode';
  oldValue: RosterValue;
  newValue: RosterValue;
}

export interface RosterBatchStep {
  step: number;
  approverNames: string[];
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface RosterBatch {
  id: string;
  /** 'pay' when the request changes pay: it follows the Lương & phụ cấp approvers. */
  approvalGroup?: 'general' | 'pay';
  /** One entry per approval step; the request is applied after the last one. */
  steps?: RosterBatchStep[];
  currentStep?: number;
  code: string;
  source: RosterBatchSource;
  title: string;
  reason: string;
  effectiveDate: string;
  status: RosterBatchStatus;
  createdByName: string;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  approverNames: string[];
  peopleCount: number;
  newPeopleCount: number;
  itemCount: number;
  items: RosterChangeItem[];
  awaitingMe: boolean;
  can: { decide: boolean; cancel: boolean; resubmit: boolean };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
export const GENDER_OPTIONS: RosterOption[] = [{ code: 'Nam', name: 'Nam' }, { code: 'Nữ', name: 'Nữ' }];

export const dateVi = (iso: RosterValue): string => {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

export const moneyVi = (value: RosterValue): string => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value)) : '';

const catalogLabel = (catalogs: RosterCatalogs, catalog: RosterCatalogKey, value: RosterValue): string => {
  if (value == null || value === '') return '';
  const id = String(value);
  if (catalog === 'orgUnit') return catalogs.orgUnits.find(unit => unit.id === id)?.name || id;
  if (catalog === 'position') return catalogs.positions.find(position => position.id === id)?.name || id;
  if (catalog === 'level') return id;
  if (catalog === 'education') return catalogs.education.find(item => item.code === id)?.name || id;
  return id;
};

export const formatValue = (key: string, value: RosterValue, catalogs: RosterCatalogs): string => {
  const field = STANDARD_BY_KEY[key] || customByKey[key];
  if (value == null || value === '') return '';
  if (!field) return String(value);
  if (field.type === 'date') return dateVi(value);
  if (field.type === 'money') return moneyVi(value);
  if (field.type === 'number') return typeof value === 'number' ? String(Math.round(value * 10) / 10).replace('.', ',') : String(value);
  if (field.type === 'select' && field.catalog) return catalogLabel(catalogs, field.catalog, value);
  return String(value);
};

/** Whole months from the start date to `today` (thâm niên). */
export const seniorityMonths = (start: RosterValue, today: string): number | null => {
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(start)) return null;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const months = (ty - sy) * 12 + (tm - sm) - (td < sd ? 1 : 0);
  return months < 0 ? 0 : months;
};

export const seniorityLabel = (months: number | null): string => {
  if (months == null) return '';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} th`;
  return rest ? `${years} n ${rest} th` : `${years} năm`;
};

/** Monthly total = P1 + PCTN + PC điện thoại + P3 + PC giữ xe; null when nothing is known. */
export const salaryTotal = (values: Partial<Record<RosterFieldKey, RosterValue>>): number | null => {
  const parts = (['p1', 'pctn', 'phoneAllowance', 'p3', 'vehicleAllowance'] as const).map(key => values[key]);
  if (parts.every(part => part == null)) return null;
  return parts.reduce<number>((sum, part) => sum + (typeof part === 'number' ? part : 0), 0);
};

export const blockOf = (row: Pick<RosterRow, 'values'>, catalogs: RosterCatalogs): string | null => {
  const unit = catalogs.orgUnits.find(item => item.id === row.values.orgUnit);
  return unit?.blockCode || null;
};

export const positionOf = (row: Pick<RosterRow, 'values'>, catalogs: RosterCatalogs): RosterPosition | null =>
  catalogs.positions.find(item => item.id === row.values.position) || null;

/** Placeholder numbers typed when accounts were created (0999…): unknown, not a real phone. */
export const isPlaceholderPhone = (value: RosterValue): boolean => typeof value === 'string' && /^0999/.test(value);

/** Required columns that are empty (or hold a placeholder). Only columns the viewer can see count. */
export const missingFields = (row: Pick<RosterRow, 'values'>, can: Pick<RosterCapabilities, 'viewPersonal'> & Partial<Pick<RosterCapabilities, 'viewPay'>>): RosterFieldKey[] =>
  rosterFields().filter(field => field.required && (can.viewPersonal || field.group !== 'personal') && (!field.payOnly || Boolean(can.viewPay)))
    .filter(field => row.values[field.key] == null || row.values[field.key] === '' || (field.key === 'phone' && isPlaceholderPhone(row.values.phone ?? null)))
    .map(field => field.key);

/** Mã NV = TT + 6 số cuối CCCD (chủ SP chốt 16/10/2026). */
export const codeFromIdNumber = (idNumber: RosterValue): string | null => {
  const digits = String(idNumber ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? `TT${digits.slice(-6)}` : null;
};

/** Same as codeFromIdNumber but takes one more digit while the code is used by someone else. */
export const uniqueCodeFromIdNumber = (idNumber: RosterValue, taken: (code: string) => boolean): string | null => {
  const digits = String(idNumber ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  for (let size = 6; size <= digits.length; size += 1) {
    const code = `TT${digits.slice(-size)}`;
    if (!taken(code)) return code;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Text helpers shared by the importer and the search box
// ---------------------------------------------------------------------------
export const nfcText = (value: unknown): string => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const nameKey = (value: unknown): string => nfcText(value).replace(/\(\d+\)/g, '').trim().toLocaleLowerCase('vi');
export const flatText = (value: unknown): string => nameKey(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

/** Same letters and marks, any tone-mark placement: "Thuỷ" = "Thủy", but "Thanh" ≠ "Thành". */
const toneKey = (value: unknown): string => nameKey(value).split(' ').map(syllable => {
  const chars = [...syllable.normalize('NFD')];
  const isMark = (ch: string) => /[\u0300-\u036f]/.test(ch);
  return `${chars.filter(ch => !isMark(ch)).join('')}|${chars.filter(isMark).sort().join('')}`;
}).join(' ');

const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
};

/** Same family name, given name at most 2 letters apart, middle names may be missing. */
const looksLikeSamePerson = (a: string, b: string): boolean => {
  const ta = flatText(a).split(' ');
  const tb = flatText(b).split(' ');
  if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0]) return false;
  const givenA = ta[ta.length - 1];
  const givenB = tb[tb.length - 1];
  if (editDistance(givenA, givenB) > 2) return false;
  const midA = ta.slice(1, -1);
  const midB = tb.slice(1, -1);
  const [short, long] = midA.length <= midB.length ? [midA, midB] : [midB, midA];
  return short.every(token => long.includes(token)) && (givenA === givenB || midA.join(' ') === midB.join(' '));
};

// ---------------------------------------------------------------------------
// Excel "Data" sheet → rows
// ---------------------------------------------------------------------------
export interface RosterImportIssue { rowNumber: number; fullName: string; column: string; value: string; fix: string }

export interface RosterImportRow {
  rowNumber: number;
  fullName: string;
  /** "Ban chỉ huy công trình XINHAI VINA", resolved to an org unit id when it matches. */
  unitText: string;
  positionText: string;
  levelText: string;
  educationText: string;
  values: Partial<Record<RosterFieldKey, RosterValue>>;
}

type Cell = string | number | boolean | Date | null | undefined;

const HEADERS: Array<{ key: RosterFieldKey | 'fullName' | 'unitText' | 'positionText' | 'levelText' | 'educationText' | 'seniorityMonths'; match: (flat: string, sub: string) => boolean }> = [
  { key: 'fullName', match: flat => flat === 'ho va ten' },
  { key: 'positionText', match: (flat, sub) => sub === 'ten goi' || flat === 'chuc danh' },
  { key: 'unitText', match: flat => flat === 'bo phan' },
  { key: 'levelText', match: flat => flat === 'level' },
  { key: 'p1', match: flat => flat.startsWith('luong co ban') },
  { key: 'pctn', match: flat => flat.startsWith('pctn') },
  { key: 'phoneAllowance', match: flat => flat.startsWith('pc dien thoai') },
  { key: 'p3', match: flat => flat.startsWith('p3') },
  { key: 'vehicleAllowance', match: flat => flat.startsWith('pc giu gin xe') },
  { key: 'seniorityMonths', match: (_flat, sub) => sub === 'tham nien' },
  { key: 'startDate', match: flat => flat === 'ngay vao' },
  { key: 'officialDate', match: flat => flat.startsWith('ngay ky hdld chinh thuc') },
  { key: 'leaveRemaining', match: flat => flat.startsWith('phep nam') },
  { key: 'phone', match: flat => flat.startsWith('sdt') },
  { key: 'dateOfBirth', match: flat => flat === 'ngay sinh' },
  { key: 'idNumber', match: flat => flat === 'cccd' },
  { key: 'idIssuedDate', match: flat => flat === 'ngay cap' },
  { key: 'idIssuedPlace', match: flat => flat === 'noi cap' },
  { key: 'permanentAddress', match: flat => flat.startsWith('dia chi thuong tru') },
  { key: 'educationText', match: flat => flat === 'trinh do' },
  { key: 'institution', match: flat => flat === 'noi dao tao' },
  { key: 'note', match: flat => flat.startsWith('mo ta') || flat === 'ghi chu' },
];

const headerFlat = (cell: Cell): string => flatText(cell).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

const excelSerialToIso = (serial: number): string | null => {
  if (!Number.isFinite(serial) || serial < 1000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/** Excel cells are either real dates (serial numbers) or text typed as d/m/yyyy. */
export const parseRosterDate = (cell: Cell): { value: string | null; bad: boolean } => {
  if (cell == null || cell === '') return { value: null, bad: false };
  if (cell instanceof Date) return { value: cell.toISOString().slice(0, 10), bad: false };
  if (typeof cell === 'number') { const value = excelSerialToIso(cell); return { value, bad: value == null }; }
  const text = String(cell).trim();
  if (!text || /^-+$/.test(text)) return { value: null, bad: false };
  const match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!match) return { value: null, bad: true };
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (match[3].length === 2) year += year > 40 ? 1900 : 2000;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || check.getUTCDate() !== day) return { value: null, bad: true };
  return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, bad: false };
};

const parseMoney = (cell: Cell): number | null => {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  const text = String(cell).trim();
  if (/^-+$/.test(text)) return 0;
  const digits = text.replace(/[^\d-]/g, '');
  return digits ? Number(digits) : null;
};

const parsePhone = (cell: Cell): { value: string | null; extra: boolean; fixed: boolean } => {
  if (cell == null || cell === '') return { value: null, extra: false, fixed: false };
  const parts = String(cell).split(/[/,;\n]+/).map(part => part.replace(/\D/g, '')).filter(Boolean);
  if (parts.length === 0) return { value: null, extra: false, fixed: false };
  let first = parts[0].replace(/^84(?=\d{9}$)/, '0');
  const fixed = first.length === 9;
  if (fixed) first = `0${first}`;
  return { value: first, extra: parts.length > 1, fixed };
};

const parseIdNumber = (cell: Cell): { value: string | null; fixed: boolean } => {
  if (cell == null || cell === '') return { value: null, fixed: false };
  const digits = String(typeof cell === 'number' ? Math.round(cell) : cell).replace(/\D/g, '');
  if (!digits) return { value: null, fixed: false };
  if (digits.length === 11) return { value: `0${digits}`, fixed: true };
  return { value: digits, fixed: false };
};

const textOrNull = (cell: Cell): string | null => {
  // Excel shows 0 as "-" in accounting format: an empty text cell, not the text "0".
  if (typeof cell === 'number' && cell === 0) return null;
  const text = nfcText(cell);
  return text && !/^-+$/.test(text) ? text : null;
};

export interface ParsedRosterSheet { rows: RosterImportRow[]; issues: RosterImportIssue[]; sheetName: string }

/** Reads the standard "Data" sheet (two header rows, group rows without a name are skipped). */
export const parseRosterSheet = (sheetName: string, cells: unknown[][]): ParsedRosterSheet => {
  const matrix = cells as Cell[][];
  const headerRow = matrix.findIndex(row => row.some(cell => headerFlat(cell) === 'ho va ten'));
  if (headerRow < 0) throw new Error('Không tìm thấy dòng tiêu đề có cột "Họ và tên". Dùng đúng file mẫu Data nhân sự.');
  const top = matrix[headerRow] || [];
  const sub = matrix[headerRow + 1] || [];
  const width = Math.max(top.length, sub.length);
  const columns: Partial<Record<(typeof HEADERS)[number]['key'], number>> = {};
  for (let col = 0; col < width; col += 1) {
    const flat = headerFlat(top[col]);
    const subFlat = headerFlat(sub[col]);
    const hit = HEADERS.find(header => columns[header.key] == null && header.match(flat, subFlat));
    if (hit) columns[hit.key] = col;
  }
  if (columns.fullName == null || columns.positionText == null || columns.unitText == null) {
    throw new Error('File thiếu cột Họ và tên, Vị trí công việc hoặc Bộ phận.');
  }
  // Seniority amount sits right after the "Thâm niên (tháng)" column.
  const seniorityAmountCol = columns.seniorityMonths != null ? columns.seniorityMonths + 1 : null;
  // Columns HR added in Cấu hình are found by their name in the header.
  const customColumns = customFieldDefs.map(def => {
    let col = -1;
    for (let index = 0; index < width && col < 0; index += 1) {
      if (headerFlat(top[index]) === flatText(def.label) || headerFlat(sub[index]) === flatText(def.label)) col = index;
    }
    return { def, col };
  }).filter(item => item.col >= 0);

  const rows: RosterImportRow[] = [];
  const issues: RosterImportIssue[] = [];
  const cellAt = (row: Cell[], key: keyof typeof columns): Cell => (columns[key] == null ? null : row[columns[key] as number]);

  matrix.slice(headerRow + 2).forEach((row, index) => {
    const rowNumber = headerRow + 3 + index;
    const fullName = nfcText(cellAt(row, 'fullName'));
    if (!fullName) return;
    const issue = (column: string, value: Cell, fix: string) => issues.push({ rowNumber, fullName, column, value: String(value ?? '(trống)'), fix });
    const values: RosterImportRow['values'] = {};

    (['startDate', 'officialDate', 'dateOfBirth', 'idIssuedDate'] as const).forEach(key => {
      const raw = cellAt(row, key);
      const parsed = parseRosterDate(raw);
      if (parsed.bad) issue(fieldLabel(key), raw, 'Ngày không đọc được — để trống, HR bổ sung');
      values[key] = parsed.value;
    });
    if (!values.startDate) issue('Ngày vào', null, 'Chưa có ngày vào — HR bổ sung');

    const phone = parsePhone(cellAt(row, 'phone'));
    if (phone.fixed) issue('SĐT', cellAt(row, 'phone'), 'Thiếu số 0 đầu — đã thêm');
    if (phone.extra) issue('SĐT', cellAt(row, 'phone'), 'Nhiều số — lấy số đầu làm SĐT chính');
    values.phone = phone.value;

    const idNumber = parseIdNumber(cellAt(row, 'idNumber'));
    if (idNumber.fixed) issue('CCCD', cellAt(row, 'idNumber'), 'Excel làm mất số 0 đầu — đã thêm');
    if (idNumber.value && idNumber.value.length !== 12 && idNumber.value.length !== 9) {
      issue('CCCD', cellAt(row, 'idNumber'), 'Không đủ 12 số — bỏ qua ô này, HR kiểm tra');
      values.idNumber = null;
    } else values.idNumber = idNumber.value;

    (['p1', 'pctn', 'phoneAllowance', 'p3', 'vehicleAllowance'] as const).forEach(key => { values[key] = parseMoney(cellAt(row, key)); });
    if (seniorityAmountCol != null) values.seniorityAllowance = parseMoney(row[seniorityAmountCol]);
    // Leave is kept in half days between -30 and 60 (same rule as the Số phép tab).
    const leave = parseMoney(cellAt(row, 'leaveRemaining'));
    if (leave != null && (leave < -30 || leave > 60)) {
      issue('Phép năm', cellAt(row, 'leaveRemaining'), 'Ngoài khoảng −30 đến 60 ngày — bỏ qua ô này');
      values.leaveRemaining = null;
    } else if (leave != null && Math.round(leave * 2) !== leave * 2) {
      values.leaveRemaining = Math.round(leave * 2) / 2;
      issue('Phép năm', cellAt(row, 'leaveRemaining'), `Làm tròn về ${String(values.leaveRemaining).replace('.', ',')} ngày`);
    } else values.leaveRemaining = leave;

    customColumns.forEach(({ def, col }) => {
      const raw = row[col];
      if (def.type === 'date') {
        const parsed = parseRosterDate(raw);
        if (parsed.bad) issue(def.label, raw, 'Ngày không đọc được — bỏ qua ô này');
        values[def.key] = parsed.value;
      } else if (def.type === 'money' || def.type === 'number') {
        values[def.key] = parseMoney(raw);
      } else if (def.options) {
        const text = textOrNull(raw);
        const option = text ? def.options.find(item => flatText(item) === flatText(text)) : null;
        if (text && !option) issue(def.label, raw, `Không có trong danh sách chọn (${def.options.join(', ')}) — bỏ qua ô này`);
        values[def.key] = option || null;
      } else values[def.key] = textOrNull(raw);
    });

    values.idIssuedPlace = textOrNull(cellAt(row, 'idIssuedPlace'));
    values.permanentAddress = textOrNull(cellAt(row, 'permanentAddress'));
    values.institution = textOrNull(cellAt(row, 'institution'));
    values.note = textOrNull(cellAt(row, 'note'));

    rows.push({
      rowNumber,
      fullName,
      unitText: nfcText(cellAt(row, 'unitText')),
      positionText: nfcText(cellAt(row, 'positionText')),
      levelText: nfcText(cellAt(row, 'levelText')).toUpperCase(),
      educationText: textOrNull(cellAt(row, 'educationText')) || '',
      values,
    });
  });
  return { rows, issues, sheetName };
};

/** Picks the sheet named "Data" (or the first sheet that has a "Họ và tên" header). */
export const readRosterWorkbook = async (buffer: ArrayBuffer): Promise<ParsedRosterSheet> => {
  const { loadXlsx } = await import('./loadXlsx');
  const XLSX = await loadXlsx();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const names = [...workbook.SheetNames].sort((a, b) => Number(flatText(b) === 'data') - Number(flatText(a) === 'data'));
  for (const name of names) {
    const matrix = XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[name], { header: 1, defval: null, raw: true });
    if (matrix.some(row => row.some(cell => headerFlat(cell) === 'ho va ten'))) return parseRosterSheet(name, matrix);
  }
  throw new Error('Không thấy sheet nào có cột "Họ và tên". Dùng đúng file mẫu Data nhân sự.');
};

// ---------------------------------------------------------------------------
// Catalog resolution
// ---------------------------------------------------------------------------
const EDUCATION_ALIASES: Record<string, string> = {
  'tien si': 'TS', 'thac si': 'Ths', 'cao hoc': 'Ths', 'dai hoc': 'ĐH', 'cao dang': 'CĐ', 'trung cap': 'TC',
  'so cap': 'SC', '12/12': 'THPT', 'thpt': 'THPT', '9/12': 'THCS', 'thcs': 'THCS', 'ldpt': 'LĐPT',
};

const resolveUnit = (text: string, catalogs: RosterCatalogs): RosterOrgUnit | null => {
  const flat = flatText(text);
  if (!flat) return null;
  return catalogs.orgUnits.find(unit => flatText(unit.name) === flat)
    || catalogs.orgUnits.find(unit => unit.code && flatText(unit.code) === flat)
    || catalogs.orgUnits.find(unit => (unit.aliases || []).some(alias => flatText(alias) === flat)) || null;
};

const resolvePosition = (text: string, catalogs: RosterCatalogs): RosterPosition | null => {
  const flat = flatText(text);
  return flat ? catalogs.positions.find(position => flatText(position.name) === flat) || null : null;
};

const resolveEducation = (text: string, catalogs: RosterCatalogs): string | null => {
  const code = EDUCATION_ALIASES[flatText(text)];
  if (code) return catalogs.education.some(item => item.code === code) ? code : null;
  return catalogs.education.find(item => flatText(item.name) === flatText(text))?.code || null;
};

// ---------------------------------------------------------------------------
// Matching an imported file against the roster
// ---------------------------------------------------------------------------
export type RosterMatchHow = 'id' | 'name' | 'variant' | 'phone' | 'confirm' | 'new';

export interface RosterImportMatch {
  row: RosterImportRow;
  how: RosterMatchHow;
  /** Chosen employee; null for new people or rows still waiting for HR to choose. */
  employeeId: string | null;
  /** Possible employees when the name is written differently or shared by two people. */
  candidates: string[];
}

export interface RosterImportPlan {
  matches: RosterImportMatch[];
  /** Active people on Vioo who are not in the file. */
  notInFile: RosterRow[];
  issues: RosterImportIssue[];
}

const usablePhone = (value: RosterValue) => typeof value === 'string' && value.length >= 10 && !isPlaceholderPhone(value);

export const matchRosterImport = (parsed: ParsedRosterSheet, roster: RosterRow[]): RosterImportPlan => {
  const active = roster.filter(row => row.status === 'Đang làm việc');
  const used = new Set<string>();
  const pick = (rows: RosterRow[]) => rows.filter(row => !used.has(row.employeeId));
  const matches: RosterImportMatch[] = [];
  const pending: RosterImportRow[] = [];

  // Pass 1: keys that cannot be confused (CCCD, exact unique name, phone).
  parsed.rows.forEach(row => {
    const id = row.values.idNumber;
    let hit: RosterRow[] = id ? pick(active.filter(person => person.values.idNumber === id)) : [];
    let how: RosterMatchHow = 'id';
    if (hit.length !== 1 && !/\(\d+\)/.test(row.fullName)) {
      hit = pick(active.filter(person => nameKey(person.fullName) === nameKey(row.fullName)));
      how = 'name';
      if (hit.length !== 1) { hit = pick(active.filter(person => toneKey(person.fullName) === toneKey(row.fullName))); how = 'variant'; }
    }
    if (hit.length !== 1 && usablePhone(row.values.phone)) {
      hit = pick(active.filter(person => person.values.phone === row.values.phone));
      how = 'phone';
    }
    if (hit.length === 1) {
      used.add(hit[0].employeeId);
      matches.push({ row, how, employeeId: hit[0].employeeId, candidates: [] });
    } else pending.push(row);
  });

  // Pass 2: names written differently or shared → HR chooses.
  pending.forEach(row => {
    const candidates = pick(active.filter(person => nameKey(person.fullName) === nameKey(row.fullName) || looksLikeSamePerson(person.fullName, row.fullName)));
    matches.push({ row, how: candidates.length ? 'confirm' : 'new', employeeId: null, candidates: candidates.map(person => person.employeeId) });
  });
  matches.sort((a, b) => a.row.rowNumber - b.row.rowNumber);

  const confirmIds = new Set(matches.flatMap(match => match.candidates));
  const notInFile = active.filter(person => !used.has(person.employeeId) && !confirmIds.has(person.employeeId));
  return { matches, notInFile, issues: parsed.issues };
};

/** Values the row would write, resolved against the catalogs. Unknown catalog text is reported, not written. */
export const resolveImportValues = (row: RosterImportRow, catalogs: RosterCatalogs): {
  values: Partial<Record<RosterFieldKey, RosterValue>>; unknown: Array<{ field: RosterFieldKey; text: string }>;
} => {
  const values: Partial<Record<RosterFieldKey, RosterValue>> = { ...row.values };
  const unknown: Array<{ field: RosterFieldKey; text: string }> = [];
  const unit = resolveUnit(row.unitText, catalogs);
  if (unit) values.orgUnit = unit.id; else if (row.unitText) unknown.push({ field: 'orgUnit', text: row.unitText });
  const position = resolvePosition(row.positionText, catalogs);
  if (position) values.position = position.id; else if (row.positionText) unknown.push({ field: 'position', text: row.positionText });
  if (row.levelText) {
    if (catalogs.levels.some(level => level.code === row.levelText)) values.level = row.levelText;
    else unknown.push({ field: 'level', text: row.levelText });
  }
  if (row.educationText) {
    const education = resolveEducation(row.educationText, catalogs);
    if (education) values.education = education; else unknown.push({ field: 'education', text: row.educationText });
  }
  return { values, unknown };
};

const sameValue = (a: RosterValue, b: RosterValue) => (a ?? null) === (b ?? null)
  || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005);

/** Change items for one matched (or new) person. Empty file cells never erase what Vioo has. */
export const importItemsFor = (
  match: RosterImportMatch, person: RosterRow | null, catalogs: RosterCatalogs, can: Pick<RosterCapabilities, 'viewPay' | 'editPay'>,
  codeTaken: (code: string, employeeId: string | null) => boolean,
): RosterChangeItem[] => {
  const { values } = resolveImportValues(match.row, catalogs);
  const employeeId = person?.employeeId || null;
  const fullName = match.row.fullName.replace(/\s*\(\d+\)\s*$/, '').trim();
  const items: RosterChangeItem[] = [];
  const push = (field: RosterChangeItem['field'], oldValue: RosterValue, newValue: RosterValue) => {
    if (newValue == null || newValue === '' || sameValue(oldValue, newValue)) return;
    items.push({
      employeeId, personKey: employeeId || `new:${match.row.rowNumber}`, employeeCode: person?.employeeCode || null,
      fullName, field, oldValue: oldValue ?? null, newValue,
    });
  };
  if (!person) push('fullName', null, fullName);
  else if (nameKey(person.fullName) !== nameKey(fullName)) push('fullName', person.fullName, fullName);
  rosterFields().forEach(field => {
    if (!field.editable || !(field.key in values)) return;
    if (isPayField(field.key) && !can.editPay) return;
    push(field.key, person?.values[field.key] ?? null, values[field.key] ?? null);
  });
  const code = uniqueCodeFromIdNumber(values.idNumber ?? person?.values.idNumber ?? null, candidate => codeTaken(candidate, employeeId));
  if (code && code !== person?.employeeCode) push('employeeCode', person?.employeeCode ?? null, code);
  return items;
};

export const MATCH_LABEL: Record<RosterMatchHow, string> = {
  id: 'Trùng CCCD',
  name: 'Trùng họ tên',
  variant: 'Trùng họ tên (khác dấu)',
  phone: 'Trùng SĐT',
  confirm: 'Cần chọn người',
  new: 'Người mới',
};

export const BATCH_STATUS_LABEL: Record<RosterBatchStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  returned: 'Trả lại',
  cancelled: 'Đã rút',
};

export const BATCH_SOURCE_LABEL: Record<RosterBatchSource, string> = {
  grid: 'Sửa trên bảng',
  import: 'Nhập Data',
};
