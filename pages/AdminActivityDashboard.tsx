import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity, Bell, CheckCircle2, Clock, MonitorSmartphone, RefreshCw,
  RotateCw, Search, ShieldAlert, Smartphone, Users, Wifi, XCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import {
  NotificationDelivery,
  PushSubscriptionAdminRow,
  UserSession,
  UserSessionStatus,
  userActivityService,
} from '../lib/userActivityService';

type ViewTab = 'sessions' | 'push';
type DeliveryFilter = NotificationDelivery['status'] | 'all';
type SessionFilter = UserSessionStatus | 'all';

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('vi-VN');
};

const formatDuration = (seconds: number) => {
  if (!seconds) return '0 phút';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} giờ ${m} phút`;
  return `${m} phút`;
};

const statusStyle: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  logout: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  timeout: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  sent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
  skipped: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
  pending: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
};

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: string;
}> = ({ icon, label, value, tone = 'text-slate-700 dark:text-slate-200' }) => (
  <div className="glass-card p-4 rounded-xl">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="text-slate-400">{icon}</div>
    </div>
    <p className={`text-2xl font-black mt-2 ${tone}`}>{value}</p>
  </div>
);

const AdminActivityDashboard: React.FC = () => {
  const { user } = useApp();
  const [tab, setTab] = useState<ViewTab>('sessions');
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionAdminRow[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await userActivityService.timeoutStaleSessions(5).catch(err => {
        console.warn('Timeout stale sessions failed:', err);
      });
      const [sessionRows, subscriptionRows, deliveryRows] = await Promise.all([
        userActivityService.listSessions({ status: sessionFilter, limit: 300 }),
        userActivityService.listPushSubscriptions({ limit: 300 }),
        userActivityService.listDeliveries({ status: deliveryFilter, channel: 'web_push', limit: 300 }),
      ]);
      setSessions(sessionRows);
      setSubscriptions(subscriptionRows);
      setDeliveries(deliveryRows);
    } catch (err: any) {
      setError(err?.message || 'Không tải được dữ liệu giám sát.');
    } finally {
      setLoading(false);
    }
  }, [deliveryFilter, sessionFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = useMemo(() => userActivityService.buildSummary(sessions, subscriptions, deliveries), [deliveries, sessions, subscriptions]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!normalizedSearch) return sessions;
    return sessions.filter(session =>
      session.user?.name?.toLowerCase().includes(normalizedSearch) ||
      session.user?.email?.toLowerCase().includes(normalizedSearch) ||
      session.platform?.toLowerCase().includes(normalizedSearch) ||
      session.deviceType?.toLowerCase().includes(normalizedSearch)
    );
  }, [normalizedSearch, sessions]);

  const filteredDeliveries = useMemo(() => {
    if (!normalizedSearch) return deliveries;
    return deliveries.filter(delivery =>
      delivery.user?.name?.toLowerCase().includes(normalizedSearch) ||
      delivery.user?.email?.toLowerCase().includes(normalizedSearch) ||
      delivery.notification?.title?.toLowerCase().includes(normalizedSearch) ||
      delivery.errorMessage?.toLowerCase().includes(normalizedSearch) ||
      delivery.subscription?.platform?.toLowerCase().includes(normalizedSearch)
    );
  }, [deliveries, normalizedSearch]);

  const retryDelivery = async (delivery: NotificationDelivery) => {
    if (!delivery.notificationId) return;
    setRetryingId(delivery.id);
    try {
      await userActivityService.retryWebPush(delivery.notificationId, delivery.subscriptionId);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Retry Web Push thất bại.');
    } finally {
      setRetryingId(null);
    }
  };

  if (user.role !== Role.ADMIN) return <Navigate to="/" replace />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <Activity className="text-cyan-500" size={24} /> Hoạt động hệ thống
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Online user, phiên đăng nhập và Web Push delivery
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
            <button onClick={() => setTab('sessions')} className={`px-3 py-2 rounded-lg text-xs font-black transition ${tab === 'sessions' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
              <Users size={14} className="inline mr-1.5" /> User
            </button>
            <button onClick={() => setTab('push')} className={`px-3 py-2 rounded-lg text-xs font-black transition ${tab === 'push' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>
              <Bell size={14} className="inline mr-1.5" /> Web Push
            </button>
          </div>
          <button onClick={loadData} disabled={loading} className="px-3 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black flex items-center gap-1.5 disabled:opacity-60">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatTile icon={<Wifi size={18} />} label="Đang online" value={summary.onlineUsers} tone="text-emerald-600" />
        <StatTile icon={<Clock size={18} />} label="Phiên active" value={summary.activeSessions} />
        <StatTile icon={<Users size={18} />} label="Login hôm nay" value={summary.todayLogins} tone="text-blue-600" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Logout hôm nay" value={summary.todayLogouts} />
        <StatTile icon={<MonitorSmartphone size={18} />} label="Push devices" value={summary.pushActiveDevices} tone="text-cyan-600" />
        <StatTile icon={<XCircle size={18} />} label="Push lỗi hôm nay" value={summary.pushFailedToday} tone="text-red-600" />
      </div>

      <div className="glass-card p-4 rounded-xl flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="relative max-w-md w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Tìm user, thiết bị, notification..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold outline-none focus:border-cyan-400"
          />
        </div>
        {tab === 'sessions' ? (
          <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value as SessionFilter)} className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold">
            <option value="all">Tất cả session</option>
            <option value="active">Active</option>
            <option value="logout">Logout</option>
            <option value="timeout">Timeout</option>
          </select>
        ) : (
          <select value={deliveryFilter} onChange={e => setDeliveryFilter(e.target.value as DeliveryFilter)} className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bold">
            <option value="all">Tất cả delivery</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
            <option value="pending">Pending</option>
          </select>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm font-bold flex items-center gap-2">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      {tab === 'sessions' ? (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Trạng thái</th>
                  <th className="text-left px-4 py-3">Thiết bị</th>
                  <th className="text-left px-4 py-3">Login</th>
                  <th className="text-left px-4 py-3">Last seen</th>
                  <th className="text-right px-4 py-3">Online</th>
                  <th className="text-right px-4 py-3">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSessions.map(session => (
                  <tr key={session.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-800 dark:text-white">{session.user?.name || session.userId}</p>
                      <p className="text-xs text-slate-400">{session.user?.email || session.userId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-black uppercase ${statusStyle[session.status] || statusStyle.pending}`}>
                        {session.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 font-bold">
                        <Smartphone size={15} /> {session.platform || 'unknown'} / {session.deviceType || 'device'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(session.loginAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(session.lastSeenAt)}</td>
                    <td className="px-4 py-3 text-right font-black text-slate-700 dark:text-slate-200">{formatDuration(session.durationSeconds)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/audit-trail?userId=${session.userId}`} className="text-cyan-600 dark:text-cyan-300 text-xs font-black hover:underline">
                        Xem log
                      </Link>
                    </td>
                  </tr>
                ))}
                {!loading && filteredSessions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-bold">Không có dữ liệu session</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-3">Notification</th>
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Device</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Lỗi</th>
                    <th className="text-right px-4 py-3">Thời gian</th>
                    <th className="text-right px-4 py-3">Retry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredDeliveries.map(delivery => (
                    <tr key={delivery.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 min-w-[220px]">
                        <p className="font-black text-slate-800 dark:text-white">{delivery.notification?.title || delivery.notificationId || '-'}</p>
                        <p className="text-xs text-slate-400 line-clamp-1">{delivery.notification?.message || delivery.notificationId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-700 dark:text-slate-200">{delivery.user?.name || delivery.userId || '-'}</p>
                        <p className="text-xs text-slate-400">{delivery.user?.email || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {delivery.subscription?.platform || '-'} / {delivery.subscription?.deviceType || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-black uppercase ${statusStyle[delivery.status] || statusStyle.pending}`}>
                          {delivery.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[260px] truncate text-xs text-slate-500">{delivery.errorMessage || '-'}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{formatDateTime(delivery.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => retryDelivery(delivery)}
                          disabled={!delivery.notificationId || retryingId === delivery.id}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300 disabled:opacity-40"
                          title="Gửi lại Web Push"
                        >
                          <RotateCw size={14} className={retryingId === delivery.id ? 'animate-spin' : ''} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && filteredDeliveries.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-bold">Không có delivery log</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <MonitorSmartphone size={17} className="text-cyan-500" />
              <h2 className="font-black text-slate-800 dark:text-white">Thiết bị Web Push</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-[10px] uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-3">User</th>
                    <th className="text-left px-4 py-3">Platform</th>
                    <th className="text-left px-4 py-3">Active</th>
                    <th className="text-left px-4 py-3">Last used</th>
                    <th className="text-left px-4 py-3">Endpoint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {subscriptions.slice(0, 80).map(sub => (
                    <tr key={sub.id}>
                      <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{sub.user?.name || sub.userId}</td>
                      <td className="px-4 py-3 text-slate-500">{sub.platform || '-'} / {sub.deviceType || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 rounded-lg text-[10px] font-black uppercase ${sub.isActive ? statusStyle.sent : statusStyle.failed}`}>
                          {sub.isActive ? 'active' : 'off'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(sub.lastUsedAt || sub.lastSeenAt)}</td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-[420px] truncate">{sub.endpoint}</td>
                    </tr>
                  ))}
                  {!loading && subscriptions.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 font-bold">Chưa có thiết bị đăng ký push</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminActivityDashboard;
