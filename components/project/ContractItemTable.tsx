import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Save, X, ChevronRight, ChevronDown, Upload,
  Package, Edit2, GripVertical, FileSpreadsheet, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { ContractItem, ContractItemType } from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface ContractItemTableProps {
  contractId: string;
  contractType: ContractItemType;
  constructionSiteId: string;
  readOnly?: boolean;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtMoney = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return fmt(n) + ' đ';
};

const EMPTY_ITEM: Partial<ContractItem> = {
  code: '', name: '', unit: 'm2', quantity: 0, unitPrice: 0, totalPrice: 0, order: 0,
};

const ContractItemTable: React.FC<ContractItemTableProps> = ({
  contractId, contractType, constructionSiteId, readOnly,
}) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ContractItem>>({});
  const [showAddRow, setShowAddRow] = useState(false);
  const [newItem, setNewItem] = useState<Partial<ContractItem>>({ ...EMPTY_ITEM });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contractItemService.listByContract(contractId, contractType);
      setItems(data);
      // Auto-expand all groups
      const groups = new Set(data.filter(i => data.some(c => c.parentId === i.id)).map(i => i.id));
      setExpandedGroups(groups);
    } catch (e: any) { toast.error('Lỗi tải BOQ', e?.message); }
    finally { setLoading(false); }
  }, [contractId, contractType]);

  useEffect(() => { load(); }, [load]);

  // Build tree structure
  const rootItems = items.filter(i => !i.parentId);
  const getChildren = (parentId: string) => items.filter(i => i.parentId === parentId);
  const isGroup = (id: string) => items.some(i => i.parentId === id);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Summary
  const totalValue = items.filter(i => !isGroup(i.id)).reduce((s, i) => s + (i.totalPrice || 0), 0);
  const completedValue = items.filter(i => !isGroup(i.id)).reduce((s, i) => s + ((i.completedQuantity || 0) * i.unitPrice), 0);
  const completedPercent = totalValue > 0 ? (completedValue / totalValue) * 100 : 0;

  // CRUD handlers
  const handleAdd = async () => {
    if (!newItem.code || !newItem.name) { toast.warning('Thiếu thông tin', 'Nhập mã và tên hạng mục'); return; }
    try {
      await contractItemService.create({
        ...newItem as any,
        contractId,
        contractType,
        constructionSiteId,
        quantity: newItem.quantity || 0,
        unitPrice: newItem.unitPrice || 0,
        totalPrice: (newItem.quantity || 0) * (newItem.unitPrice || 0),
        order: items.length,
      });
      setShowAddRow(false);
      setNewItem({ ...EMPTY_ITEM });
      await load();
      toast.success('Thêm hạng mục thành công');
    } catch (e: any) { toast.error('Lỗi thêm', e?.message); }
  };

  const handleStartEdit = (item: ContractItem) => {
    setEditingId(item.id);
    setEditData({ code: item.code, name: item.name, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await contractItemService.update(editingId, editData);
      setEditingId(null);
      await load();
      toast.success('Cập nhật thành công');
    } catch (e: any) { toast.error('Lỗi cập nhật', e?.message); }
  };

  const handleDelete = async (item: ContractItem) => {
    const ok = await confirm({ targetName: `${item.code} — ${item.name}`, title: 'Xoá hạng mục BOQ' });
    if (!ok) return;
    try {
      await contractItemService.remove(item.id);
      await load();
      toast.success('Xoá hạng mục thành công');
    } catch (e: any) { toast.error('Lỗi xoá', e?.message); }
  };

  // Excel Import
  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      // Auto-detect columns (skip header row)
      if (rows.length < 2) { toast.warning('File rỗng', 'File Excel không có dữ liệu'); return; }

      const importItems: Omit<ContractItem, 'id' | 'createdAt'>[] = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[0]) continue;
        importItems.push({
          contractId,
          contractType,
          constructionSiteId,
          code: String(row[0] || ''),
          name: String(row[1] || ''),
          unit: String(row[2] || 'm2'),
          quantity: Number(row[3]) || 0,
          unitPrice: Number(row[4]) || 0,
          totalPrice: (Number(row[3]) || 0) * (Number(row[4]) || 0),
          order: items.length + i,
        });
      }

      if (importItems.length === 0) { toast.warning('Không có dữ liệu', 'Không tìm thấy hạng mục hợp lệ'); return; }

      await contractItemService.batchCreate(importItems);
      await load();
      toast.success('Import thành công', `${importItems.length} hạng mục đã được thêm`);
      setShowImport(false);
    } catch (err: any) {
      toast.error('Lỗi import', err?.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Render a single BOQ row
  const renderRow = (item: ContractItem, depth: number = 0) => {
    const isEditing = editingId === item.id;
    const isGrp = isGroup(item.id);
    const expanded = expandedGroups.has(item.id);
    const children = getChildren(item.id);
    const pct = item.quantity > 0 && item.completedQuantity
      ? Math.min((item.completedQuantity / item.quantity) * 100, 100) : 0;

    return (
      <React.Fragment key={item.id}>
        <tr className={`group hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors ${isGrp ? 'bg-slate-50/50 dark:bg-slate-700/30 font-bold' : ''}`}>
          {/* STT / Expand */}
          <td className="px-2 py-2 text-center w-10">
            {isGrp ? (
              <button onClick={() => toggleGroup(item.id)} className="text-slate-400 hover:text-indigo-500">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="text-[10px] text-slate-300">{item.order + 1}</span>
            )}
          </td>
          {/* Mã */}
          <td className="px-2 py-2 text-xs" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
            {isEditing ? (
              <input value={editData.code || ''} onChange={e => setEditData({ ...editData, code: e.target.value })}
                className="w-16 px-1.5 py-1 rounded border border-indigo-300 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400" />
            ) : (
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{item.code}</span>
            )}
          </td>
          {/* Tên hạng mục */}
          <td className="px-2 py-2 text-xs min-w-[200px]">
            {isEditing ? (
              <input value={editData.name || ''} onChange={e => setEditData({ ...editData, name: e.target.value })}
                className="w-full px-1.5 py-1 rounded border border-indigo-300 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200">{item.name}</span>
            )}
          </td>
          {/* ĐVT */}
          <td className="px-2 py-2 text-xs text-center">
            {isEditing ? (
              <input value={editData.unit || ''} onChange={e => setEditData({ ...editData, unit: e.target.value })}
                className="w-12 px-1 py-1 rounded border border-indigo-300 text-xs text-center outline-none" />
            ) : (
              <span className="text-slate-500">{item.unit}</span>
            )}
          </td>
          {/* Khối lượng */}
          <td className="px-2 py-2 text-xs text-right">
            {isEditing ? (
              <input type="number" value={editData.quantity || 0}
                onChange={e => setEditData({ ...editData, quantity: Number(e.target.value) })}
                className="w-20 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200 font-medium">{isGrp ? '' : fmt(item.quantity)}</span>
            )}
          </td>
          {/* Đơn giá */}
          <td className="px-2 py-2 text-xs text-right">
            {isEditing ? (
              <input type="number" value={editData.unitPrice || 0}
                onChange={e => setEditData({ ...editData, unitPrice: Number(e.target.value) })}
                className="w-24 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none" />
            ) : (
              <span className="text-slate-700 dark:text-slate-200">{isGrp ? '' : fmt(item.unitPrice)}</span>
            )}
          </td>
          {/* Thành tiền */}
          <td className="px-2 py-2 text-xs text-right font-bold">
            <span className={isGrp ? 'text-slate-800 dark:text-white' : 'text-emerald-600'}>
              {isGrp
                ? fmtMoney(children.reduce((s, c) => s + (c.totalPrice || 0), 0))
                : fmtMoney(item.totalPrice || 0)
              }
            </span>
          </td>
          {/* % Hoàn thành */}
          <td className="px-2 py-2 text-xs text-center w-[90px]">
            {!isGrp && (
              <div className="flex items-center gap-1">
                <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <span className="text-[9px] font-bold text-slate-400 w-8">{pct.toFixed(0)}%</span>
              </div>
            )}
          </td>
          {/* Actions */}
          <td className="px-2 py-2 text-center w-16">
            {!readOnly && (
              isEditing ? (
                <div className="flex gap-0.5 justify-center">
                  <button onClick={handleSaveEdit} className="w-6 h-6 rounded flex items-center justify-center text-emerald-500 hover:bg-emerald-50">
                    <Save size={12} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-0.5 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleStartEdit(item)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-blue-500 hover:bg-blue-50">
                    <Edit2 size={11} />
                  </button>
                  <button onClick={() => handleDelete(item)} className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            )}
          </td>
        </tr>
        {/* Children */}
        {isGrp && expanded && children.map(child => renderRow(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-3 mt-3">
      {/* Header KPI */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">GT Hợp đồng</span>
            <span className="ml-2 text-sm font-black text-slate-800 dark:text-white">{fmtMoney(totalValue)}</span>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">Hoàn thành</span>
            <span className="ml-2 text-sm font-black text-emerald-600">{fmtMoney(completedValue)}</span>
            <span className="ml-1 text-[9px] font-bold text-slate-400">({completedPercent.toFixed(1)}%)</span>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-400 font-bold uppercase">Hạng mục</span>
            <span className="ml-2 text-sm font-black text-indigo-600">{items.length}</span>
          </div>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button onClick={() => { setShowImport(true); fileInputRef.current?.click(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-all">
              <FileSpreadsheet size={12} /> Import Excel
            </button>
            <button onClick={() => { setShowAddRow(true); setNewItem({ ...EMPTY_ITEM, order: items.length }); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-all">
              <Plus size={12} /> Thêm hạng mục
            </button>
          </div>
        )}
      </div>

      {/* BOQ Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-700 dark:to-slate-700">
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center w-10">#</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase">Mã</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase">Tên hạng mục</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center">ĐVT</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">KL</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">Đơn giá</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-right">Thành tiền</th>
              <th className="px-2 py-2.5 text-[9px] font-black text-slate-500 uppercase text-center">Hoàn thành</th>
              <th className="px-2 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-sm text-slate-400">Đang tải...</td></tr>
            ) : items.length === 0 && !showAddRow ? (
              <tr>
                <td colSpan={9} className="text-center py-10">
                  <Package size={32} className="mx-auto mb-2 text-slate-200" />
                  <p className="text-xs font-bold text-slate-400">Chưa có hạng mục BOQ</p>
                  <p className="text-[10px] text-slate-300 mt-1">Thêm thủ công hoặc Import từ Excel</p>
                </td>
              </tr>
            ) : (
              <>
                {rootItems.map(item => renderRow(item, 0))}
                {/* Add new row */}
                {showAddRow && (
                  <tr className="bg-indigo-50/50 dark:bg-indigo-900/20">
                    <td className="px-2 py-2 text-center"><Plus size={12} className="text-indigo-400 mx-auto" /></td>
                    <td className="px-2 py-2">
                      <input value={newItem.code || ''} onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                        placeholder="HM-01" autoFocus
                        className="w-16 px-1.5 py-1 rounded border border-indigo-300 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-400 bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2">
                      <input value={newItem.name || ''} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                        placeholder="Tên hạng mục"
                        className="w-full px-1.5 py-1 rounded border border-indigo-300 text-xs outline-none focus:ring-1 focus:ring-indigo-400 bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input value={newItem.unit || 'm2'} onChange={e => setNewItem({ ...newItem, unit: e.target.value })}
                        className="w-12 px-1 py-1 rounded border border-indigo-300 text-xs text-center outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={newItem.quantity || 0}
                        onChange={e => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
                        className="w-20 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input type="number" value={newItem.unitPrice || 0}
                        onChange={e => setNewItem({ ...newItem, unitPrice: Number(e.target.value) })}
                        className="w-24 px-1 py-1 rounded border border-indigo-300 text-xs text-right outline-none bg-white dark:bg-slate-700" />
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold text-emerald-600">
                      {fmtMoney((newItem.quantity || 0) * (newItem.unitPrice || 0))}
                    </td>
                    <td className="px-2 py-2"></td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex gap-0.5 justify-center">
                        <button onClick={handleAdd} className="w-6 h-6 rounded flex items-center justify-center text-emerald-500 hover:bg-emerald-50">
                          <CheckCircle2 size={14} />
                        </button>
                        <button onClick={() => setShowAddRow(false)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:bg-slate-100">
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
          {/* Footer total */}
          {items.length > 0 && (
            <tfoot>
              <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-slate-700 dark:to-slate-700 border-t-2 border-indigo-200 dark:border-indigo-800">
                <td colSpan={6} className="px-3 py-2.5 text-xs font-black text-slate-700 dark:text-white text-right uppercase">
                  Tổng cộng
                </td>
                <td className="px-2 py-2.5 text-sm font-black text-indigo-700 dark:text-indigo-300 text-right">
                  {fmtMoney(totalValue)}
                </td>
                <td className="px-2 py-2.5 text-[10px] font-bold text-emerald-600 text-center">
                  {completedPercent.toFixed(1)}%
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Hidden file input for Excel import */}
      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
        onChange={handleImportExcel} />

      {/* Import hint */}
      {showImport && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <FileSpreadsheet size={14} className="text-emerald-500 shrink-0" />
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            File Excel cần có 5 cột theo thứ tự: <strong>Mã | Tên hạng mục | ĐVT | Khối lượng | Đơn giá</strong>. Hàng đầu tiên là tiêu đề.
          </p>
        </div>
      )}
    </div>
  );
};

export default ContractItemTable;
