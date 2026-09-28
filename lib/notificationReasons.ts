// Why a person received a notification (notifications.delivery_reason, set on
// the server). The inbox groups by this so people see their own work first.
export type NotificationDeliveryReason = 'assigned' | 'mentioned' | 'watching' | 'responsible' | 'system';

export type NotificationInboxTab = 'all' | 'mine' | 'watching' | 'responsible' | 'system';

export const NOTIFICATION_INBOX_TABS: Array<{
  id: NotificationInboxTab;
  label: string;
  reasons: NotificationDeliveryReason[] | null;
  emptyMessage: string;
}> = [
  { id: 'all', label: 'Tất cả', reasons: null, emptyMessage: 'Bạn chưa có thông báo nào.' },
  { id: 'mine', label: 'Việc của tôi', reasons: ['assigned', 'mentioned'], emptyMessage: 'Không có việc nào đang chờ bạn và không ai nhắc tên bạn.' },
  { id: 'watching', label: 'Theo dõi', reasons: ['watching'], emptyMessage: 'Chưa có cập nhật nào về hồ sơ bạn tạo hoặc theo dõi.' },
  { id: 'responsible', label: 'Nghiệp vụ', reasons: ['responsible'], emptyMessage: 'Chưa có cảnh báo nào cho mảng bạn phụ trách.' },
  { id: 'system', label: 'Hệ thống', reasons: ['system'], emptyMessage: 'Chưa có thông báo chung.' },
];

export const NOTIFICATION_REASON_LABELS: Record<NotificationDeliveryReason, string> = {
  assigned: 'Cần bạn xử lý',
  mentioned: 'Nhắc đến bạn',
  watching: 'Bạn đang theo dõi',
  responsible: 'Bạn phụ trách',
  system: 'Thông báo chung',
};

export const NOTIFICATION_REASON_TONES: Record<NotificationDeliveryReason, string> = {
  assigned: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  mentioned: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  watching: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  responsible: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  system: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export const getNotificationInboxTab = (reason: NotificationDeliveryReason | undefined): Exclude<NotificationInboxTab, 'all'> => {
  if (reason === 'assigned' || reason === 'mentioned') return 'mine';
  if (reason === 'responsible' || reason === 'system') return reason;
  return 'watching';
};

export const getInboxTabReasons = (tab: NotificationInboxTab): NotificationDeliveryReason[] | null =>
  NOTIFICATION_INBOX_TABS.find(item => item.id === tab)?.reasons ?? null;
