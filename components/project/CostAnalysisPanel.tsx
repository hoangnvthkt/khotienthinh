import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, BarChart3, ChevronDown, ChevronRight,
  DollarSign, RefreshCw,
} from 'lucide-react';
import { ProjectCostItem } from '../../types';
import { projectCostItemService } from '../../lib/projectCostItemService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { useToast } from '../../context/ToastContext';

interface Props {
  constructionSiteId: string;
}

const fmt = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return n.toLocaleString('vi-VN') + ' đ';
};

const CostAnalysisPanel: React.FC<Props> = ({ constructionSiteId }) => {
  const toast = useToast();
  const [items, setItems] = useState<ProjectCostItem[]>([]);
  const [warnings, setWarnings] = useState<Array<{ item: ProjectCostItem; overPercent: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [paymentSummary, setPaymentSummary] = useState<{ totalPaid: number; totalApproved: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let costItems = await projectCostItemService.listBySite(constructionSiteId);
      // Auto-init if empty
      if (costItems.length === 0) {
        costItems = await projectCostItemService.initDefault(constructionSiteId);
      }
      setItems(costItems);

      const w = await projectCostItemService.checkThresholds(constructionSiteId);
      setWarnings(w);

      // Payment summary across all contracts
      const certs = await paymentCertificateService.listBySite(constructionSiteId);
      const totalPaid = certs.filter(c => c.status === 'paid').reduce((s, c) => s + c.currentPayableAmount, 0);
      const totalApproved = certs.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + c.currentPayableAmount, 0);
      setPaymentSummary({ totalPaid, totalApproved });
    } catch (e: any) { toast.error('Lỗi tải CP', e?.message); }
    finally { setLoading(false); }
  }, [constructionSiteId]);

  useEffect(() => { load(); }, [load]);

  const rootItems = items.filter(i => !i.parentId);
  const getChildren = (parentId: string) => items.filter(i => i.parentId === parentId);

  const totalBudget = rootItems.reduce((s, i) => s + i.budgetAmount, 0);
  const totalActual = rootItems.reduce((s, i) => s + i.actualAmount, 0);
  const margin = totalBudget - totalActual;
  const marginPercent = totalBudget > 0 ? (margin / totalBudget) * 100 : 0;

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
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Dự toán</div>
          <div className="text-lg font-black text-slate-800 dark:text-white">{fmt(totalBudget)}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Thực tế</div>
          <div className="text-lg font-black text-orange-600">{fmt(totalActual)}</div>
        </div>
        <div className={`rounded-xl p-4 border ${margin >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          <div className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1">
            {margin >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} Lãi/Lỗ
          </div>
          <div className={`text-lg font-black ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {margin >= 0 ? '+' : ''}{fmt(margin)}
          </div>
          <div className={`text-[9px] font-bold ${margin >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {marginPercent.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Đã thu (TT)</div>
          <div className="text-lg font-black text-blue-600">{fmt(paymentSummary?.totalPaid || 0)}</div>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-800">
          <div className="text-[10px] font-black text-amber-700 flex items-center gap-1 mb-2">
            <AlertTriangle size={12} /> Cảnh báo ngưỡng chi phí ({warnings.length})
          </div>
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-amber-700 font-medium">{w.item.code} {w.item.name}</span>
                <span className="font-bold text-red-600">{w.overPercent}% dự toán</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost breakdown table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <BarChart3 size={13} className="text-indigo-500" /> Danh mục chi phí dự án
          </h4>
          <button onClick={load} className="text-slate-400 hover:text-indigo-500"><RefreshCw size={12} /></button>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-700">
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase w-10">#</th>
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase">Khoản mục</th>
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase text-right">Dự toán</th>
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase text-right">Thực tế</th>
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase text-right">Chênh lệch</th>
              <th className="px-3 py-2 text-[9px] font-black text-slate-500 uppercase text-center w-24">Tiến độ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
            {rootItems.map(item => {
              const children = getChildren(item.id);
              const hasChildren = children.length > 0;
              const isExpanded = expanded.has(item.id);
              const variance = item.actualAmount - item.budgetAmount;
              const pct = item.budgetAmount > 0 ? (item.actualAmount / item.budgetAmount) * 100 : 0;

              return (
                <React.Fragment key={item.id}>
                  <tr className="font-bold hover:bg-slate-50/50 dark:hover:bg-slate-700/30 cursor-pointer" onClick={() => hasChildren && toggleExpand(item.id)}>
                    <td className="px-3 py-2 text-xs text-indigo-600">
                      {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-800 dark:text-white">{item.code} {item.name}</td>
                    <td className="px-3 py-2 text-xs text-right">{fmt(item.budgetAmount)}</td>
                    <td className="px-3 py-2 text-xs text-right text-orange-600">{fmt(item.actualAmount)}</td>
                    <td className={`px-3 py-2 text-xs text-right font-bold ${variance <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {variance > 0 ? '+' : ''}{fmt(variance)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className="text-[8px] font-bold text-slate-400 w-8">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                  {hasChildren && isExpanded && children.map(child => {
                    const cv = child.actualAmount - child.budgetAmount;
                    const cp = child.budgetAmount > 0 ? (child.actualAmount / child.budgetAmount) * 100 : 0;
                    return (
                      <tr key={child.id} className="hover:bg-indigo-50/20">
                        <td className="px-3 py-1.5"></td>
                        <td className="px-3 py-1.5 text-[10px] text-slate-600 pl-8">{child.code} {child.name}</td>
                        <td className="px-3 py-1.5 text-[10px] text-right">{fmt(child.budgetAmount)}</td>
                        <td className="px-3 py-1.5 text-[10px] text-right text-orange-500">{fmt(child.actualAmount)}</td>
                        <td className={`px-3 py-1.5 text-[10px] text-right ${cv <= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{cv > 0 ? '+' : ''}{fmt(cv)}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${cp > 100 ? 'bg-red-400' : 'bg-blue-400'}`} style={{ width: `${Math.min(cp, 100)}%` }} />
                            </div>
                            <span className="text-[7px] text-slate-400 w-7">{cp.toFixed(0)}%</span>
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
