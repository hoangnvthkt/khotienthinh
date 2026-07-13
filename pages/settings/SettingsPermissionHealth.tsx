import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

type HealthStatus = 'ok' | 'warning' | 'critical';
type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

type HealthFinding = {
  severity?: FindingSeverity;
  schema?: string;
  table?: string;
  policy?: string;
  command?: string;
  function?: string;
  identityArguments?: string;
  permissionCode?: string;
  moduleCode?: string;
  privilege?: string;
  projectId?: string;
  warehouseId?: string;
  columns?: string[];
};

type PermissionHealthSummary = {
  generatedAt?: string;
  status?: HealthStatus;
  legacyProjectionEnabled?: boolean;
  legacyFallbackDisabled?: boolean;
  checks?: Record<string, HealthFinding[]>;
};

const CHECK_LABELS: Record<string, string> = {
  unmappedRoutes: 'Route chưa map',
  broadPolicies: 'Policy rộng',
  anonCrudGrants: 'Anon CRUD',
  sensitiveTablesWithoutRls: 'Bảng nhạy cảm chưa RLS',
  nonNamespacedPermissionActions: 'Permission không namespace',
  legacyAdminFunctionConsumers: 'Consumer legacy admin',
  legacyProjectionColumns: 'Legacy projection',
  projectsWithoutScopedGrants: 'Dự án thiếu scoped grant',
  warehousesWithoutScopedGrants: 'Kho thiếu scoped grant',
  departmentsWithoutScopedGrants: 'Phòng ban thiếu scoped grant',
};

const severityClass: Record<FindingSeverity, string> = {
  critical: 'bg-red-50 text-red-700 border-red-100',
  high: 'bg-orange-50 text-orange-700 border-orange-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  low: 'bg-blue-50 text-blue-700 border-blue-100',
  info: 'bg-slate-50 text-slate-600 border-slate-100',
};

const statusConfig = (status: HealthStatus = 'ok') => {
  if (status === 'critical') return {
    label: 'Critical',
    icon: ShieldAlert,
    className: 'bg-red-50 text-red-700 border-red-100',
  };
  if (status === 'warning') return {
    label: 'Warning',
    icon: AlertTriangle,
    className: 'bg-amber-50 text-amber-700 border-amber-100',
  };
  return {
    label: 'OK',
    icon: ShieldCheck,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  };
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const describeFinding = (finding: HealthFinding) => {
  if (finding.policy) return `${finding.schema}.${finding.table} / ${finding.policy}`;
  if (finding.privilege) return `${finding.schema}.${finding.table} / ${finding.privilege}`;
  if (finding.function) return `${finding.schema}.${finding.function}(${finding.identityArguments || ''})`;
  if (finding.permissionCode) return `${finding.permissionCode} (${finding.moduleCode || '-'})`;
  if (finding.projectId) return `project:${finding.projectId}`;
  if (finding.warehouseId) return `warehouse:${finding.warehouseId}`;
  if (finding.columns?.length) return `${finding.schema}.${finding.table} / ${finding.columns.join(', ')}`;
  if (finding.table) return `${finding.schema}.${finding.table}`;
  return JSON.stringify(finding);
};

const SettingsPermissionHealth: React.FC = () => {
  const [summary, setSummary] = useState<PermissionHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSummary = async () => {
    if (!isSupabaseConfigured) {
      setSummary({
        status: 'warning',
        generatedAt: new Date().toISOString(),
        legacyProjectionEnabled: false,
        legacyFallbackDisabled: false,
        checks: {},
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.rpc('get_permission_health_summary');
      if (error) throw error;
      setSummary((data || {}) as PermissionHealthSummary);
    } catch (error: any) {
      logApiError('settings.permissionHealth.load', error);
      setErrorMessage(getApiErrorMessage(error, 'Không thể tải permission health.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const groups = useMemo(() => {
    const checks = summary?.checks || {};
    return Object.entries(CHECK_LABELS).map(([key, label]) => {
      const findings = Array.isArray(checks[key]) ? checks[key] : [];
      return { key, label, findings };
    });
  }, [summary]);

  const totalFindings = groups.reduce((sum, group) => sum + group.findings.length, 0);
  const status = statusConfig(summary?.status);
  const StatusIcon = status.icon;

  if (loading && !summary) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-100 bg-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-400" />
        <span className="text-sm font-bold text-slate-500">Đang tải permission health</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Permission Health</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                <Clock3 size={14} />
                <span>{formatDateTime(summary?.generatedAt)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={loadSummary}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Làm mới
          </button>
        </div>

        {errorMessage && (
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className={`rounded-xl border p-4 ${status.className}`}>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest">
              <StatusIcon size={16} />
              Trạng thái
            </div>
            <div className="mt-2 text-2xl font-black">{status.label}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
              <Database size={16} />
              Findings
            </div>
            <div className="mt-2 text-2xl font-black text-slate-800">{totalFindings}</div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">Projection</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-black text-slate-800">
              {summary?.legacyProjectionEnabled ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
              {summary?.legacyProjectionEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-4">
            <div className="text-xs font-black uppercase tracking-widest text-slate-500">Legacy fallback</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-black text-slate-800">
              {summary?.legacyFallbackDisabled ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
              {summary?.legacyFallbackDisabled ? 'Disabled' : 'Enabled'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map(group => (
          <div key={group.key} className="rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-black text-slate-800">{group.label}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                {group.findings.length}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto p-4">
              {group.findings.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                  <CheckCircle2 size={16} />
                  Không có finding
                </div>
              ) : (
                <div className="space-y-2">
                  {group.findings.map((finding, index) => {
                    const severity = finding.severity || 'info';
                    return (
                      <div key={`${group.key}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${severityClass[severity]}`}>
                            {severity}
                          </span>
                          {finding.command && (
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                              {finding.command}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 break-words font-mono text-xs font-bold text-slate-700">
                          {describeFinding(finding)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SettingsPermissionHealth;
