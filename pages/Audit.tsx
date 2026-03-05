
import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  ClipboardCheck, Search, QrCode, Save, AlertCircle,
  CheckCircle2, History, Warehouse as WarehouseIcon,
  ArrowRight, Package, Info
} from 'lucide-react';
import { TransactionType, TransactionStatus, InventoryItem, Role } from '../types';
import ScannerModal from '../components/ScannerModal';

const Audit: React.FC = () => {
  const { items, warehouses, user, addTransaction } = useApp();
  const toast = useToast();
  const [selectedWhId, setSelectedWhId] = useState<string>(user.assignedWarehouseId || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [isScannerOpen, setScannerOpen] = useState(false);

  // State for audit session
  const [auditData, setAuditData] = useState<Record<string, number>>({});
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
    } else {
      setAuditData(prev => ({ ...prev, [itemId]: numValue }));
    }
  };

  const handleScanResult = (sku: string) => {
    setSearchTerm(sku);
    setScannerOpen(false);
  };

  const isAccountant = user.role === Role.ACCOUNTANT;

  const handleSaveAudit = async () => {
    if (!selectedWhId || Object.keys(auditData).length === 0 || isAccountant) return;

    setIsSaving(true);

    // Create adjustment transactions for each item audited
    const now = new Date().toISOString();

    const transactionItems = Object.entries(auditData).map(([itemId, actual]) => {
      const item = items.find(i => i.id === itemId);
      const system = (item?.stockByWarehouse[selectedWhId] || 0) as number;
      const delta = (actual as number) - system;

      return {
        itemId,
        quantity: delta, // Store the delta
        price: item?.priceIn || 0
      };
    });

    const newTx = {
      id: `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: TransactionType.ADJUSTMENT,
      date: now,
      items: transactionItems,
      targetWarehouseId: selectedWhId,
      requesterId: user.id,
      approverId: user.id,
      status: TransactionStatus.COMPLETED,
      note: `Kiểm kê kho định kỳ tại ${warehouses.find(w => w.id === selectedWhId)?.name}`
    };

    addTransaction(newTx);

    setTimeout(() => {
      setIsSaving(false);
      setShowSuccess(true);
      setAuditData({});
      toast.success('Kiểm kê thành công', 'Dữ liệu tồn kho đã được điều chỉnh.');
      setTimeout(() => setShowSuccess(false), 3000);
    }, 1000);
  };

  const stats = useMemo(() => {
    const itemsAudited = Object.keys(auditData).length;
    let discrepancies = 0;

    Object.entries(auditData).forEach(([itemId, actual]) => {
      const item = items.find(i => i.id === itemId);
      const system = item?.stockByWarehouse[selectedWhId] || 0;
      if (actual !== system) discrepancies++;
    });

    return { itemsAudited, discrepancies };
  }, [auditData, items, selectedWhId]);

  return (
    <div className="space-y-6">
      <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScanResult} />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Kiểm kê kho</h1>
          <p className="text-slate-500 text-sm font-medium">Đối soát tồn kho thực tế và hệ thống.</p>
        </div>
        <div className="flex gap-2">
          {!isAccountant && (
            <button
              disabled={Object.keys(auditData).length === 0 || isSaving}
              onClick={handleSaveAudit}
              className="flex items-center px-6 py-2.5 bg-accent text-white rounded-xl hover:bg-blue-700 transition font-black uppercase text-[10px] tracking-widest shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none"
            >
              {isSaving ? 'Đang lưu...' : <><Save size={16} className="mr-2" /> Hoàn tất kiểm kê</>}
            </button>
          )}
        </div>
      </div>

      {showSuccess && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 text-emerald-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={20} />
          <p className="text-sm font-bold">Dữ liệu kiểm kê đã được cập nhật vào hệ thống thành công!</p>
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
                }}
                disabled={user.role === 'KEEPER' && !!user.assignedWarehouseId}
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
                <span className="text-slate-500 font-medium">Số lượng sai lệch:</span>
                <span className={`font-black ${stats.discrepancies > 0 ? 'text-orange-600' : 'text-slate-800'}`}>
                  {stats.discrepancies}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-2xl shadow-sm text-white space-y-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <History size={14} /> Hướng dẫn
            </h3>
            <ul className="text-[11px] space-y-3 text-slate-300 font-medium">
              <li className="flex gap-2">
                <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">1</div>
                <span>Chọn kho bạn đang đứng để bắt đầu kiểm kê.</span>
              </li>
              <li className="flex gap-2">
                <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">2</div>
                <span>Sử dụng máy quét QR hoặc tìm kiếm để chọn vật tư.</span>
              </li>
              <li className="flex gap-2">
                <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">3</div>
                <span>Nhập số lượng thực tế bạn đếm được vào ô "Thực tế".</span>
              </li>
              <li className="flex gap-2">
                <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center text-[8px] font-black shrink-0 mt-0.5">4</div>
                <span>Nhấn "Hoàn tất" để hệ thống tự động điều chỉnh tồn kho.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="text" placeholder="Tìm vật tư để kiểm kê..."
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
                <p className="font-black uppercase tracking-widest text-sm">Vui lòng chọn kho để bắt đầu</p>
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
                      <th className="p-4">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map(item => {
                      const systemStock = item.stockByWarehouse[selectedWhId] || 0;
                      const actualStock = auditData[item.id];
                      const hasInput = actualStock !== undefined;
                      const diff = hasInput ? actualStock - systemStock : 0;

                      return (
                        <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${hasInput ? 'bg-blue-50/30' : ''}`}>
                          <td className="p-4">
                            <div className="font-black text-slate-800 text-sm">{item.name}</div>
                            <div className="text-[10px] font-bold text-slate-400 font-mono">{item.sku}</div>
                          </td>
                          <td className="p-4 text-center font-black text-slate-500">{systemStock}</td>
                          <td className="p-4 text-center">
                            <input
                              type="number"
                              min="0"
                              placeholder={isAccountant ? "Chỉ xem" : "Nhập số..."}
                              value={actualStock === undefined ? '' : actualStock}
                              onChange={(e) => handleUpdateActual(item.id, e.target.value)}
                              disabled={isAccountant}
                              className="w-24 px-3 py-2 text-center border border-slate-200 rounded-lg font-black text-slate-800 focus:ring-2 focus:ring-accent outline-none disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </td>
                          <td className="p-4 text-center">
                            {hasInput ? (
                              <span className={`font-black text-sm ${diff === 0 ? 'text-slate-400' : (diff > 0 ? 'text-emerald-600' : 'text-red-600')}`}>
                                {diff > 0 ? `+${diff}` : diff}
                              </span>
                            ) : (
                              <span className="text-slate-200">-</span>
                            )}
                          </td>
                          <td className="p-4">
                            {hasInput ? (
                              diff === 0 ? (
                                <span className="flex items-center text-[10px] font-black text-emerald-600 uppercase"><CheckCircle2 size={12} className="mr-1" /> Khớp</span>
                              ) : (
                                <span className="flex items-center text-[10px] font-black text-orange-600 uppercase"><AlertCircle size={12} className="mr-1" /> Lệch</span>
                              )
                            ) : (
                              <span className="text-[10px] font-bold text-slate-300 uppercase italic">Chưa kiểm</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-20 text-center">
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
    </div>
  );
};

export default Audit;
