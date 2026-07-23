import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, BarChart3, ChevronDown, ChevronRight,
  RefreshCw, Edit2, Check, X, Save,
} from 'lucide-react';
import { ProjectFinancialSummary } from '../../types';
import { projectCostItemService, ProjectContractCostAnalysisNode } from '../../lib/projectCostItemService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { buildFinancialSummary } from '../../lib/projectFinancialService';
import { useToast } from '../../context/ToastContext';

interface Props {
  constructionSiteId: string;
  projectId?: string | null;
  onSelectCostItem?: (costItemId: string, symbol: string) => void;
}

const fmt = (n: number) => {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return n.toLocaleString('vi-VN') + ' đ';
};

const TreeRow: React.FC<{
  node: ProjectContractCostAnalysisNode;
  expanded: Set<string>;
  toggleExpand: (id: string) => void;
  onEditBudget: (node: ProjectContractCostAnalysisNode) => void;
  onSelectCostItem?: (costItemId: string, symbol: string) => void;
}> = ({ node, expanded, toggleExpand, onEditBudget, onSelectCostItem }) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const variance = node.totalBudgetAmount - node.actualAmount;
  const pct = node.totalBudgetAmount > 0 ? (node.actualAmount / node.totalBudgetAmount) * 100 : 0;
  const isOverBudget = node.totalBudgetAmount > 0 && node.actualAmount > node.totalBudgetAmount;

  return (
    <React.Fragment>
      <tr
        className={`text-xs transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-700/40 ${
          node.depth === 0 ? 'font-black bg-slate-50/60 dark:bg-slate-800/60' : 'font-semibold'
        }`}
      >
        {/* Toggle Expand Button */}
        <td className="px-3 py-2 text-indigo-600 select-none">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="p-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-indigo-600"
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="inline-block w-4" />
          )}
        </td>

        {/* Item Symbol & Name */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-2" style={{ paddingLeft: `${node.depth * 14}px` }}>
            <button
              type="button"
              onClick={() => onSelectCostItem?.(node.id, node.symbol)}
              className="inline-flex items-center gap-1.5 hover:opacity-80 text-left transition-opacity group cursor-pointer"
              title="Bấm để lọc các giao dịch thuộc khoản mục này trong Sổ giao dịch"
            >
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/40 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
                {node.symbol}
              </span>
              <span className="text-slate-800 dark:text-white font-bold group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {node.name}
              </span>
            </button>

            {node.directTxCount > 0 && (
              <button
                type="button"
                onClick={() => onSelectCostItem?.(node.id, node.symbol)}
                className="inline-flex items-center gap-0.5 text-[9px] font-black text-orange-600 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 px-1.5 py-0.5 rounded-full cursor-pointer transition-colors border border-orange-200/60 dark:border-orange-900/40"
                title={`Click để chuyển sang Sổ giao dịch & lọc ${node.directTxCount} giao dịch thuộc khoản mục này`}
              >
                <span>{node.directTxCount} GD</span>
                <span className="text-[10px]">↗</span>
              </button>
            )}
          </div>
        </td>

        {/* Budget Amount */}
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1 group">
            <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{fmt(node.totalBudgetAmount)}</span>
            <button
              type="button"
              onClick={() => onEditBudget(node)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-indigo-600 transition-opacity"
              title="Sửa dự toán"
            >
              <Edit2 size={11} />
            </button>
          </div>
        </td>

        {/* Actual Amount */}
        <td className="px-3 py-2 text-right font-black text-orange-600 font-mono">
          {fmt(node.actualAmount)}
        </td>

        {/* Variance */}
        <td className={`px-3 py-2 text-right font-bold font-mono ${variance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {variance >= 0 ? '+' : ''}{fmt(variance)}
        </td>

        {/* Progress Bar */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isOverBudget ? 'bg-red-500' : pct > 80 ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className={`text-[9px] font-mono font-bold w-8 text-right ${isOverBudget ? 'text-red-600' : 'text-slate-400'}`}>
              {pct.toFixed(0)}%
            </span>
          </div>
        </td>
      </tr>

      {/* Render children recursively if expanded */}
      {hasChildren && isExpanded && node.children.map(child => (
        <TreeRow
          key={child.id}
          node={child}
          expanded={expanded}
          toggleExpand={toggleExpand}
          onEditBudget={onEditBudget}
          onSelectCostItem={onSelectCostItem}
        />
      ))}
    </React.Fragment>
  );
};

const CostAnalysisPanel: React.FC<Props> = ({ constructionSiteId, projectId, onSelectCostItem }) => {
  const toast = useToast();
  const [treeNodes, setTreeNodes] = useState<ProjectContractCostAnalysisNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentSummary, setPaymentSummary] = useState<{ totalPaid: number; totalApproved: number } | null>(null);
  const [financialSummary, setFinancialSummary] = useState<ProjectFinancialSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Edit budget modal state
  const [editingNode, setEditingNode] = useState<ProjectContractCostAnalysisNode | null>(null);
  const [editingBudgetValue, setEditingBudgetValue] = useState<string>('');
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nodes = await projectCostItemService.listProjectCostAnalysisTree(constructionSiteId, projectId);
      setTreeNodes(nodes);

      // Auto-expand root nodes on first load
      setExpanded(new Set(nodes.map(n => n.id)));

      // Payment summary across all contracts
      const certs = await paymentCertificateService.listBySite(constructionSiteId, projectId);
      const totalPaid = certs.filter(c => c.status === 'paid').reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount ?? 0), 0);
      const totalApproved = certs.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + (c.grossThisPeriod ?? c.currentCompletedValue ?? 0), 0);
      setPaymentSummary({ totalPaid, totalApproved });
      setFinancialSummary(await buildFinancialSummary(constructionSiteId, [], projectId));
    } catch (e: any) {
      toast.error('Lỗi tải phân tích chi phí', e?.message);
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, projectId, toast]);

  useEffect(() => { load(); }, [load]);

  const totalBudget = useMemo(() => treeNodes.reduce((s, node) => s + node.totalBudgetAmount, 0), [treeNodes]);
  const totalActual = useMemo(() => treeNodes.reduce((s, node) => s + node.actualAmount, 0), [treeNodes]);
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

  const handleOpenEditBudget = (node: ProjectContractCostAnalysisNode) => {
    setEditingNode(node);
    setEditingBudgetValue(node.budgetAmount ? String(node.budgetAmount) : '');
  };

  const handleSaveBudget = async () => {
    if (!editingNode) return;
    setSavingBudget(true);
    try {
      const val = Number(editingBudgetValue || 0);
      await projectCostItemService.saveProjectCostBudget(
        constructionSiteId,
        projectId,
        editingNode.symbol,
        editingNode.name,
        val,
      );
      toast.success('Đã cập nhật dự toán', `Dự toán cho khoản mục "${editingNode.symbol} - ${editingNode.name}" đã được lưu.`);
      setEditingNode(null);
      await load();
    } catch (err: any) {
      toast.error('Lỗi cập nhật dự toán', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingBudget(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-sm text-slate-400 font-bold">Đang tải cây danh mục chi phí dự án...</div>;

  return (
    <div className="space-y-4">
      {/* Margin KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Tổng dự toán</div>
          <div className="text-lg font-black text-slate-800 dark:text-white">{fmt(totalBudget)}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Thực tế phát sinh</div>
          <div className="text-lg font-black text-orange-600">{fmt(totalActual)}</div>
        </div>
        <div className={`rounded-xl p-4 border ${budgetVariance >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          <div className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1">
            {budgetVariance >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} Chênh lệch ngân sách
          </div>
          <div className={`text-lg font-black ${budgetVariance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {budgetVariance >= 0 ? '+' : ''}{fmt(budgetVariance)}
          </div>
          <div className={`text-[9px] font-bold ${budgetVariance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {budgetVariancePercent.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
          <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">DT nghiệm thu / Margin</div>
          <div className="text-lg font-black text-blue-600">{fmt(paymentSummary?.totalApproved || 0)}</div>
          <div className={`text-[9px] font-bold ${contractMargin >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>Margin: {fmt(contractMargin)}</div>
        </div>
      </div>

      {/* Cost breakdown table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <div>
            <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
              <BarChart3 size={14} className="text-indigo-500" /> Danh mục chi phí dự án (Đồng bộ Quản lý Hợp đồng)
            </h4>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
              Phát sinh thực tế tự động tổng hợp & cộng dồn từ Sổ Giao Dịch (`project_transactions`)
            </p>
          </div>
          <button onClick={load} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors" title="Làm mới dữ liệu">
            <RefreshCw size={13} />
          </button>
        </div>

        {treeNodes.length === 0 ? (
          <div className="py-8 text-center text-xs font-bold text-slate-400">
            Chưa có danh mục khoản mục chi phí nào trong Quản lý hợp đồng.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100 dark:border-slate-700">
                  <th className="px-3 py-2.5 w-10">#</th>
                  <th className="px-3 py-2.5">Khoản mục chi phí</th>
                  <th className="px-3 py-2.5 text-right">Dự toán</th>
                  <th className="px-3 py-2.5 text-right">Thực tế (Sổ GD)</th>
                  <th className="px-3 py-2.5 text-right">Chênh lệch</th>
                  <th className="px-3 py-2.5 text-center w-28">Tiến độ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {treeNodes.map(node => (
                  <TreeRow
                    key={node.id}
                    node={node}
                    expanded={expanded}
                    toggleExpand={toggleExpand}
                    onEditBudget={handleOpenEditBudget}
                    onSelectCostItem={onSelectCostItem}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Budget Modal */}
      {editingNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 border border-slate-100 dark:border-slate-800 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-black text-slate-800 dark:text-white">
                Cập nhật Dự toán Ngân sách
              </h3>
              <button onClick={() => setEditingNode(null)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Khoản mục</label>
                <div className="font-bold text-xs text-slate-700 dark:text-slate-200">
                  <span className="font-black text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded mr-1.5">{editingNode.symbol}</span>
                  {editingNode.name}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Số tiền Dự toán (VNĐ)</label>
                <input
                  type="number"
                  value={editingBudgetValue}
                  onChange={e => setEditingBudgetValue(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm font-mono font-bold outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingNode(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveBudget}
                disabled={savingBudget}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save size={14} /> {savingBudget ? 'Đang lưu...' : 'Lưu dự toán'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CostAnalysisPanel;
