import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import { useTheme } from '../../context/ThemeContext';
import {
  BarChart3, Plus, ChevronDown, ChevronRight, Download,
  Trash2, Edit3, Save, X, FolderPlus, Zap, FileText,
  Receipt, Calendar, DollarSign, PlusCircle, Copy, Loader2
} from 'lucide-react';
import { BudgetCategory, BudgetEntry, BudgetSource, ExpenseRecord } from '../../types';

// Source labels
const SOURCE_OPTIONS: { value: BudgetSource; label: string; icon: string }[] = [
  { value: 'manual', label: 'Nhập tay (Phiếu chi)', icon: '✏️' },
  { value: 'payroll_salary', label: 'Tự động: Lương cơ bản', icon: '💰' },
  { value: 'payroll_allowance', label: 'Tự động: Phụ cấp', icon: '💰' },
  { value: 'payroll_insurance', label: 'Tự động: BHXH/YT/TN', icon: '💰' },
  { value: 'payroll_total', label: 'Tự động: Tổng chi lương', icon: '💰' },
  { value: 'inventory_import', label: 'Tự động: Nhập kho (vật tư)', icon: '📦' },
  { value: 'asset_maintenance', label: 'Tự động: Bảo trì tài sản', icon: '🔧' },
];

const BudgetDashboard: React.FC = () => {
  const {
    budgetCategories, budgetEntries, expenseRecords,
    payrollRecords, transactions, items,
    addHrmItem, updateHrmItem, removeHrmItem, user
  } = useApp();
  useModuleData('ex');
  const { theme } = useTheme();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCell, setEditingCell] = useState<{ catId: string; month: number; type: 'planned' | 'actual' } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formParentId, setFormParentId] = useState<string>('');
  const [formSource, setFormSource] = useState<BudgetSource>('manual');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  // Expense record form
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expCatId, setExpCatId] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(new Date().toISOString().split('T')[0]);
  const [expDesc, setExpDesc] = useState('');
  // Expense detail view
  const [viewExpCatId, setViewExpCatId] = useState<string | null>(null);
  // Copy from previous year
  const [copying, setCopying] = useState(false);

  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // ==================== DATA FILTERED BY YEAR ====================

  const yearCategories = useMemo(() =>
    budgetCategories.filter(c => c.year === selectedYear).sort((a, b) => a.order - b.order),
  [budgetCategories, selectedYear]);

  const yearEntries = useMemo(() =>
    budgetEntries.filter(e => e.year === selectedYear),
  [budgetEntries, selectedYear]);

  const parentCategories = useMemo(() =>
    yearCategories.filter(c => !c.parentId),
  [yearCategories]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, BudgetCategory[]>();
    for (const c of yearCategories) {
      if (c.parentId) {
        if (!map.has(c.parentId)) map.set(c.parentId, []);
        map.get(c.parentId)!.push(c);
      }
    }
    return map;
  }, [yearCategories]);

  // Manual categories for expense entry
  const manualLeafCategories = useMemo(() =>
    yearCategories.filter(c => c.source === 'manual' && !(childrenMap.has(c.id) && childrenMap.get(c.id)!.length > 0)),
  [yearCategories, childrenMap]);

  // ==================== AUTO-CALC FROM PAYROLL ====================

  const payrollByMonth = useMemo(() => {
    const map = new Map<number, { salary: number; allowance: number; insurance: number; total: number }>();
    for (const m of months) {
      const monthRecs = payrollRecords.filter(p => p.month === m && p.year === selectedYear);
      const salary = monthRecs.reduce((s, p) => s + (p.baseSalary || 0), 0);
      const allowance = monthRecs.reduce((s, p) =>
        s + (p.allowancePosition || 0) + (p.allowanceMeal || 0) + (p.allowanceTransport || 0) + (p.allowancePhone || 0) + (p.allowanceOther || 0), 0);
      const insurance = monthRecs.reduce((s, p) => s + (p.deductionInsurance || 0), 0);
      const total = monthRecs.reduce((s, p) => s + (p.grossSalary || 0), 0);
      map.set(m, { salary, allowance, insurance, total });
    }
    return map;
  }, [payrollRecords, selectedYear]);

  // ==================== AUTO-CALC FROM INVENTORY ====================

  const inventoryByMonth = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of months) {
      // Sum value of "nhap" (import) transactions in this month/year
      const monthTx = (transactions || []).filter(t => {
        if (t.type !== 'nhap' || t.status === 'cancelled') return false;
        const d = new Date(t.date);
        return d.getMonth() + 1 === m && d.getFullYear() === selectedYear;
      });
      let total = 0;
      for (const tx of monthTx) {
        for (const item of (tx.items || [])) {
          total += (item.price || 0) * (item.quantity || 0);
        }
      }
      map.set(m, total);
    }
    return map;
  }, [transactions, selectedYear]);

  // ==================== EXPENSE RECORDS BY CAT+MONTH ====================

  const expenseByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const rec of expenseRecords) {
      const d = new Date(rec.date);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      if (y !== selectedYear) continue;
      const key = `${rec.categoryId}_${m}`;
      map.set(key, (map.get(key) || 0) + rec.amount);
    }
    return map;
  }, [expenseRecords, selectedYear]);

  // ==================== ENTRY LOOKUP ====================

  const getEntry = useCallback((catId: string, month: number): BudgetEntry | undefined =>
    yearEntries.find(e => e.categoryId === catId && e.month === month),
  [yearEntries]);

  // Get ACTUAL value from auto source or manual
  const getAutoActual = useCallback((cat: BudgetCategory, month: number): number => {
    const src = cat.source || 'manual';
    if (src === 'manual') {
      return expenseByKey.get(`${cat.id}_${month}`) || 0;
    }
    const p = payrollByMonth.get(month);
    if (src === 'payroll_salary') return p?.salary || 0;
    if (src === 'payroll_allowance') return p?.allowance || 0;
    if (src === 'payroll_insurance') return p?.insurance || 0;
    if (src === 'payroll_total') return p?.total || 0;
    if (src === 'inventory_import') return inventoryByMonth.get(month) || 0;
    // asset_maintenance — future
    return 0;
  }, [expenseByKey, payrollByMonth, inventoryByMonth]);

  // Get totals for a category (if parent, sum children)
  const getCatMonthValues = useCallback((catId: string, month: number): { planned: number; actual: number } => {
    const children = childrenMap.get(catId);
    if (children && children.length > 0) {
      let planned = 0, actual = 0;
      for (const ch of children) {
        const v = getCatMonthValues(ch.id, month);
        planned += v.planned;
        actual += v.actual;
      }
      return { planned, actual };
    }
    const cat = yearCategories.find(c => c.id === catId);
    const entry = getEntry(catId, month);
    const planned = entry?.planned || 0;
    const actual = cat ? getAutoActual(cat, month) : 0;
    return { planned, actual };
  }, [childrenMap, getEntry, yearCategories, getAutoActual]);

  // Year totals for a category
  const getCatYearTotals = useCallback((catId: string): { planned: number; actual: number } => {
    let planned = 0, actual = 0;
    for (const m of months) {
      const v = getCatMonthValues(catId, m);
      planned += v.planned;
      actual += v.actual;
    }
    return { planned, actual };
  }, [getCatMonthValues]);

  // ==================== KPIs ====================

  const kpis = useMemo(() => {
    let totalPlanned = 0, totalActual = 0;
    for (const cat of parentCategories) {
      const t = getCatYearTotals(cat.id);
      totalPlanned += t.planned;
      totalActual += t.actual;
    }
    const rate = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
    return { totalPlanned, totalActual, diff: totalActual - totalPlanned, rate, catCount: yearCategories.length };
  }, [parentCategories, getCatYearTotals, yearCategories]);

  // ==================== CELL EDIT (PLANNED ONLY for auto-source) ====================

  const startEdit = (catId: string, month: number, type: 'planned' | 'actual') => {
    if (childrenMap.has(catId) && childrenMap.get(catId)!.length > 0) return;
    const cat = yearCategories.find(c => c.id === catId);
    // Can't edit actual for auto-source categories
    if (type === 'actual' && cat && cat.source !== 'manual') return;
    if (type === 'actual') return; // actual always from expense records or auto
    const entry = getEntry(catId, month);
    setCellValue(String(entry?.planned || 0));
    setEditingCell({ catId, month, type: 'planned' });
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const { catId, month } = editingCell;
    const numVal = Number(cellValue) || 0;
    const existing = getEntry(catId, month);
    if (existing) {
      updateHrmItem('budget_entries', { ...existing, planned: numVal });
    } else {
      addHrmItem('budget_entries', {
        id: crypto.randomUUID(),
        categoryId: catId,
        month, year: selectedYear,
        planned: numVal,
        actual: 0,
      });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  // ==================== EXPENSE RECORD CRUD ====================

  const handleAddExpense = () => {
    if (!expCatId || !expAmount || !expDate) return;
    addHrmItem('expense_records', {
      id: crypto.randomUUID(),
      categoryId: expCatId,
      amount: Number(expAmount) || 0,
      date: expDate,
      description: expDesc,
      createdBy: user?.name || '',
    });
    setExpAmount(''); setExpDesc('');
    setShowExpenseForm(false);
  };

  const handleDeleteExpense = (id: string) => {
    if (!confirm('Xoá phiếu chi này?')) return;
    removeHrmItem('expense_records', id);
  };

  // ==================== CATEGORY CRUD ====================

  const handleSaveCategory = () => {
    if (!formName || !formCode) return;
    if (editingCatId) {
      const old = yearCategories.find(c => c.id === editingCatId);
      if (old) {
        updateHrmItem('budget_categories', {
          ...old, name: formName, code: formCode,
          parentId: formParentId || null, source: formSource,
        });
      }
      setEditingCatId(null);
    } else {
      const maxOrder = yearCategories.reduce((m, c) => Math.max(m, c.order), 0);
      addHrmItem('budget_categories', {
        id: crypto.randomUUID(),
        name: formName, code: formCode,
        parentId: formParentId || null,
        year: selectedYear, order: maxOrder + 1,
        source: formSource,
      });
    }
    setFormName(''); setFormCode(''); setFormParentId(''); setFormSource('manual');
    setShowAddModal(false);
  };

  const handleDeleteCategory = (cat: BudgetCategory) => {
    if (!confirm(`Xoá mục "${cat.code} ${cat.name}"?`)) return;
    removeHrmItem('budget_categories', cat.id);
  };

  const handleEditCategory = (cat: BudgetCategory) => {
    setFormName(cat.name);
    setFormCode(cat.code);
    setFormParentId(cat.parentId || '');
    setFormSource(cat.source || 'manual');
    setEditingCatId(cat.id);
    setShowAddModal(true);
  };

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ==================== COPY FROM PREVIOUS YEAR ====================

  const handleCopyFromLastYear = async () => {
    const prevYear = selectedYear - 1;
    const prevCats = budgetCategories.filter(c => c.year === prevYear);
    if (prevCats.length === 0) {
      alert(`Không tìm thấy dữ liệu kế hoạch năm ${prevYear}`);
      return;
    }
    if (yearCategories.length > 0) {
      if (!confirm(`Năm ${selectedYear} đã có ${yearCategories.length} mục. Tiếp tục sẽ THÊM các mục từ năm ${prevYear}. Bạn có chắc?`)) return;
    }
    setCopying(true);
    try {
      // Map old ID → new ID for parent linking
      const idMap = new Map<string, string>();
      for (const cat of prevCats) {
        idMap.set(cat.id, crypto.randomUUID());
      }
      // Create categories with new IDs
      for (const cat of prevCats.sort((a, b) => a.order - b.order)) {
        const newId = idMap.get(cat.id)!;
        const newParentId = cat.parentId ? idMap.get(cat.parentId) || null : null;
        await addHrmItem('budget_categories', {
          id: newId,
          name: cat.name,
          code: cat.code,
          parentId: newParentId,
          year: selectedYear,
          order: cat.order,
          source: cat.source || 'manual',
        });
      }
      // Copy planned entries
      const prevEntries = budgetEntries.filter(e => e.year === prevYear);
      for (const entry of prevEntries) {
        const newCatId = idMap.get(entry.categoryId);
        if (!newCatId) continue;
        await addHrmItem('budget_entries', {
          id: crypto.randomUUID(),
          categoryId: newCatId,
          month: entry.month,
          year: selectedYear,
          planned: entry.planned,
          actual: 0,
        });
      }
      alert(`✅ Đã sao chép ${prevCats.length} mục + ${prevEntries.length} dòng DK từ năm ${prevYear} sang ${selectedYear}`);
    } catch (err: any) {
      alert('❌ Lỗi: ' + (err.message || 'Không thể sao chép'));
    } finally {
      setCopying(false);
    }
  };

  // ==================== EXPORT EXCEL ====================

  const exportExcel = () => {
    const headers = ['Mã', 'Mục chi phí', 'Nguồn'];
    for (const m of months) headers.push(`T${m} DK`, `T${m} TT`);
    headers.push('Tổng DK', 'Tổng TT', '% TH');

    const rows: any[][] = [];
    const addRow = (cat: BudgetCategory, indent = '') => {
      const srcLabel = SOURCE_OPTIONS.find(s => s.value === cat.source)?.label || 'Nhập tay';
      const row: any[] = [cat.code, indent + cat.name, srcLabel];
      let yP = 0, yA = 0;
      for (const m of months) {
        const v = getCatMonthValues(cat.id, m);
        row.push(v.planned, v.actual);
        yP += v.planned; yA += v.actual;
      }
      row.push(yP, yA, yP > 0 ? Math.round((yA / yP) * 100) + '%' : '0%');
      rows.push(row);
      for (const ch of (childrenMap.get(cat.id) || [])) addRow(ch, '  ');
    };
    for (const p of parentCategories) addRow(p);

    const totalRow: any[] = ['', 'TỔNG CỘNG', ''];
    let gP = 0, gA = 0;
    for (const m of months) {
      let mP = 0, mA = 0;
      for (const p of parentCategories) { const v = getCatMonthValues(p.id, m); mP += v.planned; mA += v.actual; }
      totalRow.push(mP, mA); gP += mP; gA += mA;
    }
    totalRow.push(gP, gA, gP > 0 ? Math.round((gA / gP) * 100) + '%' : '0%');
    rows.push(totalRow);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i <= 2 ? 22 : 12 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `KHCP_${selectedYear}`);
    XLSX.writeFile(wb, `ke_hoach_chi_phi_${selectedYear}.xlsx`);
  };

  // ==================== FORMAT ====================

  const fmtM = (v: number) => {
    if (v === 0) return '—';
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
    return v.toLocaleString('vi-VN');
  };

  const pctColor = (pct: number) => {
    if (pct === 0) return 'text-slate-400';
    if (pct <= 80) return 'text-blue-500';
    if (pct <= 100) return 'text-emerald-600';
    return 'text-red-500';
  };

  const sourceTag = (src: BudgetSource) => {
    if (src === 'manual') return <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-[8px] font-black text-slate-500">✏️ Tay</span>;
    return <span className="px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/20 text-[8px] font-black text-blue-500">⚡ Auto</span>;
  };

  // ==================== RENDER ROW ====================

  const renderCategoryRow = (cat: BudgetCategory, isChild = false) => {
    const hasChildren = childrenMap.has(cat.id) && childrenMap.get(cat.id)!.length > 0;
    const isExpanded = !collapsed.has(cat.id);
    const yearTotals = getCatYearTotals(cat.id);
    const pct = yearTotals.planned > 0 ? Math.round((yearTotals.actual / yearTotals.planned) * 100) : 0;
    const isLeaf = !hasChildren;
    const isManual = cat.source === 'manual';

    return (
      <React.Fragment key={cat.id}>
        <tr className={`group ${isChild ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/80 dark:bg-slate-800/40'} hover:bg-blue-50/50 dark:hover:bg-blue-950/10 transition`}>
          {/* Category Name */}
          <td className={`px-3 py-2.5 sticky left-0 z-10 ${isChild ? 'bg-white dark:bg-slate-900/95' : 'bg-slate-50 dark:bg-slate-800/95'}`} style={{ minWidth: 240 }}>
            <div className="flex items-center gap-1.5">
              {!isChild && hasChildren ? (
                <button onClick={() => toggleCollapse(cat.id)} className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              ) : <span className="w-5" />}
              {isChild && <span className="w-3" />}
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isChild ? 'bg-slate-100 dark:bg-slate-700 text-slate-500' : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600'}`}>{cat.code}</span>
              <span className={`text-xs truncate ${isChild ? 'font-bold text-slate-600 dark:text-slate-400' : 'font-black text-slate-800 dark:text-white'}`}>{cat.name}</span>
              {isLeaf && sourceTag(cat.source)}
              <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                {isLeaf && isManual && (
                  <button onClick={() => { setExpCatId(cat.id); setViewExpCatId(cat.id); }}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-emerald-500 transition" title="Xem phiếu chi">
                    <Receipt size={11} />
                  </button>
                )}
                <button onClick={() => handleEditCategory(cat)}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition" title="Sửa">
                  <Edit3 size={11} />
                </button>
                <button onClick={() => handleDeleteCategory(cat)}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition" title="Xoá">
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          </td>
          {/* Monthly cells */}
          {months.map(m => {
            const v = getCatMonthValues(cat.id, m);
            const isEditingP = editingCell?.catId === cat.id && editingCell.month === m && editingCell.type === 'planned';
            // Quarterly subtotal after months 3,6,9,12
            const qMonths = m % 3 === 0 ? [m - 2, m - 1, m] : null;
            let qP = 0, qA = 0;
            if (qMonths) { for (const qm of qMonths) { const qv = getCatMonthValues(cat.id, qm); qP += qv.planned; qA += qv.actual; } }
            return (
              <React.Fragment key={m}>
              <td className="px-0 py-1" style={{ minWidth: 110 }}>
                <div className="flex divide-x divide-slate-100 dark:divide-slate-800">
                  {/* Planned — editable for leaf */}
                  <div className={`flex-1 px-1.5 py-1 text-center text-[11px] ${isLeaf ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20' : ''} rounded-l`}
                    onClick={() => isLeaf && startEdit(cat.id, m, 'planned')}>
                    {isEditingP ? (
                      <input type="number" value={cellValue} onChange={e => setCellValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                        onBlur={saveEdit} autoFocus
                        className="w-full text-center text-[11px] font-bold border border-blue-300 rounded px-1 py-0.5 bg-white dark:bg-slate-800 outline-none" />
                    ) : (
                      <span className={`font-bold ${v.planned > 0 ? 'text-blue-600' : 'text-slate-300'}`}>{fmtM(v.planned)}</span>
                    )}
                  </div>
                  {/* Actual — AUTO or from expense records (not editable inline) */}
                  <div className="flex-1 px-1.5 py-1 text-center text-[11px] rounded-r">
                    <span className={`font-bold ${
                      v.actual > v.planned && v.planned > 0 ? 'text-red-500' : v.actual > 0 ? 'text-emerald-600' : 'text-slate-300'
                    }`}>{fmtM(v.actual)}</span>
                  </div>
                </div>
              </td>
              {qMonths && (
                <td className="px-0 py-1 bg-amber-50/50 dark:bg-amber-950/10 border-x border-amber-100 dark:border-amber-900" style={{ minWidth: 75 }}>
                  <div className="text-center">
                    <div className="text-[10px] font-black text-blue-600">{fmtM(qP)}</div>
                    <div className="text-[10px] font-black text-emerald-600">{fmtM(qA)}</div>
                  </div>
                </td>
              )}
              </React.Fragment>
            );
          })}
          {/* Year totals */}
          <td className="px-2 py-2 text-center" style={{ minWidth: 80 }}>
            <div className="text-[11px] font-black text-blue-600">{fmtM(yearTotals.planned)}</div>
            <div className="text-[11px] font-black text-emerald-600">{fmtM(yearTotals.actual)}</div>
          </td>
          <td className="px-2 py-2 text-center" style={{ minWidth: 55 }}>
            <span className={`text-xs font-black ${pctColor(pct)}`}>{pct}%</span>
            {pct > 100 && <span className="text-[9px]"> 🔴</span>}
            {pct > 0 && pct <= 100 && <span className="text-[9px]"> 🟢</span>}
          </td>
        </tr>
        {hasChildren && isExpanded && childrenMap.get(cat.id)!.map(ch => renderCategoryRow(ch, true))}
      </React.Fragment>
    );
  };

  // ==================== GRAND TOTAL ====================

  const grandTotals = useMemo(() =>
    months.map(m => {
      let p = 0, a = 0;
      for (const cat of parentCategories) { const v = getCatMonthValues(cat.id, m); p += v.planned; a += v.actual; }
      return { planned: p, actual: a };
    }),
  [parentCategories, getCatMonthValues]);

  // Expense records for viewing
  const viewExpRecords = useMemo(() => {
    if (!viewExpCatId) return [];
    return expenseRecords.filter(r => r.categoryId === viewExpCatId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [viewExpCatId, expenseRecords]);

  const viewExpCat = viewExpCatId ? yearCategories.find(c => c.id === viewExpCatId) : null;

  // ==================== RENDER ====================

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="text-indigo-500" size={24} /> Kế hoạch Chi phí
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
            Theo dõi ngân sách & chi phí thực tế — <span className="text-blue-500">DK nhập tay</span>, <span className="text-emerald-500">TT tự động tổng hợp</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <option key={y} value={y}>Năm {y}</option>
            ))}
          </select>
          <button onClick={handleCopyFromLastYear} disabled={copying}
            className="px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition flex items-center gap-1.5 disabled:opacity-50"
            title={`Sao chép danh mục + DK từ năm ${selectedYear - 1}`}>
            {copying ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
            {copying ? 'Đang chép...' : `Chép từ ${selectedYear - 1}`}
          </button>
          <button onClick={() => { setEditingCatId(null); setFormName(''); setFormCode(''); setFormParentId(''); setFormSource('manual'); setShowAddModal(true); }}
            className="px-3 py-2 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition flex items-center gap-1.5">
            <Plus size={14} /> Thêm mục
          </button>
          <button onClick={() => { setExpCatId(manualLeafCategories[0]?.id || ''); setShowExpenseForm(true); }}
            className="px-3 py-2 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5"
            disabled={manualLeafCategories.length === 0}>
            <PlusCircle size={14} /> Phiếu chi
          </button>
          <button onClick={exportExcel}
            className="px-3 py-2 bg-teal-500 text-white rounded-xl text-xs font-black hover:bg-teal-600 transition flex items-center gap-1.5">
            <Download size={14} /> Xuất Excel
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Mục chi phí</p>
          <p className="text-xl font-black text-slate-800 dark:text-white">{kpis.catCount}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng dự kiến</p>
          <p className="text-xl font-black text-blue-600">{fmtM(kpis.totalPlanned)}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng thực tế</p>
          <p className="text-xl font-black text-emerald-600">{fmtM(kpis.totalActual)}</p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Chênh lệch</p>
          <p className={`text-xl font-black ${kpis.diff > 0 ? 'text-red-500' : kpis.diff < 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
            {kpis.diff > 0 ? '+' : ''}{fmtM(kpis.diff)}
          </p>
        </div>
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tỷ lệ TH</p>
          <p className={`text-xl font-black ${pctColor(kpis.rate)}`}>{kpis.rate}%</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] font-bold text-slate-400 flex-wrap">
        <span>🔵 DK = Dự kiến (nhập tay)</span>
        <span>🟢 TT = Thực tế (⚡ auto hoặc từ phiếu chi)</span>
        <span>🔴 Vượt ngân sách</span>
        <span>Click vào ô DK mục con để sửa số</span>
      </div>

      {/* Main Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800">
                <th className="px-3 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest sticky left-0 z-20 bg-slate-100 dark:bg-slate-800" style={{ minWidth: 240 }}>Mục chi phí</th>
                {months.map(m => (
                  <React.Fragment key={m}>
                    <th className="px-0 py-1 text-center" style={{ minWidth: 110 }}>
                      <div className="text-[10px] font-black text-slate-500">T{m}</div>
                      <div className="flex text-[8px] font-bold text-slate-400 divide-x divide-slate-200 dark:divide-slate-700">
                        <span className="flex-1 text-center text-blue-400">DK</span>
                        <span className="flex-1 text-center text-emerald-400">TT</span>
                      </div>
                    </th>
                    {m % 3 === 0 && (
                      <th className="px-1 py-1 text-center bg-amber-50 dark:bg-amber-950/20 border-x border-amber-200 dark:border-amber-800" style={{ minWidth: 75 }}>
                        <div className="text-[10px] font-black text-amber-600">Q{m / 3}</div>
                        <div className="flex text-[8px] font-bold text-amber-400 divide-x divide-amber-200 dark:divide-amber-700">
                          <span className="flex-1 text-center">DK</span>
                          <span className="flex-1 text-center">TT</span>
                        </div>
                      </th>
                    )}
                  </React.Fragment>
                ))}
                <th className="px-2 py-2 text-center text-[10px] font-black text-slate-500 uppercase" style={{ minWidth: 80 }}>Tổng năm</th>
                <th className="px-2 py-2 text-center text-[10px] font-black text-slate-500 uppercase" style={{ minWidth: 55 }}>%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {parentCategories.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-16 text-center">
                    <BarChart3 size={40} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-black text-slate-400">Chưa có mục chi phí</p>
                    <p className="text-xs text-slate-400 mt-1">Nhấn "+ Thêm mục" để bắt đầu</p>
                  </td>
                </tr>
              ) : (
                <>
                  {parentCategories.map(cat => renderCategoryRow(cat))}
                  {/* Grand Total */}
                  <tr className="bg-indigo-50 dark:bg-indigo-950/20 border-t-2 border-indigo-200 dark:border-indigo-800">
                    <td className="px-3 py-3 sticky left-0 z-10 bg-indigo-50 dark:bg-indigo-950/20">
                      <span className="text-xs font-black text-indigo-700 dark:text-indigo-400 uppercase">Tổng cộng</span>
                    </td>
                    {grandTotals.map((t, i) => {
                      const m = i + 1;
                      const qMonths = m % 3 === 0 ? [m - 3, m - 2, m - 1] : null; // indices
                      let gqP = 0, gqA = 0;
                      if (qMonths) { for (const qi of qMonths) { gqP += grandTotals[qi].planned; gqA += grandTotals[qi].actual; } }
                      return (
                        <React.Fragment key={i}>
                        <td className="px-0 py-2">
                          <div className="flex divide-x divide-indigo-100 dark:divide-indigo-800">
                            <div className="flex-1 text-center text-[11px] font-black text-blue-700">{fmtM(t.planned)}</div>
                            <div className="flex-1 text-center text-[11px] font-black text-emerald-700">{fmtM(t.actual)}</div>
                          </div>
                        </td>
                        {qMonths && (
                          <td className="px-0 py-2 bg-amber-50/50 dark:bg-amber-950/10 border-x border-amber-100 dark:border-amber-900">
                            <div className="text-center">
                              <div className="text-[10px] font-black text-blue-700">{fmtM(gqP)}</div>
                              <div className="text-[10px] font-black text-emerald-700">{fmtM(gqA)}</div>
                            </div>
                          </td>
                        )}
                        </React.Fragment>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      <div className="text-[11px] font-black text-blue-700">{fmtM(kpis.totalPlanned)}</div>
                      <div className="text-[11px] font-black text-emerald-700">{fmtM(kpis.totalActual)}</div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-sm font-black ${pctColor(kpis.rate)}`}>{kpis.rate}%</span>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ==================== CHART: DK vs TT by Category ==================== */}
      {parentCategories.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bar chart by parent category */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-indigo-500" /> So sánh DK vs TT theo mục
            </h3>
            <div className="space-y-3">
              {parentCategories.map(cat => {
                const t = getCatYearTotals(cat.id);
                const maxVal = Math.max(t.planned, t.actual, 1);
                const pct = t.planned > 0 ? Math.round((t.actual / t.planned) * 100) : 0;
                return (
                  <div key={cat.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate max-w-[180px]">{cat.code}. {cat.name}</span>
                      <span className={`text-[10px] font-black ${pctColor(pct)}`}>{pct}%</span>
                    </div>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-bold text-blue-400 w-5">DK</span>
                        <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-500 flex items-center justify-end pr-1"
                            style={{ width: `${Math.max((t.planned / maxVal) * 100, 2)}%` }}>
                            {t.planned > 0 && <span className="text-[8px] font-black text-white">{fmtM(t.planned)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-bold text-emerald-400 w-5">TT</span>
                        <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 flex items-center justify-end pr-1 ${
                            t.actual > t.planned && t.planned > 0 ? 'bg-gradient-to-r from-red-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                          }`} style={{ width: `${Math.max((t.actual / maxVal) * 100, 2)}%` }}>
                            {t.actual > 0 && <span className="text-[8px] font-black text-white">{fmtM(t.actual)}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Monthly trend */}
          <div className="glass-panel rounded-2xl p-5">
            <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2">
              <Calendar size={16} className="text-indigo-500" /> Xu hướng chi phí theo tháng
            </h3>
            <div className="flex items-end gap-1.5 h-48">
              {grandTotals.map((t, i) => {
                const maxGT = Math.max(...grandTotals.map(g => Math.max(g.planned, g.actual)), 1);
                const hP = Math.max((t.planned / maxGT) * 100, 3);
                const hA = Math.max((t.actual / maxGT) * 100, 3);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group" title={`T${i + 1}: DK ${fmtM(t.planned)} / TT ${fmtM(t.actual)}`}>
                    <div className="flex gap-0.5 items-end w-full" style={{ height: '85%' }}>
                      <div className="flex-1 bg-gradient-to-t from-blue-400 to-blue-300 rounded-t transition-all duration-300 group-hover:from-blue-500 group-hover:to-blue-400"
                        style={{ height: `${hP}%` }} />
                      <div className={`flex-1 rounded-t transition-all duration-300 ${
                        t.actual > t.planned && t.planned > 0
                          ? 'bg-gradient-to-t from-red-400 to-red-300 group-hover:from-red-500 group-hover:to-red-400'
                          : 'bg-gradient-to-t from-emerald-400 to-emerald-300 group-hover:from-emerald-500 group-hover:to-emerald-400'
                      }`} style={{ height: `${hA}%` }} />
                    </div>
                    <span className="text-[9px] font-black text-slate-400">T{i + 1}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-4 mt-3 text-[10px] font-bold text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-blue-400 inline-block" /> DK</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-emerald-400 inline-block" /> TT</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-400 inline-block" /> Vượt DK</span>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ADD/EDIT CATEGORY MODAL ==================== */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                <FolderPlus size={20} className="text-indigo-500" />
                {editingCatId ? 'Sửa mục chi phí' : 'Thêm mục chi phí'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Mã *</label>
                  <input type="text" value={formCode} onChange={e => setFormCode(e.target.value)} placeholder="I, I.1..."
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Tên mục *</label>
                  <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Chi phí đào tạo..."
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Thuộc mục cha</label>
                <select value={formParentId} onChange={e => setFormParentId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <option value="">— Mục cha (cấp cao nhất) —</option>
                  {parentCategories.map(p => (
                    <option key={p.id} value={p.id}>{p.code}. {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block flex items-center gap-1">
                  <Zap size={10} className="text-amber-500" /> Nguồn dữ liệu thực tế
                </label>
                <select value={formSource} onChange={e => setFormSource(e.target.value as BudgetSource)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  {SOURCE_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-400 mt-1">
                  {formSource === 'manual'
                    ? '✏️ Dữ liệu TT nhập từ Phiếu chi'
                    : '⚡ Dữ liệu TT tự động tổng hợp từ module tương ứng'}
                </p>
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => { setShowAddModal(false); setEditingCatId(null); }}
                className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={handleSaveCategory}
                className="px-4 py-2.5 bg-indigo-500 text-white rounded-xl text-xs font-black hover:bg-indigo-600 transition flex items-center gap-1.5">
                <Save size={14} /> {editingCatId ? 'Cập nhật' : 'Tạo mục'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ADD EXPENSE RECORD MODAL ==================== */}
      {showExpenseForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                <Receipt size={20} className="text-emerald-500" /> Tạo phiếu chi
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Mục chi phí *</label>
                <select value={expCatId} onChange={e => setExpCatId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none">
                  <option value="">— Chọn mục —</option>
                  {manualLeafCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.code}. {c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Số tiền (VNĐ) *</label>
                  <input type="number" value={expAmount} onChange={e => setExpAmount(e.target.value)} placeholder="1000000"
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Ngày chi *</label>
                  <input type="date" value={expDate} onChange={e => setExpDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase mb-1 block">Mô tả</label>
                <input type="text" value={expDesc} onChange={e => setExpDesc(e.target.value)} placeholder="VD: Thuê giảng viên khóa ABC..."
                  className="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 outline-none" />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowExpenseForm(false)}
                className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-700 transition">Huỷ</button>
              <button onClick={handleAddExpense} disabled={!expCatId || !expAmount}
                className="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black hover:bg-emerald-600 transition flex items-center gap-1.5 disabled:opacity-50">
                <Save size={14} /> Lưu phiếu chi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== VIEW EXPENSE RECORDS PANEL ==================== */}
      {viewExpCatId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                <FileText size={20} className="text-emerald-500" />
                Phiếu chi: {viewExpCat?.code} {viewExpCat?.name}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={() => { setExpCatId(viewExpCatId); setShowExpenseForm(true); }}
                  className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-black flex items-center gap-1">
                  <PlusCircle size={12} /> Thêm
                </button>
                <button onClick={() => setViewExpCatId(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {viewExpRecords.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Chưa có phiếu chi nào</p>
              ) : (
                <div className="space-y-2">
                  {viewExpRecords.map(rec => (
                    <div key={rec.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <DollarSign size={14} className="text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-black text-slate-700 dark:text-white">{rec.amount.toLocaleString('vi-VN')}đ</div>
                        <div className="text-[10px] text-slate-400">{new Date(rec.date).toLocaleDateString('vi-VN')} — {rec.description || 'Không có mô tả'}</div>
                        {rec.createdBy && <div className="text-[9px] text-slate-400">Người tạo: {rec.createdBy}</div>}
                      </div>
                      <button onClick={() => handleDeleteExpense(rec.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetDashboard;
