import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  History,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Role, type User } from '../../types';
import {
  notificationAlertRuleService,
  type AlertHistoryItem,
  type AlertRecipientConfig,
  type AlertRecipientMode,
  type AlertRuleKey,
  type NotificationAlertRule,
} from '../../lib/notificationAlertRules';
import {
  PROJECT_PERMISSION_LABELS,
  type ProjectPermissionCode,
} from '../../lib/projectStaffService';
import { notificationService } from '../../lib/notificationService';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';

interface SettingsAlertsProps {
  users: User[];
  currentUserId: string;
}

const RECIPIENT_MODES: Array<{ value: AlertRecipientMode; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'module_admins', label: 'Quản trị module' },
  { value: 'project_permission', label: 'Nhân sự dự án theo quyền' },
  { value: 'employee_owner', label: 'Nhân sự liên quan' },
  { value: 'roles', label: 'Theo vai trò' },
  { value: 'users', label: 'Người nhận cụ thể' },
  { value: 'broadcast', label: 'Broadcast global' },
];

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.WAREHOUSE_KEEPER]: 'Thủ kho',
  [Role.EMPLOYEE]: 'Nhân viên',
};

const PROJECT_PERMISSION_CODES: ProjectPermissionCode[] = [
  'view',
  'edit',
  'submit',
  'verify',
  'confirm',
  'approve',
];

const getRuleTone = (category: string) => {
  if (category === 'safety') return 'border-red-100 bg-red-50 text-red-700';
  if (category === 'payment') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (category === 'budget') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (category === 'attendance') return 'border-teal-100 bg-teal-50 text-teal-700';
  if (category === 'hrm') return 'border-indigo-100 bg-indigo-50 text-indigo-700';
  return 'border-slate-100 bg-slate-50 text-slate-700';
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const parseCsv = (value: string) =>
  value.split(',').map(item => item.trim().toUpperCase()).filter(Boolean);

const toggleValue = <T,>(values: T[] | undefined, value: T): T[] => {
  const current = values || [];
  return current.includes(value)
    ? current.filter(item => item !== value)
    : [...current, value];
};

const cloneRecipientConfig = (config: AlertRecipientConfig): AlertRecipientConfig => ({
  ...config,
  roles: [...(config.roles || [])],
  moduleKeys: [...(config.moduleKeys || [])],
  userIds: [...(config.userIds || [])],
  projectPermissionCodes: [...(config.projectPermissionCodes || [])],
});

const SettingsAlerts: React.FC<SettingsAlertsProps> = ({ users, currentUserId }) => {
  const toast = useToast();
  const [rules, setRules] = useState<NotificationAlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<AlertRuleKey | null>(null);
  const [running, setRunning] = useState(false);

  const activeUsers = useMemo(
    () => [...users]
      .filter(user => user.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [users],
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [ruleRows, historyRows] = await Promise.all([
        notificationAlertRuleService.list(),
        notificationAlertRuleService.listHistory(50),
      ]);
      setRules(ruleRows.map(rule => ({
        ...rule,
        thresholds: { ...(rule.thresholds || {}) },
        recipientConfig: cloneRecipientConfig(rule.recipientConfig),
        channels: { ...rule.channels },
      })));
      setHistory(historyRows);
    } catch (error: any) {
      logApiError('settings.alerts.load', error);
      toast.error('Không tải được cảnh báo', getApiErrorMessage(error, 'Không thể tải cấu hình cảnh báo.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const patchRule = (alertKey: AlertRuleKey, patch: Partial<NotificationAlertRule>) => {
    setRules(prev => prev.map(rule => rule.alertKey === alertKey ? { ...rule, ...patch } : rule));
  };

  const patchRecipient = (alertKey: AlertRuleKey, patch: Partial<AlertRecipientConfig>) => {
    setRules(prev => prev.map(rule => {
      if (rule.alertKey !== alertKey) return rule;
      return {
        ...rule,
        recipientConfig: {
          ...rule.recipientConfig,
          ...patch,
        },
      };
    }));
  };

  const patchThreshold = (alertKey: AlertRuleKey, key: string, value: string) => {
    const nextValue = Number(value);
    setRules(prev => prev.map(rule => {
      if (rule.alertKey !== alertKey) return rule;
      return {
        ...rule,
        thresholds: {
          ...(rule.thresholds || {}),
          [key]: Number.isFinite(nextValue) ? nextValue : 0,
        },
      };
    }));
  };

  const saveRule = async (rule: NotificationAlertRule) => {
    setSavingKey(rule.alertKey);
    try {
      await notificationAlertRuleService.update(rule, currentUserId);
      toast.success('Đã lưu cảnh báo', rule.label);
      await loadData();
    } catch (error: any) {
      logApiError('settings.alerts.save', error);
      toast.error('Không lưu được cảnh báo', getApiErrorMessage(error, 'Không thể cập nhật rule cảnh báo.'));
    } finally {
      setSavingKey(null);
    }
  };

  const runChecksNow = async () => {
    setRunning(true);
    try {
      const count = await notificationService.runAlertChecks({ force: true });
      toast.success('Đã chạy kiểm tra cảnh báo', `Đã tạo ${count} thông báo theo các rule đang bật.`);
      const historyRows = await notificationAlertRuleService.listHistory(50);
      setHistory(historyRows);
    } catch (error: any) {
      logApiError('settings.alerts.runNow', error);
      toast.error('Không chạy được cảnh báo', getApiErrorMessage(error, 'Không thể chạy kiểm tra cảnh báo.'));
    } finally {
      setRunning(false);
    }
  };

  const renderRecipientControls = (rule: NotificationAlertRule) => {
    const config = rule.recipientConfig || { mode: 'admin', fallbackToAdmin: true };

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nhóm nhận</span>
            <select
              value={config.mode}
              onChange={event => patchRecipient(rule.alertKey, { mode: event.target.value as AlertRecipientMode })}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
            >
              {RECIPIENT_MODES.map(mode => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={config.includeAdmins !== false}
              onChange={event => patchRecipient(rule.alertKey, { includeAdmins: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
              disabled={config.mode === 'admin' || config.mode === 'module_admins' || config.mode === 'employee_owner'}
            />
            <span className="text-xs font-black text-slate-600">Kèm Admin</span>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={config.fallbackToAdmin !== false}
              onChange={event => patchRecipient(rule.alertKey, { fallbackToAdmin: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            <span className="text-xs font-black text-slate-600">Không có người nhận thì gửi Admin</span>
          </label>
        </div>

        {config.mode === 'roles' && (
          <div className="flex flex-wrap gap-2">
            {(Object.values(Role) as Role[]).map(role => (
              <label key={role} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={(config.roles || []).includes(role)}
                  onChange={() => patchRecipient(rule.alertKey, { roles: toggleValue(config.roles, role) })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {ROLE_LABELS[role]}
              </label>
            ))}
          </div>
        )}

        {config.mode === 'module_admins' && (
          <label className="space-y-1 block">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Module key</span>
            <input
              value={(config.moduleKeys || []).join(', ')}
              onChange={event => patchRecipient(rule.alertKey, { moduleKeys: parseCsv(event.target.value) })}
              placeholder="HRM, RQ, DA"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
            />
          </label>
        )}

        {config.mode === 'project_permission' && (
          <div className="flex flex-wrap gap-2">
            {PROJECT_PERMISSION_CODES.map(code => (
              <label key={code} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={(config.projectPermissionCodes || []).includes(code)}
                  onChange={() => patchRecipient(rule.alertKey, {
                    projectPermissionCodes: toggleValue(config.projectPermissionCodes, code),
                  })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {PROJECT_PERMISSION_LABELS[code]}
              </label>
            ))}
          </div>
        )}

        {config.mode === 'users' && (
          <select
            multiple
            value={config.userIds || []}
            onChange={event => patchRecipient(rule.alertKey, {
              userIds: Array.from(event.target.selectedOptions).map(option => option.value),
            })}
            className="h-36 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
          >
            {activeUsers.map(user => (
              <option key={user.id} value={user.id}>
                {user.name} - {user.email}
              </option>
            ))}
          </select>
        )}

        {config.mode === 'employee_owner' && (
          <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs font-bold text-teal-700">
            Rule này gửi cho tài khoản liên kết với nhân sự phát sinh cảnh báo.
          </div>
        )}

        {config.mode === 'broadcast' && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-bold text-red-700 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Broadcast sẽ tạo notification global. Chỉ dùng khi thật sự muốn toàn bộ user đều thấy.
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 size={22} className="mr-3 animate-spin" />
        <span className="text-sm font-bold">Đang tải cấu hình cảnh báo...</span>
      </div>
    );
  }

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 space-y-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <BellRing size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Cảnh báo global</h2>
              <p className="text-xs font-bold text-slate-500">
                {rules.filter(rule => rule.isEnabled).length}/{rules.length} rule đang bật
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw size={15} /> Tải lại
            </button>
            <button
              type="button"
              onClick={runChecksNow}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 disabled:opacity-50"
            >
              {running ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              Chạy kiểm tra ngay
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-4">
          {rules.map(rule => (
            <div key={rule.alertKey} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${getRuleTone(rule.category)}`}>
                      {rule.category}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                      {rule.alertKey}
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-black text-slate-800">{rule.label}</h3>
                  {rule.description && <p className="mt-1 text-sm font-medium text-slate-500">{rule.description}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black ${rule.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    <input
                      type="checkbox"
                      checked={rule.isEnabled}
                      onChange={event => patchRule(rule.alertKey, { isEnabled: event.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                    />
                    {rule.isEnabled ? 'Đang bật' : 'Đang tắt'}
                  </label>
                  <button
                    type="button"
                    onClick={() => saveRule(rule)}
                    disabled={savingKey === rule.alertKey}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingKey === rule.alertKey ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Lưu
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cooldown phút</span>
                  <input
                    type="number"
                    min={0}
                    value={rule.cooldownMinutes}
                    onChange={event => patchRule(rule.alertKey, { cooldownMinutes: Math.max(0, Number(event.target.value || 0)) })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={rule.channels.inApp !== false}
                    onChange={event => patchRule(rule.alertKey, { channels: { ...rule.channels, inApp: event.target.checked } })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span className="text-xs font-black text-slate-600">In-app</span>
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={rule.channels.webPush !== false}
                    onChange={event => patchRule(rule.alertKey, { channels: { ...rule.channels, webPush: event.target.checked } })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span className="text-xs font-black text-slate-600">Web push</span>
                </label>
              </div>

              {Object.keys(rule.thresholds || {}).length > 0 && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {Object.entries(rule.thresholds || {}).map(([key, value]) => (
                    <label key={key} className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{key}</span>
                      <input
                        type="number"
                        value={value}
                        onChange={event => patchThreshold(rule.alertKey, key, event.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
                  <Users size={14} /> Người nhận
                </div>
                {renderRecipientControls(rule)}
              </div>
            </div>
          ))}
        </div>

        <aside className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:self-start">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800 flex items-center gap-2">
                <History size={16} className="text-slate-400" /> Lịch sử alert
              </h3>
              <p className="text-[11px] font-bold text-slate-400">50 bản ghi gần nhất</p>
            </div>
            <Check size={16} className="text-emerald-500" />
          </div>

          <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm font-bold text-slate-400">
                Chưa có alert nào.
              </div>
            ) : history.map(item => {
              const alertKey = item.metadata?.alertKey || 'legacy_global';
              return (
                <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap gap-1">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
                          {alertKey}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${item.userId ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {item.userId ? 'user-specific' : 'global cũ'}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-xs font-black text-slate-800">{item.title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] font-medium text-slate-500">{item.message}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-black text-slate-400">{formatDateTime(item.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default SettingsAlerts;
