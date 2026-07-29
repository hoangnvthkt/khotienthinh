import { describe, expect, it } from 'vitest';
import { createApproverBlock, createEmptyRequestTemplateDraft, requestTemplateDraftReducer, validateRequestTemplateForPublish } from '../requestTemplateEditorModel';

describe('request approval builder model', () => {
  it('creates valid defaults for all four approver sources', () => {
    expect(createApproverBlock('FIXED_SINGLE', 1)).toMatchObject({ fixedUserIds: [], minimumDynamicApprovers: null });
    expect(createApproverBlock('FIXED_MULTI', 2)).toMatchObject({ fixedUserIds: [], minimumDynamicApprovers: null });
    expect(createApproverBlock('DIRECT_MANAGER', 3)).toMatchObject({ fixedUserIds: [], minimumDynamicApprovers: null });
    expect(createApproverBlock('DYNAMIC_CREATOR_SELECT', 4)).toMatchObject({ fixedUserIds: [], minimumDynamicApprovers: 1 });
  });

  it('rejects an undersized fixed-multi block and de-duplicates its users', () => {
    const block = { ...createApproverBlock('FIXED_MULTI', 1), fixedUserIds: ['director', 'director'] };
    const next = requestTemplateDraftReducer(createEmptyRequestTemplateDraft(), { type: 'UPSERT_APPROVER_BLOCK', block });

    expect(next.approverBlocks[0].fixedUserIds).toEqual(['director']);
    expect(validateRequestTemplateForPublish({
      ...next, name: 'Mua hàng', fields: [{ key: 'reason', label: 'Lý do', fieldType: 'text', required: true, options: [], sortOrder: 1 }], scopes: [{ kind: 'COMPANY', targetId: null }],
    })).toContainEqual(expect.objectContaining({ code: 'FIXED_MULTI_REQUIRED' }));
  });
});
