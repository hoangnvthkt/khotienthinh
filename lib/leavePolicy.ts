// Leave policy setup: which parts of a leave type HR may change, and how its approval
// chain reads to people. The server enforces the same locks (save_hrm_leave_type).
import type { LeaveSubtype, LeaveTypeDraft, LeaveTypeOption } from './leaveService';

/** Pay source of these types drives the leave balance and the timesheet, so it stays fixed. */
export const LEAVE_PAID_BY_LOCKED = new Set(['annual', 'late_early', 'overtime', 'business_trip']);
/** The timesheet reads these reason names ("Về sớm", "Ra ngoài trong giờ"), so the list stays fixed. */
export const LEAVE_SUBTYPES_LOCKED = new Set(['late_early', 'overtime']);

export const PAID_BY_LABEL: Record<LeaveTypeOption['paidBy'], string> = {
  company: 'Công ty trả lương',
  social_insurance: 'Quỹ BHXH chi trả',
  none: 'Không hưởng lương',
};

export const draftOf = (type: LeaveTypeOption): LeaveTypeDraft => ({
  name: type.name,
  description: type.description || '',
  paidBy: type.paidBy,
  secondStepAfterDays: type.secondStepAfterDays,
  hrStep: type.hrStep,
  requiresOfficial: type.requiresOfficial,
  subtypes: type.subtypes.map(item => ({ ...item })),
  requiresAttachment: type.requiresAttachment,
  attachmentHint: type.attachmentHint || '',
});

export const emptyDraft = (): LeaveTypeDraft => ({
  name: '', description: '', paidBy: 'none', secondStepAfterDays: null, hrStep: false,
  requiresOfficial: false, subtypes: [], requiresAttachment: false, attachmentHint: '',
});

const cleanSubtypes = (subtypes: LeaveSubtype[]) => subtypes
  .map(item => ({ name: item.name.trim(), maxDays: item.maxDays }))
  .filter(item => item.name);

/** Problems that stop saving, in the user's words. */
export const leaveDraftProblems = (draft: LeaveTypeDraft, unit: 'day' | 'minute', otherNames: string[]): string[] => {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length < 2) problems.push('Nhập tên loại đơn.');
  else if (otherNames.some(other => other.trim().toLowerCase() === name.toLowerCase())) problems.push(`Đã có loại đơn tên "${name}".`);
  if (unit === 'day' && draft.secondStepAfterDays !== null && !(draft.secondStepAfterDays >= 0 && draft.secondStepAfterDays * 2 === Math.floor(draft.secondStepAfterDays * 2))) {
    problems.push('Ngưỡng thêm bước duyệt là số ngày, bước 0,5.');
  }
  const subtypes = cleanSubtypes(draft.subtypes);
  const seen = new Set<string>();
  for (const item of subtypes) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) problems.push(`Lý do "${item.name}" bị trùng.`);
    seen.add(key);
    if (item.maxDays !== null && !(item.maxDays > 0 && item.maxDays * 2 === Math.floor(item.maxDays * 2))) {
      problems.push(`Số ngày tối đa của "${item.name}" phải lớn hơn 0, bước 0,5.`);
    }
  }
  if (draft.requiresAttachment && draft.attachmentHint.trim().length < 3) problems.push('Ghi rõ giấy tờ cần nộp để nhân viên biết chụp gì.');
  return problems;
};

/** The draft as the server expects it: trimmed, empty reasons dropped. */
export const normalizeDraft = (draft: LeaveTypeDraft): LeaveTypeDraft => ({
  ...draft,
  name: draft.name.trim(),
  description: draft.description.trim(),
  attachmentHint: draft.attachmentHint.trim(),
  subtypes: cleanSubtypes(draft.subtypes),
});

export const sameDraft = (a: LeaveTypeDraft, b: LeaveTypeDraft) =>
  JSON.stringify(normalizeDraft(a)) === JSON.stringify(normalizeDraft(b));

const days = (value: number) => value.toLocaleString('vi-VN');

/** One-line approval flow, e.g. "Quản lý → Tổng giám đốc khi > 3 ngày → Phòng HCNS". */
export const approvalSteps = (
  type: Pick<LeaveTypeOption, 'unit' | 'secondStepAfterDays' | 'hrStep'>,
  secondStepLabel: string,
): string[] => {
  const steps = ['Quản lý trực tiếp'];
  if (type.unit === 'day' && type.secondStepAfterDays !== null) {
    steps.push(`${secondStepLabel} khi > ${days(type.secondStepAfterDays)} ngày`);
  }
  if (type.hrStep) steps.push('Phòng HCNS');
  return steps;
};

/** Short limits line for the type list, e.g. "3 lý do · tối đa 3 ngày". */
export const subtypeSummary = (subtypes: LeaveSubtype[]): string => {
  if (!subtypes.length) return '';
  const limits = subtypes.map(item => item.maxDays).filter((value): value is number => value !== null);
  if (!limits.length) return `${subtypes.length} lý do`;
  const max = Math.max(...limits);
  return `${subtypes.length} lý do · tối đa ${days(max)} ngày`;
};

/** Plain example of who approves short and long requests, shown under the approval switches. */
export const approvalExample = (
  draft: Pick<LeaveTypeDraft, 'secondStepAfterDays' | 'hrStep'>,
  unit: 'day' | 'minute',
  secondStepLabel: string,
): string => {
  const tail = draft.hrStep ? ' → Phòng HCNS' : '';
  if (unit === 'minute') return `Mỗi đơn: Quản lý trực tiếp${tail}.`;
  if (draft.secondStepAfterDays === null) return `Mọi đơn: Quản lý trực tiếp${tail}.`;
  const limit = draft.secondStepAfterDays;
  const longer = Math.floor(limit) + 1;
  return limit === 0
    ? `Mọi đơn: Quản lý trực tiếp → ${secondStepLabel}${tail}.`
    : `Đơn ${days(limit)} ngày trở xuống: Quản lý trực tiếp${tail}. Đơn ${days(longer)} ngày: Quản lý trực tiếp → ${secondStepLabel}${tail}.`;
};

/** Reason check before sending: the chosen reason must exist and fit its day limit. */
export const subtypeProblem = (type: Pick<LeaveTypeOption, 'subtypes' | 'unit'>, subtype: string, requestDays: number): string | null => {
  if (!type.subtypes.length) return null;
  const match = type.subtypes.find(item => item.name === subtype);
  if (!match) return 'Chọn lý do nghỉ.';
  if (type.unit === 'day' && match.maxDays !== null && requestDays > match.maxDays) {
    return `"${match.name}" được nghỉ tối đa ${days(match.maxDays)} ngày, đơn này ${days(requestDays)} ngày.`;
  }
  return null;
};
