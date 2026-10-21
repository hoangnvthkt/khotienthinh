import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from '../apiError';

describe('getApiErrorMessage', () => {
  it('describes foreign-key errors without assuming the user was deleting data', () => {
    expect(getApiErrorMessage({
      code: '23503',
      message: 'insert or update on table "transactions" violates foreign key constraint',
    })).toBe('Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng ở nơi khác. Vui lòng kiểm tra lại.');
  });

  it('explains Room saves blocked by a departed member or a missing required recipient', () => {
    expect(getApiErrorMessage({
      code: '23503',
      message: 'Room members must be active staff in the selected project scope',
    })).toBe('Room còn người đã rời dự án hoặc đã bị khóa tài khoản. Tải lại trang rồi lưu lại.');
    expect(getApiErrorMessage({
      code: '23514',
      message: 'Required workflow action has no active Room recipient',
    })).toBe('Room này phải luôn có người giữ quyền duyệt / xác nhận bắt buộc. Giao quyền đó cho ít nhất một người trong dự án rồi lưu lại.');
  });

  it('explains that a used workflow template must be deactivated instead of deleted', () => {
    expect(getApiErrorMessage({
      message: 'workflow template has bindings/versions/instances and must be deactivated instead of deleted',
    })).toBe('Mẫu quy trình đã có phiếu, phiên bản hoặc liên kết sử dụng. Hãy tắt quy trình thay vì xóa.');
  });

  it('shows which workflow steps are missing a handler', () => {
    expect(getApiErrorMessage({
      code: '22023',
      message: 'WORKFLOW_STEP_ASSIGNEE_MISSING',
      details: 'Bước "Tạo đề xuất" chưa có người xử lý.\nBước "Duyệt" chưa có người xử lý.',
    })).toBe('Mỗi bước phải có người xử lý. Bước "Tạo đề xuất" chưa có người xử lý. Bước "Duyệt" chưa có người xử lý.');
  });
});
