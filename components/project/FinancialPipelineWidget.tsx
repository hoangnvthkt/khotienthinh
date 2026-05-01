import React, { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, CheckCircle, DollarSign, RotateCcw,
  AlertTriangle, ChevronRight, ShieldCheck, BarChart3
} from 'lucide-react';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { advancePaymentService } from '../../lib/advancePaymentService';
import { quantityAcceptanceService } from '../../lib/quantityAcceptanceService';
import { contractItemService } from '../../lib/contractItemService';
import { projectFinancialService, ProjectFinancialKPIs } from '../../lib/projectFinancialService';

interface Props {
  contractId: string;
  contractType: 'customer' | 'subcontractor';
  constructionSiteId: string;
}

const fmt = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' tr';
  return n.toLocaleString('vi-VN');
};

const pct = (a: number, b: number) =>
  b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0;

interface PipelineData {
  contractValue: number;
  revisedContractValue: number;
  totalAccepted: number;
  totalCertified: number;
  totalPaid: number;
  totalRetention: number;
  advanceTotalAmount: number;
  advanceTotalRecovered: number;
  advanceTotalRemaining: number;
  certCount: number;
  paidCertCount: number;
}

const FinancialPipelineWidget: React.FC<Props> = ({ contractId, contractType, constructionSiteId }) => {
  const [data, setData] = useState<PipelineData | null>(null);
  const [siteKPIs, setSiteKPIs] = useState<ProjectFinancialKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'kpi'>('pipeline');

  useEffect(() => {
    if (!contractId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [paymentSummary, advanceBalance, acceptances, boqItems, kpis] = await Promise.all([
          paymentCertificateService.getPaymentSummary(contractId, contractType),
          advancePaymentService.getBalance(contractId, contractType),
          quantityAcceptanceService.listByContract(contractId, contractType),
          contractItemService.listByContract(contractId, contractType),
          projectFinancialService.getKPIs(constructionSiteId),
        ]);

        if (cancelled) return;

        const approvedAcceptances = acceptances.filter(a => a.status === 'approved');
        const totalAccepted = approvedAcceptances.reduce((s, a) => s + (a.totalAcceptedAmount || 0), 0);
        const revisedContractValue = boqItems.reduce((s, i) => s + (i.revisedTotalPrice ?? i.totalPrice ?? 0), 0);

        setData({
          contractValue: paymentSummary.totalContractValue,
          revisedContractValue,
          totalAccepted,
          totalCertified: paymentSummary.totalApproved,
          totalPaid: paymentSummary.totalPaid,
          totalRetention: paymentSummary.totalRetention,
          advanceTotalAmount: advanceBalance.totalAdvance,
          advanceTotalRecovered: advanceBalance.totalRecovered,
          advanceTotalRemaining: advanceBalance.totalRemaining,
          certCount: paymentSummary.certCount,
          paidCertCount: 0,
        });
        setSiteKPIs(kpis);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [contractId, contractType, constructionSiteId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
        <span className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mr-2" />
        Đang tải dữ liệu tài chính...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm p-4 bg-red-50 rounded-xl border border-red-200">
        <AlertTriangle size={16} />
        <span>Lỗi tải dữ liệu: {error}</span>
      </div>
    );
  }

  const contractValue = data.revisedContractValue || data.contractValue;
  const acceptedPct = pct(data.totalAccepted, contractValue);
  const paidPct = pct(data.totalPaid, contractValue);
  const recoveredPct = pct(data.advanceTotalRecovered, data.advanceTotalAmount);
  const remaining = contractValue - data.totalPaid;

  const stages = [
    {
      icon: <TrendingUp size={18} className="text-blue-600" />,
      bg: 'bg-blue-50 border-blue-200',
      bar: 'bg-blue-500',
      label: 'Giá trị HĐ (BOQ)',
      sub: data.revisedContractValue !== data.contractValue
        ? `Gốc: ${fmt(data.contractValue)} · Sửa đổi: ${fmt(data.revisedContractValue)}`
        : undefined,
      value: fmt(contractValue),
      pctValue: 100,
      pctLabel: '100%',
    },
    {
      icon: <CheckCircle size={18} className="text-violet-600" />,
      bg: 'bg-violet-50 border-violet-200',
      bar: 'bg-violet-500',
      label: 'Đã Nghiệm thu',
      sub: `${data.certCount} đợt`,
      value: fmt(data.totalAccepted),
      pctValue: acceptedPct,
      pctLabel: `${acceptedPct}%`,
    },
    {
      icon: <DollarSign size={18} className="text-emerald-600" />,
      bg: 'bg-emerald-50 border-emerald-200',
      bar: 'bg-emerald-500',
      label: 'Đã Thanh toán',
      sub: data.totalRetention > 0 ? `Bảo lãnh giữ lại: ${fmt(data.totalRetention)}` : undefined,
      value: fmt(data.totalPaid),
      pctValue: paidPct,
      pctLabel: `${paidPct}%`,
    },
    {
      icon: <RotateCcw size={18} className="text-orange-600" />,
      bg: 'bg-orange-50 border-orange-200',
      bar: 'bg-orange-500',
      label: 'Thu hồi Tạm ứng',
      sub: data.advanceTotalAmount > 0
        ? `TU gốc: ${fmt(data.advanceTotalAmount)} · Còn lại: ${fmt(data.advanceTotalRemaining)}`
        : 'Không có tạm ứng',
      value: fmt(data.advanceTotalRecovered),
      pctValue: recoveredPct,
      pctLabel: `${recoveredPct}%`,
    },
  ];

  // ── Site-level 4 KPIs từ projectFinancialService ──
  const kpiCards = siteKPIs ? [
    {
      label: 'Chênh lệch ngân sách',
      value: siteKPIs.budgetVariance,
      pctValue: siteKPIs.budgetVariancePercent,
      sub: `NS: ${fmt(siteKPIs.budgetTotal)} · TT: ${fmt(siteKPIs.actualCost)}`,
      icon: siteKPIs.budgetVariance >= 0
        ? <TrendingUp size={16} className="text-emerald-600" />
        : <TrendingDown size={16} className="text-red-600" />,
      positive: siteKPIs.budgetVariance >= 0,
      bg: siteKPIs.budgetVariance >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200',
      textColor: siteKPIs.budgetVariance >= 0 ? 'text-emerald-700' : 'text-red-700',
      pctColor: siteKPIs.budgetVariance >= 0 ? 'text-emerald-600' : 'text-red-600',
    },
    {
      label: 'Biên lợi nhuận HĐ',
      value: siteKPIs.contractMargin,
      pctValue: siteKPIs.contractMarginPercent,
      sub: `HĐ điều chỉnh: ${fmt(siteKPIs.revisedContractValue)}`,
      icon: <DollarSign size={16} className={siteKPIs.contractMargin >= 0 ? 'text-violet-600' : 'text-red-600'} />,
      positive: siteKPIs.contractMargin >= 0,
      bg: siteKPIs.contractMargin >= 0 ? 'bg-violet-50 border-violet-200' : 'bg-red-50 border-red-200',
      textColor: siteKPIs.contractMargin >= 0 ? 'text-violet-700' : 'text-red-700',
      pctColor: siteKPIs.contractMargin >= 0 ? 'text-violet-600' : 'text-red-600',
    },
    {
      label: 'Doanh thu xác nhận',
      value: siteKPIs.totalCertifiedRevenue,
      pctValue: siteKPIs.certificationPercent,
      sub: `Đã TT: ${fmt(siteKPIs.totalPaidRevenue)} · Giữ lại: ${fmt(siteKPIs.totalRetentionHeld)}`,
      icon: <ShieldCheck size={16} className="text-blue-600" />,
      positive: true,
      bg: 'bg-blue-50 border-blue-200',
      textColor: 'text-blue-700',
      pctColor: 'text-blue-600',
    },
    {
      label: 'Vị thế tiền mặt',
      value: siteKPIs.cashPosition,
      pctValue: siteKPIs.cashPositionPercent,
      sub: `Thu: ${fmt(siteKPIs.cashIn)} · Chi: ${fmt(siteKPIs.cashOut)}`,
      icon: <RotateCcw size={16} className={siteKPIs.cashPosition >= 0 ? 'text-indigo-600' : 'text-orange-600'} />,
      positive: siteKPIs.cashPosition >= 0,
      bg: siteKPIs.cashPosition >= 0 ? 'bg-indigo-50 border-indigo-200' : 'bg-orange-50 border-orange-200',
      textColor: siteKPIs.cashPosition >= 0 ? 'text-indigo-700' : 'text-orange-700',
      pctColor: siteKPIs.cashPosition >= 0 ? 'text-indigo-600' : 'text-orange-600',
    },
  ] : [];

  return (
    <div className="space-y-3">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'pipeline'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ChevronRight size={12} /> Dòng chảy HĐ
        </button>
        <button
          onClick={() => setActiveTab('kpi')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'kpi'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <BarChart3 size={12} /> KPI Dự án
        </button>
      </div>

      {activeTab === 'pipeline' && (
        <>
          {/* Pipeline cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stages.map((stage, i) => (
              <div key={i} className={`rounded-2xl border p-4 ${stage.bg} flex flex-col gap-2`}>
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
                    {stage.icon}
                  </div>
                  <span className="text-xs font-black text-slate-500">{stage.pctLabel}</span>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{stage.label}</p>
                  <p className="text-lg font-black text-slate-800 leading-tight">{stage.value}</p>
                  {stage.sub && <p className="text-[10px] text-slate-400 mt-0.5">{stage.sub}</p>}
                </div>
                {/* Progress bar */}
                <div className="h-1.5 bg-white/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${stage.bar} rounded-full transition-all duration-700`}
                    style={{ width: `${stage.pctValue}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Pipeline flow visualization */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Dòng chảy tài chính</p>
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { label: 'GT HĐ', value: contractValue, color: 'bg-blue-500' },
                { label: 'Nghiệm thu', value: data.totalAccepted, color: 'bg-violet-500' },
                { label: 'Chứng từ', value: data.totalCertified, color: 'bg-emerald-400' },
                { label: 'Đã thu', value: data.totalPaid, color: 'bg-emerald-600' },
              ].map((node, i, arr) => (
                <React.Fragment key={i}>
                  <div className="flex flex-col items-center min-w-0">
                    <div
                      className={`h-6 rounded-full ${node.color} transition-all duration-500`}
                      style={{
                        width: `${Math.max(24, pct(node.value, contractValue))}px`,
                        maxWidth: '120px',
                        minWidth: '24px',
                      }}
                    />
                    <p className="text-[9px] text-slate-500 mt-1 font-semibold whitespace-nowrap">{node.label}</p>
                    <p className="text-[10px] font-black text-slate-700">{fmt(node.value)}</p>
                  </div>
                  {i < arr.length - 1 && <ChevronRight size={14} className="text-slate-300 flex-shrink-0 mb-4" />}
                </React.Fragment>
              ))}

              {/* Remaining */}
              <React.Fragment>
                <ChevronRight size={14} className="text-slate-300 flex-shrink-0 mb-4" />
                <div className="flex flex-col items-center">
                  <div className="h-6 rounded-full bg-slate-200 w-6" />
                  <p className="text-[9px] text-slate-400 mt-1 font-semibold">Còn phải thu</p>
                  <p className="text-[10px] font-black text-slate-500">{fmt(remaining)}</p>
                </div>
              </React.Fragment>
            </div>
          </div>
        </>
      )}

      {activeTab === 'kpi' && siteKPIs && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpiCards.map((kpi, i) => (
              <div key={i} className={`rounded-2xl border p-4 ${kpi.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-xl bg-white/70 shadow-sm flex items-center justify-center">
                    {kpi.icon}
                  </div>
                  <span className={`text-xs font-black ${kpi.pctColor}`}>
                    {kpi.pctValue > 0 ? '+' : ''}{kpi.pctValue}%
                  </span>
                </div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{kpi.label}</p>
                <p className={`text-lg font-black leading-tight ${kpi.textColor}`}>
                  {kpi.value > 0 ? '+' : ''}{fmt(kpi.value)}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* Margin breakdown bar */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">Phân tích biên lợi nhuận</p>
            <div className="space-y-2.5">
              {[
                { label: 'HĐ điều chỉnh', value: siteKPIs.revisedContractValue, color: 'bg-blue-500', base: siteKPIs.revisedContractValue },
                { label: 'Chi phí thực tế', value: siteKPIs.actualCost, color: 'bg-red-400', base: siteKPIs.revisedContractValue },
                { label: 'Chi phí cam kết', value: siteKPIs.committedCost, color: 'bg-amber-400', base: siteKPIs.revisedContractValue },
                { label: 'Biên lợi nhuận', value: Math.max(0, siteKPIs.contractMargin), color: 'bg-emerald-500', base: siteKPIs.revisedContractValue },
              ].map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-slate-500 w-28 shrink-0">{row.label}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${row.color} rounded-full transition-all duration-700`}
                      style={{ width: `${pct(row.value, row.base)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-black text-slate-700 w-16 text-right shrink-0">{fmt(row.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialPipelineWidget;
