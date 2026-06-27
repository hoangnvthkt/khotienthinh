import React from 'react';
import { AlertTriangle, ClipboardCheck, HardHat, ShieldCheck, Truck, Users } from 'lucide-react';
import { SafetyDashboardSummary } from '../../../types';
import { EmptyState, NextActionCard, StatusBadge } from '../../erp';
import {
  SAFETY_ISSUE_STATUS_LABELS,
  SAFETY_SEVERITY_LABELS,
  getSafetyIssueStatusTone,
  getSafetySeverityTone,
} from '../../../lib/safetyWorkflow';

interface Props {
  summary: SafetyDashboardSummary | null;
  loading?: boolean;
  onOpenView: (view: 'issues' | 'inspections' | 'contractors' | 'equipment') => void;
  onOpenAction?: (sourceType: string, id: string) => void;
}

const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'blue';
  onClick?: () => void;
}> = ({ label, value, icon, tone = 'slate', onClick }) => {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  };
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase text-slate-400">{label}</span>
        <span className="text-current opacity-70">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-black">{value}</div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`rounded-lg border p-4 text-left shadow-sm transition hover:shadow-md ${tones[tone]}`}>
        {content}
      </button>
    );
  }

  return <div className={`rounded-lg border p-4 shadow-sm ${tones[tone]}`}>{content}</div>;
};

const SafetyOverview: React.FC<Props> = ({ summary, loading, onOpenView, onOpenAction }) => {
  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map(index => <div key={index} className="h-28 animate-pulse rounded-lg bg-slate-100" />)}
      </div>
    );
  }

  if (!summary) {
    return (
      <EmptyState
        icon={<ShieldCheck size={18} />}
        title="Chưa có dữ liệu an toàn"
        message="Khi bắt đầu ghi nhận nguy cơ, checklist, thiết bị hoặc nhà thầu, dashboard sẽ tự tổng hợp tại đây."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-700 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase text-emerald-600/70">Safety Score</div>
              <div className="mt-2 text-4xl font-black">{summary.safetyScore}</div>
            </div>
            <ShieldCheck size={34} />
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.safetyScore}%` }} />
          </div>
        </div>
        <StatCard label="Issue đang mở" value={summary.openIssues} icon={<AlertTriangle size={18} />} tone={summary.openIssues ? 'amber' : 'emerald'} onClick={() => onOpenView('issues')} />
        <StatCard label="Nguy cơ cao/nghiêm trọng" value={summary.highRiskIssues + summary.criticalIssues} icon={<HardHat size={18} />} tone={summary.highRiskIssues + summary.criticalIssues ? 'red' : 'emerald'} onClick={() => onOpenView('issues')} />
        <StatCard label="Checklist hôm nay" value={`${summary.completedTodayInspections}/${summary.dueTodayInspections}`} icon={<ClipboardCheck size={18} />} tone="blue" onClick={() => onOpenView('inspections')} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Thiết bị sắp/hết hạn" value={summary.expiringEquipment + summary.expiredEquipment} icon={<Truck size={18} />} tone={summary.expiredEquipment ? 'red' : summary.expiringEquipment ? 'amber' : 'emerald'} onClick={() => onOpenView('equipment')} />
        <StatCard label="Nhân sự chưa huấn luyện" value={summary.untrainedWorkers} icon={<Users size={18} />} tone={summary.untrainedWorkers ? 'amber' : 'emerald'} />
        <StatCard label="NTP công trình thiếu hồ sơ" value={summary.contractorsMissingDocs} icon={<HardHat size={18} />} tone={summary.contractorsMissingDocs ? 'amber' : 'emerald'} onClick={() => onOpenView('contractors')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-800">Cần xử lý ngay</h3>
              <p className="text-xs font-medium text-slate-500">Ưu tiên issue nghiêm trọng, quá hạn và thiết bị hết hạn kiểm định.</p>
            </div>
            <StatusBadge status="open" label={`${summary.nextActions.length} việc`} tone={summary.nextActions.length ? 'attention' : 'success'} />
          </div>
          {summary.nextActions.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={18} />} title="Không có việc khẩn" message="Hiện chưa có cảnh báo an toàn cần xử lý ngay." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {summary.nextActions.map(action => (
                <NextActionCard
                  key={`${action.sourceType}-${action.id}`}
                  title={action.title}
                  code={action.code}
                  status={action.status}
                  statusLabel={SAFETY_ISSUE_STATUS_LABELS[action.status as keyof typeof SAFETY_ISSUE_STATUS_LABELS] || action.status}
                  tone={action.severity ? getSafetySeverityTone(action.severity) : getSafetyIssueStatusTone(action.status)}
                  nextAction={action.severity ? `Mức độ ${SAFETY_SEVERITY_LABELS[action.severity]}. Cần kiểm tra và cập nhật trạng thái.` : 'Kiểm tra hồ sơ và cập nhật tình trạng.'}
                  actorName={action.actorName || undefined}
                  dueAt={action.dueAt}
                  category={action.severity === 'critical' ? 'warning' : 'tracking'}
                  actionLabel="Mở"
                  onClick={() => onOpenAction?.(action.sourceType, action.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-slate-800">Khu vực/tổ đội rủi ro</h3>
          <div className="mt-3 space-y-2">
            {summary.topRiskAreas.length === 0 ? (
              <p className="text-xs font-bold text-slate-400">Chưa đủ dữ liệu để xếp hạng.</p>
            ) : summary.topRiskAreas.map(area => (
              <div key={area.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="truncate text-xs font-black text-slate-700">{area.label}</span>
                <StatusBadge status="warning" label={`${area.count} issue`} tone="warning" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default SafetyOverview;
