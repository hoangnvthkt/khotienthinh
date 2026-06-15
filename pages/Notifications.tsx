import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, Check, CheckCheck, Clock, ExternalLink, Inbox, RefreshCw, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AppNotification, NOTIFICATION_CATEGORIES, NotificationCursor, notificationService } from '../lib/notificationService';
import { resolveNotificationPath } from '../lib/notificationRoutes';
import { getNotificationWorkGroup, getNotificationWorkGroupLabel, NotificationWorkGroup } from '../lib/erpWorkflow';
import { EmptyState, FilterBar, MobileCardList, PageHeader, StatusBadge } from '../components/erp';

type NotificationFilter = 'all' | 'unread' | NotificationWorkGroup;

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'action', label: 'Cần xử lý' },
  { id: 'tracking', label: 'Theo dõi' },
  { id: 'alert', label: 'Cảnh báo' },
  { id: 'unread', label: 'Chưa đọc' },
];

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
};

const getSeverityTone = (severity: AppNotification['severity']) => {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
};

const getSeverityLabel = (severity: AppNotification['severity']) => {
  if (severity === 'critical') return 'Khẩn cấp';
  if (severity === 'warning') return 'Cần chú ý';
  return 'Thông tin';
};

const Notifications: React.FC = () => {
  const { user } = useApp();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<NotificationCursor | undefined>();
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<NotificationFilter>('all');

  const loadFirstPage = useCallback(async () => {
    setRefreshing(true);
    try {
      const page = await notificationService.listPage(user.id, { limit: 50 });
      setNotifications(page.items);
      setNextCursor(page.nextCursor);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user.id]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await notificationService.listPage(user.id, { limit: 50, cursor: nextCursor });
      setNotifications(prev => {
        const seen = new Set(prev.map(item => item.id));
        return [...prev, ...page.items.filter(item => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, user.id]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const counts = useMemo(() => {
    return notifications.reduce<Record<string, number>>((acc, notification) => {
      const group = getNotificationWorkGroup(notification);
      acc[group] = (acc[group] || 0) + 1;
      if (!notification.isRead) acc.unread = (acc.unread || 0) + 1;
      return acc;
    }, {});
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return notifications.filter(notification => {
      const group = getNotificationWorkGroup(notification);
      const matchFilter =
        filter === 'all' ||
        (filter === 'unread' && !notification.isRead) ||
        group === filter;
      const matchSearch = !query || [
        notification.title,
        notification.message,
        notification.category,
        notification.sourceType || '',
      ].some(value => String(value || '').toLowerCase().includes(query));
      return matchFilter && matchSearch;
    });
  }, [notifications, filter, searchTerm]);

  const groupedNotifications = useMemo(() => {
    const groups: Record<NotificationWorkGroup, AppNotification[]> = {
      action: [],
      alert: [],
      tracking: [],
    };
    filteredNotifications.forEach(notification => {
      groups[getNotificationWorkGroup(notification)].push(notification);
    });
    return groups;
  }, [filteredNotifications]);

  const handleOpen = async (notification: AppNotification) => {
    if (!notification.isRead) {
      await notificationService.markRead(notification.id);
      setNotifications(prev => prev.map(item => item.id === notification.id ? { ...item, isRead: true } : item));
    }
    const target = resolveNotificationPath(notification);
    if (!target) return;
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(target);
  };

  const handleMarkRead = async (notification: AppNotification) => {
    await notificationService.markRead(notification.id);
    setNotifications(prev => prev.map(item => item.id === notification.id ? { ...item, isRead: true } : item));
  };

  const handleDismiss = async (notification: AppNotification) => {
    await notificationService.dismiss(notification.id);
    setNotifications(prev => prev.filter(item => item.id !== notification.id));
  };

  const handleMarkAllRead = async () => {
    await notificationService.markAllRead(user.id);
    setNotifications(prev => prev.map(item => ({ ...item, isRead: true })));
  };

  const renderNotification = (notification: AppNotification, framed = true) => {
    const category = NOTIFICATION_CATEGORIES[notification.category as keyof typeof NOTIFICATION_CATEGORIES];
    const group = getNotificationWorkGroup(notification);
    const target = resolveNotificationPath(notification);

    return (
      <div
        className={framed
          ? `group cursor-pointer rounded-lg border p-4 transition hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-600 ${
              notification.isRead
                ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                : 'border-blue-200 bg-blue-50/40 dark:border-blue-900/50 dark:bg-blue-950/20'
            }`
          : 'group cursor-pointer'}
        onClick={() => handleOpen(notification)}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800">
            {notification.icon || category?.icon || <Bell size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="line-clamp-1 text-sm font-black text-slate-900 dark:text-white">{notification.title}</h3>
              {!notification.isRead && <span className="h-2 w-2 rounded-full bg-blue-500" />}
              <StatusBadge status={notification.severity} label={getSeverityLabel(notification.severity)} tone={getSeverityTone(notification.severity)} />
              <StatusBadge status={group} label={getNotificationWorkGroupLabel(group)} tone={group === 'alert' ? 'attention' : group === 'action' ? 'info' : 'neutral'} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">{notification.message}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-400">
              {category && <span>{category.label}</span>}
              <span className="inline-flex items-center gap-1"><Clock size={12} />{timeAgo(notification.createdAt)}</span>
              {target && <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"><ExternalLink size={12} />Mở hồ sơ</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100" onClick={event => event.stopPropagation()}>
            {!notification.isRead && (
              <button
                type="button"
                onClick={() => handleMarkRead(notification)}
                className="rounded-lg border border-slate-200 bg-white p-2 text-emerald-600 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-950"
                title="Đánh dấu đã đọc"
              >
                <Check size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDismiss(notification)}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-950"
              title="Ẩn thông báo"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const orderedGroups: NotificationWorkGroup[] = ['action', 'alert', 'tracking'];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ERP Inbox"
        title="Thông báo"
        description="Một nơi để xem việc cần xử lý, cảnh báo hệ thống và các cập nhật theo dõi."
        meta={
          <>
            <StatusBadge status="action" label={`${counts.action || 0} cần xử lý`} tone="info" size="md" />
            <StatusBadge status="alert" label={`${counts.alert || 0} cảnh báo`} tone="attention" size="md" />
            <StatusBadge status="unread" label={`${counts.unread || 0} chưa đọc`} tone={(counts.unread || 0) > 0 ? 'warning' : 'success'} size="md" />
          </>
        }
        secondaryActions={[
          {
            label: refreshing ? 'Đang tải' : 'Làm mới',
            icon: <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />,
            onClick: loadFirstPage,
            disabled: refreshing,
          },
          ...(counts.unread ? [{
            label: 'Đánh dấu đã đọc',
            icon: <CheckCheck size={15} />,
            onClick: handleMarkAllRead,
          }] : []),
        ]}
      />

      <FilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Tìm tiêu đề, nội dung, module..."
        canClear={!!searchTerm || filter !== 'all'}
        onClear={() => { setSearchTerm(''); setFilter('all'); }}
        filters={
          <>
            {FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`min-h-9 rounded-lg px-3 text-xs font-black transition ${
                  filter === item.id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </>
        }
      />

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map(index => <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={filter === 'alert' ? <AlertTriangle size={18} /> : filter === 'action' ? <Inbox size={18} /> : <Bell size={18} />}
          title="Không có thông báo phù hợp"
          message="Khi có việc cần xử lý hoặc cảnh báo mới, hệ thống sẽ đưa vào đây."
        />
      ) : (
        <div className="space-y-6">
          {orderedGroups.map(group => {
            const items = groupedNotifications[group];
            if (items.length === 0) return null;
            return (
              <section key={group} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-slate-800 dark:text-white">{getNotificationWorkGroupLabel(group)}</h2>
                  <span className="text-[11px] font-bold text-slate-400">{items.length} thông báo</span>
                </div>
                <div className="hidden gap-3 md:grid">
                  {items.map(notification => <div key={notification.id}>{renderNotification(notification)}</div>)}
                </div>
                <MobileCardList
                  items={items}
                  getKey={notification => notification.id}
                  renderItem={notification => renderNotification(notification, false)}
                  className="md:hidden"
                />
              </section>
            );
          })}
          {nextCursor && filter === 'all' && !searchTerm.trim() && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              >
                <RefreshCw size={14} className={loadingMore ? 'animate-spin' : ''} />
                {loadingMore ? 'Đang tải' : 'Tải thêm'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Notifications;
