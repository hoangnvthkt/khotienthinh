import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../../context/ToastContext';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileText,
  Gauge,
  HardHat,
  ListChecks,
  Package,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  TrendingUp,
  Truck,
  WalletCards,
} from 'lucide-react';
import {
  ExecutiveAlertSeverity,
  ExecutivePaymentBlockingStage,
  PartyDashboardMetric,
  ProjectDashboardMetrics,
  SupplierDashboardMetric,
  projectDashboardMetricsService,
} from '../../lib/projectDashboardMetricsService';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { fromDb } from '../../lib/dbMapping';
import { getSupabaseProjection } from '../../lib/supabaseProjections';

interface FastConsDashboardProps {
  constructionSiteId: string;
  projectId?: string;
}

type ExecutiveTaskRow = ProjectDashboardMetrics['executive']['timeline']['rows'][number];
type ExecutiveAction = ProjectDashboardMetrics['executive']['actionLinks'][number];

const fmtMoney = (value: number): string => {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString('vi-VN');
};

const fmtFull = (value: number): string => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} đ`;

const fmtDate = (value?: string): string => {
  if (!value) return 'Chưa có';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
};

const fmtDeltaDays = (days: number): string => {
  if (days > 0) return `+${days} ngày`;
  if (days < 0) return `${days} ngày`;
  return 'Không đổi';
};

const fmtScheduleDelta = (days: number): string => {
  if (days > 0) return `Chậm ${days} ngày`;
  if (days < 0) return `Nhanh ${Math.abs(days)} ngày`;
  return 'Đúng kế hoạch';
};

const metricTone = (value: number, positiveGood = true): string => {
  if (value === 0) return 'text-slate-700';
  const isGood = positiveGood ? value > 0 : value < 0;
  return isGood ? 'text-emerald-700' : 'text-red-700';
};

const SummaryCard = ({
  title,
  value,
  sub,
  icon,
  tone = 'slate',
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'orange' | 'blue' | 'violet' | 'red';
}) => {
  const toneClass = {
    slate: 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200',
    emerald: 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300',
    orange: 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-800 dark:text-teal-300',
    blue: 'bg-teal-50/60 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-800 dark:text-teal-300',
    violet: 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-800 dark:text-teal-300',
    red: 'bg-teal-100/60 dark:bg-teal-950/60 border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase font-bold tracking-wide opacity-70">{title}</div>
          <div className="mt-1 text-lg md:text-xl font-bold truncate">{value}</div>
        </div>
        <div className="w-9 h-9 shrink-0 rounded-xl bg-white/80 dark:bg-zinc-800/80 shadow-sm flex items-center justify-center">
          {icon}
        </div>
      </div>
      {sub && <div className="mt-2 text-[11px] font-semibold opacity-75 truncate">{sub}</div>}
    </div>
  );
};

const ExecutiveKpiCard = ({
  title,
  value,
  sub,
  icon,
  tone = 'slate',
  onClick,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'orange' | 'blue' | 'violet' | 'red' | 'cyan';
  onClick?: () => void;
}) => {
  const toneClass = {
    slate: 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100',
    emerald: 'border-teal-200 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300',
    orange: 'border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
    blue: 'border-blue-200 dark:border-blue-800/60 bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300',
    violet: 'border-violet-200 dark:border-violet-800/60 bg-violet-50/70 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300',
    red: 'border-red-200 dark:border-red-800/60 bg-red-50/70 dark:bg-red-950/40 text-red-800 dark:text-red-300',
    cyan: 'border-cyan-200 dark:border-cyan-800/60 bg-cyan-50/70 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-300',
  }[tone];
  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group rounded-xl border p-4 text-left shadow-sm transition-all ${toneClass} ${onClick ? 'hover:-translate-y-0.5 hover:shadow-md hover:border-teal-500/50 active:translate-y-0 cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</div>
          <div className="mt-2 text-2xl font-bold leading-none tracking-normal sm:text-3xl">{value}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-current shadow-sm">
          {icon}
        </div>
      </div>
      {sub && <div className="mt-3 min-h-8 text-[11px] font-semibold leading-4 text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </Element>
  );
};

const TaskHighlightPanel = ({
  title,
  rows,
  empty,
  tone,
  onOpenTask,
  onOpenAll,
}: {
  title: string;
  rows: ExecutiveTaskRow[];
  empty: string;
  tone: 'emerald' | 'blue' | 'orange' | 'red';
  onOpenTask: (taskId: string) => void;
  onOpenAll: () => void;
}) => {
  const toneClass = {
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
    blue: 'text-teal-700 bg-teal-50 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-800/60',
    orange: 'text-teal-800 bg-teal-50/80 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800/60',
    red: 'text-teal-900 bg-teal-100/60 border-teal-300 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-800',
  }[tone];

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{title}</div>
          <div className="mt-0.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">{rows.length} hạng mục</div>
        </div>
        <button
          type="button"
          onClick={onOpenAll}
          className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold ${toneClass}`}
        >
          Mở
        </button>
      </div>
      <div className="space-y-2">
        {rows.slice(0, 4).map(row => (
          <button
            key={row.taskId}
            type="button"
            onClick={() => onOpenTask(row.taskId)}
            className="w-full rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-left transition hover:border-zinc-200 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-200">{row.wbsCode ? `${row.wbsCode} · ` : ''}{row.name}</div>
                <div className="mt-1 truncate text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                  {fmtDate(row.startDate)} - {fmtDate(row.plannedEndDate)} · {row.actualProgress}%
                </div>
              </div>
              <div className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${row.dayDelta !== null && row.dayDelta > 0 ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : row.dayDelta !== null && row.dayDelta < 0 ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                {row.varianceLabel}
              </div>
            </div>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 px-3 py-5 text-center text-[11px] font-medium text-zinc-400">
            {empty}
          </div>
        )}
      </div>
    </div>
  );
};

const ExecutiveActionCard = ({
  action,
  onOpen,
}: {
  action: ExecutiveAction;
  onOpen: (action: ExecutiveAction) => void;
}) => {
  const toneClass = {
    critical: 'border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400',
    warning: 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
    info: 'border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
    success: 'border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400',
  }[action.tone || 'info'];

  return (
    <button
      type="button"
      onClick={() => onOpen(action)}
      className="group flex min-h-[96px] w-full flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left shadow-sm transition-all hover:border-teal-500/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">{action.title}</div>
          <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-4 text-zinc-500 dark:text-zinc-400">{action.description}</div>
        </div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
          <ArrowUpRight size={14} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          {action.amount ? fmtMoney(action.amount) : action.count != null ? `${action.count} mục` : 'Mở chi tiết'}
        </div>
        <ArrowRight size={13} className="text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-teal-600 dark:group-hover:text-teal-400" />
      </div>
    </button>
  );
};

const MetricRow = ({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
    <span className={`text-xs font-bold text-right ${highlight ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>
      {fmtFull(value)}
    </span>
  </div>
);

const severityClasses: Record<ExecutiveAlertSeverity, string> = {
  critical: 'bg-teal-100/80 dark:bg-teal-950/60 border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200',
  warning: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400',
  info: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-400',
  success: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60 text-teal-700 dark:text-teal-400',
};

const stageLabels: Record<ExecutivePaymentBlockingStage, string> = {
  none: 'Đủ điều kiện',
  dossier: 'Hồ sơ',
  quality: 'Chất lượng',
  cash: 'Dòng tiền',
};

const partyLabels = {
  owner: 'CĐT',
  subcontractor: 'Thầu phụ',
  supplier: 'NCC',
};

const statusLabel = {
  green: 'Ổn định',
  amber: 'Cần theo dõi',
  red: 'Cần can thiệp',
};

const CompactProgress = ({ label, value, tone }: { label: string; value: number; tone: string }) => (
  <div>
    <div className="flex items-center justify-between gap-3 mb-1">
      <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{Math.round(value)}%</span>
    </div>
    <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  </div>
);

const ApprovalQueuePanel = ({ metrics }: { metrics: ProjectDashboardMetrics }) => {
  const queue = metrics.executive.approvalQueue;
  const items = [
    { label: 'Nhật ký submitted', value: queue.dailyLogSubmitted },
    { label: 'Nghiệm thu KL', value: queue.quantityAcceptanceSubmitted },
    { label: 'Chứng từ TT', value: queue.paymentCertificateSubmitted },
    { label: 'Phát sinh HĐ', value: queue.variationSubmitted },
    { label: 'Đối chiếu BOQ', value: queue.reconciliationSubmitted },
  ];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center">
            <ClipboardCheck size={15} />
          </div>
          <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Yêu cầu chờ xử lý</h3>
        </div>
        <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{queue.total}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(item => (
          <MiniCount key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
};

const PriorityAlertsPanel = ({ metrics }: { metrics: ProjectDashboardMetrics }) => {
  const alerts = metrics.executive.priorityAlerts;
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-xl bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 flex items-center justify-center">
          <AlertTriangle size={15} />
        </div>
        <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Cảnh báo ưu tiên</h3>
      </div>
      {alerts.length === 0 ? (
        <div className="rounded-xl border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-950/40 p-3 text-xs font-bold text-teal-700 dark:text-teal-400 flex items-center gap-2">
          <CheckCircle2 size={14} />
          Không có cảnh báo trọng yếu trong dữ liệu hiện tại.
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className={`rounded-xl border p-3 ${severityClasses[alert.severity]}`}>
              <div className="text-xs font-bold">{alert.title}</div>
              <div className="mt-1 text-[11px] font-medium opacity-85 leading-relaxed">{alert.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ScheduleHealthPanel = ({ metrics }: { metrics: ProjectDashboardMetrics }) => {
  const schedule = metrics.executive.scheduleHealth;
  const tone = schedule.status === 'red'
    ? 'bg-red-500'
    : schedule.status === 'amber'
      ? 'bg-amber-500'
      : 'bg-teal-600';
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-teal-700/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400 flex items-center justify-center">
            <Activity size={15} />
          </div>
          <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Sức khỏe tiến độ</h3>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityClasses[schedule.status === 'red' ? 'critical' : schedule.status === 'amber' ? 'warning' : 'success']}`}>
          {statusLabel[schedule.status]}
        </span>
      </div>
      <div className="space-y-3">
        <CompactProgress label="Kế hoạch đến hôm nay" value={schedule.plannedProgress} tone="bg-zinc-400 dark:bg-zinc-600" />
        <CompactProgress label="Thực tế" value={schedule.actualProgress} tone={tone} />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4">
        <MiniCount label="Lệch tiến độ" value={schedule.progressVariance} />
        <MiniCount label="Forecast trễ" value={schedule.forecastDeltaDays} />
        <MiniCount label="Task quá hạn" value={schedule.overdueTaskCount} />
        <MiniCount label="Delay active" value={schedule.activeDelayEventCount} />
      </div>
      <div className="mt-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        Hoàn thành forecast: <span className="font-bold text-zinc-800 dark:text-zinc-200">{fmtDate(schedule.forecastEndDate)}</span>
        <span className="mx-1">·</span>
        Ảnh hưởng <span className="font-bold text-zinc-800 dark:text-zinc-200">{schedule.impactedTaskCount}</span> hạng mục downstream.
      </div>
    </div>
  );
};

const PaymentRiskPanel = ({ metrics }: { metrics: ProjectDashboardMetrics }) => {
  const risks = metrics.executive.paymentPeriodRisks;
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-teal-700/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400 flex items-center justify-center">
            <CalendarClock size={15} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Kỳ thanh toán sắp đến / quá hạn</h3>
            <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mt-0.5">Theo mốc 10 ngày tới và target lũy kế của lịch thanh toán.</p>
          </div>
        </div>
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{risks.length}</span>
      </div>
      {risks.length === 0 ? (
        <div className="p-4 text-xs font-medium text-zinc-400">Chưa có kỳ thanh toán quá hạn hoặc đến hạn trong 10 ngày tới.</div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {risks.slice(0, 6).map(risk => (
            <div key={risk.id} className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${severityClasses[risk.severity]}`}>
                      {partyLabels[risk.party]}
                    </span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">{risk.description || risk.label}</span>
                    <span className="text-[11px] font-medium text-zinc-400">{fmtDate(risk.dueDate)}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {risk.daysUntilDue < 0 ? `Quá hạn ${Math.abs(risk.daysUntilDue)} ngày` : `Còn ${risk.daysUntilDue} ngày`}
                    <span className="mx-1">·</span>
                    Nghẽn tại: <span className="font-bold text-zinc-700 dark:text-zinc-300">{stageLabels[risk.blockingStage]}</span>
                    <span className="mx-1">·</span>
                    Thiếu: <span className="font-bold text-teal-800 dark:text-teal-300">{fmtFull(risk.missingAmount)}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{risk.recommendation}</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:w-[560px]">
                  <MiniMoney label="Kế hoạch" value={risk.targetCumulative} />
                  <MiniMoney label="Hồ sơ" value={risk.acceptedValue} />
                  <MiniMoney label="Chất lượng" value={risk.certifiedValue} />
                  <MiniMoney label="Đã TT" value={risk.paidValue} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** Cell value in reconciliation table */
const TCell = ({ value, highlight, negative, formula }: { value: number; highlight?: boolean; negative?: boolean; formula?: string }) => {
  const color = negative && value < 0
    ? 'text-red-600'
    : highlight
      ? 'text-slate-900'
      : 'text-slate-600';
  return (
    <td className={`px-3 py-2 text-right whitespace-nowrap ${highlight ? 'font-black' : 'font-semibold'} text-xs ${color}`}>
      <div>{fmtFull(value)}</div>
      {formula && <div className="text-[9px] font-semibold text-slate-400 mt-0.5">{formula}</div>}
    </td>
  );
};

/** Horizontal 3-party reconciliation table (FastCons style) */
const ReconciliationTable = ({
  owner,
  subcontractor,
  supplier,
}: {
  owner: PartyDashboardMetric;
  subcontractor: PartyDashboardMetric;
  supplier: SupplierDashboardMetric;
}) => {
  // Row definitions: [label, ownerVal, subVal, supplierVal, options]
  type RowDef = {
    label: string;
    owner: number;
    sub: number;
    sup: number;
    highlight?: boolean;
    negative?: boolean;
    separator?: boolean;
    ownerFormula?: string;
    subFormula?: string;
    supFormula?: string;
  };
  const rows: RowDef[] = [
    { label: 'Hợp đồng', owner: owner.contractValue, sub: subcontractor.contractValue, sup: supplier.contractValue, highlight: true },
    { label: 'Đã thực hiện', owner: owner.performedValue, sub: subcontractor.performedValue, sup: 0 },
    { label: 'Đã nghiệm thu', owner: owner.acceptedValue, sub: subcontractor.acceptedValue, sup: 0 },
    {
      label: 'Đề nghị thanh toán',
      owner: owner.paymentRequested,
      sub: subcontractor.paymentRequested,
      sup: supplier.paymentRequested,
      ownerFormula: '(1) − (2) − (3) − (4) − (5)',
      subFormula: '(1) − (2) − (3) − (4) − (5)',
    },
    { label: 'KL đề nghị TT', owner: owner.paymentVolumeValue, sub: subcontractor.paymentVolumeValue, sup: 0 },
    { label: 'Thu hồi tạm ứng', owner: owner.advanceRecovered, sub: subcontractor.advanceRecovered, sup: 0 },
    { label: 'Giá trị giữ lại', owner: owner.retentionValue, sub: subcontractor.retentionValue, sup: 0 },
    { label: 'Phạt / khấu trừ', owner: owner.penaltyDeductionValue, sub: subcontractor.penaltyDeductionValue, sup: 0 },
    { label: '', owner: 0, sub: 0, sup: 0, separator: true },
    {
      label: 'Thu / Trả thực tế',
      owner: owner.actualPaid,
      sub: subcontractor.actualPaid,
      sup: supplier.actualPaid,
      highlight: true,
      ownerFormula: '(6) + (7) + (8)',
      subFormula: '(6) + (7) + (8)',
      supFormula: '(1) + (2) + (3)',
    },
    { label: '   Từ đề nghị TT', owner: owner.paidFromPaymentRequests, sub: subcontractor.paidFromPaymentRequests, sup: supplier.paidFromPaymentRequests },
    { label: '   Từ tạm ứng', owner: owner.outstandingAdvance, sub: subcontractor.outstandingAdvance, sup: supplier.outstandingAdvance },
    { label: '', owner: 0, sub: 0, sup: 0, separator: true },
    {
      label: 'Công nợ',
      owner: owner.paymentRequested - owner.actualPaid,
      sub: subcontractor.debt,
      sup: supplier.debt,
      highlight: true,
      negative: true,
    },
  ];

  const colHeader = (icon: React.ReactNode, title: string, sub: string, bg: string) => (
    <th className={`px-3 py-3 text-center ${bg} whitespace-nowrap`}>
      <div className="flex items-center justify-center gap-1.5">
        {icon}
        <span className="text-xs font-black text-slate-800 uppercase tracking-wide">{title}</span>
      </div>
      <div className="text-[9px] font-semibold text-slate-400 mt-0.5">{sub}</div>
    </th>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[700px]">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="px-4 py-3 text-left w-[200px] bg-slate-50 whitespace-nowrap">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Hạng mục</div>
              </th>
              {colHeader(<Building2 size={13} className="text-orange-600" />, 'Chủ đầu tư', 'HĐ nhận thầu', 'bg-orange-50/50')}
              {colHeader(<HardHat size={13} className="text-blue-600" />, 'Nhà thầu', 'HĐ giao thầu', 'bg-blue-50/50')}
              {colHeader(<Truck size={13} className="text-cyan-600" />, 'Nhà cung cấp', 'PO / Vật tư', 'bg-cyan-50/50')}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.separator) {
                return <tr key={i}><td colSpan={4} className="h-1 bg-slate-100" /></tr>;
              }
              const isDebt = row.label === 'Công nợ';
              const rowBg = isDebt
                ? 'bg-slate-50'
                : row.highlight
                  ? 'bg-amber-50/30'
                  : i % 2 === 0
                    ? 'bg-white'
                    : 'bg-slate-50/40';
              return (
                <tr key={i} className={`border-b border-slate-100 last:border-b-0 ${rowBg} hover:bg-slate-50 transition-colors`}>
                  <td className={`px-4 py-2 text-left ${row.highlight ? 'font-black text-slate-800' : 'font-semibold text-slate-500'}`}>
                    {row.label}
                  </td>
                  <TCell value={row.owner} highlight={row.highlight} negative={row.negative} formula={row.ownerFormula} />
                  <TCell value={row.sub} highlight={row.highlight} negative={row.negative} formula={row.subFormula} />
                  <TCell value={row.sup} highlight={row.highlight} negative={row.negative} formula={row.supFormula} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface WeeklySnapshot {
  id?: string;
  scopeKey: string;
  weekLabel: string;
  weekStart: string;
  progressPercent: number;
  constructionProgressPercent?: number;
  valueProgressPercent?: number;
  progressMode: string;
  suppliedValue?: number;
  contractTotalValue?: number;
  purchasedValue?: number;
  issuedValue?: number;
  recognizedValue?: number;
  ganttPercent?: number;
  calculatedAt: string;
}

interface SCurvePoint {
  index: number;
  weekLabel: string;
  dateRangeLabel: string;
  dateIso: string;
  plannedPercent: number;
  actualPercent: number | null;
  isPastOrCurrent: boolean;
}

const buildSmoothPath = (pts: { x: number; y: number }[]): string => {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let path = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.x ? p2.y.toFixed(1) : p2.y.toFixed(1)}`;
  }
  return path;
};

const buildAreaPath = (pts: { x: number; y: number }[], baseY: number): string => {
  if (pts.length === 0) return '';
  const linePath = buildSmoothPath(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${linePath} L ${last.x.toFixed(1)},${baseY} L ${first.x.toFixed(1)},${baseY} Z`;
};

const PlannedVsActualSCurvePanel: React.FC<{
  constructionSiteId: string;
  projectId?: string;
  currentMetrics: ProjectDashboardMetrics;
}> = ({ constructionSiteId, projectId, currentMetrics }) => {
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const scopeKey = projectId && constructionSiteId
    ? `${projectId}_${constructionSiteId}`
    : projectId || constructionSiteId;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        if (!isSupabaseConfigured) {
          setSnapshots([]);
          return;
        }
        const { data, error } = await supabase
          .from('weekly_progress_snapshots')
          .select(getSupabaseProjection('weekly_progress_snapshots'))
          .eq('scope_key', scopeKey)
          .order('week_start', { ascending: true })
          .limit(24);
        if (error) throw error;
        if (!cancelled) {
          setSnapshots((data || []).map(row => fromDb(row) as WeeklySnapshot));
        }
      } catch {
        if (!cancelled) setSnapshots([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [scopeKey]);

  const timeline = currentMetrics.executive?.timeline;
  const scheduleHealth = currentMetrics.executive?.scheduleHealth;
  const actualProgress = currentMetrics.progress?.constructionProgressPercent
    ?? currentMetrics.progress?.percent
    ?? timeline?.actualProgress
    ?? 0;
  const plannedProgress = timeline?.plannedProgress
    ?? scheduleHealth?.plannedProgress
    ?? 0;
  const variance = Math.round((actualProgress - plannedProgress) * 10) / 10;

  // Generate weekly checkpoints for S-Curve
  const sCurvePoints = React.useMemo<SCurvePoint[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    let pStart = timeline?.projectStart;
    let pEnd = timeline?.projectEnd || scheduleHealth?.baselineEndDate;

    if (!pStart && snapshots.length > 0) pStart = snapshots[0].weekStart;
    if (!pEnd && snapshots.length > 0) pEnd = snapshots[snapshots.length - 1].weekStart;

    const now = new Date();
    if (!pStart) {
      const d = new Date(now);
      d.setDate(d.getDate() - 28);
      pStart = d.toISOString().slice(0, 10);
    }
    if (!pEnd) {
      const d = new Date(now);
      d.setDate(d.getDate() + 42);
      pEnd = d.toISOString().slice(0, 10);
    }

    const startDate = new Date(`${pStart}T00:00:00`);
    const endDate = new Date(`${pEnd}T00:00:00`);
    const totalDays = Math.max(7, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
    const numWeeks = Math.max(6, Math.min(12, Math.ceil(totalDays / 7)));
    const daysPerStep = totalDays / numWeeks;

    const rawRows = timeline?.rows || [];
    const taskRows = rawRows.some(r => r.isLeaf) ? rawRows.filter(r => r.isLeaf) : rawRows;
    const totalTaskWeight = taskRows.reduce((acc, r) => acc + (r.weight || r.plannedDays || 1), 0);

    const pts: SCurvePoint[] = [];

    for (let i = 1; i <= numWeeks; i++) {
      const stepEndDate = new Date(startDate.getTime() + i * daysPerStep * 86400000);
      const stepStartDate = new Date(startDate.getTime() + (i - 1) * daysPerStep * 86400000);
      const dateIso = stepEndDate.toISOString().slice(0, 10);
      const startStr = `${String(stepStartDate.getDate()).padStart(2, '0')}/${String(stepStartDate.getMonth() + 1).padStart(2, '0')}`;
      const endStr = `${String(stepEndDate.getDate()).padStart(2, '0')}/${String(stepEndDate.getMonth() + 1).padStart(2, '0')}`;

      // Planned %
      let planned = 0;
      if (taskRows.length > 0 && totalTaskWeight > 0) {
        let weightedSum = 0;
        taskRows.forEach(row => {
          const rStart = row.startDate;
          const rEnd = row.plannedEndDate;
          const rowWeight = row.weight || row.plannedDays || 1;
          if (rStart && rEnd) {
            if (dateIso >= rEnd) {
              weightedSum += 100 * rowWeight;
            } else if (dateIso <= rStart) {
              weightedSum += 0;
            } else {
              const d1 = new Date(`${rStart}T00:00:00`).getTime();
              const d2 = new Date(`${rEnd}T00:00:00`).getTime();
              const fraction = Math.max(0, Math.min(1, (stepEndDate.getTime() - d1) / Math.max(86400000, d2 - d1)));
              weightedSum += fraction * 100 * rowWeight;
            }
          }
        });
        planned = Math.round(weightedSum / totalTaskWeight);
      } else {
        const t = i / numWeeks;
        const s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        planned = Math.round(s * 100);
      }
      if (i === numWeeks) planned = 100;
      planned = Math.min(100, Math.max(0, planned));

      // Actual %
      const isPastOrCurrent = dateIso <= today || stepStartDate.toISOString().slice(0, 10) <= today;
      let actual: number | null = null;

      if (isPastOrCurrent) {
        const match = snapshots.find(s => s.weekStart <= dateIso && s.weekStart >= stepStartDate.toISOString().slice(0, 10));
        if (match) {
          actual = match.constructionProgressPercent ?? match.progressPercent;
        } else {
          const stepTime = stepEndDate.getTime();
          const startTime = startDate.getTime();
          const todayTime = new Date(`${today}T00:00:00`).getTime();
          if (stepTime >= todayTime) {
            actual = actualProgress;
          } else {
            const ratio = Math.max(0, Math.min(1, (stepTime - startTime) / Math.max(86400000, todayTime - startTime)));
            const smoothRatio = ratio < 0.5 ? 2 * ratio * ratio : 1 - Math.pow(-2 * ratio + 2, 2) / 2;
            actual = Math.round(smoothRatio * actualProgress);
          }
        }
        actual = Math.min(100, Math.max(0, actual));
      }

      pts.push({
        index: i,
        weekLabel: `Tuần ${i}`,
        dateRangeLabel: `${startStr} - ${endStr}`,
        dateIso,
        plannedPercent: planned,
        actualPercent: actual,
        isPastOrCurrent,
      });
    }

    return pts;
  }, [currentMetrics, snapshots, actualProgress, plannedProgress, timeline, scheduleHealth]);

  if (loading) return null;

  // SVG Chart Geometry
  const svgWidth = 680;
  const svgHeight = 220;
  const padLeft = 45;
  const padRight = 30;
  const padTop = 20;
  const padBottom = 35;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;
  const baseY = padTop + plotHeight; // y for 0% (185)

  const n = sCurvePoints.length;
  const getX = (i: number) => padLeft + (n > 1 ? (i / (n - 1)) * plotWidth : plotWidth / 2);
  const getY = (val: number) => padTop + (1 - val / 100) * plotHeight;

  const plannedPts = sCurvePoints.map((p, i) => ({ x: getX(i), y: getY(p.plannedPercent) }));
  const actualRaw = sCurvePoints
    .map((p, i) => (p.actualPercent !== null ? { x: getX(i), y: getY(p.actualPercent), idx: i } : null))
    .filter(Boolean) as { x: number; y: number; idx: number }[];

  const plannedLinePath = buildSmoothPath(plannedPts);
  const plannedAreaPath = buildAreaPath(plannedPts, baseY);
  const actualLinePath = buildSmoothPath(actualRaw);
  const actualAreaPath = actualRaw.length > 0 ? buildAreaPath(actualRaw, baseY) : '';

  const activePoint = hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < n ? sCurvePoints[hoveredIndex] : null;
  const activeX = hoveredIndex !== null ? getX(hoveredIndex) : null;
  const activePlannedY = hoveredIndex !== null ? getY(sCurvePoints[hoveredIndex].plannedPercent) : null;
  const activeActualY = hoveredIndex !== null && sCurvePoints[hoveredIndex].actualPercent !== null
    ? getY(sCurvePoints[hoveredIndex].actualPercent!)
    : null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <TrendingUp size={16} />
          </div>
          <div>
            <h3 className="text-xs font-black text-zinc-900 dark:text-zinc-100">
              Tiến độ kế hoạch và thực tế (Planned vs Actual S-Curve)
            </h3>
            <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mt-0.5">
              Tiến độ lũy kế của dự án. Khoảng cách giữa hai đường thể hiện mức nhanh/chậm so với kế hoạch.
            </p>
          </div>
        </div>

        {/* Current status badges */}
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-black">
            KH: {plannedProgress}%
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-black">
            TT: {actualProgress}%
          </div>
          <div className={`px-2.5 py-1 rounded-lg text-xs font-black border ${
            variance > 1
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
              : variance < -2
                ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
          }`}>
            {variance > 0 ? `+${variance}%` : `${variance}%`} ({variance > 1 ? 'Nhanh' : variance < -2 ? 'Chậm' : 'Đúng hạn'})
          </div>
        </div>
      </div>

      {/* S-Curve Chart Area */}
      <div className="p-5">
        <div className="relative w-full overflow-x-auto">
          <div className="min-w-[600px]">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto select-none"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <linearGradient id="sCurveBlueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="sCurveGreenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines & Y-Axis Labels */}
              {[100, 75, 50, 25, 0].map(val => {
                const y = getY(val);
                return (
                  <g key={val}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="text-[10px] font-bold fill-zinc-400 dark:fill-zinc-500"
                    >
                      {val}%
                    </text>
                  </g>
                );
              })}

              {/* X-Axis Labels */}
              {sCurvePoints.map((p, i) => {
                const x = getX(i);
                const isHovered = hoveredIndex === i;
                return (
                  <text
                    key={p.weekLabel}
                    x={x}
                    y={svgHeight - 12}
                    textAnchor="middle"
                    className={`text-[10px] transition-colors ${
                      isHovered
                        ? 'font-black fill-blue-600 dark:fill-blue-400'
                        : 'font-semibold fill-zinc-500 dark:fill-zinc-400'
                    }`}
                  >
                    {p.weekLabel}
                  </text>
                );
              })}

              {/* Shaded Areas */}
              {plannedAreaPath && <path d={plannedAreaPath} fill="url(#sCurveBlueGrad)" />}
              {actualAreaPath && <path d={actualAreaPath} fill="url(#sCurveGreenGrad)" />}

              {/* Planned S-Curve Line (Blue) */}
              <path
                d={plannedLinePath}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Actual S-Curve Line (Green) */}
              {actualLinePath && (
                <path
                  d={actualLinePath}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Planned Dots */}
              {plannedPts.map((pt, i) => (
                <circle
                  key={`plan-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIndex === i ? 6 : 4}
                  fill="#3b82f6"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="transition-all duration-150"
                />
              ))}

              {/* Actual Dots */}
              {actualRaw.map((pt, i) => (
                <circle
                  key={`act-${i}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIndex === pt.idx ? 6 : 4}
                  fill="#22c55e"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  className="transition-all duration-150"
                />
              ))}

              {/* Active Hover Vertical Guide */}
              {activeX !== null && (
                <line
                  x1={activeX}
                  y1={padTop}
                  x2={activeX}
                  y2={baseY}
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  strokeWidth="1.2"
                />
              )}

              {/* Transparent Hover Hitboxes */}
              {sCurvePoints.map((_, i) => {
                const x = getX(i);
                const colWidth = plotWidth / n;
                return (
                  <rect
                    key={`hit-${i}`}
                    x={x - colWidth / 2}
                    y={padTop}
                    width={colWidth}
                    height={plotHeight + 20}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                );
              })}
            </svg>
          </div>
        </div>

        {/* Hover Tooltip Card */}
        {activePoint && activeX !== null && (
          <div className="mt-2 p-3 bg-zinc-900 text-white rounded-xl text-xs flex flex-wrap items-center justify-between gap-3 shadow-lg animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="font-black text-amber-400">{activePoint.weekLabel}</span>
              <span className="text-zinc-400">({activePoint.dateRangeLabel})</span>
            </div>
            <div className="flex items-center gap-4 font-bold">
              <div className="flex items-center gap-1.5 text-blue-300">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span>Kế hoạch: {activePoint.plannedPercent}%</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Thực tế: {activePoint.actualPercent !== null ? `${activePoint.actualPercent}%` : 'Chưa diễn ra'}</span>
              </div>
              {activePoint.actualPercent !== null && (
                <div className={`px-2 py-0.5 rounded text-[11px] font-black ${
                  activePoint.actualPercent >= activePoint.plannedPercent
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/20 text-red-300'
                }`}>
                  {activePoint.actualPercent >= activePoint.plannedPercent ? '+' : ''}
                  {activePoint.actualPercent - activePoint.plannedPercent}%
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4">
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
            <span className="w-3 h-3 rounded-full bg-blue-500 shadow-sm" />
            <span>Kế hoạch</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-300">
            <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm" />
            <span>Thực tế</span>
          </div>
        </div>

        {/* S-Curve Interpretation Guide */}
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
          <div className="text-[11px] font-black text-zinc-700 dark:text-zinc-300">
            Chỉ cần nhìn khoảng cách giữa 2 đường:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-semibold">
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span>Actual &gt; Plan → <strong className="font-black text-emerald-700 dark:text-emerald-300">đang nhanh</strong></span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 text-blue-800 dark:text-blue-300">
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span>Actual ≈ Plan → <strong className="font-black text-blue-700 dark:text-blue-300">đúng tiến độ</strong></span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50/70 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 text-red-800 dark:text-red-300">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span>Actual &lt; Plan → <strong className="font-black text-red-700 dark:text-red-300">đang chậm</strong></span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/40 text-amber-800 dark:text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>Khoảng cách mở rộng → <strong className="font-black text-amber-700 dark:text-amber-300">tình hình đang xấu dần</strong></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const WeeklyProgressTrendPanel = PlannedVsActualSCurvePanel;

const FastConsDashboard: React.FC<FastConsDashboardProps> = ({ constructionSiteId, projectId }) => {
  const [metrics, setMetrics] = useState<ProjectDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    projectDashboardMetricsService.getSnapshot(projectId, constructionSiteId)
      .then(snapshot => {
        if (!cancelled) {
          setMetrics(snapshot);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err?.message || 'Không tải được cấu hình dashboard');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [constructionSiteId, projectId]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      toast.info('Đang đồng bộ...', 'Đang tổng hợp dữ liệu thực tế từ các phân hệ...');
      const result = await projectDashboardMetricsService.getMetrics({ projectId, constructionSiteId });
      await projectDashboardMetricsService.saveSnapshot(projectId, constructionSiteId, result);
      setMetrics(result);
      toast.success('Đồng bộ thành công', 'Dữ liệu dashboard điều hành đã được cập nhật mới nhất.');
    } catch (err: any) {
      toast.error('Lỗi đồng bộ', err?.message || 'Không thể tổng hợp số liệu dashboard.');
    } finally {
      setIsSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <div className="flex flex-col items-center justify-center gap-3">
          <RefreshCw size={28} className="animate-spin text-slate-400" />
          <div className="text-xs font-black text-slate-500">Đang tải dashboard điều hành...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 rounded-2xl border border-red-200 p-5 text-sm font-bold text-red-700 flex items-center gap-2 justify-center">
        <AlertTriangle size={16} />
        {error}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center max-w-md mx-auto space-y-6 my-8">
        <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mx-auto border border-slate-100 shadow-sm">
          <Activity size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-black text-slate-800">Chưa có dữ liệu snapshot</h3>
          <p className="text-xs text-slate-400 leading-relaxed font-semibold">
            Dashboard điều hành dự án tổng hợp số liệu thực tế từ các phân hệ Gantt, BOQ, Nghiệm thu và PO. Nhấn nút dưới đây để bắt đầu tính toán và đồng bộ dữ liệu lần đầu.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 active:scale-95 transition flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
        >
          {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Đồng bộ & Cập nhật
        </button>
      </div>
    );
  }

  const financial = metrics.financialKPIs;
  const scheduleHealth = metrics.executive.scheduleHealth;
  const approvalQueue = metrics.executive.approvalQueue;
  const timeline = metrics.executive.timeline || {
    todayIso: new Date().toISOString().slice(0, 10),
    projectStart: '',
    projectEnd: scheduleHealth.baselineEndDate,
    projectDurationDays: 0,
    calendarElapsedDays: 0,
    verifiedLogDays: 0,
    forecastProjectEnd: scheduleHealth.forecastEndDate,
    forecastDurationDays: 0,
    forecastDeltaDays: scheduleHealth.forecastDeltaDays,
    plannedProgress: scheduleHealth.plannedProgress,
    actualProgress: scheduleHealth.actualProgress,
    progressVariance: scheduleHealth.progressVariance,
    rows: [],
    activeRows: [],
    completedRows: [],
    lateRows: [],
    upcomingRows: [],
    notStartedRows: [],
  };
  const financialExecutive = metrics.executive.financialExecutive || {
    contractValue: financial?.revisedContractValue || metrics.progress.contractTotalValue || 0,
    received: metrics.cashFlow.cashIn,
    spent: metrics.cashFlow.cashOut,
    cashBalance: metrics.cashFlow.balance,
    upcomingReceivable30d: 0,
    upcomingPayable30d: 0,
    overdueReceivable: 0,
    overduePayable: 0,
    overdueReceivableCount: 0,
    overduePayableCount: 0,
  };
  const taskHighlights = metrics.executive.taskHighlights || {
    active: timeline.activeRows,
    completed: timeline.completedRows,
    late: timeline.lateRows,
    upcoming: timeline.upcomingRows,
  };
  const actionLinks = metrics.executive.actionLinks || [];
  const forecastTone = scheduleHealth.forecastDeltaDays > 0 || scheduleHealth.status === 'red'
    ? 'red'
    : scheduleHealth.status === 'amber'
      ? 'orange'
      : 'emerald';
  const progressTone = scheduleHealth.status === 'red'
    ? 'red'
    : scheduleHealth.status === 'amber'
      ? 'orange'
      : 'blue';
  const progressVarianceText = `${scheduleHealth.progressVariance >= 0 ? '+' : ''}${scheduleHealth.progressVariance}%`;
  const constructionProgressPercent = metrics.progress.constructionProgressPercent ?? metrics.progress.percent ?? 0;
  const valueProgressPercent = metrics.progress.valueProgressPercent ?? (metrics.progress.mode === 'contract_value' ? metrics.progress.percent : 0);
  const projectStatusText = scheduleHealth.status === 'red'
    ? 'Cần can thiệp'
    : scheduleHealth.status === 'amber'
      ? 'Cần theo dõi'
      : 'Ổn định';

  const openProjectTab = (targetTab: string, params?: Record<string, string>) => {
    const query = new URLSearchParams(location.search);
    query.set('tab', targetTab);
    if (projectId) query.set('projectId', projectId);
    if (constructionSiteId) query.set('siteId', constructionSiteId);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    navigate(`/da?${query.toString()}`);
  };

  const openAction = (action: ExecutiveAction) => {
    openProjectTab(action.targetTab, action.params);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-100 dark:border-zinc-800 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarIcon />
              <h2 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-100">Điều hành dự án</h2>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${scheduleHealth.status === 'red' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60' : scheduleHealth.status === 'amber' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60' : 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-teal-200 dark:border-teal-800/60'}`}>
                {projectStatusText}
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              Cập nhật {new Date(metrics.calculatedAt).toLocaleString('vi-VN')} từ tiến độ, tài chính, thanh toán và nhật ký.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm transition-colors disabled:opacity-50"
              title="Đồng bộ lại toàn bộ dữ liệu mới nhất"
            >
              {isSyncing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Cập nhật
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-xl bg-gradient-to-br from-teal-800 to-teal-950 border border-teal-700/50 p-5 text-white shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal-200">
                  <CalendarDays size={16} />
                  Đã thi công
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-5xl font-bold leading-none sm:text-6xl">{timeline.calendarElapsedDays}</span>
                  <span className="pb-1 text-sm font-semibold text-teal-200">ngày</span>
                </div>
                <div className="mt-3 text-sm font-medium text-teal-100/90">
                  Tổng {timeline.projectDurationDays || '-'} ngày kế hoạch · {timeline.verifiedLogDays} ngày có nhật ký xác nhận
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:min-w-[280px]">
                <div className="rounded-lg bg-white/10 backdrop-blur-sm p-3 border border-white/10">
                  <div className="text-[10px] font-medium uppercase text-teal-200">Kết thúc KH</div>
                  <div className="mt-1 text-sm font-bold">{fmtDate(timeline.projectEnd || scheduleHealth.baselineEndDate)}</div>
                </div>
                <div className="rounded-lg bg-white/10 backdrop-blur-sm p-3 border border-white/10">
                  <div className="text-[10px] font-medium uppercase text-teal-200">Kết thúc dự kiến</div>
                  <div className="mt-1 text-sm font-bold">{fmtDate(timeline.forecastProjectEnd || scheduleHealth.forecastEndDate)}</div>
                </div>
                <div className="rounded-lg bg-white/10 backdrop-blur-sm p-3 border border-white/10">
                  <div className="text-[10px] font-medium uppercase text-teal-200">Nhanh/chậm</div>
                  <div className="mt-1 text-sm font-bold">{fmtScheduleDelta(timeline.forecastDeltaDays || scheduleHealth.forecastDeltaDays)}</div>
                </div>
                <div className="rounded-lg bg-white/10 backdrop-blur-sm p-3 border border-white/10">
                  <div className="text-[10px] font-medium uppercase text-teal-200">Tiến độ TT</div>
                  <div className="mt-1 text-sm font-bold">{constructionProgressPercent}%</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ExecutiveKpiCard
              title="Kế hoạch"
              value={`${timeline.plannedProgress || scheduleHealth.plannedProgress}%`}
              sub={`Thực tế lệch ${progressVarianceText}`}
              icon={<Gauge size={17} />}
              tone={progressTone}
              onClick={() => openProjectTab('report')}
            />
            <ExecutiveKpiCard
              title="Forecast"
              value={fmtScheduleDelta(timeline.forecastDeltaDays || scheduleHealth.forecastDeltaDays)}
              sub={`Dự kiến ${fmtDate(timeline.forecastProjectEnd || scheduleHealth.forecastEndDate)}`}
              icon={<TimerReset size={17} />}
              tone={forecastTone}
              onClick={() => openProjectTab('gantt')}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <ExecutiveKpiCard
          title="Tiến độ thi công"
          value={`${constructionProgressPercent}%`}
          sub={`KH ${timeline.plannedProgress || scheduleHealth.plannedProgress}% · ${progressVarianceText}`}
          icon={<Activity size={17} />}
          tone={progressTone}
          onClick={() => openProjectTab('gantt')}
        />
        <ExecutiveKpiCard
          title="Tiến độ giá trị"
          value={`${valueProgressPercent}%`}
          sub={`${fmtMoney(metrics.progress.actualProductionValue || metrics.progress.recognizedValue || 0)} / ${fmtMoney(metrics.progress.contractTotalValue || 0)}`}
          icon={<CircleDollarSign size={17} />}
          tone={valueProgressPercent >= constructionProgressPercent ? 'emerald' : 'orange'}
          onClick={() => openProjectTab('gantt')}
        />
        <ExecutiveKpiCard
          title="Tổng hợp đồng"
          value={fmtMoney(financialExecutive.contractValue)}
          sub={fmtFull(financialExecutive.contractValue)}
          icon={<FileText size={17} />}
          tone="slate"
          onClick={() => openProjectTab('contract')}
        />
        <ExecutiveKpiCard
          title="Đã thu"
          value={fmtMoney(financialExecutive.received)}
          sub={`Tiền thật đã ghi nhận`}
          icon={<WalletCards size={17} />}
          tone="emerald"
          onClick={() => openProjectTab('finance', { financeTab: 'cashflow' })}
        />
        <ExecutiveKpiCard
          title="Đã chi"
          value={fmtMoney(financialExecutive.spent)}
          sub={`Số dư ${fmtMoney(financialExecutive.cashBalance)}`}
          icon={<Banknote size={17} />}
          tone={financialExecutive.cashBalance >= 0 ? 'blue' : 'red'}
          onClick={() => openProjectTab('finance', { financeTab: 'cashflow' })}
        />
        <ExecutiveKpiCard
          title="Sắp thu 30 ngày"
          value={fmtMoney(financialExecutive.upcomingReceivable30d)}
          sub={`Quá hạn ${fmtMoney(financialExecutive.overdueReceivable)} · ${financialExecutive.overdueReceivableCount} khoản`}
          icon={<Clock size={17} />}
          tone={financialExecutive.overdueReceivable > 0 ? 'orange' : 'cyan'}
          onClick={() => openProjectTab('payment', { paymentTab: financialExecutive.overdueReceivable > 0 ? 'overdue' : 'upcoming' })}
        />
        <ExecutiveKpiCard
          title="Sắp chi 30 ngày"
          value={fmtMoney(financialExecutive.upcomingPayable30d)}
          sub={`Quá hạn ${fmtMoney(financialExecutive.overduePayable)} · ${financialExecutive.overduePayableCount} khoản`}
          icon={<CalendarClock size={17} />}
          tone={financialExecutive.overduePayable > 0 ? 'red' : 'violet'}
          onClick={() => openProjectTab('payment', { paymentTab: financialExecutive.overduePayable > 0 ? 'overdue' : 'upcoming' })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <TaskHighlightPanel
          title="Đang thi công"
          rows={taskHighlights.active}
          empty="Chưa có hạng mục đang thi công."
          tone="blue"
          onOpenTask={taskId => openProjectTab('gantt', { taskId })}
          onOpenAll={() => openProjectTab('report', { reportStatus: 'active' })}
        />
        <TaskHighlightPanel
          title="Đã hoàn thành"
          rows={taskHighlights.completed}
          empty="Chưa có hạng mục hoàn thành."
          tone="emerald"
          onOpenTask={taskId => openProjectTab('gantt', { taskId })}
          onOpenAll={() => openProjectTab('report', { reportStatus: 'completed' })}
        />
        <TaskHighlightPanel
          title="Chậm / cần xử lý"
          rows={taskHighlights.late}
          empty="Chưa ghi nhận hạng mục chậm."
          tone="red"
          onOpenTask={taskId => openProjectTab('gantt', { taskId })}
          onOpenAll={() => openProjectTab('report', { reportStatus: 'late' })}
        />
        <TaskHighlightPanel
          title="Sắp đến hạn"
          rows={taskHighlights.upcoming}
          empty="Chưa có hạng mục sắp đến hạn."
          tone="orange"
          onOpenTask={taskId => openProjectTab('gantt', { taskId })}
          onOpenAll={() => openProjectTab('gantt')}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shadow-sm border border-zinc-200 dark:border-zinc-700">
              <ListChecks size={15} />
            </div>
            <div>
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Hành động nhanh</div>
              <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">Mở đúng tab và bộ lọc liên quan</div>
            </div>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{actionLinks.length} lối tắt</div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {actionLinks.slice(0, 8).map(action => (
            <ExecutiveActionCard key={action.id} action={action} onOpen={openAction} />
          ))}
          {actionLinks.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-xs font-medium text-zinc-400 md:col-span-2 xl:col-span-4">
              Cần bấm Cập nhật để tạo các lối tắt điều hành mới.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ScheduleHealthPanel metrics={metrics} />
        <PriorityAlertsPanel metrics={metrics} />
        <ApprovalQueuePanel metrics={metrics} />
      </div>

      <WeeklyProgressTrendPanel constructionSiteId={constructionSiteId} projectId={projectId} currentMetrics={metrics} />

      <PaymentRiskPanel metrics={metrics} />

      {/* === Bảng Đối Soát 3 Bên (FastCons-style) === */}
      <ReconciliationTable owner={metrics.owner} subcontractor={metrics.subcontractor} supplier={metrics.supplier} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-teal-700/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400 flex items-center justify-center">
              <ShieldCheck size={15} />
            </div>
            <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Chi phí theo KL thi công</h3>
          </div>
          <MetricRow label="Chi phí dự toán KL đã thực hiện" value={metrics.constructionCost.performedBudgetCost} highlight />
          <MetricRow label="Chi phí trả thầu phụ" value={metrics.constructionCost.subcontractPaid} />
          <MetricRow label="Chi phí trả NCC" value={metrics.constructionCost.supplierPaid} />
          <MetricRow label="Chi phí khác" value={metrics.constructionCost.otherCost} />
          <MetricRow label="Tổng chi phí thực tế" value={metrics.constructionCost.totalActualCost} highlight />
          <div className={`mt-3 text-sm font-bold ${metricTone(metrics.constructionCost.forecastProfitLoss)}`}>
            Dự trù lãi/lỗ: {fmtFull(metrics.constructionCost.forecastProfitLoss)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 flex items-center justify-center">
              <Package size={15} />
            </div>
            <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Vật liệu và định mức</h3>
          </div>
          <MetricRow label="CP vật liệu theo dự toán" value={metrics.material.materialPurchasedBudgetCost} highlight />
          <MetricRow label="CP vật liệu theo PO/phiếu mua" value={metrics.material.materialPurchasedActualCost} />
          <div className={`py-2 text-xs font-bold ${metricTone(metrics.material.materialPurchaseProfitLoss)}`}>
            Dự trù lãi/lỗ vật liệu: {fmtFull(metrics.material.materialPurchaseProfitLoss)}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <MiniCount label="Vượt định mức" value={metrics.material.overLimitCount} />
            <MiniCount label="Cảnh báo 1" value={metrics.material.warningLevel1Count} />
            <MiniCount label="Cảnh báo 2" value={metrics.material.warningLevel2Count} />
            <MiniCount label="CV vượt VT" value={metrics.material.taskMaterialOverCount} />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center">
              <FileText size={15} />
            </div>
            <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-200">Dòng tiền và công nợ</h3>
          </div>
          <MetricRow label="Giá trị thu" value={metrics.cashFlow.cashIn} highlight />
          <MetricRow label="Giá trị chi" value={metrics.cashFlow.cashOut} />
          <MetricRow label="Số dư" value={metrics.cashFlow.balance} highlight />
          <MetricRow label="Phải thu" value={metrics.cashFlow.receivable} />
          <MetricRow label="Phải trả" value={metrics.cashFlow.payable} />
          <div className="mt-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Khoản quá hạn</span>
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{metrics.cashFlow.overdueCount}</span>
          </div>
        </div>
      </div>

      {financial && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard title="Chênh lệch ngân sách" value={fmtMoney(financial.budgetVariance)} sub={`${financial.budgetVariancePercent}%`} icon={<Activity size={15} />} tone={financial.budgetVariance >= 0 ? 'emerald' : 'red'} />
          <SummaryCard title="Biên lợi nhuận HĐ" value={fmtMoney(financial.contractMargin)} sub={`${financial.contractMarginPercent}%`} icon={<CircleDollarSign size={15} />} tone={financial.contractMargin >= 0 ? 'emerald' : 'orange'} />
          <SummaryCard title="Doanh thu xác nhận" value={fmtMoney(financial.totalCertifiedRevenue)} sub={`Đã TT ${fmtMoney(financial.totalPaidRevenue)}`} icon={<ShieldCheck size={15} />} tone="blue" />
          <SummaryCard title="Tạm ứng còn lại" value={fmtMoney(financial.totalAdvanceOutstanding)} sub={`Giữ lại ${fmtMoney(financial.totalRetentionHeld)}`} icon={<Banknote size={15} />} tone="violet" />
        </div>
      )}

      {(metrics.warnings.length > 0 || metrics.sourceNotes.length > 0) && (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4">
          <div className="text-[11px] font-bold uppercase text-zinc-500 dark:text-zinc-400 mb-2">Ghi chú dữ liệu</div>
          <div className="space-y-1">
            {metrics.sourceNotes.map((note, index) => (
              <p key={`note-${index}`} className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{note}</p>
            ))}
            {metrics.warnings.map((warning, index) => (
              <p key={`warning-${index}`} className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Thiếu nguồn: {warning}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const MiniCount = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">
    <div className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
    <div className="text-base font-bold text-zinc-800 dark:text-zinc-200">{value}</div>
  </div>
);

const MiniMoney = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 min-w-0">
    <div className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 truncate">{label}</div>
    <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200 truncate">{fmtMoney(value)}</div>
  </div>
);

const BarIcon = () => (
  <div className="w-8 h-8 rounded-xl bg-teal-700/10 text-teal-700 dark:bg-teal-500/20 dark:text-teal-400 flex items-center justify-center">
    <Activity size={15} />
  </div>
);

export default FastConsDashboard;
