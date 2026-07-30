import { describe, expect, it } from 'vitest';
import {
  createEmptyRequestTemplateDraft,
  requestTemplateDraftReducer,
  toSaveDraftInput,
  validateRequestTemplateForSave,
  validateRequestTemplateForPublish,
} from '../requestTemplateEditorModel';

describe('request template editor model', () => {
  it('reorders approver blocks with consecutive sort orders', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      approverBlocks: [
        {
          key: 'manager', name: 'Quản lý', source: 'DIRECT_MANAGER' as const,
          fixedUserIds: [], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 1,
        },
        {
          key: 'director', name: 'Giám đốc', source: 'FIXED_SINGLE' as const,
          fixedUserIds: ['director-id'], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 2,
        },
      ],
    };

    const next = requestTemplateDraftReducer(draft, {
      type: 'REORDER_APPROVER_BLOCKS',
      orderedKeys: ['director', 'manager'],
    });

    expect(next.approverBlocks.map(block => [block.key, block.sortOrder]))
      .toEqual([['director', 1], ['manager', 2]]);
  });

  it('blocks publish when a dynamic approver block has no minimum', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      name: 'Đề xuất mua hàng',
      fields: [{
        key: 'reason', label: 'Lý do', fieldType: 'textarea' as const,
        required: true, options: [], sortOrder: 1,
      }],
      scopes: [{ kind: 'COMPANY' as const, targetId: null }],
      approverBlocks: [{
        key: 'dynamic', name: 'Người duyệt được chọn khi gửi',
        source: 'DYNAMIC_CREATOR_SELECT' as const,
        fixedUserIds: [], minimumDynamicApprovers: 0, slaHours: null, sortOrder: 1,
      }],
    };

    expect(validateRequestTemplateForPublish(draft)).toContainEqual({
      section: 'APPROVAL',
      code: 'DYNAMIC_MINIMUM_REQUIRED',
      message: 'Khối người duyệt linh động cần số người duyệt tối thiểu từ 1.',
    });
  });

  it('identifies a fixed approval block without an approver before saving a draft', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      name: 'Đề xuất mua thiết bị',
      approverBlocks: [{
        key: 'manager', name: 'Quản lý trực tiếp', source: 'FIXED_SINGLE' as const,
        fixedUserIds: [], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 1,
      }],
    };

    expect(validateRequestTemplateForSave(draft)).toContainEqual({
      section: 'APPROVAL',
      code: 'FIXED_APPROVER_REQUIRED',
      message: 'Khối “Quản lý trực tiếp” cần chọn ít nhất một người duyệt.',
    });
  });

  it('serializes the editor draft into the runtime save contract', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      id: 'template-1',
      name: '  Đề xuất cấp thiết bị  ',
      description: '  Cấp máy tính mới  ',
      fields: [{
        key: 'device_type', label: ' Loại thiết bị ', fieldType: 'select' as const,
        required: true, options: ['Laptop'], sortOrder: 1,
      }],
      scopes: [
        { kind: 'COMPANY' as const, targetId: null },
        { kind: 'ORG_UNIT' as const, targetId: 'unit-1' },
        { kind: 'PERMISSION_GROUP' as const, targetId: 'requester' },
        { kind: 'USER' as const, targetId: 'user-1' },
      ],
      approverBlocks: [{
        key: 'manager', name: 'Quản lý', source: 'DIRECT_MANAGER' as const,
        fixedUserIds: [], minimumDynamicApprovers: null, slaHours: 24, sortOrder: 1,
      }],
      notificationEvents: ['SUBMITTED', 'APPROVED'] as ('SUBMITTED' | 'APPROVED')[],
    };

    expect(toSaveDraftInput(draft, '2026-07-29T01:00:00.000Z')).toMatchObject({
      templateId: 'template-1',
      expectedUpdatedAt: '2026-07-29T01:00:00.000Z',
      name: 'Đề xuất cấp thiết bị',
      description: 'Cấp máy tính mới',
      usageScope: {
        companyWide: true,
        orgUnitIds: ['unit-1'],
        permissionCodes: ['requester'],
        userIds: ['user-1'],
      },
      notificationConfig: { SUBMITTED: true, APPROVED: true },
      formSchema: [{ key: 'device_type', label: 'Loại thiết bị', options: ['Laptop'] }],
    });
  });
});
