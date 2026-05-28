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
  if (rawMessage.includes('row-level security') || rawMessage.includes('permission denied') || rawMessage.includes('not authorized') || err.status === 401 || err.status === 403) {
    return 'Bạn không có quyền thực hiện thao tác này.';
  }
  if (rawMessage.includes('duplicate key') || rawMessage.includes('23505') || rawMessage.includes('already exists')) {
    return 'Dữ liệu này đã tồn tại. Vui lòng kiểm tra lại thông tin nhập.';
  }
  if (rawMessage.includes('foreign key') || rawMessage.includes('23503') || rawMessage.includes('referenced from table')) {
    return 'Dữ liệu đang được sử dụng ở nơi khác nên chưa thể xoá.';
  }
  if (rawMessage.includes('insufficient stock') || rawMessage.includes('không đủ tồn') || rawMessage.includes('tồn khả dụng')) {
    return originalMessage || 'Không đủ tồn kho khả dụng để thực hiện thao tác.';
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
