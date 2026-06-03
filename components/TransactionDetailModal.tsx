
import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Package, MapPin, Truck, ArrowRight, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Transaction, TransactionStatus, TransactionType } from '../types';
import { useApp } from '../context/AppContext';
import { canApproveWmsTransaction, canReceiveWmsTransaction, isFulfillmentBatchTransaction } from '../lib/wmsPermissions';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { parseQuantityInput, sanitizeQuantityInput } from '../lib/quantityInput';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({ isOpen, onClose, transaction }) => {
  const { items, warehouses, users, suppliers, user, updateTransactionStatus } = useApp();
  const toast = useToast();
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, { quantity: string; reason: string }>>({});
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (transaction) {
      setQuantityDrafts(Object.fromEntries(
        transaction.items.map((ti, index) => [index, { quantity: String(ti.quantity ?? 0), reason: ti.varianceReason || '' }])
      ));
    }
  }, [transaction]);

  if (!isOpen || !transaction) return null;

  const isPending = transaction.status === TransactionStatus.PENDING;
  const isApproved = transaction.status === TransactionStatus.APPROVED;
  const canApprove = isPending && canApproveWmsTransaction(user, transaction);
  const canReceive = isApproved
    && (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER)
    && canReceiveWmsTransaction(user, transaction);
  const actionMode: 'approval' | 'receipt' | null = canApprove ? 'approval' : canReceive ? 'receipt' : null;
  const canAdjustQuantities = !!actionMode && (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER);
  const isFulfillmentTx = isFulfillmentBatchTransaction(transaction);

  const requester = users.find(u => u.id === transaction.requesterId);
  const approver = users.find(u => u.id === transaction.approverId);
  const sourceWh = warehouses.find(w => w.id === transaction.sourceWarehouseId);
  const targetWh = warehouses.find(w => w.id === transaction.targetWarehouseId);
  const supplier = suppliers.find(s => s.id === transaction.supplierId);

  const updateQuantityDraft = (index: number, patch: Partial<{ quantity: string; reason: string }>) => {
    setQuantityDrafts(prev => ({
      ...prev,
      [index]: {
        quantity: prev[index]?.quantity ?? String(transaction.items[index]?.quantity ?? 0),
        reason: prev[index]?.reason ?? '',
        ...patch,
      },
    }));
  };

  const updateQuantityValue = (index: number, rawValue: string) => {
    const maxQty = Number(transaction.items[index]?.quantity || 0);
    updateQuantityDraft(index, {
      quantity: sanitizeQuantityInput(rawValue, {
        max: maxQty,
        previousValue: quantityDrafts[index]?.quantity ?? String(maxQty),
      }),
    });
  };

  const buildQuantityLines = () => {
    return transaction.items.map((ti, index) => {
      const draft = quantityDrafts[index] || { quantity: String(ti.quantity ?? 0), reason: '' };
      const quantity = parseQuantityInput(draft.quantity);
      const originalQty = Number(ti.quantity || 0);
      const reason = draft.reason.trim();

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Dòng ${index + 1}: Số lượng thực tế phải lớn hơn 0.`);
      }
      if (quantity > originalQty) {
        throw new Error(`Dòng ${index + 1}: Số lượng thực tế không được lớn hơn số lượng trên phiếu.`);
      }
      if (quantity !== originalQty && !reason) {
        throw new Error(`Dòng ${index + 1}: Nhập lý do khi số lượng thực tế lệch phiếu.`);
      }

      return { index, quantity, reason };
    });
  };

  const handlePrimaryAction = async () => {
    setProcessing(true);
    try {
      if (canAdjustQuantities) {
        await materialRequestFulfillmentService.updateTransactionReceiptQuantities({
          transaction,
          stage: actionMode || 'approval',
          lines: buildQuantityLines(),
        });
      }

      const nextStatus = actionMode === 'receipt'
        ? TransactionStatus.COMPLETED
        : (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER)
          ? TransactionStatus.APPROVED
          : TransactionStatus.COMPLETED;

      await updateTransactionStatus(transaction.id, nextStatus, user.id);
      onClose();
      toast.success(actionMode === 'receipt' ? 'Đã xác nhận nhập kho' : 'Đã duyệt phiếu kho');
    } catch (err: any) {
      logApiError('transactionDetail.primaryAction', err);
      toast.error(
        actionMode === 'receipt' ? 'Không thể xác nhận nhập kho' : 'Không thể phê duyệt phiếu',
        getApiErrorMessage(err, 'Không thể cập nhật phiếu kho trên Supabase.'),
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAll = async () => {
    setProcessing(true);
    try {
      await updateTransactionStatus(transaction.id, TransactionStatus.CANCELLED, user.id);
      onClose();
      toast.success('Đã từ chối phiếu');
    } catch (err: any) {
      logApiError('transactionDetail.reject', err);
      toast.error('Không thể từ chối phiếu', getApiErrorMessage(err, 'Không thể cập nhật trạng thái phiếu kho.'));
    } finally {
      setProcessing(false);
    }
  };

  const getStatusInfo = (status: TransactionStatus) => {
    switch (status) {
      case TransactionStatus.COMPLETED: return { label: 'Đã phê duyệt', color: 'bg-green-100 text-green-700 border-green-200' };
      case TransactionStatus.CANCELLED: return { label: 'Đã từ chối', color: 'bg-red-100 text-red-700 border-red-200' };
      case TransactionStatus.PENDING: return { label: 'Đang chờ duyệt', color: 'bg-orange-100 text-orange-700 border-orange-200' };
      case TransactionStatus.APPROVED: return { label: 'Chờ xác nhận nhập', color: 'bg-blue-100 text-blue-700 border-blue-200' };
      default: return { label: 'Khác', color: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  const getTxTypeLabel = (type: TransactionType) => {
    switch (type) {
      case TransactionType.IMPORT: return 'Phiếu Nhập kho';
      case TransactionType.EXPORT: return 'Phiếu Xuất kho';
      case TransactionType.TRANSFER: return 'Phiếu Chuyển kho';
      default: return 'Phiếu kho';
    }
  };

  const statusInfo = getStatusInfo(transaction.status);
  const primaryActionLabel = actionMode === 'receipt'
    ? 'Xác nhận nhập'
    : isFulfillmentTx
      ? 'Duyệt SL/CL'
      : 'Duyệt phiếu';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chi tiết phiếu</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <h3 className="font-bold text-xl text-slate-800">{getTxTypeLabel(transaction.type)}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-8 bg-slate-50/30">
          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Calendar size={18} className="text-slate-400 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Ngày tạo</p>
                  <p className="text-sm font-medium text-slate-700">{new Date(transaction.date).toLocaleString('vi-VN')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <User size={18} className="text-slate-400 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Người lập phiếu</p>
                  <p className="text-sm font-medium text-slate-700">{requester?.name || 'Hệ thống'}</p>
                </div>
              </div>
              {approver && (
                <div className="flex items-start gap-3">
                  <CheckCircle size={18} className="text-green-500 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Người phê duyệt</p>
                    <p className="text-sm font-medium text-slate-700">{approver?.name}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {transaction.type === TransactionType.IMPORT && supplier && (
                <div className="flex items-start gap-3">
                  <Truck size={18} className="text-blue-500 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Nhà cung cấp</p>
                    <p className="text-sm font-medium text-slate-700">{supplier.name}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-slate-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Luồng hàng hoá</p>
                  <div className="flex items-center gap-2 mt-1">
                    {sourceWh && <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded">{sourceWh.name}</span>}
                    {sourceWh && targetWh && <ArrowRight size={14} className="text-slate-300" />}
                    {targetWh && <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded">{targetWh.name}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Items List */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-700 flex items-center">
                <Package size={16} className="mr-2" /> Danh mục vật tư
              </h4>
              <span className="text-[10px] font-bold text-slate-400">{transaction.items.length} hạng mục</span>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3">Vật tư</th>
                  <th className="px-4 py-3 text-right">SL phiếu</th>
                  {canAdjustQuantities && <th className="px-4 py-3 text-right">SL thực tế</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transaction.items.map((ti, idx) => {
                  const item = items.find(i => i.id === ti.itemId) || transaction.pendingItems?.find(i => i.id === ti.itemId);
                  const draft = quantityDrafts[idx] || { quantity: String(ti.quantity ?? 0), reason: '' };
                  const draftQty = parseQuantityInput(draft.quantity);
                  const hasVariance = Number.isFinite(draftQty) && draftQty !== Number(ti.quantity || 0);
                  return (
                    <tr key={`${ti.fulfillmentBatchId || ''}-${ti.requestLineId || ti.itemId}-${idx}`}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-700">{item?.name || 'Vật tư mới'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{item?.sku || 'Đang chờ duyệt'}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">
                        {ti.quantity} <span className="text-[10px] text-slate-400 ml-1">{item?.unit}</span>
                      </td>
                      {canAdjustQuantities && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.quantity}
                                onChange={(event) => updateQuantityValue(idx, event.target.value)}
                                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm font-black text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10"
                              />
                              <span className="w-8 text-left text-[10px] font-bold text-slate-400">{item?.unit}</span>
                            </div>
                            {hasVariance && (
                              <div className="flex items-center gap-2 w-full justify-end">
                                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                                <input
                                  type="text"
                                  value={draft.reason}
                                  onChange={(event) => updateQuantityDraft(idx, { reason: event.target.value })}
                                  placeholder="Lý do lệch"
                                  className="w-52 max-w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 placeholder:text-amber-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {transaction.note && (
            <div className="bg-slate-100 p-4 rounded-xl border-l-4 border-slate-400">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Ghi chú phiếu</p>
              <p className="text-sm text-slate-600 italic">"{transaction.note}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-100 flex justify-between items-center">
          <div className="flex gap-2">
            {(canApprove || canReceive) && (
              <>
                {canApprove && (
                  <button
                    onClick={handleRejectAll}
                    disabled={processing}
                    className="px-6 py-2.5 bg-white border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-all text-sm uppercase tracking-widest disabled:opacity-60"
                  >
                    {processing ? 'Đang xử lý...' : 'Từ chối phiếu'}
                  </button>
                )}
                <button 
                  onClick={handlePrimaryAction}
                  disabled={processing}
                  className="px-6 py-2.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20 text-sm uppercase tracking-widest flex items-center gap-2 disabled:opacity-60"
                >
                  {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} {primaryActionLabel}
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-8 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailModal;
