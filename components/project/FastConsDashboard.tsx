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
              <div className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${row.dayDelta > 0 ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : row.dayDelta < 0 ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                {fmtScheduleDelta(row.dayDelta)}
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
    { label: 'Task/gate pending', value: queue.taskCompletionSubmitted + queue.taskGatePending },
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

const getISOWeekLabel = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(weekNo).padStart(2, '0')}/${d.getUTCFullYear()}`;
};

const getWeekStart = (date: Date): string => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
};

const WeeklyProgressTrendPanel: React.FC<{
  constructionSiteId: string;
  projectId?: string;
  currentMetrics: ProjectDashboardMetrics;
}> = ({ constructionSiteId, projectId, currentMetrics }) => {
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([]);
  const [loading, setLoading] = useState(true);

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
          .select('*')
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

  const constructionProgressPercent = currentMetrics.progress.constructionProgressPercent ?? currentMetrics.progress.percent ?? 0;
  const valueProgressPercent = currentMetrics.progress.valueProgressPercent ?? (currentMetrics.progress.mode === 'contract_value' ? currentMetrics.progress.percent : 0);

  // Save current week snapshot whenever metrics change (from sync)
  useEffect(() => {
    if (!isSupabaseConfigured || !currentMetrics) return;
    const now = new Date();
    const weekLabel = getISOWeekLabel(now);
    const weekStart = getWeekStart(now);
    const snapshot: Record<string, unknown> = {
      scope_key: scopeKey,
      project_id: projectId || null,
      construction_site_id: constructionSiteId || null,
      week_label: weekLabel,
      week_start: weekStart,
      progress_percent: constructionProgressPercent,
      progress_mode: currentMetrics.progress.mode,
      construction_progress_percent: constructionProgressPercent,
      value_progress_percent: valueProgressPercent,
      supplied_value: currentMetrics.progress.suppliedValue || null,
      contract_total_value: currentMetrics.progress.contractTotalValue || null,
      purchased_value: currentMetrics.progress.purchasedValue || 0,
      issued_value: currentMetrics.progress.issuedValue || 0,
      recognized_value: currentMetrics.progress.recognizedValue || currentMetrics.progress.suppliedValue || 0,
      gantt_percent: currentMetrics.progress.ganttPercent || null,
      calculated_at: currentMetrics.calculatedAt,
      updated_at: new Date().toISOString(),
    };
    supabase
      .from('weekly_progress_snapshots')
      .upsert(snapshot, { onConflict: 'scope_key,week_start' })
      .then(({ error }) => {
        if (error) console.warn('Failed to save weekly snapshot:', error);
        else {
          // Refresh snapshots after upsert
          supabase
            .from('weekly_progress_snapshots')
            .select('*')
            .eq('scope_key', scopeKey)
            .order('week_start', { ascending: true })
            .limit(24)
            .then(({ data }) => {
              if (data) setSnapshots(data.map(row => fromDb(row) as WeeklySnapshot));
            });
        }
      });
  }, [constructionProgressPercent, currentMetrics, currentMetrics.calculatedAt, scopeKey, constructionSiteId, projectId, valueProgressPercent]);

  const displaySnapshots = snapshots.slice(-12);
  const maxPercent = Math.max(100, ...displaySnapshots.map(s => s.progressPercent));
  const isContractValueMode = currentMetrics.progress.mode === 'contract_value';

  if (loading) return null;
  if (displaySnapshots.length < 2) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
            <TrendingUp size={15} />
          </div>
          <div>
            <h3 className="text-xs font-black text-slate-800">Trend tiến độ theo tuần</h3>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
              Tiến độ thi công tuần · {isContractValueMode ? 'Dự án đang chọn mode giá trị' : currentMetrics.progress.modeLabel} · {displaySnapshots.length} tuần gần nhất
            </p>
          </div>
        </div>
        <span className="text-lg font-black text-slate-900">{constructionProgressPercent}%</span>
      </div>
      <div className="p-4">
        <div className="flex items-end gap-1.5" style={{ height: 160 }}>
          {displaySnapshots.map((snap, idx) => {
            const barHeight = maxPercent > 0 ? (snap.progressPercent / maxPercent) * 100 : 0;
            const isLast = idx === displaySnapshots.length - 1;
            const delta = idx > 0 ? snap.progressPercent - displaySnapshots[idx - 1].progressPercent : 0;
            return (
              <div key={snap.weekStart} className="flex-1 flex flex-col items-center justify-end h-full gap-1 group relative">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                  <div className="bg-slate-900 text-white text-[10px] font-bold rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
                    <div>{snap.weekLabel}</div>
                    <div className="mt-0.5">{snap.progressPercent}%{delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta}%)` : ''}</div>
                    {snap.valueProgressPercent != null && (
                      <div className="mt-0.5 text-slate-300">GT: {snap.valueProgressPercent}% · {fmtMoney(snap.recognizedValue || snap.suppliedValue || 0)}</div>
                    )}
                  </div>
                </div>
                {/* Bar */}
                <div
                  className={`w-full rounded-t-md transition-all duration-300 ${isLast ? 'bg-indigo-500' : 'bg-slate-200 group-hover:bg-indigo-300'}`}
                  style={{ height: `${Math.max(2, barHeight)}%`, minHeight: 2 }}
                />
                {/* Label */}
                <span className={`text-[9px] font-bold ${isLast ? 'text-indigo-700' : 'text-slate-400'} leading-tight text-center`}>
                  {snap.weekLabel.split('/')[0]}
                </span>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="text-[10px] font-semibold text-slate-400">
            {displaySnapshots[0]?.weekLabel} → {displaySnapshots[displaySnapshots.length - 1]?.weekLabel}
          </span>
          {displaySnapshots.length >= 2 && (
            <span className={`text-[10px] font-black ${(displaySnapshots[displaySnapshots.length - 1].progressPercent - displaySnapshots[0].progressPercent) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {(displaySnapshots[displaySnapshots.length - 1].progressPercent - displaySnapshots[0].progressPercent) >= 0 ? '+' : ''}
              {displaySnapshots[displaySnapshots.length - 1].progressPercent - displaySnapshots[0].progressPercent}% trong kỳ
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

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
