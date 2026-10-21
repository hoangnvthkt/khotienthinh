type ApiErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  name?: string;
};

const asErrorLike = (error: unknown): ApiErrorLike => {
  if (!error) return {};
  if (error instanceof Error) return error;
  if (typeof error === 'string') return { message: error };
  if (typeof error === 'object') return error as ApiErrorLike;
  return { message: String(error) };
};

export const logApiError = (scope: string, error: unknown) => {
  console.error(`[${scope}]`, error);
};

export const getApiErrorMessage = (
  error: unknown,
  fallbackMessage = 'Không thể xử lý yêu cầu. Vui lòng thử lại.'
) => {
  const err = asErrorLike(error);
  const originalMessage = err.message?.trim();
  const rawMessage = [err.message, err.details, err.hint, err.code, err.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!rawMessage) return fallbackMessage;

  // Lỗi nghiệp vụ có câu tiếng Việt sau mã (vd. "BUSINESS_DATE_BACKDATE: Ngày … cần quyền …") — hiện đúng câu đó.
  const coded = originalMessage?.match(/^(?:BUSINESS_DATE_[A-Z_]+|PURCHASE_RECEIPT_RECON_OPEN|WMS_[A-Z_]+|INVENTORY_NEGATIVE_STOCK): (.+)$/s);
  if (coded) return coded[1].trim();

  if (rawMessage.includes('purchase_order_create_moved_to_procurement')) {
    return 'Đơn hàng từ phiếu đề xuất nay lập tại màn Mua hàng. Phòng Mua hàng sẽ tiếp nhận phiếu đã duyệt.';
  }
  if (rawMessage.includes('invalid login credentials')) {
    return 'Tên đăng nhập hoặc mật khẩu không chính xác.';
  }
  if (rawMessage.includes('email not confirmed')) {
    return 'Email đăng nhập chưa được xác thực.';
  }
  if (rawMessage.includes('jwt') || rawMessage.includes('session') || rawMessage.includes('refresh token')) {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  }
  if (rawMessage.includes('failed to fetch') || rawMessage.includes('network') || rawMessage.includes('timeout')) {
    return 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.';
  }
  if (rawMessage.includes('workflow_command_forbidden')) {
    return 'Bạn không có quyền thực hiện thao tác này.';
  }
  if (rawMessage.includes('workflow_template_invalid') || rawMessage.includes('invalid workflow template structure')) {
    return err.details
      ? `Quy trình chưa hợp lệ. ${err.details.split('\n').join(' ')}`
      : 'Quy trình chưa hợp lệ: cần ít nhất một bước xử lý đã lưu và mỗi bước phải có tên.';
  }
  if (rawMessage.includes('workflow_step_assignee_missing')) {
    return err.details
      ? `Mỗi bước phải có người xử lý. ${err.details.split('\n').join(' ')}`
      : 'Mỗi bước phải có người xử lý trước khi bật quy trình.';
  }
  if (rawMessage.includes('workflow_category_name_taken')) {
    return 'Tên nhóm này đã có. Vui lòng đặt tên khác.';
  }
  if (rawMessage.includes('row-level security') || rawMessage.includes('permission denied') || rawMessage.includes('not authorized') || err.status === 401 || err.status === 403) {
    return 'Bạn không có quyền thực hiện thao tác này.';
  }
  if (rawMessage.includes('duplicate key') || rawMessage.includes('23505') || rawMessage.includes('already exists')) {
    return 'Dữ liệu này đã tồn tại. Vui lòng kiểm tra lại thông tin nhập.';
  }
  if (
    rawMessage.includes('workflow template has bindings/versions/instances')
    || rawMessage.includes('must be deactivated instead of deleted')
  ) {
    return 'Mẫu quy trình đã có phiếu, phiên bản hoặc liên kết sử dụng. Hãy tắt quy trình thay vì xóa.';
  }
  if (rawMessage.includes('room members must be active staff in the selected project scope')) {
    return 'Room còn người đã rời dự án hoặc đã bị khóa tài khoản. Tải lại trang rồi lưu lại.';
  }
  if (rawMessage.includes('required workflow action has no active room recipient')) {
    return 'Room này phải luôn có người giữ quyền duyệt / xác nhận bắt buộc. Giao quyền đó cho ít nhất một người trong dự án rồi lưu lại.';
  }
  if (rawMessage.includes('foreign key') || rawMessage.includes('23503') || rawMessage.includes('referenced from table')) {
    return 'Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng ở nơi khác. Vui lòng kiểm tra lại.';
  }
  if (rawMessage.includes('inventory_negative_stock')) {
    return (originalMessage || '').replace(/^INVENTORY_NEGATIVE_STOCK:\s*/, '') || 'Không đủ tồn kho để xuất.';
  }
  if (rawMessage.includes('purchase_receipt_not_receivable')) {
    return 'Đợt giao đã được nhận hoặc hủy ở nơi khác. Đóng và mở lại phiếu để xem trạng thái mới.';
  }
  if (rawMessage.includes('purchase_receipt_batch_mismatch')) {
    return 'Phiếu kho không khớp đợt giao. Tải lại rồi thử lại.';
  }
  if (rawMessage.includes('insufficient stock') || rawMessage.includes('không đủ tồn') || rawMessage.includes('tồn khả dụng')) {
    return originalMessage || 'Không đủ tồn kho khả dụng để thực hiện thao tác.';
  }
  if (originalMessage && /[À-ỹ]/.test(originalMessage)) {
    return originalMessage;
  }

  if (
    originalMessage &&
    !err.code &&
    !err.details &&
    !err.hint &&
    (error instanceof Error || typeof error === 'string' || /[À-ỹ]/.test(originalMessage))
  ) {
    return originalMessage;
  }

  return fallbackMessage;
};
