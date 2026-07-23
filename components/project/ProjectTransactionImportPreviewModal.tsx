import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import {
  BusinessPartner,
  ContractCostItem,
  ProjectCostCategory,
  ProjectTransaction,
} from '../../types';
import {
  applyContractCostItemToTransaction,
  buildContractCostItemOptions,
  clearContractCostItemSnapshot,
  inferProjectCostCategoryFromCostItem,
} from '../../lib/contractCostItemOptions';
import {
  ProjectTransactionImportPreviewItem,
  ProjectTransactionImportPreviewResult,
  downloadProjectTransactionImportTemplate,
} from '../../lib/projectTransactionImport';

interface Props {
  isOpen: boolean;
  costItems: ContractCostItem[];
  partners: BusinessPartner[];
  initialResult: ProjectTransactionImportPreviewResult | null;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (transactions: ProjectTransaction[]) => void | Promise<void>;
}

type TabType = 'all' | 'warning' | 'valid' | 'selected';

const CATEGORY_TAGS: Record<ProjectCostCategory, { label: string; cls: string }> = {
  materials: { label: 'Vật tư', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
  labor: { label: 'Nhân công', cls: 'bg-sky-50 text-sky-600 border-sky-200' },
  machinery: { label: 'Máy móc', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  subcontract: { label: 'Thầu phụ', cls: 'bg-purple-50 text-purple-600 border-purple-200' },
  overhead: { label: 'Quản lý chung', cls: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
  other: { label: 'Phát sinh/Khác', cls: 'bg-pink-50 text-pink-600 border-pink-200' },
};

const fmtVNND = (value: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));

export const ProjectTransactionImportPreviewModal: React.FC<Props> = ({
  isOpen,
  costItems,
  partners,
  initialResult,
  saving = false,
  onClose,
  onConfirm,
}) => {
  const [items, setItems] = useState<ProjectTransactionImportPreviewItem[]>(() => initialResult?.items || []);
  const [activeTab, setActiveTab] = useState<TabType>('all');

  // Re-sync items when initialResult changes
  React.useEffect(() => {
    if (initialResult?.items) {
      setItems(initialResult.items);
    }
  }, [initialResult]);

  const costItemOptions = useMemo(() => buildContractCostItemOptions(costItems), [costItems]);

  const fallbackOtherCostItem = useMemo(() => {
    return costItems.find(item => item.symbol.toUpperCase() === 'CPK' || item.name.toLowerCase().includes('chi phí khác')) || costItems[0] || null;
  }, [costItems]);

  if (!isOpen || !initialResult) return null;

  // Filtered rows for current active tab
  const filteredItems = items.filter(item => {
    if (activeTab === 'warning') return item.status === 'warning_missing_cost_item';
    if (activeTab === 'valid') return item.status === 'valid';
    if (activeTab === 'selected') return item.selected;
    return true;
  });

  const selectedItems = items.filter(item => item.selected && item.tx.amount > 0);
  const selectedExpenseTotal = selectedItems
    .filter(item => item.tx.type === 'expense')
    .reduce((sum, item) => sum + Number(item.tx.amount || 0), 0);

  const selectedRevenueTotal = selectedItems
    .filter(item => item.tx.type !== 'expense')
    .reduce((sum, item) => sum + Number(item.tx.amount || 0), 0);

  const warningCount = items.filter(item => item.status === 'warning_missing_cost_item').length;

  const toggleSelectAll = (checked: boolean) => {
    setItems(prev => prev.map(item => item.tx.amount <= 0 ? item : { ...item, selected: checked }));
  };

  const toggleSelectItem = (index: number, checked: boolean) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], selected: checked };
      return next;
    });
  };

  const updateItemTx = (index: number, updater: (prevTx: ProjectTransaction) => ProjectTransaction) => {
    setItems(prev => {
      const next = [...prev];
      const current = next[index];
      const updatedTx = updater(current.tx);
      const isMissingCost = updatedTx.type === 'expense' && !updatedTx.contractCostItemId;
      const isInvalidAmt = updatedTx.amount <= 0;

      let newStatus: ProjectTransactionImportPreviewItem['status'] = 'valid';
      let warningMessage: string | undefined;

      if (isInvalidAmt) {
        newStatus = 'invalid_amount';
        warningMessage = 'Số tiền <= 0';
      } else if (isMissingCost) {
        newStatus = 'warning_missing_cost_item';
        warningMessage = 'Chưa chọn Khoản mục chi phí';
      }

      next[index] = {
        ...current,
        tx: updatedTx,
        status: newStatus,
        warningMessage,
        selected: isInvalidAmt ? false : current.selected,
      };
      return next;
    });
  };

  const handleSelectCostItem = (index: number, costItemId: string) => {
    const selectedCostItem = costItems.find(item => item.id === costItemId);
    updateItemTx(index, prevTx => {
      if (!selectedCostItem) {
        return {
          ...prevTx,
          ...clearContractCostItemSnapshot(),
          category: 'other',
        };
      }
      return {
        ...applyContractCostItemToTransaction(prevTx, selectedCostItem, 'manual'),
        category: inferProjectCostCategoryFromCostItem(selectedCostItem),
      };
    });
  };

  const handleSelectPartner = (index: number, partnerIdOrName: string) => {
    const matchedPartner = partners.find(p => p.id === partnerIdOrName || p.name === partnerIdOrName || p.code === partnerIdOrName);
    updateItemTx(index, prevTx => ({
      ...prevTx,
      counterpartyPartnerId: matchedPartner?.id || null,
      counterpartyName: matchedPartner?.name || partnerIdOrName || null,
    }));
  };

  const handleAutoAssignFallbackCostItem = () => {
    if (!fallbackOtherCostItem) return;
    setItems(prev =>
      prev.map(item => {
        if (item.tx.type === 'expense' && !item.tx.contractCostItemId) {
          const updatedTx: ProjectTransaction = {
            ...applyContractCostItemToTransaction(item.tx, fallbackOtherCostItem, 'auto'),
            category: inferProjectCostCategoryFromCostItem(fallbackOtherCostItem),
          };
          return {
            ...item,
            tx: updatedTx,
            status: updatedTx.amount <= 0 ? 'invalid_amount' : 'valid',
            warningMessage: updatedTx.amount <= 0 ? 'Số tiền <= 0' : undefined,
          };
        }
        return item;
      })
    );
  };

  const handleConfirmImport = async () => {
    const validSelectedTxs = items
      .filter(item => item.selected && item.tx.amount > 0)
      .map(item => item.tx);

    if (validSelectedTxs.length === 0) return;
    await onConfirm(validSelectedTxs);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-7xl max-h-[92vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-slate-800 dark:text-white">Xem trước & Chỉnh sửa Import Giao Dịch</h3>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                {items.length} dòng dữ liệu
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 mt-0.5">
              Anh có thể kiểm tra, gán Khoản mục chi phí / Đối tác và điều chỉnh trước khi lưu chính thức vào Sổ Giao Dịch
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadProjectTransactionImportTemplate}
              className="px-3 py-2 rounded-xl border border-emerald-200 text-emerald-700 bg-emerald-50/60 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
              title="Tải file mẫu Excel chuẩn"
            >
              <Download size={14} /> Tải file mẫu Excel
            </button>
            <button
              onClick={onClose}
              disabled={saving}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="p-4 sm:p-5 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Đã chọn import</div>
            <div className="text-xl font-black text-slate-800 dark:text-white mt-1">
              {selectedItems.length} <span className="text-xs font-bold text-slate-400">/ {items.length} dòng</span>
            </div>
          </div>

          <div className="rounded-2xl border border-orange-200/80 dark:border-orange-950/60 bg-orange-50/40 dark:bg-orange-950/20 p-3.5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 flex items-center gap-1">
              <ArrowUpRight size={14} /> Tổng Chi (Đã chọn)
            </div>
            <div className="text-xl font-black text-orange-700 dark:text-orange-300 mt-1">
              {fmtVNND(selectedExpenseTotal)}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-950/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3.5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <ArrowDownLeft size={14} /> Tổng Thu (Đã chọn)
            </div>
            <div className="text-xl font-black text-emerald-700 dark:text-emerald-300 mt-1">
              {fmtVNND(selectedRevenueTotal)}
            </div>
          </div>

          <div className={`rounded-2xl border p-3.5 shadow-sm ${warningCount > 0 ? 'border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle size={14} /> Chưa gán Khoản mục
            </div>
            <div className="text-xl font-black text-amber-700 dark:text-amber-300 mt-1">
              {warningCount} <span className="text-xs font-bold opacity-75">giao dịch</span>
            </div>
          </div>
        </div>

        {/* Toolbar & Filter Tabs */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'all' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Tất cả ({items.length})
            </button>
            {warningCount > 0 && (
              <button
                onClick={() => setActiveTab('warning')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all ${activeTab === 'warning' ? 'bg-amber-500 text-white' : 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100'}`}
              >
                <AlertTriangle size={12} /> Cần xem lại ({warningCount})
              </button>
            )}
            <button
              onClick={() => setActiveTab('valid')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'valid' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Hợp lệ ({items.filter(i => i.status === 'valid').length})
            </button>
            <button
              onClick={() => setActiveTab('selected')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${activeTab === 'selected' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              Đã chọn ({selectedItems.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            {warningCount > 0 && fallbackOtherCostItem && (
              <button
                onClick={handleAutoAssignFallbackCostItem}
                className="px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-amber-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
                title={`Tự động gán tất cả dòng chi phí chưa có khoản mục về "${fallbackOtherCostItem.name}"`}
              >
                <Wand2 size={13} /> Gán nhanh về '{fallbackOtherCostItem.symbol}'
              </button>
            )}
            <button
              onClick={() => toggleSelectAll(true)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Chọn tất cả
            </button>
            <button
              onClick={() => toggleSelectAll(false)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Bỏ chọn
            </button>
          </div>
        </div>

        {/* Table Area */}
        <div className="flex-1 overflow-auto p-4 sm:p-5">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-[10px] uppercase font-black tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5 text-center w-10">
                  <input
                    type="checkbox"
                    checked={filteredItems.length > 0 && filteredItems.every(i => i.selected)}
                    onChange={e => {
                      const checked = e.target.checked;
                      setItems(prev =>
                        prev.map(item =>
                          filteredItems.some(f => f.rowNumber === item.rowNumber) && item.tx.amount > 0
                            ? { ...item, selected: checked }
                            : item
                        )
                      );
                    }}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="px-2 py-2.5 text-center w-12">STT</th>
                <th className="px-3 py-2.5 text-left w-24">Loại GT</th>
                <th className="px-3 py-2.5 text-left w-28">Ngày GT</th>
                <th className="px-3 py-2.5 text-left min-w-[260px]">Khoản mục chi phí (Nếu là Chi)</th>
                <th className="px-3 py-2.5 text-left min-w-[180px]">Đối tác / Nhà cung cấp</th>
                <th className="px-3 py-2.5 text-right w-32">Số tiền (VNĐ)</th>
                <th className="px-3 py-2.5 text-left min-w-[220px]">Nội dung diễn giải</th>
                <th className="px-3 py-2.5 text-left w-28">Số HĐ / Chứng từ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs font-bold text-slate-400">
                    Không có giao dịch nào khớp với bộ lọc
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const originalIndex = items.findIndex(i => i.rowNumber === item.rowNumber);
                  const isExpense = item.tx.type === 'expense';
                  const categoryTag = CATEGORY_TAGS[item.tx.category] || CATEGORY_TAGS.other;

                  return (
                    <tr
                      key={item.rowNumber}
                      className={`align-middle transition-colors ${item.status === 'warning_missing_cost_item' ? 'bg-amber-50/50 dark:bg-amber-950/20' : item.status === 'invalid_amount' ? 'bg-red-50/40 dark:bg-red-950/20 opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          disabled={item.tx.amount <= 0}
                          onChange={e => toggleSelectItem(originalIndex, e.target.checked)}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-30"
                        />
                      </td>

                      {/* Row Number & Status Alert */}
                      <td className="px-2 py-2.5 text-center font-mono font-bold text-slate-500">
                        <div className="flex items-center justify-center gap-1">
                          <span>{item.rowNumber}</span>
                          {item.status === 'warning_missing_cost_item' && (
                            <span title={item.warningMessage}>
                              <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Type Selector */}
                      <td className="px-3 py-2.5">
                        <select
                          value={item.tx.type}
                          onChange={e => updateItemTx(originalIndex, prev => ({ ...prev, type: e.target.value as any }))}
                          className={`w-full px-2 py-1 rounded-lg border text-xs font-bold outline-none ${isExpense ? 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-300' : 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'}`}
                        >
                          <option value="expense">Chi phí</option>
                          <option value="revenue_received">Thu tiền (Đã thu)</option>
                          <option value="revenue_pending">Doanh thu (Chờ thu)</option>
                        </select>
                      </td>

                      {/* Date Input */}
                      <td className="px-3 py-2.5">
                        <input
                          type="date"
                          value={item.tx.date}
                          onChange={e => updateItemTx(originalIndex, prev => ({ ...prev, date: e.target.value }))}
                          className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 dark:text-white font-mono text-xs font-bold outline-none"
                        />
                      </td>

                      {/* Cost Item Select (only relevant for Expense) */}
                      <td className="px-3 py-2.5">
                        {isExpense ? (
                          <div className="space-y-1">
                            <select
                              value={item.tx.contractCostItemId || ''}
                              onChange={e => handleSelectCostItem(originalIndex, e.target.value)}
                              className={`w-full px-2 py-1.5 rounded-lg border text-xs font-bold outline-none ${!item.tx.contractCostItemId ? 'border-amber-400 bg-amber-50 text-amber-900 font-bold dark:bg-amber-950 dark:text-amber-100' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-white'}`}
                            >
                              <option value="">-- Chọn khoản mục chi phí --</option>
                              {costItemOptions.map(opt => (
                                <option key={opt.item.id} value={opt.item.id}>
                                  {`${'-- '.repeat(opt.depth)}${opt.displayIndex} - ${opt.item.symbol} - ${opt.item.name}`}
                                </option>
                              ))}
                            </select>
                            {item.tx.contractCostItemId ? (
                              <div className="flex items-center gap-1 text-[10px]">
                                <span className={`px-1.5 py-0.2 rounded border font-bold ${categoryTag.cls}`}>
                                  {categoryTag.label}
                                </span>
                                <span className="font-mono text-slate-400">{item.tx.contractCostItemSymbolSnapshot}</span>
                              </div>
                            ) : (
                              <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <AlertTriangle size={10} /> File ghi: "{item.rawCostItemInput || 'Trống'}" — hãy chọn Khoản mục
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">Không áp dụng cho Thu</span>
                        )}
                      </td>

                      {/* Partner Input */}
                      <td className="px-3 py-2.5">
                        <select
                          value={item.tx.counterpartyPartnerId || item.tx.counterpartyName || ''}
                          onChange={e => handleSelectPartner(originalIndex, e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-white text-xs font-bold outline-none"
                        >
                          <option value="">-- Không chọn đối tác --</option>
                          {partners.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.code ? `${p.code} - ${p.name}` : p.name}
                            </option>
                          ))}
                          {item.rawPartnerInput && !partners.some(p => p.id === item.tx.counterpartyPartnerId) && (
                            <option value={item.rawPartnerInput}>File ghi: {item.rawPartnerInput}</option>
                          )}
                        </select>
                      </td>

                      {/* Amount Input */}
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number"
                          value={item.tx.amount || 0}
                          onChange={e => updateItemTx(originalIndex, prev => ({ ...prev, amount: Number(e.target.value || 0) }))}
                          className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-xs font-black text-right outline-none"
                        />
                      </td>

                      {/* Description Input */}
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={item.tx.description || ''}
                          onChange={e => updateItemTx(originalIndex, prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Nhập nội dung diễn giải..."
                          className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-white text-xs font-medium outline-none"
                        />
                      </td>

                      {/* Invoice No Input */}
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={item.tx.invoiceNo || ''}
                          onChange={e => updateItemTx(originalIndex, prev => ({ ...prev, invoiceNo: e.target.value }))}
                          placeholder="Số HĐ/CT..."
                          className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-white font-mono text-xs font-medium outline-none"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/60">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
            {selectedItems.length > 0 ? (
              <span>
                Đang chọn <strong className="text-slate-900 dark:text-white">{selectedItems.length}</strong> giao dịch | Tổng Chi: <strong className="text-orange-600">{fmtVNND(selectedExpenseTotal)}</strong> | Tổng Thu: <strong className="text-emerald-600">{fmtVNND(selectedRevenueTotal)}</strong>
              </span>
            ) : (
              <span className="text-amber-600 font-bold">Vui lòng tích chọn ít nhất 1 giao dịch để Import</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              disabled={saving}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={saving || selectedItems.length === 0}
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-600/20 transition-all"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              Xác nhận Import ({selectedItems.length} giao dịch)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
