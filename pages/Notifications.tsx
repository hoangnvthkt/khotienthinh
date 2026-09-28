import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Bell, Check, CheckCheck, Clock, ExternalLink, Inbox, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AppNotification, NOTIFICATION_CATEGORIES, NotificationCursor, notificationService } from '../lib/notificationService';
import { resolveNotificationPath } from '../lib/notificationRoutes';
import {
  getInboxTabReasons,
  getNotificationInboxTab,
  NOTIFICATION_INBOX_TABS,
  NOTIFICATION_REASON_LABELS,
  type NotificationInboxTab,
} from '../lib/notificationReasons';
import { EmptyState, FilterBar, MobileCardList, PageHeader, StatusBadge } from '../components/erp';
import VehicleBookingNotificationContent from '../components/VehicleBookingNotificationContent';
import NotificationPreferencesCard from '../components/NotificationPreferencesCard';

type TabCounts = Record<Exclude<NotificationInboxTab, 'all'>, number>;
type SectionTab = Exclude<NotificationInboxTab, 'all'>;

const SECTION_ORDER: SectionTab[] = ['mine', 'responsible', 'watching', 'system'];

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
  const [tab, setTab] = useState<NotificationInboxTab>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [tabCounts, setTabCounts] = useState<TabCounts | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [searchParams] = useSearchParams();
  const [showPreferences, setShowPreferences] = useState(searchParams.get('preferences') === '1');

  const loadFirstPage = useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    try {
      const [page, counts] = await Promise.all([
        notificationService.listPage(user.id, { limit: 50, reasons: getInboxTabReasons(tab) }),
        notificationService.countUnreadByTab(user.id).catch(() => null),
      ]);
      setNotifications(page.items);
      setNextCursor(page.nextCursor);
      setTabCounts(counts);
    } catch (error) {
      console.warn('Notification inbox failed:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user.id, tab]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await notificationService.listPage(user.id, { limit: 50, cursor: nextCursor, reasons: getInboxTabReasons(tab) });
      setNotifications(prev => {
        const seen = new Set(prev.map(item => item.id));
        return [...prev, ...page.items.filter(item => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, user.id, tab]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const totalUnread = tabCounts
    ? tabCounts.mine + tabCounts.watching + tabCounts.responsible + tabCounts.system
    : notifications.filter(notification => !notification.isRead).length;

  const filteredNotifications = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return notifications.filter(notification => {
      const matchFilter = !unreadOnly || !notification.isRead;
      const matchSearch = !query || [
        notification.title,
        notification.message,
        notification.category,
        notification.sourceType || '',
      ].some(value => String(value || '').toLowerCase().includes(query));
      return matchFilter && matchSearch;
    });
  }, [notifications, unreadOnly, searchTerm]);

  const groupedNotifications = useMemo(() => {
    const groups: Record<SectionTab, AppNotification[]> = { mine: [], responsible: [], watching: [], system: [] };
    filteredNotifications.forEach(notification => {
      groups[getNotificationInboxTab(notification.deliveryReason)].push(notification);
    });
    return groups;
  }, [filteredNotifications]);

  const adjustTabCount = (notification: AppNotification) => {
    if (notification.isRead) return;
    const key = getNotificationInboxTab(notification.deliveryReason);
    setTabCounts(prev => prev ? { ...prev, [key]: Math.max(prev[key] - 1, 0) } : prev);
  };

  const handleOpen = async (notification: AppNotification) => {
    if (!notification.isRead) {
      await notificationService.markRead(notification.id);
      adjustTabCount(notification);
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
    adjustTabCount(notification);
    setNotifications(prev => prev.map(item => item.id === notification.id ? { ...item, isRead: true } : item));
  };

  const handleDismiss = async (notification: AppNotification) => {
    await notificationService.dismiss(notification.id);
    adjustTabCount(notification);
    setNotifications(prev => prev.filter(item => item.id !== notification.id));
  };

  const handleMarkAllRead = async () => {
    await notificationService.markAllRead(user.id);
    setNotifications(prev => prev.map(item => ({ ...item, isRead: true })));
    setTabCounts(prev => prev ? { mine: 0, watching: 0, responsible: 0, system: 0 } : prev);
  };

  const renderNotification = (notification: AppNotification, framed = true) => {
    const category = NOTIFICATION_CATEGORIES[notification.category as keyof typeof NOTIFICATION_CATEGORIES];
    const reason = notification.deliveryReason;
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
              {reason && (
                <StatusBadge
                  status={reason}
                  label={NOTIFICATION_REASON_LABELS[reason]}
                  tone={reason === 'assigned' || reason === 'mentioned' ? 'info' : reason === 'responsible' ? 'attention' : 'neutral'}
                />
              )}
            </div>
            <div className="mt-1">
              <VehicleBookingNotificationContent notification={notification} />
            </div>
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

  const sectionLabel = (key: SectionTab) => NOTIFICATION_INBOX_TABS.find(item => item.id === key)?.label || key;
  const activeTab = NOTIFICATION_INBOX_TABS.find(item => item.id === tab) || NOTIFICATION_INBOX_TABS[0];
  const countLabel = (value: number) => (value > 99 ? '99+' : String(value));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ERP Inbox"
        title="Thông báo"
        description="Việc cần bạn xử lý hiện trước; cập nhật theo dõi và cảnh báo nghiệp vụ được tách riêng."
        meta={
          tabCounts ? (
            <>
              <StatusBadge status="mine" label={`${countLabel(tabCounts.mine)} việc của tôi chưa đọc`} tone={tabCounts.mine > 0 ? 'info' : 'success'} size="md" />
              <StatusBadge status="responsible" label={`${countLabel(tabCounts.responsible)} cảnh báo nghiệp vụ chưa đọc`} tone="attention" size="md" />
            </>
          ) : undefined
        }
        secondaryActions={[
          {
            label: showPreferences ? 'Ẩn cách nhận' : 'Cách nhận thông báo',
            icon: <Settings2 size={15} />,
            onClick: () => setShowPreferences(value => !value),
          },
          {
            label: refreshing ? 'Đang tải' : 'Làm mới',
            icon: <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />,
            onClick: loadFirstPage,
            disabled: refreshing,
          },
          ...(totalUnread ? [{
            label: 'Đánh dấu đã đọc',
            icon: <CheckCheck size={15} />,
            onClick: handleMarkAllRead,
          }] : []),
        ]}
      />

      {showPreferences && <NotificationPreferencesCard userId={user.id} />}

      <FilterBar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Tìm tiêu đề, nội dung, module..."
        canClear={!!searchTerm || tab !== 'all' || unreadOnly}
        onClear={() => { setSearchTerm(''); setTab('all'); setUnreadOnly(false); }}
        filters={
          <>
            {NOTIFICATION_INBOX_TABS.map(item => {
              const count = item.id === 'all' ? 0 : tabCounts?.[item.id] || 0;
              const selected = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTab(item.id)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black transition ${
                    selected
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                  }`}
                >
                  {item.label}
                  {count > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] ${selected ? 'bg-white/25' : item.id === 'mine' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {countLabel(count)}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(value => !value)}
              className={`min-h-9 rounded-lg px-3 text-xs font-black transition ${
                unreadOnly
                  ? 'bg-blue-600 text-white'
                  : 'border border-dashed border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
              }`}
            >
              Chỉ chưa đọc
            </button>
          </>
        }
      />

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map(index => <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<AlertTriangle size={18} />}
          title="Không tải được thông báo"
          message="Kiểm tra kết nối rồi thử lại."
          action={(
            <button
              type="button"
              onClick={loadFirstPage}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
            >
              <RefreshCw size={14} /> Thử lại
            </button>
          )}
        />
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={tab === 'mine' ? <Inbox size={18} /> : <Bell size={18} />}
          title={searchTerm.trim() || unreadOnly ? 'Không có thông báo phù hợp' : 'Không có thông báo'}
          message={searchTerm.trim() || unreadOnly ? 'Thử bỏ bớt điều kiện lọc.' : activeTab.emptyMessage}
        />
      ) : (
        <div className="space-y-6">
          {SECTION_ORDER.map(group => {
            const items = groupedNotifications[group];
            if (items.length === 0) return null;
            return (
              <section key={group} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-slate-800 dark:text-white">{sectionLabel(group)}</h2>
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
          {nextCursor && !unreadOnly && !searchTerm.trim() && (
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
