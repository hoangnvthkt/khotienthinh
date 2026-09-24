import { describe, expect, it } from 'vitest';
import { formatProjectV2Destination, formatProjectV2Quantity, getProjectV2SourceLabel,
  getProjectV2StatusLabel, presentProjectV2Error, presentProjectV2Issue } from '../projectV2/presentation';

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

  it('keeps internal command codes out of planning forms', () => {
    expect(presentProjectV2Error(new Error('PROJECT_V2_MATERIAL_NORM_INCOMPLETE'), 'Không lưu được kế hoạch.'))
      .toBe('Thiếu định mức vật tư. Kiểm tra lại nguồn trước khi lưu.');
    expect(presentProjectV2Error({ code: '42501', message: 'PROJECT_V2_PLAN_SCOPE_DENIED' }, 'Không lưu được kế hoạch.'))
      .toBe('Bạn không có quyền thực hiện thao tác này.');
    expect(presentProjectV2Error(new Error('PROJECT_V2_UNRECOGNIZED_INTERNAL_CODE'), 'Không lưu được kế hoạch.'))
      .toBe('Không lưu được kế hoạch.');
    expect(presentProjectV2Error(new Error('Tổ đội không thuộc dự án.'), 'Không lưu được kế hoạch.'))
      .toBe('Tổ đội không thuộc dự án.');
  });

  it('does not render a destination UUID as a receiving location', () => {
    expect(formatProjectV2Destination('site-a', 'site-a', 'Công trường A')).toBe('Công trường A');
    expect(formatProjectV2Destination('site-b', 'site-a', 'Công trường A'))
      .toBe('Điểm nhận cần đối chiếu');
    expect(formatProjectV2Destination(null, 'site-a', 'Công trường A'))
      .toBe('Chưa xác định điểm nhận');
  });
});
