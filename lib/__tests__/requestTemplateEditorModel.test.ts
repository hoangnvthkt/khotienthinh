import { describe, expect, it } from 'vitest';
import * as requestTemplateEditorModel from '../requestTemplateEditorModel';
import {
  createEmptyRequestTemplateDraft,
  requestTemplateDraftReducer,
  toSaveDraftInput,
  validateRequestTemplateForSave,
  validateRequestTemplateForPublish,
} from '../requestTemplateEditorModel';

type PersistenceModelApi = {
  buildRequestTemplateSaveInput?: (
    draft: ReturnType<typeof createEmptyRequestTemplateDraft>,
    updatedAt: string | null,
  ) => { expectedUpdatedAt?: string };
  shouldScheduleRequestTemplateAutosave?: (input: {
    hasTemplateId: boolean;
    isDirty: boolean;
    isBlocked: boolean;
    isStructurallySaveable: boolean;
    hasValidationIssues: boolean;
  }) => boolean;
  changeApproverBlockSource?: (
    block: ReturnType<typeof requestTemplateEditorModel.createApproverBlock>,
    source: 'FIXED_SINGLE' | 'FIXED_MULTI' | 'DIRECT_MANAGER' | 'DYNAMIC_CREATOR_SELECT',
  ) => ReturnType<typeof requestTemplateEditorModel.createApproverBlock>;
};

const persistenceModel = requestTemplateEditorModel as typeof requestTemplateEditorModel & PersistenceModelApi;

describe('request template editor model', () => {
  it('normalizes stale fields when changing the approver source', () => {
    expect(persistenceModel.changeApproverBlockSource).toBeTypeOf('function');
    const block = {
      ...requestTemplateEditorModel.createApproverBlock('FIXED_MULTI', 1),
      fixedUserIds: ['user-1', 'user-2'],
    };

    expect(persistenceModel.changeApproverBlockSource!(block, 'DIRECT_MANAGER')).toMatchObject({
      source: 'DIRECT_MANAGER',
      fixedUserIds: [],
      minimumDynamicApprovers: null,
    });
    expect(persistenceModel.changeApproverBlockSource!(block, 'DYNAMIC_CREATOR_SELECT')).toMatchObject({
      source: 'DYNAMIC_CREATOR_SELECT',
      fixedUserIds: [],
      minimumDynamicApprovers: 1,
    });
  });

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

  it('includes the loaded concurrency token when saving an existing draft', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      id: 'template-1',
    };
    const updatedAt = '2026-07-30T07:50:51.141207Z';

    expect(persistenceModel.buildRequestTemplateSaveInput).toBeTypeOf('function');
    expect(persistenceModel.buildRequestTemplateSaveInput!(draft, updatedAt))
      .toMatchObject({ expectedUpdatedAt: updatedAt });
  });

  it('refuses to save an existing draft without its concurrency token', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      id: 'template-1',
    };

    expect(persistenceModel.buildRequestTemplateSaveInput).toBeTypeOf('function');
    expect(() => persistenceModel.buildRequestTemplateSaveInput!(draft, null))
      .toThrow('REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED');
  });

  it('does not schedule autosave after an automatic save failure blocks it', () => {
    expect(persistenceModel.shouldScheduleRequestTemplateAutosave).toBeTypeOf('function');
    expect(persistenceModel.shouldScheduleRequestTemplateAutosave!({
      hasTemplateId: true,
      isDirty: true,
      isBlocked: true,
      isStructurallySaveable: true,
      hasValidationIssues: false,
    })).toBe(false);
  });
});
