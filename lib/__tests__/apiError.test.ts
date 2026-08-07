import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from '../apiError';

describe('getApiErrorMessage', () => {
  it('describes foreign-key errors without assuming the user was deleting data', () => {
    expect(getApiErrorMessage({
      code: '23503',
      message: 'insert or update on table "transactions" violates foreign key constraint',
    })).toBe('Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng ở nơi khác. Vui lòng kiểm tra lại.');
  });

  it('explains that a used workflow template must be deactivated instead of deleted', () => {
    expect(getApiErrorMessage({
      message: 'workflow template has bindings/versions/instances and must be deactivated instead of deleted',
    })).toBe('Mẫu quy trình đã có phiếu, phiên bản hoặc liên kết sử dụng. Hãy tắt quy trình thay vì xóa.');
  });
});
