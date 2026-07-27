import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from '../apiError';

describe('getApiErrorMessage', () => {
  it('describes foreign-key errors without assuming the user was deleting data', () => {
    expect(getApiErrorMessage({
      code: '23503',
      message: 'insert or update on table "transactions" violates foreign key constraint',
    })).toBe('Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng ở nơi khác. Vui lòng kiểm tra lại.');
  });
});
