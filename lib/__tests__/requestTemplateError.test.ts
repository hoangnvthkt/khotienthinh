import { describe, expect, it } from 'vitest';
import { formatRequestTemplateSaveError } from '../requestTemplateError';

describe('formatRequestTemplateSaveError', () => {
  it('explains an invalid form schema without blaming a concurrent editor', () => {
    const message = formatRequestTemplateSaveError({
      message: 'REQUEST_FORM_SCHEMA_INVALID',
      code: '22023',
    });

    expect(message).toBe(
      'Cấu hình trường dữ liệu của mẫu chưa hợp lệ. Vui lòng kiểm tra lại các trường dữ liệu và thử lại.',
    );
    expect(message).not.toContain('phiên khác');
  });

  it('keeps the concurrency guidance for an actual stale update', () => {
    expect(formatRequestTemplateSaveError({ message: 'CONFLICT', code: '40001' }))
      .toBe('Bản nháp đã được cập nhật bởi phiên khác. Vui lòng tải lại trang để lấy dữ liệu mới nhất.');
  });

  it('keeps permission failures specific', () => {
    expect(formatRequestTemplateSaveError({ message: 'REQUEST_TEMPLATE_FORBIDDEN', code: '42501' }))
      .toBe('Bạn không có quyền quản lý mẫu đề xuất.');
  });
});
