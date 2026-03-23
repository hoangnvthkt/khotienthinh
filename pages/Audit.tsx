
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  ClipboardCheck, Search, QrCode, Save, AlertCircle,
  CheckCircle2, History, Warehouse as WarehouseIcon,
  ArrowRight, Package, Info, TrendingDown, AlertTriangle, ShieldAlert,
  Download, Eye, Calendar, FileSpreadsheet, ChevronLeft
} from 'lucide-react';
import { TransactionType, TransactionStatus, InventoryItem, Role, LossReason, LOSS_REASON_LABELS, AuditSession, AuditSessionItem } from '../types';
import ScannerModal from '../components/ScannerModal';
import * as XLSX from 'xlsx';

const Audit: React.FC = () => {
  const { items, warehouses, user, addTransaction, lossNorms, categories, auditSessions, addAuditSession } = useApp();
  const toast = useToast();
  const [selectedWhId, setSelectedWhId] = useState<string>(user.assignedWarehouseId || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [isScannerOpen, setScannerOpen] = useState(false);

  // Tab: 'audit' or 'history'
  const [activeView, setActiveView] = useState<'audit' | 'history'>('audit');
  const [viewingSession, setViewingSession] = useState<AuditSession | null>(null);

  // State for audit session
  const [auditData, setAuditData] = useState<Record<string, number>>({});
  const [auditReasons, setAuditReasons] = useState<Record<string, LossReason>>({});
  const [auditNotes, setAuditNotes] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const filteredItems = useMemo(() => {
    if (!selectedWhId) return [];
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [items, searchTerm, selectedWhId]);

  const handleUpdateActual = (itemId: string, value: string) => {
    const numValue = parseInt(value);
    if (isNaN(numValue)) {
      const newData = { ...auditData };
      delete newData[itemId];
      setAuditData(newData);
      const newReasons = { ...auditReasons };
      delete newReasons[itemId];
      setAuditReasons(newReasons);
      const newNotes = { ...auditNotes };
      delete newNotes[itemId];
      setAuditNotes(newNotes);
    } else {
      setAuditData(prev => ({ ...prev, [itemId]: numValue }));
    }
  };

  const handleScanResult = (sku: string) => {
    setSearchTerm(sku);
    setScannerOpen(false);
  };

  const getAllowedLoss = (item: InventoryItem): { percentage: number; source: string } | null => {
    const itemNorm = lossNorms.find(n => n.itemId === item.id);
    if (itemNorm) return { percentage: itemNorm.allowedPercentage, source: `Định mức: ${item.name}` };
    const catNorm = lossNorms.find(n => n.categoryId && categories.find(c => c.id === n.categoryId && c.name === item.category));
    if (catNorm) return { percentage: catNorm.allowedPercentage, source: `Định mức DM: ${item.category}` };
    return null;
  };

  const isReadOnly = user.role !== Role.ADMIN && !user.assignedWarehouseId;

  const unreasonedDiscrepancies = useMemo(() => {
    let count = 0;
    Object.entries(auditData).forEach(([itemId, actual]) => {
      const item = items.find(i => i.id === itemId);
      const system = item?.stockByWarehouse[selectedWhId] || 0;
      if (actual !== system && !auditReasons[itemId]) count++;
    });
    return count;
  }, [auditData, auditReasons, items, selectedWhId]);

  const handleSaveAudit = async () => {
    if (!selectedWhId || Object.keys(auditData).length === 0 || isReadOnly) return;

    if (unreasonedDiscrepancies > 0) {
      toast.error('Thiếu nguyên nhân', `Còn ${unreasonedDiscrepancies} vật tư chênh lệch chưa chọn nguyên nhân.`);
      return;
    }

    setIsSaving(true);
    const now = new Date().toISOString();
    const txId = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Build audit session items
    const sessionItems: AuditSessionItem[] = Object.entries(auditData).map(([itemId, actual]) => {
      const item = items.find(i => i.id === itemId)!;
      const system = item.stockByWarehouse[selectedWhId] || 0;
      const delta = (actual as number) - system;
      const isLoss = delta < 0;
      let exceedsNorm = false;
      let lossPercent = 0;
      let normPercent: number | undefined;

      if (isLoss && system > 0) {
        lossPercent = (Math.abs(delta) / system) * 100;
        const norm = getAllowedLoss(item);
        if (norm) {
          normPercent = norm.percentage;
          exceedsNorm = lossPercent > norm.percentage;
        }
      }

      return {
        itemId,
        itemName: item.name,
        sku: item.sku,
        unit: item.unit || '',
        systemStock: system,
        actualStock: actual as number,
        delta,
        lossReason: auditReasons[itemId] || undefined,
        note: auditNotes[itemId] || undefined,
        exceedsNorm,
        lossPercent: isLoss ? lossPercent : undefined,
        normPercent,
        lossValue: isLoss ? Math.abs(delta) * (item.priceIn || 0) : 0
      };
    });

    const whName = warehouses.find(w => w.id === selectedWhId)?.name || '';

    // Compute stats
    const totalDiscrepancies = sessionItems.filter(i => i.delta !== 0).length;
    const totalExceedNorm = sessionItems.filter(i => i.exceedsNorm).length;
    const totalLossValue = sessionItems.reduce((sum, i) => sum + (i.lossValue || 0), 0);

    // Save audit session
    const session: AuditSession = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      warehouseId: selectedWhId,
      warehouseName: whName,
      date: now,
      auditorId: user.id,
      auditorName: user.name || user.username,
      items: sessionItems,
      totalItems: sessionItems.length,
      totalDiscrepancies,
      totalExceedNorm,
      totalLossValue,
      transactionId: txId
    };
    addAuditSession(session);

    // Create adjustment transaction
    const transactionItems = sessionItems.map(si => ({
      itemId: si.itemId,
      quantity: si.delta,
      price: items.find(i => i.id === si.itemId)?.priceIn || 0
    }));

    const reasonDetails = sessionItems
      .filter(si => si.lossReason)
      .map(si => `${si.itemName}: ${LOSS_REASON_LABELS[si.lossReason!]}${si.note ? ` - ${si.note}` : ''}`)
      .join('; ');

    addTransaction({
      id: txId,
      type: TransactionType.ADJUSTMENT,
      date: now,
      items: transactionItems,
      targetWarehouseId: selectedWhId,
      requesterId: user.id,
      approverId: user.id,
      status: TransactionStatus.COMPLETED,
      note: `Kiểm kê tại ${whName}${reasonDetails ? `. Chi tiết: ${reasonDetails}` : ''}`
    });

    setTimeout(() => {
      setIsSaving(false);
      setShowSuccess(true);
      setAuditData({});
      setAuditReasons({});
      setAuditNotes({});
      toast.success('Kiểm kê thành công', 'Dữ liệu đã lưu. Xem tại tab "Lịch sử kiểm kê".');
      setTimeout(() => setShowSuccess(false), 3000);
    }, 1000);
  };

  // ==================== EXCEL EXPORT ====================
  const exportSessionToExcel = (session: AuditSession) => {
    const wsData = [
      ['BÁO CÁO KIỂM KÊ KHO'],
      [],
      ['Kho:', session.warehouseName],
      ['Ngày kiểm kê:', new Date(session.date).toLocaleString('vi-VN')],
      ['Người kiểm kê:', session.auditorName],
      ['Tổng vật tư kiểm:', session.totalItems],
      ['Chênh lệch:', session.totalDiscrepancies],
      ['Vượt định mức:', session.totalExceedNorm],
      ['Tổng giá trị hao hụt:', session.totalLossValue.toLocaleString('vi-VN') + ' đ'],
      [],
      ['STT', 'Mã SKU', 'Tên vật tư', 'ĐVT', 'Tồn HT', 'Thực tế', 'Chênh lệch', '% Hao hụt', '% Định mức', 'Vượt ĐM', 'Nguyên nhân', 'Ghi chú', 'Giá trị hao hụt']
    ];

    session.items.forEach((item, idx) => {
      wsData.push([
        (idx + 1) as any,
        item.sku,
        item.itemName,
        item.unit || '',
        item.systemStock as any,
        item.actualStock as any,
        item.delta as any,
        item.lossPercent !== undefined ? `${item.lossPercent.toFixed(1)}%` : '',
        item.normPercent !== undefined ? `${item.normPercent}%` : '',
        item.exceedsNorm ? 'CÓ' : '',
        item.lossReason ? LOSS_REASON_LABELS[item.lossReason] : '',
        item.note || '',
        item.lossValue ? (item.lossValue as any) : ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = [
      { wch: 5 }, { wch: 15 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 25 }, { wch: 15 }
    ];

    // Merge title row
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }];

    XLSX.utils.book_append_sheet(wb, ws, 'Kiểm kê');

    // Format: yy-mm-dd-hh-mm-ss kiemke.xlsx
    const d = new Date(session.date);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yy = d.getFullYear().toString().slice(-2);
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const fileName = `${yy}-${mm}-${dd}-${hh}-${mi}-${ss} kiemke.xlsx`;

    // Use Blob-based download for reliable browser export
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Xuất Excel', `Đã tải file ${fileName}`);
  };

  const stats = useMemo(() => {
    const itemsAudited = Object.keys(auditData).length;
    let discrepancies = 0;
    let exceedNorm = 0;
    let totalLossValue = 0;

    Object.entries(auditData).forEach(([itemId, actual]) => {
      const item = items.find(i => i.id === itemId);
      const system = item?.stockByWarehouse[selectedWhId] || 0;
      const diff = (actual as number) - system;
      if (actual !== system) {
        discrepancies++;
        if (diff < 0) {
          totalLossValue += Math.abs(diff) * (item?.priceIn || 0);
          const norm = getAllowedLoss(item!);
          if (norm && system > 0) {
            const lossPercent = (Math.abs(diff) / system) * 100;
            if (lossPercent > norm.percentage) exceedNorm++;
          }
        }
      }
    });

    return { itemsAudited, discrepancies, exceedNorm, totalLossValue };
  }, [auditData, items, selectedWhId, lossNorms]);

  // ==================== SESSION DETAIL VIEW ====================
  if (viewingSession) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setViewingSession(null)} className="flex items-center px-4 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition font-bold text-xs">
            <ChevronLeft size={16} className="mr-1" /> Quay lại
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Chi tiết kiểm kê</h1>
            <p className="text-slate-500 text-sm font-medium">{viewingSession.warehouseName} — {new Date(viewingSession.date).toLocaleString('vi-VN')}</p>
          </div>
          <button onClick={() => exportSessionToExcel(viewingSession)} className="flex items-center px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-500/20">
            <Download size={16} className="mr-2" /> Xuất Excel
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Vật tư kiểm</div>
            <div className="text-2xl font-black text-slate-800 mt-1">{viewingSession.totalItems}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Chênh lệch</div>
            <div className={`text-2xl font-black mt-1 ${viewingSession.totalDiscrepancies > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>{viewingSession.totalDiscrepancies}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-[10px] font-black uppercase text-red-400 tracking-widest">Vượt định mức</div>
            <div className={`text-2xl font-black mt-1 ${viewingSession.totalExceedNorm > 0 ? 'text-red-600' : 'text-slate-800'}`}>{viewingSession.totalExceedNorm}</div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Giá trị hao hụt</div>
            <div className="text-2xl font-black text-red-600 mt-1">{viewingSession.totalLossValue.toLocaleString('vi-VN')}đ</div>
          </div>
        </div>

        {/* Detail table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <p className="text-xs font-bold text-slate-500">Người kiểm kê: <span className="text-slate-800">{viewingSession.auditorName}</span></p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] uppercase font-black tracking-widest text-slate-400">
                  <th className="p-4">STT</th>
                  <th className="p-4">Vật tư</th>
                  <th className="p-4 text-center">Tồn HT</th>
                  <th className="p-4 text-center">Thực tế</th>
                  <th className="p-4 text-center">Chênh lệch</th>
                  <th className="p-4 text-center">% Hao hụt</th>
                  <th className="p-4">Nguyên nhân</th>
                  <th className="p-4">Ghi chú</th>
                  <th className="p-4">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {viewingSession.items.map((item, idx) => (
                  <tr key={item.itemId} className={`hover:bg-slate-50 transition ${item.exceedsNorm ? 'bg-red-50/40' : ''}`}>
                    <td className="p-4 text-sm font-bold text-slate-400">{idx + 1}</td>
                    <td className="p-4">
                      <div className="font-black text-sm text-slate-800">{item.itemName}</div>
                      <div className="text-[10px] font-bold text-slate-400 font-mono">{item.sku}</div>
                    </td>
                    <td className="p-4 text-center font-black text-slate-500">{item.systemStock}</td>
                    <td className="p-4 text-center font-black text-slate-800">{item.actualStock}</td>
                    <td className="p-4 text-center">
                      <span className={`font-black text-sm ${item.delta === 0 ? 'text-slate-400' : item.delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {item.delta > 0 ? `+${item.delta}` : item.delta}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      {item.lossPercent !== undefined ? (
                        <div>
                          <span className="font-bold text-sm text-red-600">{item.lossPercent.toFixed(1)}%</span>
                          {item.normPercent !== undefined && (
                            <span className={`text-[9px] font-bold ml-1 ${item.exceedsNorm ? 'text-red-500' : 'text-emerald-500'}`}>/ {item.normPercent}%</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-200">-</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-bold text-slate-700">{item.lossReason ? LOSS_REASON_LABELS[item.lossReason] : '-'}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs font-medium text-slate-500">{item.note || '-'}</span>
                    </td>
                    <td className="p-4">
                      {item.exceedsNorm ? (
                        <span className="flex items-center text-[10px] font-black text-red-600 uppercase"><ShieldAlert size={12} className="mr-1" /> Vượt ĐM</span>
                      ) : item.delta === 0 ? (
                        <span className="flex items-center text-[10px] font-black text-emerald-600 uppercase"><CheckCircle2 size={12} className="mr-1" /> Khớp</span>
                      ) : (
                        <span className="flex items-center text-[10px] font-black text-orange-600 uppercase"><AlertCircle size={12} className="mr-1" /> Lệch</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ==================== MAIN RENDER ====================
  return (
    <div className="space-y-6">
      <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScanResult} />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Kiểm kê kho</h1>
          <p className="text-slate-500 text-sm font-medium">Đối soát tồn kho thực tế và hệ thống.</p>
        </div>
        <div className="flex gap-2">
          {/* Tab toggle */}
          <div className="bg-slate-100 rounded-xl p-1 flex gap-1">
            <button onClick={() => setActiveView('audit')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${activeView === 'audit' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <ClipboardCheck size={14} className="inline mr-1.5" />Kiểm kê
            </button>
            <button onClick={() => setActiveView('history')} className={`px-4 py-2 rounded-lg text-xs font-bold transition ${activeView === 'history' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <History size={14} className="inline mr-1.5" />Lịch sử ({auditSessions.length})
            </button>
          </div>
          {activeView === 'audit' && !isReadOnly && (
            <button
              disabled={Object.keys(auditData).length === 0 || isSaving || unreasonedDiscrepancies > 0}
              onClick={handleSaveAudit}
              className="flex items-center px-6 py-2.5 bg-accent text-white rounded-xl hover:bg-blue-700 transition font-black uppercase text-[10px] tracking-widest shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none"
              title={unreasonedDiscrepancies > 0 ? `Còn ${unreasonedDiscrepancies} vật tư chưa chọn nguyên nhân` : ''}
            >
              {isSaving ? 'Đang lưu...' : <><Save size={16} className="mr-2" /> Hoàn tất</>}
            </button>
          )}
        </div>
      </div>

      {showSuccess && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 text-emerald-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={20} />
          <p className="text-sm font-bold">Dữ liệu kiểm kê đã được cập nhật thành công! Xem chi tiết tại tab "Lịch sử".</p>
        </div>
      )}

      {/* ==================== HISTORY TAB ==================== */}
      {activeView === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
              <History size={20} className="mr-2 text-blue-500" /> Lịch sử kiểm kê
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">Tất cả phiên kiểm kê đã hoàn thành. Nhấn "Xem" để xem chi tiết hoặc "Tải Excel" để xuất báo cáo.</p>
          </div>

          {auditSessions.length === 0 ? (
            <div className="p-16 text-center text-slate-300">
              <ClipboardCheck size={48} className="mx-auto opacity-20 mb-4" />
              <p className="font-black uppercase tracking-widest text-sm">Chưa có lịch sử kiểm kê</p>
              <p className="text-xs font-medium mt-1">Hoàn tất phiên kiểm kê đầu tiên để lưu lịch sử.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] uppercase font-black tracking-widest text-slate-400">
                    <th className="p-4">Ngày kiểm kê</th>
                    <th className="p-4">Kho</th>
                    <th className="p-4">Người kiểm kê</th>
                    <th className="p-4 text-center">Vật tư</th>
                    <th className="p-4 text-center">Chênh lệch</th>
                    <th className="p-4 text-center">Vượt ĐM</th>
                    <th className="p-4 text-right">Hao hụt (VNĐ)</th>
                    <th className="p-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditSessions.map(session => (
                    <tr key={session.id} className="hover:bg-slate-50 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-blue-400" />
                          <div>
                            <div className="font-bold text-sm text-slate-800">{new Date(session.date).toLocaleDateString('vi-VN')}</div>
                            <div className="text-[10px] text-slate-400 font-medium">{new Date(session.date).toLocaleTimeString('vi-VN')}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4"><span className="font-bold text-sm text-slate-700">{session.warehouseName}</span></td>
                      <td className="p-4"><span className="text-sm font-medium text-slate-600">{session.auditorName}</span></td>
                      <td className="p-4 text-center"><span className="font-black text-slate-800">{session.totalItems}</span></td>
                      <td className="p-4 text-center">
                        <span className={`font-black ${session.totalDiscrepancies > 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                          {session.totalDiscrepancies}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {session.totalExceedNorm > 0 ? (
                          <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-black">{session.totalExceedNorm}</span>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className={`font-black text-sm ${session.totalLossValue > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {session.totalLossValue > 0 ? session.totalLossValue.toLocaleString('vi-VN') + 'đ' : '0'}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setViewingSession(session)}
                            className="flex items-center px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition text-[10px] font-bold"
                          >
                            <Eye size={12} className="mr-1" /> Xem
                          </button>
                          <button
                            onClick={() => exportSessionToExcel(session)}
                            className="flex items-center px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition text-[10px] font-bold"
                          >
                            <FileSpreadsheet size={12} className="mr-1" /> Excel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== AUDIT TAB ==================== */}
      {activeView === 'audit' && (
        <>
          {unreasonedDiscrepancies > 0 && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center gap-3 text-amber-700">
              <AlertTriangle size={20} />
              <p className="text-sm font-bold">Có {unreasonedDiscrepancies} vật tư chênh lệch chưa chọn nguyên nhân.</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <WarehouseIcon size={14} /> Cấu hình phiên
                </h3>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">Chọn kho kiểm kê</label>
                  <select
                    value={selectedWhId}
                    onChange={(e) => {
                      setSelectedWhId(e.target.value);
                      setAuditData({});
                      setAuditReasons({});
                      setAuditNotes({});
                    }}
                    disabled={!!user.assignedWarehouseId}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="">-- Chọn kho --</option>
                    {warehouses.map(wh => (
                      <option key={wh.id} value={wh.id}>{wh.name}</option>
                    ))}
                  </select>
                </div>

                <div className="pt-4 border-t border-slate-50 space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Vật tư đã đếm:</span>
                    <span className="font-black text-slate-800">{stats.itemsAudited}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-medium">Sai lệch:</span>
                    <span className={`font-black ${stats.discrepancies > 0 ? 'text-orange-600' : 'text-slate-800'}`}>{stats.discrepancies}</span>
                  </div>
                  {stats.exceedNorm > 0 && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-red-500 font-medium flex items-center gap-1"><ShieldAlert size={12} /> Vượt ĐM:</span>
                      <span className="font-black text-red-600">{stats.exceedNorm}</span>
                    </div>
                  )}
                  {stats.totalLossValue > 0 && (
                    <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-50">
                      <span className="text-slate-500 font-medium">Giá trị hao hụt:</span>
                      <span className="font-black text-red-600">{stats.totalLossValue.toLocaleString('vi-VN')}đ</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-800 p-6 rounded-2xl shadow-sm text-white space-y-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <History size={14} /> Hướng dẫn
                </h3>
                <ul className="text-[11px] space-y-3 text-slate-300 font-medium">
                  <li className="flex gap-2">
                    <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">1</div>
                    <span>Chọn kho để kiểm kê.</span>
                  </li>
                  <li className="flex gap-2">
                    <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">2</div>
                    <span>Nhập số lượng thực tế.</span>
                  </li>
                  <li className="flex gap-2">
                    <div className="w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">3</div>
                    <span>Nếu lệch, <b>chọn nguyên nhân</b>.</span>
                  </li>
                  <li className="flex gap-2">
                    <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">4</div>
                    <span>Nhấn "Hoàn tất" → xem tại <b>Lịch sử</b>.</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="text" placeholder="Tìm vật tư..."
                    className="w-full pl-10 pr-4 py-3 text-sm border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-accent font-medium bg-slate-50/50"
                    value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                    disabled={!selectedWhId}
                  />
                </div>
                <button
                  onClick={() => setScannerOpen(true)}
                  disabled={!selectedWhId}
                  className="flex items-center justify-center px-6 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                >
                  <QrCode className="w-4 h-4 mr-2" /> Quét QR
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden min-h-[400px]">
                {!selectedWhId ? (
                  <div className="h-[400px] flex flex-col items-center justify-center text-slate-300 space-y-4">
                    <WarehouseIcon size={48} className="opacity-20" />
                    <p className="font-black uppercase tracking-widest text-sm">Vui lòng chọn kho</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500 text-[10px] uppercase font-black tracking-widest">
                          <th className="p-4">Vật tư</th>
                          <th className="p-4 text-center">Hệ thống</th>
                          <th className="p-4 text-center">Thực tế</th>
                          <th className="p-4 text-center">Chênh lệch</th>
                          <th className="p-4">Nguyên nhân</th>
                          <th className="p-4">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredItems.map(item => {
                          const systemStock = item.stockByWarehouse[selectedWhId] || 0;
                          const actualStock = auditData[item.id];
                          const hasInput = actualStock !== undefined;
                          const diff = hasInput ? actualStock - systemStock : 0;
                          const hasDiscrepancy = hasInput && diff !== 0;
                          const isLoss = hasInput && diff < 0;

                          const norm = getAllowedLoss(item);
                          let exceedsNorm = false;
                          let lossPercent = 0;
                          if (isLoss && systemStock > 0) {
                            lossPercent = (Math.abs(diff) / systemStock) * 100;
                            if (norm) {
                              exceedsNorm = lossPercent > norm.percentage;
                            }
                          }

                          return (
                            <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${exceedsNorm ? 'bg-red-50/40' : hasInput ? 'bg-blue-50/30' : ''}`}>
                              <td className="p-4">
                                <div className="font-black text-slate-800 text-sm">{item.name}</div>
                                <div className="text-[10px] font-bold text-slate-400 font-mono">{item.sku}</div>
                              </td>
                              <td className="p-4 text-center font-black text-slate-500">{systemStock}</td>
                              <td className="p-4 text-center">
                                <input type="number" min="0" placeholder={isReadOnly ? "Chỉ xem" : "Nhập..."} value={actualStock === undefined ? '' : actualStock} onChange={(e) => handleUpdateActual(item.id, e.target.value)} disabled={isReadOnly}
                                  className="w-24 px-3 py-2 text-center border border-slate-200 rounded-lg font-black text-slate-800 focus:ring-2 focus:ring-accent outline-none disabled:bg-slate-50 disabled:text-slate-400" />
                              </td>
                              <td className="p-4 text-center">
                                {hasInput ? (
                                  <div>
                                    <span className={`font-black text-sm ${diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                      {diff > 0 ? `+${diff}` : diff}
                                    </span>
                                    {isLoss && systemStock > 0 && (
                                      <div className="text-[9px] font-bold text-slate-400 mt-0.5">
                                        {lossPercent.toFixed(1)}%
                                        {norm && <span className={exceedsNorm ? ' text-red-500' : ' text-emerald-500'}> / {norm.percentage}%</span>}
                                      </div>
                                    )}
                                  </div>
                                ) : <span className="text-slate-200">-</span>}
                              </td>
                              <td className="p-4">
                                {hasDiscrepancy ? (
                                  <div className="space-y-1">
                                    <select value={auditReasons[item.id] || ''} onChange={(e) => setAuditReasons(prev => ({ ...prev, [item.id]: e.target.value as LossReason }))} disabled={isReadOnly}
                                      className={`w-full px-2 py-1.5 text-[11px] font-bold border rounded-lg outline-none focus:ring-2 focus:ring-accent ${auditReasons[item.id] ? 'border-slate-200 bg-white text-slate-700' : 'border-orange-300 bg-orange-50 text-orange-700 animate-pulse'}`}>
                                      <option value="">-- Chọn --</option>
                                      {Object.entries(LOSS_REASON_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                    </select>
                                    {auditReasons[item.id] && (
                                      <input type="text" placeholder="Ghi chú..." value={auditNotes[item.id] || ''} onChange={(e) => setAuditNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                                        className="w-full px-2 py-1 text-[10px] border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-accent font-medium text-slate-600" />
                                    )}
                                  </div>
                                ) : hasInput ? <span className="text-[10px] text-slate-300 italic">Khớp</span> : null}
                              </td>
                              <td className="p-4">
                                {hasInput ? (
                                  exceedsNorm ? <span className="flex items-center text-[10px] font-black text-red-600 uppercase"><ShieldAlert size={12} className="mr-1" /> Vượt ĐM</span>
                                    : diff === 0 ? <span className="flex items-center text-[10px] font-black text-emerald-600 uppercase"><CheckCircle2 size={12} className="mr-1" /> Khớp</span>
                                      : <span className="flex items-center text-[10px] font-black text-orange-600 uppercase"><AlertCircle size={12} className="mr-1" /> Lệch</span>
                                ) : <span className="text-[10px] font-bold text-slate-300 uppercase italic">Chưa kiểm</span>}
                              </td>
                            </tr>
                          );
                        })}
                        {filteredItems.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-20 text-center">
                              <div className="flex flex-col items-center opacity-20">
                                <Package size={40} />
                                <p className="text-xs font-black uppercase mt-4 tracking-widest">Không tìm thấy vật tư</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Audit;
