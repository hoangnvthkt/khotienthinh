import { describe, expect, it } from 'vitest';
import { normalizeDynamicApprovers, validateRequestSubmission } from '../requestCreateModel';

const dynamicBlocks = [
  { key: 'manager-review', name: 'Quản lý', source: 'DYNAMIC_CREATOR_SELECT' as const, minimumDynamicApprovers: 2 },
  { key: 'director-review', name: 'Giám đốc', source: 'FIXED_SINGLE' as const, minimumDynamicApprovers: null },
];

describe('request create model', () => {
  it('deduplicates dynamic approvers and drops values for non-dynamic blocks', () => {
    expect(normalizeDynamicApprovers(
      { 'manager-review': ['user-1', 'user-1', ' user-2 '], 'director-review': ['user-3'] },
      dynamicBlocks,
    )).toEqual({ 'manager-review': ['user-1', 'user-2'] });
  });

  it('requires the configured minimum amount of dynamic approvers', () => {
    expect(validateRequestSubmission({
      title: '  ',
      formData: { reason: '' },
      fields: [{ key: 'reason', label: 'Lý do', required: true }],
      dynamicApproversByBlock: { 'manager-review': ['user-1'] },
      approvalBlocks: dynamicBlocks,
    })).toEqual([
      'Tiêu đề đề xuất là bắt buộc.',
      'Lý do là bắt buộc.',
      'Khối “Quản lý” cần chọn tối thiểu 2 người duyệt.',
    ]);
  });
});
