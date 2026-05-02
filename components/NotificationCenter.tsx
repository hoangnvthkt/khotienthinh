import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Bell, X, Check, CheckCheck, Trash2, AlertTriangle, Info, CheckCircle2, XCircle,
    RefreshCw, ChevronDown, ExternalLink, Clock
} from 'lucide-react';
import { notificationService, AppNotification, NOTIFICATION_CATEGORIES } from '../lib/notificationService';

interface NotificationCenterProps {
    userId?: string;
}

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

const NotificationCenter: React.FC<NotificationCenterProps> = ({ userId }) => {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const bellRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

    // Load notifications
    const load = useCallback(async () => {
        const [list, count] = await Promise.all([
            notificationService.list(userId),
            notificationService.countUnread(userId),
        ]);
        setNotifications(list);
        setUnreadCount(count);
    }, [userId]);

    useEffect(() => { load(); }, [load]);

    // Realtime subscription
    useEffect(() => {
        const channel = notificationService.subscribe((n) => {
            setNotifications(prev => [n, ...prev]);
            if (!n.isRead) setUnreadCount(c => c + 1);

            // Browser Push Notification — show when tab not focused
            if (!document.hasFocus() && Notification.permission === 'granted') {
                const browserNotif = new Notification(n.title, {
                    body: n.message,
                    icon: '/vite.svg',
                    tag: n.id, // dedup
                    silent: n.severity !== 'critical',
                });
                browserNotif.onclick = () => {
                    window.focus();
                    if (n.link) window.location.hash = n.link;
                    browserNotif.close();
                };
            }

            // Sound for urgent/critical notifications
            if (n.severity === 'critical') {
                try {
                    const audio = new Audio('data:audio/wav;base64,UklGRl9vT19teleQBJAGNkYXRh');
                    // Fallback: use system beep via AudioContext
                    const ctx = new AudioContext();
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = 800;
                    gain.gain.value = 0.1;
                    osc.start();
                    setTimeout(() => { osc.stop(); ctx.close(); }, 200);
                } catch {
                    // Audio not available
                }
            }
        }, userId);
        return () => { notificationService.unsubscribe(channel); };
    }, [userId]);

    // Request browser notification permission
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            // Don't immediately prompt — wait for user interaction
            const requestOnInteraction = () => {
                Notification.requestPermission();
                document.removeEventListener('click', requestOnInteraction);
            };
            document.addEventListener('click', requestOnInteraction);
            return () => document.removeEventListener('click', requestOnInteraction);
        }
    }, []);

    // Auto-check alerts on mount + every 5 minutes
    useEffect(() => {
        notificationService.runAlertChecks().then((count) => {
            if (count > 0) load();
        });
        const interval = setInterval(() => {
            notificationService.runAlertChecks().then((count) => {
                if (count > 0) load();
            });
        }, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [load]);

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
    const toggleOpen = () => {
        if (!isOpen && bellRef.current) {
            const rect = bellRef.current.getBoundingClientRect();
            // Position panel below bell, aligned to bell's left edge
            // If too close to right edge, shift left
            const panelWidth = 384; // w-96 = 24rem = 384px
            let left = rect.left;
            if (left + panelWidth > window.innerWidth - 16) {
                left = window.innerWidth - panelWidth - 16;
            }
            if (left < 8) left = 8;
            setPanelPos({ top: rect.bottom + 8, left });
        }
        setIsOpen(!isOpen);
    };

    const handleMarkRead = async (id: string) => {
        await notificationService.markRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        setUnreadCount(c => Math.max(0, c - 1));
    };

    const handleMarkAllRead = async () => {
        await notificationService.markAllRead(userId);
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setUnreadCount(0);
    };

    const handleDismiss = async (id: string) => {
        await notificationService.dismiss(id);
        setNotifications(prev => prev.filter(n => n.id !== id));
        const n = notifications.find(n => n.id === id);
        if (n && !n.isRead) setUnreadCount(c => Math.max(0, c - 1));
    };

    const handleDismissAll = async () => {
        await notificationService.dismissAll(userId);
        setNotifications([]);
        setUnreadCount(0);
    };

    const handleRunChecks = async () => {
        setChecking(true);
        const count = await notificationService.runAlertChecks();
        await load();
        setChecking(false);
    };

    const filtered = filterCategory === 'all'
        ? notifications
        : notifications.filter(n => n.category === filterCategory);

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
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Fixed-position Dropdown Panel (portal-like) */}
            {isOpen && (
                <div
                    ref={panelRef}
                    className="fixed w-96 max-h-[70vh] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[9999] flex flex-col overflow-hidden"
                    style={{ top: panelPos.top, left: panelPos.left }}
                >
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 shrink-0">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-black text-sm text-slate-800 dark:text-white flex items-center gap-2">
                                <Bell size={14} className="text-indigo-500" /> Thông báo
                                {unreadCount > 0 && (
                                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-red-500 text-white">{unreadCount}</span>
                                )}
                            </h3>
                            <div className="flex items-center gap-1">
                                <button onClick={handleRunChecks} disabled={checking}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-indigo-500" title="Kiểm tra cảnh báo">
                                    <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
                                </button>
                                {unreadCount > 0 && (
                                    <button onClick={handleMarkAllRead}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-emerald-500" title="Đánh dấu tất cả đã đọc">
                                        <CheckCheck size={12} />
                                    </button>
                                )}
                                {notifications.length > 0 && (
                                    <button onClick={handleDismissAll}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-red-500" title="Xoá tất cả">
                                        <Trash2 size={12} />
                                    </button>
                                )}
                                <button onClick={() => setIsOpen(false)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-600" title="Đóng">
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                        {/* Category filter chips */}
                        <div className="flex gap-1 overflow-x-auto pb-1">
                            <button onClick={() => setFilterCategory('all')}
                                className={`px-2 py-1 rounded-lg text-[9px] font-bold shrink-0 transition-all ${filterCategory === 'all' ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                                Tất cả
                            </button>
                            {Object.entries(NOTIFICATION_CATEGORIES).map(([key, cat]) => {
                                const count = notifications.filter(n => n.category === key).length;
                                if (count === 0) return null;
                                return (
                                    <button key={key} onClick={() => setFilterCategory(key)}
                                        className={`px-2 py-1 rounded-lg text-[9px] font-bold shrink-0 transition-all flex items-center gap-1 ${filterCategory === key ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                                        {cat.icon} {cat.label} <span className="opacity-60">({count})</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <Bell size={32} className="text-slate-200 mb-2" />
                                <p className="text-xs font-bold text-slate-300">Không có thông báo</p>
                                <p className="text-[10px] text-slate-300 mt-1">Hệ thống sẽ tự động kiểm tra cảnh báo</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                                {filtered.map(n => {
                                    const severity = SEVERITY_STYLES[n.severity] || SEVERITY_STYLES.info;
                                    const catCfg = NOTIFICATION_CATEGORIES[n.category as keyof typeof NOTIFICATION_CATEGORIES];
                                    return (
                                        <div
                                            key={n.id}
                                            className={`relative group px-4 py-3 transition-all cursor-pointer border-l-[3px] ${severity.border} ${!n.isRead ? severity.bg : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/20'}`}
                                            onClick={() => !n.isRead && handleMarkRead(n.id)}
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
                                                    <p className={`text-[10px] leading-relaxed ${!n.isRead ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                                        {n.message}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
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
                </div>
            )}
        </>
    );
};

export default NotificationCenter;
