import React from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { User, SafetyWorkforceDashboard } from '../../../../types';
import type { SafetyWorkforceRequestScope } from '../../../../lib/safetyWorkforceApi';
import { useSafetyDashboard } from '../../../../hooks/useSafetyWorkforce';

interface ScopedViewProps {
  scope: SafetyWorkforceRequestScope;
  currentUser: User;
}

interface DashboardContentProps {
  data: SafetyWorkforceDashboard | null;
  loading: boolean;
  error: { message: string } | null;
  onRetry: () => void;
}

const MetricSkeleton = () => (
  <div className="h-[88px] animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
);

export const SafetyPassportDashboardContent: React.FC<DashboardContentProps> = ({
  data,
  loading,
  error,
  onRetry,
}) => {
  if (loading && !data) {
    return (
      <section className="space-y-4" aria-label="Đang tải tổng quan hồ sơ an toàn">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index} />)}
        </div>
        <div className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 text-red-600" size={18} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-red-900 dark:text-red-200">Không tải được tổng quan an toàn</h3>
            <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{error.message}</p>
            <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 active:translate-y-px dark:bg-slate-950">
              <RefreshCw size={14} /> Thử lại
            </button>
          </div>
        </div>
      </section>
    );
  }

  const dashboard = data || {
    totalWorkers: 0,
    activeAssignments: 0,
    eligibleAssignments: 0,
    missingProfile: 0,
    missingCertificate: 0,
    expiredCertificate: 0,
    missingSiteRequirement: 0,
    suspendedAssignments: 0,
    expiringCertificates7Days: 0,
    expiringCertificates30Days: 0,
    expiredCertificates: 0,
    expiringCards30Days: 0,
    problematicSubcontractors: [],
  };
  const needsAttention = Math.max(0, dashboard.activeAssignments - dashboard.eligibleAssignments);
  const metrics = [
    { label: 'Nhân công', value: dashboard.totalWorkers, tone: 'text-slate-900 dark:text-slate-100' },
    { label: 'Đang tham gia', value: dashboard.activeAssignments, tone: 'text-blue-700 dark:text-blue-300' },
    { label: 'Đủ điều kiện', value: dashboard.eligibleAssignments, tone: 'text-emerald-700 dark:text-emerald-300' },
    { label: 'Cần xử lý', value: needsAttention, tone: 'text-orange-700 dark:text-orange-300' },
  ];

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => (
          <div key={metric.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-bold text-slate-500 dark:text-slate-400">{metric.label}</div>
            <div className={`mt-1 font-mono text-2xl font-black tabular-nums ${metric.tone}`}>{metric.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-orange-600" />
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">Tình trạng hồ sơ</h3>
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ['Thiếu hồ sơ', dashboard.missingProfile],
              ['Thiếu chứng chỉ', dashboard.missingCertificate],
              ['Chứng chỉ hết hạn', dashboard.expiredCertificate],
              ['Thiếu yêu cầu công trường', dashboard.missingSiteRequirement],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2 text-xs dark:border-slate-800">
                <span className="font-bold text-slate-600 dark:text-slate-300">{label}</span>
                <span className="font-mono font-black tabular-nums text-orange-700 dark:text-orange-300">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <AlertTriangle size={17} className="text-orange-600" />
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">Sắp hết hạn</h3>
          </div>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-4"><span className="font-bold text-slate-600 dark:text-slate-300">Chứng chỉ trong 7 ngày</span><strong className="font-mono text-red-700 dark:text-red-300">{dashboard.expiringCertificates7Days}</strong></div>
            <div className="flex justify-between gap-4"><span className="font-bold text-slate-600 dark:text-slate-300">Chứng chỉ trong 30 ngày</span><strong className="font-mono text-orange-700 dark:text-orange-300">{dashboard.expiringCertificates30Days}</strong></div>
            <div className="flex justify-between gap-4"><span className="font-bold text-slate-600 dark:text-slate-300">Thẻ trong 30 ngày</span><strong className="font-mono text-orange-700 dark:text-orange-300">{dashboard.expiringCards30Days}</strong></div>
          </div>
        </div>
      </div>

      {dashboard.problematicSubcontractors.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50/70 p-4 dark:border-orange-900/60 dark:bg-orange-950/20">
          <div className="flex items-center gap-2">
            <Users size={17} className="text-orange-700 dark:text-orange-300" />
            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">Nhà thầu phụ cần xử lý</h3>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {dashboard.problematicSubcontractors.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs dark:bg-slate-900">
                <span className="font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
                <span className="font-mono font-black text-orange-700 dark:text-orange-300">{item.issueCount} hồ sơ</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const SafetyPassportDashboardView: React.FC<ScopedViewProps> = ({ scope }) => {
  const state = useSafetyDashboard(scope);
  return (
    <SafetyPassportDashboardContent
      data={state.data}
      loading={state.loading}
      error={state.error}
      onRetry={() => { void state.reload(); }}
    />
  );
};

export default SafetyPassportDashboardView;
