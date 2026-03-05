
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { TransactionType, Transaction, TransactionStatus, TransactionItem, InventoryItem, Role } from '../types';
import {
  Plus, Trash2, ArrowRight, Save, Send, Clock,
  CheckCircle, XCircle, FileText, User, History,
  AlertTriangle, Flame, ShieldAlert, PackageSearch,
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Inbox, Minus
} from 'lucide-react';
import ScannerModal from '../components/ScannerModal';
import ItemSelectionModal from '../components/ItemSelectionModal';
import WarningModal from '../components/WarningModal';
import ConfirmTransferModal from '../components/ConfirmTransferModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import MasterDataConfirmModal from '../components/MasterDataConfirmModal';

const Operations: React.FC = () => {
  const location = useLocation();
  const { items, warehouses, suppliers, users, user, transactions, addTransaction, updateTransactionStatus, clearTransactionHistory } = useApp();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<string>('IMPORT');

  if (user.role === Role.ACCOUNTANT) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
        <ShieldAlert size={48} className="mb-4 opacity-20" />
        <h2 className="text-xl font-black uppercase tracking-widest">Truy cập bị từ chối</h2>
        <p className="text-sm font-medium">Bạn không có quyền thực hiện nghiệp vụ kho.</p>
      </div>
    );
  }

  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isItemSelectOpen, setItemSelectOpen] = useState(false);

  const [warningState, setWarningState] = useState<{ isOpen: boolean; title: string; message: string }>({
    isOpen: false, title: '', message: ''
  });

  const [showConfirmTransfer, setShowConfirmTransfer] = useState(false);
  const [viewingHistoryTx, setViewingHistoryTx] = useState<Transaction | null>(null);

  const isKeeper = user.role === Role.KEEPER;
  const isAdmin = user.role === Role.ADMIN;

  // State quản lý kho bãi
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [note, setNote] = useState('');
  const [txItems, setTxItems] = useState<TransactionItem[]>([]);

  // Tự động gán kho cho Thủ kho khi mount hoặc đổi tab
  useEffect(() => {
    if (isKeeper && user.assignedWarehouseId) {
      setSelectedWarehouseId(user.assignedWarehouseId);
    } else if (!selectedWarehouseId) {
      setSelectedWarehouseId(warehouses[0]?.id || '');
    }
  }, [user, isKeeper, warehouses]);

  // State cho duyệt đếm ngược
  const [approvalModal, setApprovalModal] = useState<{
    isOpen: boolean;
    txId: string;
    type: 'APPROVE' | 'CANCEL' | 'RECEIVE';
    title: string;
    message: string;
  }>({
    isOpen: false, txId: '', type: 'APPROVE', title: '', message: ''
  });

  // Lọc danh sách transaction đang chờ DUYỆT (PENDING - Chờ Admin)
  const pendingAdminTxs = useMemo(() => {
    const base = transactions.filter(t => t.status === TransactionStatus.PENDING);
    if (isAdmin) return base;
    return base.filter(t => t.requesterId === user.id);
  }, [transactions, isAdmin, user]);

  // Lọc danh sách transaction đang chờ NHẬN (APPROVED - Chờ Kho đích)
  const pendingReceiptTxs = useMemo(() => {
    const base = transactions.filter(t => t.status === TransactionStatus.APPROVED);
    if (isAdmin) return base;
    return base.filter(t => t.targetWarehouseId === user.assignedWarehouseId);
  }, [transactions, isAdmin, user]);

  // Lọc danh sách lịch sử đã xử lý
  const historyTransactions = useMemo(() => {
    const baseHistory = transactions.filter(t =>
      t.status === TransactionStatus.COMPLETED || t.status === TransactionStatus.CANCELLED
    );
    if (isAdmin) return baseHistory;
    if (user.assignedWarehouseId) {
      return baseHistory.filter(t =>
        t.targetWarehouseId === user.assignedWarehouseId ||
        t.sourceWarehouseId === user.assignedWarehouseId ||
        t.requesterId === user.id
      );
    }
    return baseHistory.filter(t => t.requesterId === user.id);
  }, [transactions, isAdmin, user]);

  const handleSelectItem = (item: InventoryItem) => {
    const existing = txItems.find(i => i.itemId === item.id);
    if (existing) {
      setTxItems(txItems.map(i => i.itemId === item.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setTxItems([...txItems, { itemId: item.id, quantity: 1, price: item.priceIn || 0 }]);
    }
  };

  const executeSubmit = () => {
    // Validate: Không cho phép xuất kho khi tồn = 0
    if (activeTab === TransactionType.EXPORT || activeTab === TransactionType.TRANSFER || activeTab === TransactionType.LIQUIDATION) {
      const insufficientItems = txItems.filter(txItem => {
        const product = items.find(i => i.id === txItem.itemId);
        const stock = product?.stockByWarehouse[selectedWarehouseId] || 0;
        return txItem.quantity > stock;
      });
      if (insufficientItems.length > 0) {
        const names = insufficientItems.map(txItem => {
          const product = items.find(i => i.id === txItem.itemId);
          const stock = product?.stockByWarehouse[selectedWarehouseId] || 0;
          return `${product?.name} (Yêu cầu: ${txItem.quantity}, Tồn: ${stock})`;
        }).join('\n');
        toast.error('Không đủ tồn kho', `Các mặt hàng sau không đủ số lượng:\n${names}`);
        setShowConfirmTransfer(false);
        return;
      }
    }
    // Mọi phiếu từ Thủ kho đều bắt đầu ở trạng thái PENDING
    const newTx: Transaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: activeTab as TransactionType,
      date: new Date().toISOString(),
      items: txItems,
      requesterId: user.id,
      status: TransactionStatus.PENDING,
      note,
      sourceWarehouseId: (activeTab === TransactionType.EXPORT || activeTab === TransactionType.TRANSFER || activeTab === TransactionType.LIQUIDATION) ? selectedWarehouseId : undefined,
      targetWarehouseId: activeTab === TransactionType.IMPORT ? selectedWarehouseId : (activeTab === TransactionType.TRANSFER ? targetWarehouseId : undefined),
      supplierId: activeTab === TransactionType.IMPORT ? supplierId : undefined,
    };

    addTransaction(newTx);
    setTxItems([]);
    setNote('');
    setShowConfirmTransfer(false);
    toast.success('Đã gửi đề xuất', 'Phiếu của bạn đang chờ Admin phê duyệt.');
  };

  const handleSubmit = () => {
    if (txItems.length === 0) return setWarningState({ isOpen: true, title: 'Chưa có dữ liệu', message: 'Chọn ít nhất một vật tư.' });
    if (activeTab === TransactionType.TRANSFER && (!targetWarehouseId || selectedWarehouseId === targetWarehouseId)) {
      return setWarningState({ isOpen: true, title: "Lỗi logic", message: "Vui lòng kiểm tra lại kho nguồn và kho nhận." });
    }
    if (activeTab === TransactionType.TRANSFER) {
      setShowConfirmTransfer(true);
    } else {
      executeSubmit();
    }
  };

  const triggerApproval = (txId: string, type: 'APPROVE' | 'CANCEL' | 'RECEIVE') => {
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;

    if (type === 'APPROVE') {
      const isNeedReceipt = tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER;
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: isNeedReceipt ? "Phê duyệt (Chờ kho nhận)" : "Phê duyệt & Hoàn tất",
        message: isNeedReceipt
          ? "Bạn đang phê duyệt lệnh này. Sau khi duyệt, phiếu sẽ chuyển tới Kho đích để xác nhận nhận hàng thực tế."
          : "Phê duyệt lệnh này sẽ trừ kho ngay lập tức. Bạn có chắc chắn?"
      });
    } else if (type === 'RECEIVE') {
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: "Xác nhận nhận hàng",
        message: "Hành động này xác nhận bạn đã nhận đủ hàng thực tế. Tồn kho tại kho của bạn sẽ được cộng thêm ngay lập tức."
      });
    } else if (type === 'CANCEL') {
      setApprovalModal({
        isOpen: true,
        txId,
        type,
        title: "Xác nhận Từ chối phiếu",
        message: "Hành động này sẽ hủy bỏ đề xuất này vĩnh viễn. Người yêu cầu sẽ nhận được thông báo về việc phiếu bị từ chối."
      });
    }
  };

  const handleConfirmAction = () => {
    const tx = transactions.find(t => t.id === approvalModal.txId);
    if (!tx) return;

    if (approvalModal.type === 'APPROVE') {
      // Luồng mới: Nhập/Chuyển cần APPROVED trước khi COMPLETED
      if (tx.type === TransactionType.IMPORT || tx.type === TransactionType.TRANSFER) {
        updateTransactionStatus(tx.id, TransactionStatus.APPROVED, user.id);
      } else {
        // Xuất/Hủy: Duyệt là COMPLETED luôn
        updateTransactionStatus(tx.id, TransactionStatus.COMPLETED, user.id);
      }
    } else if (approvalModal.type === 'RECEIVE') {
      updateTransactionStatus(tx.id, TransactionStatus.COMPLETED, user.id);
    } else if (approvalModal.type === 'CANCEL') {
      updateTransactionStatus(tx.id, TransactionStatus.CANCELLED, user.id);
    }

    setApprovalModal(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="space-y-6">
      <ScannerModal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} onScan={(sku) => {
        const item = items.find(i => i.sku === sku);
        if (item) handleSelectItem(item);
      }} />

      <ItemSelectionModal
        isOpen={isItemSelectOpen}
        onClose={() => setItemSelectOpen(false)}
        onSelect={handleSelectItem}
        onOpenScanner={() => setScannerOpen(true)}
        filterWarehouseId={selectedWarehouseId}
      />

      <WarningModal isOpen={warningState.isOpen} onClose={() => setWarningState(p => ({ ...p, isOpen: false }))} title={warningState.title} message={warningState.message} />
      <ConfirmTransferModal isOpen={showConfirmTransfer} onClose={() => setShowConfirmTransfer(false)} onConfirm={executeSubmit}
        sourceWarehouse={warehouses.find(w => w.id === selectedWarehouseId)} targetWarehouse={warehouses.find(w => w.id === targetWarehouseId)}
        items={txItems.map(ti => ({ product: items.find(i => i.id === ti.itemId)!, quantity: ti.quantity }))} />

      <TransactionDetailModal isOpen={!!viewingHistoryTx} onClose={() => setViewingHistoryTx(null)} transaction={viewingHistoryTx} />

      <MasterDataConfirmModal
        isOpen={approvalModal.isOpen}
        onClose={() => setApprovalModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmAction}
        title={approvalModal.title}
        message={approvalModal.message}
        type={approvalModal.type === 'CANCEL' ? 'danger' : (approvalModal.type === 'RECEIVE' ? 'success' : 'warning')}
        actionLabel={approvalModal.type === 'APPROVE' ? 'Xác nhận Duyệt' : (approvalModal.type === 'RECEIVE' ? 'Xác nhận Nhận hàng' : 'Từ chối phiếu')}
        countdownRequired={approvalModal.type !== 'RECEIVE'}
      />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Nghiệp vụ kho</h1>
        {isKeeper && (
          <div className="flex items-center gap-2 bg-blue-50 text-accent px-3 py-1.5 rounded-xl border border-blue-100">
            <ShieldAlert size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">Phạm vi: {warehouses.find(w => w.id === user.assignedWarehouseId)?.name}</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto bg-slate-50/50 scrollbar-hide">
          <button onClick={() => { setActiveTab('IMPORT'); setTxItems([]); }} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'IMPORT' ? 'border-accent text-accent bg-white shadow-[0_-4px_0_inset_#2563eb]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>Nhập kho</button>
          <button onClick={() => { setActiveTab('EXPORT'); setTxItems([]); }} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'EXPORT' ? 'border-accent text-accent bg-white shadow-[0_-4px_0_inset_#2563eb]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>Xuất kho</button>
          <button onClick={() => { setActiveTab('TRANSFER'); setTxItems([]); }} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'TRANSFER' ? 'border-accent text-accent bg-white shadow-[0_-4px_0_inset_#2563eb]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>Chuyển kho</button>
          <button onClick={() => { setActiveTab('LIQUIDATION'); setTxItems([]); }} className={`flex-1 min-w-[100px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === 'LIQUIDATION' ? 'border-red-600 text-red-600 bg-white shadow-[0_-4px_0_inset_#dc2626]' : 'border-transparent text-slate-400 hover:text-red-400'}`}>Xuất hủy</button>
          <button onClick={() => setActiveTab('PENDING')} className={`flex-1 min-w-[120px] px-4 py-4 text-[10px] md:text-xs font-black uppercase tracking-widest border-b-2 transition-all relative ${activeTab === 'PENDING' ? 'border-orange-500 text-orange-600 bg-white shadow-[0_-4px_0_inset_#f97316]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
            Quản lý phiếu
            {(pendingAdminTxs.length + pendingReceiptTxs.length) > 0 && <span className="ml-2 bg-orange-500 text-white text-[8px] md:text-[10px] px-1.5 py-0.5 rounded-full ring-2 ring-white">{(pendingAdminTxs.length + pendingReceiptTxs.length)}</span>}
          </button>
        </div>

        <div className="p-6 bg-white">
          {activeTab === 'PENDING' ? (
            <div className="space-y-12">
              {/* PHIẾU CHỜ ADMIN DUYỆT */}
              <section className="space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-800 flex items-center text-sm">
                    <ShieldAlert size={18} className="mr-2 text-red-500" />
                    {isAdmin ? 'Đề xuất chờ bạn phê duyệt (Giai đoạn 1)' : 'Đề xuất bạn đã gửi (Đang chờ Admin)'}
                  </h3>
                  <span className="text-[10px] font-black bg-slate-100 px-2 py-0.5 rounded text-slate-500 uppercase">{pendingAdminTxs.length} PHIẾU</span>
                </div>
                {pendingAdminTxs.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-slate-100 rounded-2xl text-slate-300 text-xs italic">Không có đề xuất nào đang chờ Admin.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {pendingAdminTxs.map(tx => {
                      const requester = users.find(u => u.id === tx.requesterId);
                      const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId || w.id === tx.sourceWarehouseId);
                      return (
                        <div key={tx.id} onClick={() => setViewingHistoryTx(tx)} className="bg-white border border-slate-100 rounded-2xl p-4 hover:border-orange-200 transition-all cursor-pointer group">
                          <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-orange-100 text-orange-700">CHỜ ADMIN DUYỆT</span>
                                <span className="text-[10px] text-slate-400 font-mono font-bold">{new Date(tx.date).toLocaleString()}</span>
                              </div>
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-sm font-black text-slate-700">{requester?.name}</span>
                                <ArrowRight size={14} className="mx-1 text-slate-300" />
                                <span className="text-sm font-black text-accent">{targetWh?.name}</span>
                                <span className="text-xs text-slate-400 ml-2">({tx.type})</span>
                              </div>
                              <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg group-hover:bg-orange-50/50 transition-colors">
                                {tx.items.length} vật tư • {tx.note || 'Không có ghi chú'}
                              </div>
                            </div>
                            {isAdmin && (
                              <div className="flex md:flex-col gap-2 min-w-[140px] pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => triggerApproval(tx.id, 'APPROVE')} className="flex-1 py-2 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-700">Duyệt Phiếu</button>
                                <button onClick={() => triggerApproval(tx.id, 'CANCEL')} className="flex-1 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50">Từ Chối</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* PHIẾU CHỜ KHO ĐÍCH XÁC NHẬN */}
              <section className="space-y-4 pt-8 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-800 flex items-center text-sm">
                    <Inbox size={18} className="mr-2 text-blue-500" />
                    {isAdmin ? 'Đã duyệt - Chờ kho đích nhận hàng (Giai đoạn 2)' : 'Hàng đang tới - Chờ bạn xác nhận nhập kho'}
                  </h3>
                  <span className="text-[10px] font-black bg-blue-50 px-2 py-0.5 rounded text-blue-500 uppercase">{pendingReceiptTxs.length} PHIẾU</span>
                </div>
                {pendingReceiptTxs.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-slate-100 rounded-2xl text-slate-300 text-xs italic">Không có hàng hoá nào đang chờ xác nhận nhập.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {pendingReceiptTxs.map(tx => {
                      const targetWh = warehouses.find(w => w.id === tx.targetWarehouseId);
                      const isMyWarehouse = targetWh?.id === user.assignedWarehouseId;
                      return (
                        <div key={tx.id} onClick={() => setViewingHistoryTx(tx)} className={`bg-white border rounded-2xl p-4 transition-all cursor-pointer group ${isMyWarehouse ? 'border-blue-200 bg-blue-50/5 shadow-md shadow-blue-500/5 hover:border-blue-400' : 'border-slate-100 hover:border-accent'}`}>
                          <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-blue-600 text-white shadow-sm">ĐÃ DUYỆT - CHỜ NHẬN</span>
                                <span className="text-[10px] text-slate-400 font-mono font-bold">Admin đã duyệt lúc {new Date(tx.date).toLocaleTimeString()}</span>
                              </div>
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-xs font-bold text-slate-400 uppercase">Kho nhận:</span>
                                <span className="text-sm font-black text-blue-600">{targetWh?.name}</span>
                              </div>
                              <div className="bg-white p-2 rounded-lg border border-slate-100 group-hover:bg-blue-50/30 transition-colors">
                                {tx.items.slice(0, 2).map((ti, i) => {
                                  const it = items.find(item => item.id === ti.itemId);
                                  return <div key={i} className="text-xs font-bold text-slate-700 flex justify-between"><span>• {it?.name}</span> <span>{ti.quantity} {it?.unit}</span></div>
                                })}
                                {tx.items.length > 2 && <div className="text-[10px] text-slate-400 mt-1 italic text-center">... và {tx.items.length - 2} hạng mục khác</div>}
                              </div>
                            </div>
                            {(isAdmin || isMyWarehouse) && (
                              <div className="flex md:flex-col gap-2 min-w-[160px] pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-slate-100 md:pl-4" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => triggerApproval(tx.id, 'RECEIVE')} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2">
                                  <CheckCircle size={14} /> XÁC NHẬN NHẬN
                                </button>
                                {isAdmin && <div className="text-[9px] text-slate-400 text-center italic mt-1 font-bold">Chờ kho đích bấm nhận</div>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* LỊCH SỬ HOẠT ĐỘNG */}
              <section className="space-y-4 pt-8 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-800 flex items-center text-sm"><History size={18} className="mr-2 text-slate-500" /> Lịch sử hoạt động</h3>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {historyTransactions.slice(0, 10).map(tx => {
                    const requester = users.find(u => u.id === tx.requesterId);
                    const isApproved = tx.status === TransactionStatus.COMPLETED;
                    const isLiquidation = tx.type === TransactionType.LIQUIDATION;
                    return (
                      <div key={tx.id} onClick={() => setViewingHistoryTx(tx)} className={`flex items-center justify-between p-3 rounded-2xl border border-slate-50 hover:border-accent transition-all cursor-pointer group ${isApproved ? (isLiquidation ? 'bg-red-50/20' : 'bg-green-50/10') : 'bg-slate-50'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isApproved ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-400'}`}>
                            {isApproved ? <CheckCircle size={16} /> : <XCircle size={16} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${isApproved ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {isApproved ? 'Hoàn thành' : 'Từ chối'}
                              </span>
                              <span className="text-xs font-black text-slate-700">{tx.type} • {tx.id.slice(-6)}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-tight">{requester?.name} • {new Date(tx.date).toLocaleDateString('vi-VN')}</p>
                          </div>
                        </div>
                        <ArrowRight size={16} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <>
              {/* Form tạo phiếu */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                {activeTab === 'IMPORT' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nhà cung cấp</label>
                    <select className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-accent outline-none font-black text-sm" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {activeTab === 'IMPORT' ? 'Kho nhận về' : (activeTab === 'LIQUIDATION' ? 'Kho cần hủy vật tư' : 'Kho xuất đi')}
                  </label>
                  <select
                    disabled={isKeeper}
                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-accent outline-none font-black text-sm disabled:opacity-70 disabled:bg-slate-100"
                    value={selectedWarehouseId}
                    onChange={e => setSelectedWarehouseId(e.target.value)}
                  >
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>

                {activeTab === 'TRANSFER' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kho đích nhận hàng</label>
                    <select className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-accent outline-none font-black text-sm" value={targetWarehouseId} onChange={e => setTargetWarehouseId(e.target.value)}>
                      <option value="">Chọn kho nhận...</option>
                      {warehouses.filter(w => w.id !== selectedWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                )}

                <div className={`space-y-2 ${activeTab === 'LIQUIDATION' || activeTab === 'IMPORT' ? 'lg:col-span-2' : 'lg:col-span-1'}`}>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ghi chú & Lý do</label>
                  <input type="text" className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 outline-none font-bold text-sm" placeholder="Thông tin bổ sung..." value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>

              <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-black text-xs uppercase tracking-widest text-slate-800 flex items-center">
                    <PackageSearch size={18} className="mr-2 text-accent" /> Danh sách vật tư trong phiếu
                  </h3>
                  <button onClick={() => setItemSelectOpen(true)} className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-black text-[10px] uppercase tracking-widest shadow-lg shadow-slate-500/20">
                    <Plus size={16} className="mr-1.5" /> Thêm / Scan
                  </button>
                </div>
                {txItems.length === 0 ? (
                  <div onClick={() => setItemSelectOpen(true)} className="border-4 border-dashed border-slate-50 rounded-2xl p-10 md:p-16 text-center text-slate-300 font-black uppercase tracking-widest cursor-pointer hover:bg-slate-50 transition-all text-sm">Nhấn để chọn vật tư...</div>
                ) : (
                  <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                    {/* Desktop View */}
                    <div className="hidden md:block">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black tracking-widest border-b border-slate-100">
                          <tr><th className="p-4">Sản phẩm</th><th className="p-4 w-32 text-center">Số lượng</th><th className="p-4 w-16"></th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {txItems.map((item, idx) => {
                            const product = items.find(i => i.id === item.itemId);
                            return (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="p-4">
                                  <div className="font-black text-slate-800 text-sm">{product?.name}</div>
                                  <div className="text-[10px] text-slate-400 font-bold uppercase">{product?.sku}</div>
                                </td>
                                <td className="p-4">
                                  <div className="flex items-center gap-2">
                                    <input type="number" min="1" value={item.quantity} onChange={(e) => setTxItems(txItems.map(ti => ti.itemId === item.itemId ? { ...ti, quantity: parseInt(e.target.value) } : ti))} className="w-full border-2 border-slate-100 rounded-lg px-2 py-1.5 text-center font-black text-accent outline-none focus:border-accent" />
                                    <span className="text-[10px] font-black text-slate-400 uppercase">{product?.unit}</span>
                                  </div>
                                </td>
                                <td className="p-4 text-right">
                                  <button onClick={() => setTxItems(txItems.filter(ti => ti.itemId !== item.itemId))} className="text-slate-300 hover:text-red-500 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {txItems.map((item, idx) => {
                        const product = items.find(i => i.id === item.itemId);
                        return (
                          <div key={idx} className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-mono text-slate-400 font-bold uppercase mb-0.5">{product?.sku}</div>
                                <h4 className="font-black text-slate-800 text-sm truncate pr-4">{product?.name}</h4>
                              </div>
                              <button onClick={() => setTxItems(txItems.filter(ti => ti.itemId !== item.itemId))} className="p-2 text-slate-300 hover:text-red-600 transition-colors shrink-0"><Trash2 size={18} /></button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Số lượng:</span>
                              <div className="flex items-center gap-3 bg-slate-50 p-1 rounded-lg border border-slate-100">
                                <button onClick={() => setTxItems(txItems.map(ti => ti.itemId === item.itemId ? { ...ti, quantity: Math.max(1, ti.quantity - 1) } : ti))} className="p-1.5 bg-white rounded border border-slate-200 text-slate-400"><Minus size={14} /></button>
                                <span className="w-8 text-center font-black text-sm">{item.quantity}</span>
                                <button onClick={() => setTxItems(txItems.map(ti => ti.itemId === item.itemId ? { ...ti, quantity: ti.quantity + 1 } : ti))} className="p-1.5 bg-white rounded border border-slate-200 text-slate-400"><Plus size={14} /></button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-6 border-t border-slate-100">
                <button
                  onClick={handleSubmit}
                  className="px-12 py-4 bg-accent text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-xl hover:bg-blue-700 transition-all flex items-center shadow-blue-500/20"
                >
                  <Send size={18} className="mr-2" /> Gửi đề xuất phê duyệt
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Operations;
