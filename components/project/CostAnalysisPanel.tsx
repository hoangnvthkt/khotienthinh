import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, BarChart3, ChevronDown, ChevronRight,
  DollarSign, RefreshCw,
} from 'lucide-react';
import { ProjectCostItem, ProjectFinancialSummary } from '../../types';
import { projectCostItemService } from '../../lib/projectCostItemService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { buildFinancialSummary } from '../../lib/projectFinancialService';
import { useToast } from '../../context/ToastContext';

interface Props {
  constructionSiteId: string;
  projectId?: string | null;
}

const fmt = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return n.toLocaleString('vi-VN') + ' đ';
};

const CostAnalysisPanel: React.FC<Props> = ({ constructionSiteId, projectId }) => {
  const toast = useToast();
  const [items, setItems] = useState<ProjectCostItem[]>([]);
  const [warnings, setWarnings] = useState<Array<{ item: ProjectCostItem; overPercent: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [paymentSummary, setPaymentSummary] = useState<{ totalPaid: number; totalApproved: number } | null>(null);
  const [financialSummary, setFinancialSummary] = useState<ProjectFinancialSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let costItems = await projectCostItemService.listBySite(constructionSiteId, projectId);
      // Auto-init if empty
      if (costItems.length === 0) {
        costItems = await projectCostItemService.initDefault(constructionSiteId, projectId);
      }
      setItems(costItems);

      const w = await projectCostItemService.checkThresholds(constructionSiteId, projectId);
      setWarnings(w);

      // Payment summary across all contracts
      const certs = await paymentCertificateService.listBySite(constructionSiteId, projectId);
	      const totalPaid = certs.filter(c => c.status === 'paid').reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount ?? 0), 0);
	      const totalApproved = certs.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + (c.grossThisPeriod ?? c.currentCompletedValue ?? 0), 0);
	      setPaymentSummary({ totalPaid, totalApproved });
	      setFinancialSummary(await buildFinancialSummary(constructionSiteId, [], projectId));
    } catch (e: any) { toast.error('Lỗi tải CP', e?.message); }
    finally { setLoading(false); }
  }, [constructionSiteId, projectId]);

  useEffect(() => { load(); }, [load]);

  const rootItems = items.filter(i => !i.parentId);
  const getChildren = (parentId: string) => items.filter(i => i.parentId === parentId);

  const totalBudget = rootItems.reduce((s, i) => s + i.budgetAmount, 0);
  const totalActual = rootItems.reduce((s, i) => s + i.actualAmount, 0);
  const budgetVariance = totalBudget - totalActual;
  const budgetVariancePercent = totalBudget > 0 ? (budgetVariance / totalBudget) * 100 : 0;
  const contractMargin = financialSummary?.contractMargin ?? 0;

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) return <div className="text-center py-6 text-sm text-slate-400">Đang tải phân tích chi phí...</div>;

  return (
    <div className="space-y-4">
      {/* Margin KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase mb-1">Dự toán</div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{fmt(totalBudget)}</div>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase mb-1">Thực tế</div>
          <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{fmt(totalActual)}</div>
        </div>
        <div className={`rounded-xl p-4 border ${budgetVariance >= 0 ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60' : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/60'}`}>
          <div className="text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase flex items-center gap-1 mb-1">
            {budgetVariance >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} Chênh lệch ngân sách
          </div>
          <div className={`text-lg font-bold ${budgetVariance >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
            {budgetVariance >= 0 ? '+' : ''}{fmt(budgetVariance)}
          </div>
          <div className={`text-[9px] font-bold ${budgetVariance >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-500'}`}>
            {budgetVariancePercent.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 shadow-sm">
          <div className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase mb-1">DT nghiệm thu / Margin</div>
          <div className="text-lg font-bold text-teal-700 dark:text-teal-400">{fmt(paymentSummary?.totalApproved || 0)}</div>
          <div className={`text-[9px] font-bold ${contractMargin >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-500'}`}>Margin: {fmt(contractMargin)}</div>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3 border border-amber-200 dark:border-amber-800/60">
          <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-2">
            <AlertTriangle size={12} /> Cảnh báo ngưỡng chi phí ({warnings.length})
          </div>
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-amber-800 dark:text-amber-300 font-medium">{w.item.code} {w.item.name}</span>
                <span className="font-bold text-red-600 dark:text-red-400">{w.overPercent}% dự toán</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost breakdown table */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
            <BarChart3 size={13} className="text-teal-700 dark:text-teal-400" /> Danh mục chi phí dự án
          </h4>
          <button onClick={load} className="text-zinc-400 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"><RefreshCw size={12} /></button>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/60">
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase w-10">#</th>
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase">Khoản mục</th>
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase text-right">Dự toán</th>
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase text-right">Thực tế</th>
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase text-right">Chênh lệch</th>
              <th className="px-3 py-2 text-[9px] font-bold text-zinc-500 dark:text-zinc-400 uppercase text-center w-24">Tiến độ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rootItems.map(item => {
              const children = getChildren(item.id);
              const hasChildren = children.length > 0;
              const isExpanded = expanded.has(item.id);
              const variance = item.actualAmount - item.budgetAmount;
              const pct = item.budgetAmount > 0 ? (item.actualAmount / item.budgetAmount) * 100 : 0;

              return (
                <React.Fragment key={item.id}>
                  <tr className="font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer" onClick={() => hasChildren && toggleExpand(item.id)}>
                    <td className="px-3 py-2 text-xs text-teal-700 dark:text-teal-400">
                      {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200">{item.code} {item.name}</td>
                    <td className="px-3 py-2 text-xs text-right">{fmt(item.budgetAmount)}</td>
                    <td className="px-3 py-2 text-xs text-right text-amber-700 dark:text-amber-400">{fmt(item.actualAmount)}</td>
                    <td className={`px-3 py-2 text-xs text-right font-bold ${variance <= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
                      {variance > 0 ? '+' : ''}{fmt(variance)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-teal-600'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-[8px] font-bold text-zinc-400 w-8">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                  {hasChildren && isExpanded && children.map(child => {
                    const cv = child.actualAmount - child.budgetAmount;
                    const cp = child.budgetAmount > 0 ? (child.actualAmount / child.budgetAmount) * 100 : 0;
                    return (
                      <tr key={child.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5 text-[10px] text-zinc-600 dark:text-zinc-400 pl-8">{child.code} {child.name}</td>
                        <td className="px-3 py-1.5 text-[10px] text-right">{fmt(child.budgetAmount)}</td>
                        <td className="px-3 py-1.5 text-[10px] text-right text-amber-700 dark:text-amber-400">{fmt(child.actualAmount)}</td>
                        <td className={`px-3 py-1.5 text-[10px] text-right ${cv <= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-500'}`}>{cv > 0 ? '+' : ''}{fmt(cv)}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <div className="flex-1 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${cp > 100 ? 'bg-red-400' : 'bg-teal-500'}`} style={{ width: `${Math.min(cp, 100)}%` }} />
                            </div>
                            <span className="text-[7px] text-zinc-400 w-7">{cp.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CostAnalysisPanel;
