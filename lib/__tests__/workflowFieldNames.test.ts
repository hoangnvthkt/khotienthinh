import { describe, expect, it } from 'vitest';
import { buildWorkflowFieldName, findDuplicateWorkflowFieldLabels } from '../workflowFieldNames';

describe('workflow field names', () => {
  it('derives the name from the label', () => {
    expect(buildWorkflowFieldName('Tệp đính kèm', [])).toBe('tệp_đính_kèm');
  });

  it('never reuses a name already taken by another field', () => {
    const existing = [{ name: 'thông_tin_chi_tiết' }, { name: 'thông_tin_chi_tiết_2' }];
    expect(buildWorkflowFieldName('Thông tin chi tiết', existing)).toBe('thông_tin_chi_tiết_3');
  });

  it('reports fields that share a name', () => {
    expect(findDuplicateWorkflowFieldLabels([
      { name: 'a', label: 'Thông tin chi tiết' },
      { name: 'a', label: 'Tệp đính kèm' },
      { name: 'b', label: 'Ghi chú' },
    ])).toEqual(['Thông tin chi tiết', 'Tệp đính kèm']);
  });
});
