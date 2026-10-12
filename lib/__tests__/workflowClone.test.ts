import { describe, expect, it } from 'vitest';
import { buildWorkflowCloneDraft, canCloneWorkflowInstance } from '../workflowClone';
import type { WorkflowTemplate } from '../../types';

const template = (patch: Partial<WorkflowTemplate> = {}) => ({
  id: 't1', name: 'Sơn Miền Bắc công trường', isActive: true, customFields: [], ...patch,
}) as unknown as WorkflowTemplate;

describe('buildWorkflowCloneDraft', () => {
  it('copies what the creator typed, adds (copy), drops step data and module links', () => {
    const table = [['Chuyến xe fooc', '1', '', '0', '1', '1']];
    const draft = buildWorkflowCloneDraft({
      templateId: 't1',
      title: 'Đề xuất 1 chuyến xe fooc',
      formData: {
        note: 'Ghi chú cũ',
        'bảng_đề_xuất': table,
        'step_05f2_files': [{ name: 'a.pdf' }],
        'step_05f2__note': 'ý kiến bước 2',
        requestCode: 'YC-1',
        subjectType: 'project',
        subjectId: 'p1',
        _files: [],
      },
    });
    expect(draft).toEqual({
      templateId: 't1',
      title: 'Đề xuất 1 chuyến xe fooc (copy)',
      note: 'Ghi chú cũ',
      formData: { 'bảng_đề_xuất': table },
    });
    expect(draft.formData['bảng_đề_xuất']).not.toBe(table);
  });

  it('does not stack the suffix when cloning a copy', () => {
    expect(buildWorkflowCloneDraft({ templateId: 't1', title: 'A (copy)', formData: {} }).title).toBe('A (copy)');
  });
});

describe('canCloneWorkflowInstance', () => {
  it('only for active Quy trình templates', () => {
    expect(canCloneWorkflowInstance(template())).toBe(true);
    expect(canCloneWorkflowInstance(template({ isActive: false }))).toBe(false);
    expect(canCloneWorkflowInstance(template({ name: 'Quy trình cấp vật tư công trường' }))).toBe(false);
    expect(canCloneWorkflowInstance(template({ customFields: [{ _requestTemplateId: 'r1' } as never] }))).toBe(false);
    expect(canCloneWorkflowInstance(null)).toBe(false);
  });
});
