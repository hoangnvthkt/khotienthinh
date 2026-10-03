import { describe, expect, it } from 'vitest';
import type { LeaveTypeOption } from '../leaveService';
import {
  approvalExample, approvalSteps, draftOf, emptyDraft, leaveDraftProblems, normalizeDraft, sameDraft, subtypeProblem, subtypeSummary,
} from '../leavePolicy';

const personal: LeaveTypeOption = {
  code: 'personal', name: 'Việc riêng có lương', description: null, paidBy: 'company', deductsAnnual: false, unit: 'day',
  secondStepAfterDays: null, hrStep: false, requiresOfficial: false,
  subtypes: [{ name: 'Kết hôn', maxDays: 3 }, { name: 'Con đẻ, con nuôi kết hôn', maxDays: 1 }],
  requiresAttachment: false, attachmentHint: null, isSystem: false, isActive: true,
};

describe('leave policy setup', () => {
  it('reads the approval flow in plain words', () => {
    expect(approvalSteps({ unit: 'day', secondStepAfterDays: 3, hrStep: false }, 'Tổng giám đốc'))
      .toEqual(['Quản lý trực tiếp', 'Tổng giám đốc khi > 3 ngày']);
    expect(approvalSteps({ unit: 'minute', secondStepAfterDays: 3, hrStep: true }, 'Tổng giám đốc'))
      .toEqual(['Quản lý trực tiếp', 'Phòng HCNS']);
  });

  it('explains who approves short and long requests', () => {
    expect(approvalExample({ secondStepAfterDays: 3, hrStep: false }, 'day', 'Tổng giám đốc'))
      .toBe('Đơn 3 ngày trở xuống: Quản lý trực tiếp. Đơn 4 ngày: Quản lý trực tiếp → Tổng giám đốc.');
    expect(approvalExample({ secondStepAfterDays: 0, hrStep: true }, 'day', 'TGĐ')).toBe('Mọi đơn: Quản lý trực tiếp → TGĐ → Phòng HCNS.');
    expect(approvalExample({ secondStepAfterDays: null, hrStep: false }, 'day', 'TGĐ')).toBe('Mọi đơn: Quản lý trực tiếp.');
  });

  it('summarises reasons by their longest limit', () => {
    expect(subtypeSummary(personal.subtypes)).toBe('2 lý do · tối đa 3 ngày');
    expect(subtypeSummary([{ name: 'Đi muộn', maxDays: null }])).toBe('1 lý do');
    expect(subtypeSummary([])).toBe('');
  });

  it('blocks names already taken, duplicate reasons and papers without a hint', () => {
    const draft = { ...draftOf(personal), name: ' việc riêng KHÔNG lương ', requiresAttachment: true,
      subtypes: [{ name: 'Kết hôn', maxDays: 3 }, { name: 'kết hôn', maxDays: 0 }] };
    const problems = leaveDraftProblems(draft, 'day', ['Việc riêng không lương']);
    expect(problems).toContain('Đã có loại đơn tên "việc riêng KHÔNG lương".');
    expect(problems).toContain('Lý do "kết hôn" bị trùng.');
    expect(problems).toContain('Số ngày tối đa của "kết hôn" phải lớn hơn 0, bước 0,5.');
    expect(problems).toContain('Ghi rõ giấy tờ cần nộp để nhân viên biết chụp gì.');
    expect(leaveDraftProblems(emptyDraft(), 'day', [])).toEqual(['Nhập tên loại đơn.']);
  });

  it('treats blank reasons and spaces as no change', () => {
    const draft = { ...draftOf(personal), name: ' Việc riêng có lương ', subtypes: [...personal.subtypes, { name: '  ', maxDays: null }] };
    expect(sameDraft(draft, draftOf(personal))).toBe(true);
    expect(normalizeDraft(draft).subtypes).toHaveLength(2);
  });

  it('checks the chosen reason against its day limit', () => {
    expect(subtypeProblem(personal, '', 1)).toBe('Chọn lý do nghỉ.');
    expect(subtypeProblem(personal, 'Kết hôn', 3)).toBeNull();
    expect(subtypeProblem(personal, 'Con đẻ, con nuôi kết hôn', 2)).toBe('"Con đẻ, con nuôi kết hôn" được nghỉ tối đa 1 ngày, đơn này 2 ngày.');
    expect(subtypeProblem({ ...personal, subtypes: [] }, '', 9)).toBeNull();
  });
});
