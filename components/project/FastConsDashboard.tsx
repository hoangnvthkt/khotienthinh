import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileText,
  HardHat,
  Package,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import {
  PartyDashboardMetric,
  ProjectDashboardMetrics,
  SupplierDashboardMetric,
  projectDashboardMetricsService,
} from '../../lib/projectDashboardMetricsService';

interface FastConsDashboardProps {
  constructionSiteId: string;
  projectId?: string;
}

const fmtMoney = (value: number): string => {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} tỷ`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString('vi-VN');
};

const fmtFull = (value: number): string => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} đ`;

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
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase font-black tracking-wide opacity-70">{title}</div>
          <div className="mt-1 text-lg md:text-xl font-black truncate">{value}</div>
        </div>
        <div className="w-9 h-9 shrink-0 rounded-xl bg-white/80 shadow-sm flex items-center justify-center">
          {icon}
        </div>
      </div>
      {sub && <div className="mt-2 text-[11px] font-semibold opacity-75 truncate">{sub}</div>}
    </div>
  );
};

const MetricRow = ({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-b-0">
    <span className="text-[11px] font-semibold text-slate-500">{label}</span>
    <span className={`text-xs font-black text-right ${highlight ? 'text-slate-900' : 'text-slate-700'}`}>
      {fmtFull(value)}
    </span>
  </div>
);

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
    <th className={`px-3 py-3 text-center ${bg}`}>
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
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="px-4 py-3 text-left w-[200px] bg-slate-50">
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

const FastConsDashboard: React.FC<FastConsDashboardProps> = ({ constructionSiteId, projectId }) => {
  const [metrics, setMetrics] = useState<ProjectDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    projectDashboardMetricsService.getMetrics({ projectId, constructionSiteId })
      .then(result => {
        if (!cancelled) setMetrics(result);
      })
      .catch(err => {
        if (!cancelled) setError(err?.message || 'Không tải được dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [constructionSiteId, projectId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2 text-xs font-black text-slate-500">
          <RefreshCw size={14} className="animate-spin" />
          Đang tổng hợp dashboard FastCons...
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="bg-red-50 rounded-2xl border border-red-200 p-5 text-sm font-bold text-red-700 flex items-center gap-2">
        <AlertTriangle size={16} />
        {error || 'Không có dữ liệu dashboard'}
      </div>
    );
  }

  const financial = metrics.financialKPIs;

  return (
    <section className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <BarIcon />
              Dashboard điều hành dự án
            </h2>
            <p className="text-[11px] font-semibold text-slate-400 mt-1">
              Tổng hợp từ Gantt, BOQ, nghiệm thu, thanh toán, tạm ứng, PO và dòng tiền hiện có.
            </p>
          </div>
          <div className="text-[10px] font-bold text-slate-400">
            Cập nhật {new Date(metrics.calculatedAt).toLocaleString('vi-VN')}
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryCard
            title="Tiến độ dự án"
            value={`${metrics.progress.percent}%`}
            sub={`${metrics.progress.modeLabel} · Gantt ${metrics.progress.ganttPercent}%`}
            icon={<Activity size={16} />}
            tone="blue"
          />
          <SummaryCard
            title="Vị thế tiền mặt"
            value={fmtMoney(metrics.cashFlow.balance)}
            sub={`Thu ${fmtMoney(metrics.cashFlow.cashIn)} · Chi ${fmtMoney(metrics.cashFlow.cashOut)}`}
            icon={<Banknote size={16} />}
            tone={metrics.cashFlow.balance >= 0 ? 'emerald' : 'red'}
          />
          <SummaryCard
            title="Dự trù lãi/lỗ"
            value={fmtMoney(metrics.constructionCost.forecastProfitLoss)}
            sub={`Theo KL thi công và chi phí đã dùng`}
            icon={<CircleDollarSign size={16} />}
            tone={metrics.constructionCost.forecastProfitLoss >= 0 ? 'emerald' : 'orange'}
          />
          <SummaryCard
            title="Chi phí 7 ngày tới"
            value={fmtMoney(metrics.sevenDayForecast.totalCost)}
            sub={`${metrics.sevenDayForecast.taskCount} hạng mục đang chạy`}
            icon={<CalendarClock size={16} />}
            tone="violet"
          />
        </div>
      </div>

      {/* === Bảng Đối Soát 3 Bên (FastCons-style) === */}
      <ReconciliationTable owner={metrics.owner} subcontractor={metrics.subcontractor} supplier={metrics.supplier} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <ShieldCheck size={15} />
            </div>
            <h3 className="text-xs font-black text-slate-800">Chi phí theo KL thi công</h3>
          </div>
          <MetricRow label="Chi phí dự toán KL đã thực hiện" value={metrics.constructionCost.performedBudgetCost} highlight />
          <MetricRow label="Chi phí trả thầu phụ" value={metrics.constructionCost.subcontractPaid} />
          <MetricRow label="Chi phí trả NCC" value={metrics.constructionCost.supplierPaid} />
          <MetricRow label="Chi phí khác" value={metrics.constructionCost.otherCost} />
          <MetricRow label="Tổng chi phí thực tế" value={metrics.constructionCost.totalActualCost} highlight />
          <div className={`mt-3 text-sm font-black ${metricTone(metrics.constructionCost.forecastProfitLoss)}`}>
            Dự trù lãi/lỗ: {fmtFull(metrics.constructionCost.forecastProfitLoss)}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Package size={15} />
            </div>
            <h3 className="text-xs font-black text-slate-800">Vật liệu và định mức</h3>
          </div>
          <MetricRow label="CP vật liệu theo dự toán" value={metrics.material.materialPurchasedBudgetCost} highlight />
          <MetricRow label="CP vật liệu theo PO/phiếu mua" value={metrics.material.materialPurchasedActualCost} />
          <div className={`py-2 text-xs font-black ${metricTone(metrics.material.materialPurchaseProfitLoss)}`}>
            Dự trù lãi/lỗ vật liệu: {fmtFull(metrics.material.materialPurchaseProfitLoss)}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <MiniCount label="Vượt định mức" value={metrics.material.overLimitCount} />
            <MiniCount label="Cảnh báo 1" value={metrics.material.warningLevel1Count} />
            <MiniCount label="Cảnh báo 2" value={metrics.material.warningLevel2Count} />
            <MiniCount label="CV vượt VT" value={metrics.material.taskMaterialOverCount} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <FileText size={15} />
            </div>
            <h3 className="text-xs font-black text-slate-800">Dòng tiền và công nợ</h3>
          </div>
          <MetricRow label="Giá trị thu" value={metrics.cashFlow.cashIn} highlight />
          <MetricRow label="Giá trị chi" value={metrics.cashFlow.cashOut} />
          <MetricRow label="Số dư" value={metrics.cashFlow.balance} highlight />
          <MetricRow label="Phải thu" value={metrics.cashFlow.receivable} />
          <MetricRow label="Phải trả" value={metrics.cashFlow.payable} />
          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500">Khoản quá hạn</span>
            <span className="text-sm font-black text-slate-800">{metrics.cashFlow.overdueCount}</span>
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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-[11px] font-black uppercase text-slate-500 mb-2">Ghi chú dữ liệu</div>
          <div className="space-y-1">
            {metrics.sourceNotes.map((note, index) => (
              <p key={`note-${index}`} className="text-[11px] font-semibold text-slate-500">{note}</p>
            ))}
            {metrics.warnings.map((warning, index) => (
              <p key={`warning-${index}`} className="text-[11px] font-semibold text-amber-700">Thiếu nguồn: {warning}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const MiniCount = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
    <div className="text-[10px] font-bold text-slate-400 truncate">{label}</div>
    <div className="text-base font-black text-slate-800">{value}</div>
  </div>
);

const BarIcon = () => (
  <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
    <Activity size={15} />
  </div>
);

export default FastConsDashboard;
