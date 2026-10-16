// Cấu hình Hồ sơ nhân sự: who approves Bảng nhân sự change requests, and extra columns HR adds
// on top of the standard "Data nhân sự" columns. Read and saved through RPCs; no network calls here.
import type { RosterGroupKey } from './hrmRoster';

export type CustomFieldType = 'text' | 'number' | 'money' | 'date' | 'select' | 'boolean';

export const CUSTOM_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: 'Chữ',
  number: 'Số',
  money: 'Số tiền',
  date: 'Ngày',
  select: 'Danh sách chọn',
  boolean: 'Có / Không',
};

export interface RosterCustomField {
  id: string;
  /** "custom:<slug>": the key used in the table, change requests and the Excel header match. */
  key: string;
  label: string;
  group: RosterGroupKey;
  type: CustomFieldType;
  /** Choices for "Danh sách chọn". */
  options: string[];
  required: boolean;
  /** Only HR Manage sees and changes it (always true for the pay group). */
  payOnly: boolean;
  hint: string | null;
  sortOrder: number;
  isActive: boolean;
  /** People who already have a value; a column with values is hidden, not deleted. */
  filledCount: number;
}

export type ApprovalGroup = 'general' | 'pay';

/** Step 1: any one person in the list approves. Step 2 (optional): then any one person in that list. */
export interface ApprovalChain { step1: string[]; step2: string[] }

export interface RosterApprovalSettings { general: ApprovalChain; pay: ApprovalChain }

export type ApproverRole = 'HR_MANAGE' | 'HR' | 'OTHER';

export interface ApproverCandidate {
  userId: string;
  name: string;
  employeeCode: string | null;
  positionName: string | null;
  role: ApproverRole;
}

export interface RosterConfig {
  approvals: RosterApprovalSettings;
  /** Used when a step-1 list is empty: everyone with HR Manage rights. */
  defaultApproverIds: string[];
  customFields: RosterCustomField[];
  candidates: ApproverCandidate[];
  updatedByName: string | null;
  updatedAt: string | null;
}

export const APPROVAL_GROUPS: Array<{ key: ApprovalGroup; label: string; hint: string }> = [
  { key: 'general', label: 'Thông tin chung & vị trí', hint: 'Bộ phận, chức danh, level, hợp đồng, liên hệ, giấy tờ, cột thêm' },
  { key: 'pay', label: 'Lương & phụ cấp', hint: 'P1, PCTN, PC điện thoại, P3, PC giữ xe, thâm niên, ghi chú lương' },
];

export const ROLE_LABEL: Record<ApproverRole, string> = { HR_MANAGE: 'HR Manage', HR: 'HR', OTHER: 'Không phải HR' };

export interface CustomFieldDraft {
  label: string;
  group: RosterGroupKey;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  payOnly: boolean;
  hint: string;
}

/** Problems that block saving a column, in words HR understands. */
export const customFieldProblems = (draft: CustomFieldDraft, others: Array<{ label: string }>, standardLabels: string[]): string[] => {
  const problems: string[] = [];
  const label = draft.label.trim();
  const same = (a: string, b: string) => a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi');
  if (label.length < 2) problems.push('Nhập tên cột (ít nhất 2 ký tự).');
  if (label.length > 60) problems.push('Tên cột tối đa 60 ký tự.');
  if (others.some(item => same(item.label, label)) || standardLabels.some(item => same(item, label))) problems.push('Đã có cột cùng tên.');
  if (draft.type === 'select') {
    const options = draft.options.map(option => option.trim()).filter(Boolean);
    if (options.length < 2) problems.push('Danh sách chọn cần ít nhất 2 lựa chọn.');
    if (new Set(options.map(option => option.toLocaleLowerCase('vi'))).size !== options.length) problems.push('Có lựa chọn bị trùng.');
  }
  return problems;
};

/** Effective step-1 approvers of a group: the configured list, or HR Manage when it is empty. */
export const effectiveStep1 = (config: Pick<RosterConfig, 'approvals' | 'defaultApproverIds'>, group: ApprovalGroup): string[] =>
  config.approvals[group].step1.length ? config.approvals[group].step1 : config.defaultApproverIds;
