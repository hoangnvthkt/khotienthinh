import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Bell, X, Check, CheckCheck, Trash2, AlertTriangle, Info, CheckCircle2, XCircle,
    RefreshCw, ChevronDown, ExternalLink, Clock, Settings2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notificationService, AppNotification, NOTIFICATION_CATEGORIES } from '../lib/notificationService';
import { resolveNotificationPath, toHashRoute } from '../lib/notificationRoutes';
import { webPushService } from '../lib/webPushService';
import { appBadgeService } from '../lib/appBadgeService';
import { notificationSoundService } from '../lib/notificationSoundService';
import VehicleBookingNotificationContent from './VehicleBookingNotificationContent';
import {
    getInboxTabReasons,
    getNotificationInboxTab,
    NOTIFICATION_INBOX_TABS,
    NOTIFICATION_REASON_LABELS,
    NOTIFICATION_REASON_TONES,
    type NotificationInboxTab,
} from '../lib/notificationReasons';

type TabCounts = Record<Exclude<NotificationInboxTab, 'all'>, number>;

interface NotificationCenterProps {
    userId?: string;
    enabled?: boolean;
    mode?: 'always' | 'mobile' | 'desktop';
}

type BrowserNotificationOptions = NotificationOptions & {
    renotify?: boolean;
    vibrate?: number[];
};

const SEVERITY_STYLES = {
    info: { border: 'border-l-blue-400', bg: 'bg-blue-50/50', icon: <Info size={14} className="text-blue-500" /> },
    warning: { border: 'border-l-amber-400', bg: 'bg-amber-50/50', icon: <AlertTriangle size={14} className="text-amber-500" /> },
    critical: { border: 'border-l-red-400', bg: 'bg-red-50/50', icon: <XCircle size={14} className="text-red-500" /> },
};

const TYPE_ICONS = {
    info: <Info size={14} className="text-blue-500" />,
    warning: <AlertTriangle size={14} className="text-amber-500" />,
    success: <CheckCircle2 size={14} className="text-emerald-500" />,
    error: <XCircle size={14} className="text-red-500" />,
};

const getIsMobileViewport = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId, enabled = true, mode = 'always' }) => {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport);
    const [activeTab, setActiveTab] = useState<NotificationInboxTab>('all');
    const [tabCounts, setTabCounts] = useState<TabCounts | null>(null);
    const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
    const activeTabRef = useRef<NotificationInboxTab>('all');
    const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
        typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
    );
    const [webPushEnabled, setWebPushEnabled] = useState(false);
    const unreadCountRef = useRef(0);
    const webPushEnabledRef = useRef(false);
    const bellRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
    const isViewportEnabled =
        mode === 'always' ||
        (mode === 'mobile' && isMobileViewport) ||
        (mode === 'desktop' && !isMobileViewport);
    const isActive = enabled && isViewportEnabled;
    const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

    useEffect(() => {
        if (mode === 'always') return;
        const media = window.matchMedia('(max-width: 1023px)');
        const handleChange = () => setIsMobileViewport(media.matches);
        handleChange();
        media.addEventListener?.('change', handleChange);
        return () => media.removeEventListener?.('change', handleChange);
    }, [mode]);

    useEffect(() => {
        if (!isActive && isOpen) setIsOpen(false);
    }, [isActive, isOpen]);

    const loadList = useCallback(async () => {
        const tab = activeTab;
        setListState('loading');
        try {
            const page = await notificationService.listPage(userId, { limit: 50, reasons: getInboxTabReasons(tab) });
            if (activeTabRef.current !== tab) return;
            setNotifications(page.items);
            setListState('ready');
        } catch (error) {
            console.warn('Notification list failed:', error);
            if (activeTabRef.current === tab) setListState('error');
        }
    }, [userId, activeTab]);

    const loadTabCounts = useCallback(async () => {
        if (!userId) return;
        try {
            setTabCounts(await notificationService.countUnreadByTab(userId));
        } catch (error) {
            console.warn('Notification tab counts failed:', error);
            setTabCounts(null);
        }
    }, [userId]);

    const selectTab = (tab: NotificationInboxTab) => {
        activeTabRef.current = tab;
        setActiveTab(tab);
    };

    const applyUnreadCount = useCallback((count: number) => {
        const nextCount = Math.max(0, Math.min(100, Math.floor(Number.isFinite(count) ? count : 0)));
        unreadCountRef.current = nextCount;
        setUnreadCount(nextCount);
        appBadgeService.setUnreadCount(nextCount);
    }, []);

    const loadCount = useCallback(async () => {
        const count = await notificationService.countUnread(userId);
        applyUnreadCount(count);
    }, [userId, applyUnreadCount]);

    useEffect(() => {
        if (!isActive) return;
        loadCount();
    }, [isActive, loadCount]);

    useEffect(() => {
        if (!isActive || !isOpen) return;
        loadList();
    }, [isActive, isOpen, loadList]);

    useEffect(() => {
        if (!isActive || !isOpen) return;
        loadTabCounts();
    }, [isActive, isOpen, loadTabCounts]);

    // Realtime subscription
    useEffect(() => {
        if (!isActive) return;
        const stop = notificationService.subscribe((n) => {
            const tab = getNotificationInboxTab(n.deliveryReason);
            if (activeTabRef.current === 'all' || activeTabRef.current === tab) {
                setNotifications(prev => {
                    if (prev.some(item => item.id === n.id)) return prev;
                    return [n, ...prev].slice(0, 50);
                });
            }
            if (!n.isRead) {
                setTabCounts(prev => prev ? { ...prev, [tab]: Math.min(prev[tab] + 1, 100) } : prev);
            }
            // Digest notices arrive quietly; the daily summary announces them.
            if (n.isRead || n.deliveryMode !== 'instant') return;
            applyUnreadCount(unreadCountRef.current + 1);
            void notificationSoundService.play(n.severity === 'critical' ? 'urgent' : 'normal');

            // Fallback browser notification when Web Push is not enabled on this device.
            if ('Notification' in window && !document.hasFocus() && Notification.permission === 'granted' && !webPushEnabledRef.current) {
                const browserOptions: BrowserNotificationOptions = {
                    body: n.message,
                    icon: '/icons/icon-192.png',
                    tag: n.id, // dedup
                    renotify: true,
                    silent: false,
                    vibrate: [100, 50, 100],
                };
                const browserNotif = new Notification(n.title, browserOptions);
                browserNotif.onclick = () => {
                    window.focus();
                    const target = resolveNotificationPath(n);
                    if (target) {
                        if (/^https?:\/\//i.test(target)) window.open(target, '_blank', 'noopener,noreferrer');
                        else window.location.hash = toHashRoute(target);
                    }
                    browserNotif.close();
                };
            }

        }, userId);
        return stop;
    }, [isActive, userId, applyUnreadCount]);

    useEffect(() => {
        if (!isActive) return;
        if ('Notification' in window) setBrowserPermission(Notification.permission);
        if (userId && webPushService.isSupported() && Notification.permission === 'granted') {
            webPushService.ensureSubscription(userId)
                .then(enabled => {
                    setWebPushEnabled(enabled);
                    webPushEnabledRef.current = enabled;
                })
                .catch(err => console.error('Web push subscription error:', err));
        }
    }, [isActive, userId]);

    useEffect(() => {
        if (!isActive || !userId) return;
        webPushService.isEnabledForThisDevice(userId)
            .then(enabled => {
                setWebPushEnabled(enabled);
                webPushEnabledRef.current = enabled;
            })
            .catch(() => {
                setWebPushEnabled(false);
                webPushEnabledRef.current = false;
            });
    }, [isActive, userId, browserPermission]);

    useEffect(() => {
        if (!isActive) return;
        const syncUnreadBadge = () => {
            if (!document.hidden) loadCount();
        };
        window.addEventListener('focus', syncUnreadBadge);
        document.addEventListener('visibilitychange', syncUnreadBadge);
        return () => {
            window.removeEventListener('focus', syncUnreadBadge);
            document.removeEventListener('visibilitychange', syncUnreadBadge);
        };
    }, [isActive, loadCount]);

    // Click outside to close
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                panelRef.current && !panelRef.current.contains(e.target as Node) &&
                bellRef.current && !bellRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // Calculate panel position from bell button
    const calculatePanelPos = useCallback(() => {
        if (!bellRef.current) return;
        const rect = bellRef.current.getBoundingClientRect();
        const panelWidth = Math.min(384, window.innerWidth - 32);
        const panelEstimatedHeight = Math.min(window.innerHeight * 0.75, 540);

        // Find sidebar element if exists
        const sidebarEl = bellRef.current.closest('aside') || document.querySelector('aside');
        const sidebarRect = sidebarEl ? sidebarEl.getBoundingClientRect() : null;
        const isInLeftSidebar = !isMobileViewport && rect.left < 340;

        let left = rect.left;
        let top = rect.bottom + 8;

        if (isInLeftSidebar) {
            // Position to the right of the entire sidebar width without overlapping the sidebar
            const sidebarRight = sidebarRect ? sidebarRect.right : rect.right;
            left = Math.max(sidebarRight + 12, rect.right + 12);
            top = Math.max(16, rect.top - 8);

            // If it exceeds right edge of screen
            if (left + panelWidth > window.innerWidth - 16) {
                left = window.innerWidth - panelWidth - 16;
            }
        } else {
            // Standard dropdown below button
            if (left + panelWidth > window.innerWidth - 16) {
                left = window.innerWidth - panelWidth - 16;
            }
            if (left < 8) left = 8;
        }

        // Ensure vertical bounds fit within viewport
        if (top + panelEstimatedHeight > window.innerHeight - 16) {
            top = Math.max(16, window.innerHeight - panelEstimatedHeight - 16);
        }
        if (top < 16) top = 16;

        setPanelPos({ top, left });
    }, [isMobileViewport]);

    // Recalculate on resize/scroll if open
    useEffect(() => {
        if (!isOpen) return;
        const handleReposition = () => calculatePanelPos();
        window.addEventListener('resize', handleReposition);
        window.addEventListener('scroll', handleReposition, true);
        return () => {
            window.removeEventListener('resize', handleReposition);
            window.removeEventListener('scroll', handleReposition, true);
        };
    }, [isOpen, calculatePanelPos]);

    const toggleOpen = () => {
        if (!isActive) return;
        if (!isOpen) {
            calculatePanelPos();
        }
        setIsOpen(!isOpen);
    };

    const decrementTabCount = (n?: AppNotification) => {
        if (!n || n.isRead) return;
        const tab = getNotificationInboxTab(n.deliveryReason);
        setTabCounts(prev => prev ? { ...prev, [tab]: Math.max(prev[tab] - 1, 0) } : prev);
    };

    const countsOnBell = (n?: AppNotification) => Boolean(n && !n.isRead && (n.deliveryMode || 'instant') === 'instant');

    const handleMarkRead = async (id: string) => {
        await notificationService.markRead(id);
        const n = notifications.find(item => item.id === id);
        decrementTabCount(n);
        setNotifications(prev => prev.map(item => item.id === id ? { ...item, isRead: true } : item));
        if (countsOnBell(n)) applyUnreadCount(unreadCountRef.current - 1);
    };

    const handleMarkAllRead = async () => {
        await notificationService.markAllRead(userId);
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setTabCounts(prev => prev ? { mine: 0, watching: 0, responsible: 0, system: 0 } : prev);
        applyUnreadCount(0);
    };

    const handleDismiss = async (id: string) => {
        await notificationService.dismiss(id);
        setNotifications(prev => prev.filter(n => n.id !== id));
        const n = notifications.find(n => n.id === id);
        decrementTabCount(n);
        if (countsOnBell(n)) applyUnreadCount(unreadCountRef.current - 1);
    };

    const handleDismissAll = async () => {
        await notificationService.dismissAll(userId);
        setNotifications([]);
        setTabCounts(prev => prev ? { mine: 0, watching: 0, responsible: 0, system: 0 } : prev);
        applyUnreadCount(0);
    };

    const handleNotificationClick = async (n: AppNotification) => {
        if (!n.isRead) {
            await handleMarkRead(n.id);
        }

        const target = resolveNotificationPath(n);
        if (target) {
            setIsOpen(false);
            if (/^https?:\/\//i.test(target)) window.open(target, '_blank', 'noopener,noreferrer');
            else navigate(target);
        }
    };

    // Alerts are evaluated on the server every 5 minutes; this only refreshes the list.
    const handleRefresh = async () => {
        setChecking(true);
        try {
            await Promise.all([loadCount(), loadList(), loadTabCounts()]);
        } finally {
            setChecking(false);
        }
    };

    const handleRequestBrowserPermission = async () => {
        if (!('Notification' in window) || !webPushService.isSupported()) return;
        const permission = await webPushService.requestNotificationPermission();
        setBrowserPermission(permission);
        if (permission === 'granted') {
            webPushService.subscribeUserToPush(userId)
                .then(enabled => {
                    setWebPushEnabled(enabled);
                    webPushEnabledRef.current = enabled;
                })
                .catch(err => console.error('Web push subscription error:', err));
        }
    };

    const activeTabConfig = NOTIFICATION_INBOX_TABS.find(tab => tab.id === activeTab) || NOTIFICATION_INBOX_TABS[0];

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

    return (
        <>
            {/* Bell button */}
            <button
                ref={bellRef}
                onClick={toggleOpen}
                className={`relative p-2 rounded-xl transition-all ${isOpen ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600' : 'hover:bg-slate-200/50 dark:hover:bg-slate-700/50'}`}
            >
                <Bell size={18} />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[9px] font-black text-white bg-red-500 rounded-full ring-2 ring-white dark:ring-slate-800 animate-pulse">
                        {unreadLabel}
                    </span>
                )}
            </button>

            {/* Fixed-position Dropdown Panel rendered via Portal to escape any stacking context / backdrop-filter issues */}
            {isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="fixed w-96 max-h-[70vh] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[999999] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                    style={{ top: panelPos.top, left: panelPos.left }}
                >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                                <Bell size={14} className="text-indigo-500" /> Thông báo
                                {unreadCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-500 text-white">{unreadLabel}</span>
                                )}
                            </h3>
                            <div className="flex items-center gap-1">
                                {browserPermission === 'default' && webPushService.isSupported() && (
                                    <button onClick={handleRequestBrowserPermission}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-blue-500" title="Bật thông báo trình duyệt">
                                        <Bell size={12} />
                                    </button>
                                )}
                                <button onClick={handleRefresh} disabled={checking}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-indigo-500" title="Làm mới thông báo" aria-label="Làm mới thông báo">
                                    <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
                                </button>
                                {unreadCount > 0 && (
                                    <button onClick={handleMarkAllRead}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-emerald-500" title="Đánh dấu tất cả đã đọc (mọi tab)" aria-label="Đánh dấu tất cả đã đọc">
                                        <CheckCheck size={12} />
                                    </button>
                                )}
                                {notifications.length > 0 && (
                                    <button onClick={handleDismissAll}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-red-500" title="Xoá tất cả thông báo ở mọi tab" aria-label="Xoá tất cả thông báo ở mọi tab">
                                        <Trash2 size={12} />
                                    </button>
                                )}
                                <button onClick={() => { setIsOpen(false); navigate('/notifications?preferences=1'); }}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-indigo-500" title="Cách nhận thông báo" aria-label="Cách nhận thông báo">
                                    <Settings2 size={12} />
                                </button>
                                <button onClick={() => setIsOpen(false)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-600" title="Đóng">
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                        {/* Inbox tabs: why the notification reached me */}
                        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Lọc thông báo">
                            {NOTIFICATION_INBOX_TABS.map(tab => {
                                const count = tab.id === 'all' ? 0 : tabCounts?.[tab.id] || 0;
                                const selected = activeTab === tab.id;
                                return (
                                    <button key={tab.id} type="button" role="tab" aria-selected={selected}
                                        onClick={() => selectTab(tab.id)}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0 transition-all flex items-center gap-1 ${selected ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                                        {tab.label}
                                        {count > 0 && (
                                            <span className={`min-w-[16px] rounded-full px-1 text-[9px] font-black ${selected ? 'bg-white/25 text-white' : tab.id === 'mine' ? 'bg-red-500 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-200'}`}>
                                                {count > 99 ? '99+' : count}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="flex-1 overflow-y-auto">
                        {listState === 'loading' && notifications.length === 0 ? (
                            <div className="space-y-2 p-4" aria-label="Đang tải thông báo">
                                {[0, 1, 2].map(index => <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-700/50" />)}
                            </div>
                        ) : listState === 'error' ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                                <AlertTriangle size={28} className="text-amber-400 mb-2" />
                                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Không tải được thông báo</p>
                                <button type="button" onClick={loadList}
                                    className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900">
                                    Thử lại
                                </button>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                                <Bell size={32} className="text-slate-200 mb-2" />
                                <p className="text-xs font-bold text-slate-400">Không có thông báo</p>
                                <p className="text-[11px] text-slate-400 mt-1">{activeTabConfig.emptyMessage}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                                {notifications.map(n => {
                                    const severity = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info;
                                    const catCfg = NOTIFICATION_CATEGORIES[n.category as keyof typeof NOTIFICATION_CATEGORIES];
                                    return (
                                        <div
                                            key={n.id}
                                            className={`relative group px-4 py-3 transition-all cursor-pointer border-l-[3px] ${severity.border} ${!n.isRead ? severity.bg : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/20'}`}
                                            onClick={() => handleNotificationClick(n)}
                                        >
                                            <div className="flex items-start gap-2.5">
                                                {/* Icon */}
                                                <div className="mt-0.5 shrink-0">
                                                    {n.icon ? <span className="text-sm">{n.icon}</span> : TYPE_ICONS[n.type]}
                                                </div>
                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className={`text-xs font-bold ${!n.isRead ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                                            {n.title}
                                                        </span>
                                                        {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                                                    </div>
                                                    <VehicleBookingNotificationContent notification={n} />
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {n.deliveryReason && (
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${NOTIFICATION_REASON_TONES[n.deliveryReason]}`}>
                                                                {NOTIFICATION_REASON_LABELS[n.deliveryReason]}
                                                            </span>
                                                        )}
                                                        {catCfg && (
                                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${catCfg.color}`}>
                                                                {catCfg.label}
                                                            </span>
                                                        )}
                                                        <span className="text-[9px] text-slate-300 flex items-center gap-0.5">
                                                            <Clock size={8} /> {timeAgo(n.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* Actions */}
                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    {!n.isRead && (
                                                        <button onClick={e => { e.stopPropagation(); handleMarkRead(n.id); }}
                                                            className="w-6 h-6 rounded-lg hover:bg-white dark:hover:bg-slate-600 flex items-center justify-center text-emerald-400 hover:text-emerald-600" title="Đã đọc">
                                                            <Check size={10} />
                                                        </button>
                                                    )}
                                                    <button onClick={e => { e.stopPropagation(); handleDismiss(n.id); }}
                                                        className="w-6 h-6 rounded-lg hover:bg-white dark:hover:bg-slate-600 flex items-center justify-center text-slate-300 hover:text-red-500" title="Xoá">
                                                        <X size={10} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-100 p-3 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => {
                                setIsOpen(false);
                                navigate('/notifications');
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                        >
                            Xem tất cả thông báo <ExternalLink size={12} />
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
};

export default NotificationCenter;
