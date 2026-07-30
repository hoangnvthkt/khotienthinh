import { describe, expect, it } from 'vitest';
import { createEmptyRequestTemplateDraft, createFieldKey, validateRequestTemplateForPublish } from '../requestTemplateEditorModel';

describe('request form builder model', () => {
  it('normalizes a field key without changing an existing stable key', () => {
    expect(createFieldKey('Số tiền đề xuất', [])).toBe('so_tien_de_xuat');
    expect(createFieldKey('Số tiền đề xuất', ['so_tien_de_xuat'])).toBe('so_tien_de_xuat_2');
  });

  it('requires a non-empty option for select fields', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      name: 'Đề xuất mua hàng',
      scopes: [{ kind: 'COMPANY' as const, targetId: null }],
      approverBlocks: [{ key: 'manager', name: 'Quản lý', source: 'DIRECT_MANAGER' as const, fixedUserIds: [], minimumDynamicApprovers: null, slaHours: null, sortOrder: 1 }],
      fields: [{ key: 'priority', label: 'Mức ưu tiên', fieldType: 'select' as const, required: true, options: [''], sortOrder: 1 }],
    };

    expect(validateRequestTemplateForPublish(draft)).toContainEqual(expect.objectContaining({
      section: 'FORM', code: 'SELECT_OPTION_REQUIRED',
    }));
  });

  it('requires at least one column header for table fields', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      name: 'Đề xuất mua vật tư',
      scopes: [{ kind: 'COMPANY' as const, targetId: null }],
      approverBlocks: [{ key: 'manager', name: 'Quản lý', source: 'DIRECT_MANAGER' as const, fixedUserIds: [], minimumDynamicApprovers: null, slaHours: null, sortOrder: 1 }],
      fields: [{ key: 'items', label: 'Danh sách vật tư', fieldType: 'table' as const, required: true, options: [''], sortOrder: 1 }],
    };

    expect(validateRequestTemplateForPublish(draft)).toContainEqual(expect.objectContaining({
      section: 'FORM', code: 'TABLE_COLUMN_REQUIRED',
    }));
  });
});
