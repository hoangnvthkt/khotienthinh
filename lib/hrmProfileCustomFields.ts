// Hồ sơ nhân sự → "Thông tin thêm": the extra columns HR adds in Cấu hình of Bảng nhân sự, read on one
// person's profile. Read only here; a value changes through an approved request in Bảng nhân sự.
import { ROSTER_GROUPS, type RosterGroupKey } from './hrmRoster';
import type { CustomFieldType } from './hrmRosterConfig';

export type ProfileCustomValue = string | number | null;

export interface ProfileCustomField {
  id: string;
  key: string;
  label: string;
  group: RosterGroupKey;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  /** Only HR Manage sees it (pay group or marked "chỉ HR Manage"). */
  payOnly: boolean;
  hint: string | null;
  value: ProfileCustomValue;
  /** HR only. */
  updatedAt: string | null;
  /** HR only: a change waiting for approval. */
  pending: { batchId: string; batchCode: string; value: ProfileCustomValue } | null;
}

export interface ProfileCustomFields {
  employeeId: string;
  accessLevel: 'SELF' | 'HR' | 'HR_MANAGE';
  can: { edit: boolean; configure: boolean; viewPay: boolean };
  /** HR without pay rights: columns that exist but are not shown. */
  hiddenPayCount: number;
  fields: ProfileCustomField[];
}

/** Profile levels that may read the extra columns; others (direct manager, directory) do not ask. */
export const canReadProfileCustomFields = (accessLevel: string | null | undefined): boolean =>
  accessLevel === 'SELF' || accessLevel === 'HR' || accessLevel === 'HR_MANAGE';

export const isEmptyCustomValue = (value: ProfileCustomValue | undefined): boolean =>
  value == null || (typeof value === 'string' && value.trim() === '');

/** Columns grouped like the Bảng nhân sự column groups, in that order; empty groups are left out. */
export const groupProfileCustomFields = (fields: ProfileCustomField[]) =>
  ROSTER_GROUPS
    .map(group => ({ ...group, fields: fields.filter(field => field.group === group.key) }))
    .filter(group => group.fields.length > 0);

/** Text shown for a value; numbers keep Vietnamese separators, money ends in "đ", dates are dd/mm/yyyy. */
export const formatCustomValue = (type: CustomFieldType, value: ProfileCustomValue | undefined): string => {
  if (isEmptyCustomValue(value)) return '';
  if (type === 'money' || type === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return String(value);
    const text = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: type === 'money' ? 0 : 4 }).format(num);
    return type === 'money' ? `${text} đ` : text;
  }
  if (type === 'date') {
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).split('-').reverse().join('/') : text;
  }
  return String(value);
};

/** Counts for the header line: how many columns, how many required ones are empty, how many wait for approval. */
export const summarizeProfileCustomFields = (fields: ProfileCustomField[]) => ({
  total: fields.length,
  missing: fields.filter(field => field.required && isEmptyCustomValue(field.value)).length,
  pending: fields.filter(field => field.pending).length,
});

/** Bảng nhân sự with this person's change form open; a request opened in the Phiếu thay đổi tab. */
export const rosterPersonLink = (employeeId: string) =>
  `/hrm/employees?view=roster&person=${encodeURIComponent(employeeId)}`;
export const rosterBatchLink = (batchId: string) =>
  `/hrm/employees?view=roster&tab=batches&batch=${encodeURIComponent(batchId)}`;
