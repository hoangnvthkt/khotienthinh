export const ERP_COMPLETION_PILOT_COMMAND_DISABLED = 'ERP_COMPLETION_PILOT_COMMAND_DISABLED';

export const mapErpCompletionCommandError = (cause: unknown): unknown => {
  const message = typeof cause === 'object' && cause !== null && 'message' in cause
    ? String((cause as { message?: unknown }).message || '')
    : String(cause || '');
  if (!message.includes(ERP_COMPLETION_PILOT_COMMAND_DISABLED)) return cause;

  const error = new Error(
    'Thao tác này chưa được mở hoặc đang tạm dừng cho phạm vi hiện tại. '
    + 'Dữ liệu chưa thay đổi; hãy liên hệ người hỗ trợ pilot.',
    { cause },
  ) as Error & { code: string };
  error.code = ERP_COMPLETION_PILOT_COMMAND_DISABLED;
  return error;
};
