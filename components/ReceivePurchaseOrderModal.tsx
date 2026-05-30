import React, { useEffect, useMemo, useState } from 'react';
import { X, PackageCheck, Loader2, AlertTriangle, Building2 } from 'lucide-react';
import { PurchaseOrder, RequestStatus, Transaction, TransactionStatus, TransactionType, Role } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { poService } from '../lib/projectService';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { materialRequestService } from '../lib/materialRequestService';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { usePermission } from '../hooks/usePermission';

interface ReceivePurchaseOrderModalProps {
  isOpen: boolean;
  po: PurchaseOrder | null;
  onClose: () => void;
  onReceived?: (po: PurchaseOrder) => void;
}

const ReceivePurchaseOrderModal: React.FC<ReceivePurchaseOrderModalProps> = ({
  isOpen,
  po,
  onClose,
  onReceived,
}) => {
  const { warehouses, items, user, requests, addTransaction, updateRequestStatus } = useApp();
  const { canManage } = usePermission();
  const toast = useToast();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const targetWarehouse = warehouses.find(warehouse => warehouse.id === po?.targetWarehouseId);
  const canReceive = !!po?.targetWarehouseId && (
    user.role === Role.ADMIN ||
    canManage('/inventory') ||
    user.assignedWarehouseId === po.targetWarehouseId
  );

  const lines = useMemo(() => {
    if (!po) return [];
    return po.items.map((item, index) => {
      const orderedQty = Number(item.qty) || 0;
      const receivedQty = Number(item.receivedQty) || 0;
      const remainingQty = Math.max(orderedQty - receivedQty, 0);
      const key = `${item.itemId}-${index}`;
      return { ...item, key, orderedQty, receivedQty, remainingQty };
    });
  }, [po]);

  useEffect(() => {
    if (!po || !isOpen) return;
    const defaults: Record<string, number> = {};
    po.items.forEach((item, index) => {
      const remainingQty = Math.max((Number(item.qty) || 0) - (Number(item.receivedQty) || 0), 0);
      defaults[`${item.itemId}-${index}`] = remainingQty;
    });
    setQuantities(defaults);
    setNote(`Nhập hàng theo PO ${po.poNumber}`);
  }, [po, isOpen]);

  if (!isOpen || !po) return null;

  const totalRemaining = lines.reduce((sum, line) => sum + line.remainingQty, 0);
  const hasReceivableLine = totalRemaining > 0;
  const hasInvalidQty = lines.some(line => {
    const qty = Number(quantities[line.key]) || 0;
    return qty < 0 || qty > line.remainingQty;
  });
  const receiptLines = lines
    .map(line => ({ itemId: line.itemId, lineId: line.lineId, quantity: Number(quantities[line.key]) || 0, price: Number(line.unitPrice) || 0 }))
    .filter(line => line.quantity > 0);
  const unlinkedReceiptLines = receiptLines.filter(line => !items.some(item => item.id === line.itemId));

  const handleConfirm = async () => {
    if (saving || !po.targetWarehouseId) return;
    if (!canReceive) {
      toast.error('Không có quyền nhận hàng', 'Tài khoản của bạn không được phân công kho nhận của PO này.');
      return;
    }
    if (!hasReceivableLine) {
      toast.warning('PO đã nhận đủ', 'Không còn khối lượng cần nhập kho.');
      return;
    }
    if (hasInvalidQty || receiptLines.length === 0) {
      toast.warning('Kiểm tra số lượng', 'Số lượng thực nhận phải lớn hơn 0 và không vượt phần còn lại.');
      return;
    }
    if (unlinkedReceiptLines.length > 0) {
      toast.warning('Chưa liên kết mã kho', 'PO có dòng chưa có mã vật tư trong hệ thống. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước khi nhập kho.');
      return;
    }

    const txId = `tx-po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const transaction: Transaction = {
      id: txId,
      type: TransactionType.IMPORT,
      date: new Date().toISOString(),
      items: receiptLines,
      targetWarehouseId: po.targetWarehouseId,
      requesterId: user.id,
      approverId: user.id,
      status: TransactionStatus.COMPLETED,
      note: note.trim() || `Nhập hàng theo PO ${po.poNumber}`,
    };

    setSaving(true);
    let updatedPo: PurchaseOrder | null = null;
    try {
      updatedPo = await poService.receivePo(po.id, receiptLines, txId);
      try {
        await addTransaction(transaction);
      } catch (transactionError) {
        await poService.upsert(po);
        throw transactionError;
      }

      try {
        const affectedRequestIds = await materialRequestFulfillmentService.recordPoReceipt({
          po: updatedPo,
          transactionId: txId,
          actorUserId: user.id,
          receiptLines,
        });
        for (const requestId of affectedRequestIds) {
          const request = requests.find(item => item.id === requestId) || await materialRequestService.getById(requestId);
          if (!request) continue;
          const batches = await materialRequestFulfillmentService.listByRequest(requestId);
          const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, batches);
          if (nextStatus !== request.status) {
            await updateRequestStatus(
              request.id,
              nextStatus as RequestStatus,
              `Đồng bộ thực nhận từ PO ${updatedPo.poNumber}`,
              undefined,
              request.sourceWarehouseId,
              request.overrideReason,
              'FULFILLMENT_RECEIVED',
            );
          }
        }
      } catch (syncError) {
        logApiError('receivePurchaseOrder.syncMaterialRequestFulfillment', syncError);
        toast.warning('PO đã nhập kho', 'Chưa đồng bộ được lũy kế thực nhận về phiếu yêu cầu. Vui lòng mở lại phiếu để kiểm tra.');
      }

      toast.success('Đã nhập kho theo PO', `${po.poNumber} đã được cập nhật tồn kho.`);
      onReceived?.(updatedPo);
      onClose();
    } catch (error: any) {
      logApiError('receivePurchaseOrder.confirm', error);
      toast.error('Không thể nhập kho theo PO', getApiErrorMessage(error, 'Không thể hoàn tất nhập kho theo phiếu NCC.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Nhận hàng theo phiếu NCC</div>
            <h3 className="font-black text-lg mt-0.5">{po.poNumber}</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Nhà cung cấp</div>
              <div className="font-black text-slate-800">{po.vendorName || 'Chưa xác định'}</div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Kho nhận</div>
              <div className="font-black text-slate-800 flex items-center gap-2">
                <Building2 size={15} className="text-emerald-600" />
                {targetWarehouse?.name || 'PO chưa chọn kho nhận'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-[10px] font-black uppercase text-slate-400 mb-1">Trạng thái PO</div>
              <div className="font-black text-slate-800 uppercase">{po.status}</div>
            </div>
          </div>

          {!po.targetWarehouseId && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-bold flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              PO chưa có kho nhận. Vui lòng cập nhật PO trong Cung ứng dự án trước khi nhập kho.
            </div>
          )}

          {!canReceive && po.targetWarehouseId && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-bold flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              Tài khoản của bạn không được phân công kho nhận của PO này.
            </div>
          )}

          <div className="border border-slate-100 rounded-2xl overflow-hidden">
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black tracking-widest border-b border-slate-100">
                  <tr>
                    <th className="p-4">Vật tư</th>
                    <th className="p-4 text-right">Đặt</th>
                    <th className="p-4 text-right">Đã nhận</th>
                    <th className="p-4 text-right">Còn lại</th>
                    <th className="p-4 text-center w-40">Thực nhận</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map(line => {
                    const qty = Number(quantities[line.key]) || 0;
                    const invalid = qty < 0 || qty > line.remainingQty;
                    return (
                      <tr key={line.key} className={line.remainingQty <= 0 ? 'bg-slate-50/60 opacity-70' : ''}>
                        <td className="p-4">
                          <div className="font-black text-sm text-slate-800">{line.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono font-bold">{line.sku}</div>
                          {(line.neededDate || line.note) && (
                            <div className="text-[10px] text-slate-500 mt-1">
                              {line.neededDate ? `Ngày cần: ${line.neededDate}` : ''}{line.neededDate && line.note ? ' • ' : ''}{line.note || ''}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right font-black text-slate-700">{line.orderedQty.toLocaleString()} {line.unit}</td>
                        <td className="p-4 text-right font-bold text-slate-500">{line.receivedQty.toLocaleString()} {line.unit}</td>
                        <td className="p-4 text-right font-black text-emerald-600">{line.remainingQty.toLocaleString()} {line.unit}</td>
                        <td className="p-4">
                          <input
                            type="number"
                            min={0}
                            max={line.remainingQty}
                            step={1}
                            disabled={line.remainingQty <= 0 || saving}
                            value={quantities[line.key] ?? 0}
                            onChange={(event) => setQuantities(prev => ({ ...prev, [line.key]: Number(event.target.value) || 0 }))}
                            className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                              invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List View */}
            <div className="block md:hidden divide-y divide-slate-100">
              {lines.map(line => {
                const qty = Number(quantities[line.key]) || 0;
                const invalid = qty < 0 || qty > line.remainingQty;
                return (
                  <div key={line.key} className={`p-4 space-y-3 ${line.remainingQty <= 0 ? 'bg-slate-50/60 opacity-70' : ''}`}>
                    <div>
                      <div className="font-black text-sm text-slate-800 leading-snug">{line.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono font-bold mt-0.5">{line.sku}</div>
                      {(line.neededDate || line.note) && (
                        <div className="text-[10px] text-slate-500 mt-1">
                          {line.neededDate ? `Ngày cần: ${line.neededDate}` : ''}{line.neededDate && line.note ? ' • ' : ''}{line.note || ''}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-3 text-center">
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Đặt</div>
                        <div className="text-xs font-black text-slate-700 mt-0.5 truncate">{line.orderedQty.toLocaleString()} {line.unit}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Đã nhận</div>
                        <div className="text-xs font-bold text-slate-500 mt-0.5 truncate">{line.receivedQty.toLocaleString()} {line.unit}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Còn lại</div>
                        <div className="text-xs font-black text-emerald-600 mt-0.5 truncate">{line.remainingQty.toLocaleString()} {line.unit}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="text-xs font-black text-slate-500 uppercase tracking-wider">Thực nhận:</div>
                      <div className="w-32 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={line.remainingQty}
                          step={1}
                          disabled={line.remainingQty <= 0 || saving}
                          value={quantities[line.key] ?? 0}
                          onChange={(event) => setQuantities(prev => ({ ...prev, [line.key]: Number(event.target.value) || 0 }))}
                          className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                            invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Ghi chú nhập kho</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="w-full p-3 rounded-xl border border-slate-200 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50">
            Đóng
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !canReceive || !hasReceivableLine || hasInvalidQty || receiptLines.length === 0}
            className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            {saving ? 'Đang nhập kho...' : 'Xác nhận nhập kho'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceivePurchaseOrderModal;
