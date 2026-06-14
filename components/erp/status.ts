export type ErpStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'attention' | 'danger';

export const ERP_TONE_STYLES: Record<ErpStatusTone, {
  badge: string;
  dot: string;
  soft: string;
  text: string;
}> = {
  neutral: {
    badge: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
    soft: 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
    text: 'text-slate-600 dark:text-slate-300',
  },
  info: {
    badge: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300',
    dot: 'bg-blue-500',
    soft: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300',
    text: 'text-blue-700 dark:text-blue-300',
  },
  success: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    soft: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  warning: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
    dot: 'bg-amber-500',
    soft: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
    text: 'text-amber-700 dark:text-amber-300',
  },
  attention: {
    badge: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300',
    dot: 'bg-orange-500',
    soft: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-300',
    text: 'text-orange-700 dark:text-orange-300',
  },
  danger: {
    badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
    dot: 'bg-red-500',
    soft: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300',
    text: 'text-red-700 dark:text-red-300',
  },
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp',
  pending: 'Chờ xử lý',
  submitted: 'Chờ duyệt',
  approved: 'Đã duyệt',
  completed: 'Hoàn thành',
  done: 'Hoàn thành',
  in_progress: 'Đang xử lý',
  running: 'Đang xử lý',
  in_transit: 'Đang giao',
  need_clarification: 'Cần bổ sung',
  returned: 'Trả lại',
  rejected: 'Từ chối',
  cancelled: 'Đã huỷ',
  canceled: 'Đã huỷ',
  error: 'Lỗi',
  overdue: 'Quá hạn',
  warning: 'Cần chú ý',
  critical: 'Khẩn cấp',
};

const TONE_BY_STATUS: Record<string, ErpStatusTone> = {
  draft: 'neutral',
  cancelled: 'neutral',
  canceled: 'neutral',
  pending: 'info',
  submitted: 'info',
  approved: 'success',
  completed: 'success',
  done: 'success',
  in_progress: 'info',
  running: 'info',
  in_transit: 'info',
  need_clarification: 'warning',
  returned: 'warning',
  warning: 'warning',
  overdue: 'attention',
  rejected: 'danger',
  error: 'danger',
  critical: 'danger',
};

export const normalizeStatusKey = (status?: string | null) =>
  String(status || 'draft').trim().replace(/[\s-]+/g, '_').toLowerCase();

export const getDefaultStatusTone = (status?: string | null): ErpStatusTone =>
  TONE_BY_STATUS[normalizeStatusKey(status)] || 'neutral';

export const getDefaultStatusLabel = (status?: string | null): string => {
  const key = normalizeStatusKey(status);
  return STATUS_LABELS[key] || String(status || 'Nháp');
};

export const getPriorityTone = (priority?: string | null): ErpStatusTone => {
  const key = normalizeStatusKey(priority);
  if (key === 'urgent') return 'danger';
  if (key === 'high') return 'attention';
  if (key === 'medium') return 'info';
  return 'neutral';
};

export const getPriorityLabel = (priority?: string | null) => {
  const key = normalizeStatusKey(priority);
  if (key === 'urgent') return 'Khẩn cấp';
  if (key === 'high') return 'Cao';
  if (key === 'medium') return 'Trung bình';
  if (key === 'low') return 'Thấp';
  return String(priority || 'Thấp');
};
