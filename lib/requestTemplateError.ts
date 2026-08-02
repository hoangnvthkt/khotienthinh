export const formatRequestTemplateSaveError = (cause: unknown): string => {
  if (!cause) return 'Không thể lưu bản nháp. Vui lòng thử lại.';
  const errorObj = cause as {
    name?: string;
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
  };
  const rawMsg = errorObj.message || errorObj.details || String(cause);

  if (errorObj.name === 'AbortError' || rawMsg.includes('aborted') || rawMsg.includes('AbortError')) {
    return 'Kết nối bị ngắt quãng hoặc yêu cầu lưu trước bị hủy. Vui lòng nhấn Lưu nháp để thử lại.';
  }
  if (rawMsg.includes('REQUEST_FORM_SCHEMA_INVALID')) {
    return 'Cấu hình trường dữ liệu của mẫu chưa hợp lệ. Vui lòng kiểm tra lại các trường dữ liệu và thử lại.';
  }
  if (rawMsg.includes('CONFLICT') || errorObj.code === '40001' || errorObj.code === 'PT409') {
    return 'Bản nháp đã được cập nhật bởi phiên khác. Vui lòng tải lại trang để lấy dữ liệu mới nhất.';
  }
  if (rawMsg.includes('REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED')) {
    return 'Thiếu phiên bản bản nháp để kiểm tra xung đột. Vui lòng tải lại trang rồi thử lại.';
  }
  if (rawMsg.includes('REQUEST_APPROVER_INACTIVE')) {
    return 'Một hoặc nhiều người duyệt trong khối không còn hoạt động hoặc bị khóa tài khoản.';
  }
  if (rawMsg.includes('REQUEST_TEMPLATE_FORBIDDEN') || errorObj.code === '42501') {
    return 'Bạn không có quyền quản lý mẫu đề xuất.';
  }
  if (rawMsg.includes('REQUEST_APPROVER_REQUIRED')) {
    return 'Cần chọn ít nhất một người duyệt cho khối người duyệt cố định.';
  }
  if (rawMsg.includes('REQUEST_TEMPLATE_NAME_REQUIRED')) {
    return 'Tên mẫu đề xuất không được để trống.';
  }
  if (rawMsg.includes('REQUEST_TEMPLATE_BLOCK_REQUIRED')) {
    return 'Mẫu cần ít nhất một khối người duyệt.';
  }
  return rawMsg.length < 120
    ? `Không thể lưu bản nháp: ${rawMsg}`
    : 'Không thể lưu bản nháp. Vui lòng kiểm tra lại cấu hình.';
};
