import { describe, expect, it } from 'vitest';
import { formatProjectV2Quantity, getProjectV2SourceLabel,
  getProjectV2StatusLabel, presentProjectV2Issue } from '../projectV2/presentation';

describe('Project V2 presentation', () => {
  it('distinguishes unknown and incomplete quantities from zero', () => {
    expect(formatProjectV2Quantity({ state: 'unknown' }, 'kg')).toBe('Chưa xác định');
    expect(formatProjectV2Quantity({ state: 'incomplete', reason: 'Thiếu định mức' }, 'kg')).toBe('Thiếu định mức');
    expect(formatProjectV2Quantity({ state: 'known', value: '0.000000' }, 'kg')).toBe('0 kg');
    expect(formatProjectV2Quantity({ state: 'known', value: '99999999999999.000001' }, 'kg'))
      .toBe('99.999.999.999.999,000001 kg');
  });

  it('uses business labels for plan states and procurement sources', () => {
    expect(getProjectV2StatusLabel('pending_approval')).toBe('Chờ duyệt');
    expect(getProjectV2SourceLabel('material_plan')).toBe('Kế hoạch vật tư');
    expect(getProjectV2SourceLabel('project_material_request')).toBe('Đề xuất vật tư');
  });

  it('explains a blocking issue without exposing an internal code', () => {
    expect(presentProjectV2Issue({ field: 'lines.line-1.normFactor', code: 'missing_norm', blocking: true }))
      .toBe('Thiếu định mức vật tư. Chọn định mức hợp lệ trước khi gửi duyệt.');
  });
});
