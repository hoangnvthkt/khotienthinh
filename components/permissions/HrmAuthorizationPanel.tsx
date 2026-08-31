import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  getUserHrmAuthorization,
  previewUserHrmBusinessRole,
  setUserHrmBusinessRole,
  type HrmAuthorizationSummary,
  type HrmBusinessRolePreview,
  type HrmBusinessRoleTarget,
} from '../../lib/hrmAuthorizationService';

export type HrmAuthorizationPanelTab = 'overview' | 'business_role' | 'effective' | 'history';

interface HrmAuthorizationPanelViewProps {
  currentUserId: string;
  targetUserId: string;
  summary: HrmAuthorizationSummary | null;
  selectedRole: HrmBusinessRoleTarget;
  expiresAt: string;
  reason: string;
  preview: HrmBusinessRolePreview | null;
  activeTab: HrmAuthorizationPanelTab;
  isLoading: boolean;
  isApplying: boolean;
  error: string | null;
  selfWarningAccepted?: boolean;
  onTabChange(tab: HrmAuthorizationPanelTab): void;
  onRoleChange(role: HrmBusinessRoleTarget): void;
  onExpiresAtChange(value: string): void;
  onReasonChange(value: string): void;
  onSelfWarningAcceptedChange?(accepted: boolean): void;
  onPreview(): void;
  onApply(): void;
}

const tabs: Array<{ key: HrmAuthorizationPanelTab; label: string; icon: React.ElementType }> = [
  { key: 'overview', label: 'Tổng quan', icon: UserCog },
  { key: 'business_role', label: 'Vai trò nghiệp vụ', icon: ShieldCheck },
  { key: 'effective', label: 'Quyền hiệu lực', icon: CheckCircle2 },
  { key: 'history', label: 'Lịch sử', icon: History },
];

const roleLabel = (role: HrmBusinessRoleTarget | null) => {
  if (role === 'HR_MANAGE') return 'HR Manage';
  if (role === 'HR') return 'HR';
  return 'Không có';
};

export const HrmAuthorizationPanelView: React.FC<HrmAuthorizationPanelViewProps> = ({
  currentUserId,
  targetUserId,
  summary,
  selectedRole,
  expiresAt,
  reason,
  preview,
  activeTab,
  isLoading,
  isApplying,
  error,
  selfWarningAccepted = false,
  onTabChange,
  onRoleChange,
  onExpiresAtChange,
  onReasonChange,
  onSelfWarningAcceptedChange = () => undefined,
  onPreview,
  onApply,
}) => {
  const isSelfAdmin = currentUserId === targetUserId && summary?.systemRole === 'ADMIN';
  const hasSelfGrantWarning = Boolean(preview?.warnings.some(warning => warning.ruleCode === 'HRM_ADMIN_SELF_GRANT'));
  const canApply = Boolean(
    preview
    && reason.trim().length >= 10
    && preview.hardDenies.length === 0
    && (!hasSelfGrantWarning || selfWarningAccepted)
    && !isApplying
  );

  if (isLoading) {
    return <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" /> Đang tải cấu hình quyền HRM…</div>;
  }

  if (!summary) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error || 'Không thể tải cấu hình quyền HRM.'}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 lg:grid-cols-4">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-bold transition ${activeTab === key ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</div>}

      {activeTab === 'overview' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Vai trò hệ thống</p>
            <p className="mt-1 text-sm font-black text-slate-800">{summary.systemRole === 'ADMIN' ? 'System Admin' : summary.systemRole}</p>
            <p className="mt-1 text-[11px] text-slate-500">Độc lập với quyền nghiệp vụ HR.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Template HR</p>
            <p className="mt-1 text-sm font-black text-teal-700">{roleLabel(summary.hrRole)}</p>
            <p className="mt-1 text-[11px] text-slate-500">{summary.expiresAt ? `Hết hạn ${new Date(summary.expiresAt).toLocaleString('vi-VN')}` : 'Không đặt ngày hết hạn'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              <p className="text-xs font-black text-slate-800">Quản lý trực tiếp</p>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {summary.isDirectManager ? `Có · ${summary.directReportCount} nhân sự` : 'Không'}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">Suy ra từ manager slot và primary assignment; không gán thủ công.</p>
          </div>
        </div>
      )}

      {activeTab === 'business_role' && (
        <div className="space-y-4">
          {isSelfAdmin && (
            <button
              type="button"
              onClick={() => onRoleChange(summary.hrRole === 'HR_MANAGE' ? 'NONE' : 'HR_MANAGE')}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs font-black text-amber-800 hover:bg-amber-100"
            >
              {summary.hrRole === 'HR_MANAGE' ? 'Thu hồi HR Manage của tôi' : 'Cấp HR Manage cho tôi'}
            </button>
          )}

          <fieldset className="space-y-2">
            <legend className="text-xs font-black text-slate-700">Template HR</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['NONE', 'HR', 'HR_MANAGE'] as const).map(role => (
                <label key={role} className={`cursor-pointer rounded-xl border p-3 text-center text-xs font-bold ${selectedRole === role ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600'}`}>
                  <input className="sr-only" type="radio" checked={selectedRole === role} onChange={() => onRoleChange(role)} />
                  {roleLabel(role)}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-bold text-slate-700">
            Ngày hết hạn (tùy chọn)
            <input type="datetime-local" value={expiresAt} onChange={event => onExpiresAtChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-teal-500" />
          </label>
          <label className="block text-xs font-bold text-slate-700">
            Lý do thay đổi
            <textarea value={reason} onChange={event => onReasonChange(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-teal-500" placeholder="Bắt buộc, tối thiểu 10 ký tự" />
          </label>

          <button type="button" onClick={onPreview} className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50">Xem trước thay đổi</button>

          {preview && (
            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs">
              <div className="flex justify-between gap-3 font-bold text-slate-700"><span>Thêm {preview.added.length} quyền</span><span>Gỡ {preview.removed.length} quyền</span></div>
              <div className="flex flex-wrap gap-2 text-[10px] font-black">
                <span className={`rounded-full px-2 py-1 ${preview.opensC3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-500'}`}>C3 {preview.opensC3 ? 'mở' : 'đóng'}</span>
                <span className={`rounded-full px-2 py-1 ${preview.opensC4 ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-500'}`}>C4 {preview.opensC4 ? 'mở' : 'đóng'}</span>
                {preview.allowsSensitiveExport && <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">Sensitive export</span>}
              </div>
              {preview.warnings.map((warning, index) => (
                <div key={`${warning.ruleCode || 'warning'}-${index}`} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{String(warning.message || warning.ruleCode || 'Cảnh báo phân quyền')}</span></div>
              ))}
              {hasSelfGrantWarning && (
                <label className="flex items-start gap-2 font-semibold text-slate-700">
                  <input type="checkbox" checked={selfWarningAccepted} onChange={event => onSelfWarningAcceptedChange(event.target.checked)} className="mt-0.5" />
                  Tôi xác nhận đang tự mở quyền xem và quản lý toàn bộ dữ liệu HR nhạy cảm.
                </label>
              )}
              <button type="button" disabled={!canApply} onClick={onApply} className="w-full rounded-xl bg-teal-600 px-4 py-2.5 font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{isApplying ? 'Đang áp dụng…' : 'Áp dụng quyền'}</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'effective' && (
        <div className="space-y-2">
          {summary.effectivePermissions.length === 0 ? <p className="text-xs text-slate-500">Không có quyền HR hiệu lực.</p> : summary.effectivePermissions.map((permission, index) => (
            <div key={`${permission.permissionCode}-${permission.scopeType}-${permission.scopeId}-${index}`} className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-black text-slate-800">{permission.permissionCode}</p>
              <p className="mt-1 text-[10px] text-slate-500">{permission.scopeType}/{permission.scopeId} · {permission.sourceLabel || permission.sourceCode || permission.sourceType}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-2">
          {summary.history.length === 0 ? <p className="text-xs text-slate-500">Chưa có lịch sử thay đổi HR role.</p> : summary.history.map(event => (
            <div key={event.id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div><p className="text-xs font-black text-slate-800">{event.eventType}</p><p className="mt-1 text-[10px] text-slate-500">{new Date(event.createdAt).toLocaleString('vi-VN')}</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface HrmAuthorizationPanelProps {
  currentUserId: string;
  targetUserId: string;
}

const HrmAuthorizationPanel: React.FC<HrmAuthorizationPanelProps> = ({ currentUserId, targetUserId }) => {
  const { refreshProfile } = useAuth();
  const [summary, setSummary] = useState<HrmAuthorizationSummary | null>(null);
  const [selectedRole, setSelectedRole] = useState<HrmBusinessRoleTarget>('NONE');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<HrmBusinessRolePreview | null>(null);
  const [activeTab, setActiveTab] = useState<HrmAuthorizationPanelTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfWarningAccepted, setSelfWarningAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getUserHrmAuthorization(targetUserId)
      .then(result => {
        if (cancelled) return;
        setSummary(result);
        setSelectedRole(result.hrRole || 'NONE');
        setExpiresAt(result.expiresAt ? result.expiresAt.slice(0, 16) : '');
        setPreview(null);
        setSelfWarningAccepted(false);
      })
      .catch(cause => !cancelled && setError(cause instanceof Error ? cause.message : 'Không thể tải quyền HRM.'))
      .finally(() => !cancelled && setIsLoading(false));
    return () => { cancelled = true; };
  }, [targetUserId]);

  const normalizedExpiry = useMemo(() => expiresAt ? new Date(expiresAt).toISOString() : null, [expiresAt]);

  const handleRoleChange = (role: HrmBusinessRoleTarget) => {
    setSelectedRole(role);
    setPreview(null);
    setSelfWarningAccepted(false);
  };

  const handlePreview = async () => {
    setError(null);
    try {
      setPreview(await previewUserHrmBusinessRole(targetUserId, selectedRole, normalizedExpiry));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xem trước thay đổi.');
    }
  };

  const handleApply = async () => {
    if (!summary || !preview) return;
    setIsApplying(true);
    setError(null);
    try {
      const result = await setUserHrmBusinessRole({
        targetUserId,
        targetRoleCode: selectedRole,
        expiresAt: normalizedExpiry,
        reason,
        warningAcceptances: selfWarningAccepted ? [{ ruleCode: 'HRM_ADMIN_SELF_GRANT', accepted: true }] : [],
        expectedFingerprint: preview.fingerprint,
      });
      setSummary(result);
      setSelectedRole(result.hrRole || 'NONE');
      setPreview(null);
      setReason('');
      setSelfWarningAccepted(false);
      if (targetUserId === currentUserId) await refreshProfile();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể áp dụng quyền HRM.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <HrmAuthorizationPanelView
      currentUserId={currentUserId}
      targetUserId={targetUserId}
      summary={summary}
      selectedRole={selectedRole}
      expiresAt={expiresAt}
      reason={reason}
      preview={preview}
      activeTab={activeTab}
      isLoading={isLoading}
      isApplying={isApplying}
      error={error}
      selfWarningAccepted={selfWarningAccepted}
      onTabChange={setActiveTab}
      onRoleChange={handleRoleChange}
      onExpiresAtChange={value => { setExpiresAt(value); setPreview(null); }}
      onReasonChange={setReason}
      onSelfWarningAcceptedChange={setSelfWarningAccepted}
      onPreview={handlePreview}
      onApply={handleApply}
    />
  );
};

export default HrmAuthorizationPanel;
