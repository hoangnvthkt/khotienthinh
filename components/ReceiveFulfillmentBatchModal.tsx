import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react';
import { MaterialRequest, MaterialRequestFulfillmentBatch, RequestStatus, Role } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { getRequestLineId, materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { canReceiveMaterialRequest, isGlobalWarehouseKeeper, isWarehouseKeeperFor } from '../lib/wmsPermissions';
import { parseQuantityInput, sanitizeQuantityInput } from '../lib/quantityInput';

interface ReceiveFulfillmentBatchModalProps {
  isOpen: boolean;
  request: MaterialRequest | null;
  batch: MaterialRequestFulfillmentBatch | null;
  onClose: () => void;
  onReceived?: () => void;
}

type ReceiveLineDraft = {
  lineId: string;
  qty: string;
  reason: string;
};

const ReceiveFulfillmentBatchModal: React.FC<ReceiveFulfillmentBatchModalProps> = ({
  isOpen,
  request,
  batch,
  onClose,
  onReceived,
}) => {
  const { user, warehouses, updateRequestStatus, loadModuleData } = useApp();
  const toast = useToast();
  const [receiveLines, setReceiveLines] = useState<ReceiveLineDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!batch || !isOpen) return;
    setReceiveLines(batch.lines.map(line => ({
      lineId: line.id,
      qty: String(line.issuedQty || 0),
      reason: '',
    })));
  }, [batch, isOpen]);

  if (!isOpen || !request || !batch) return null;

  const canReceive = user.role === Role.ADMIN
    || isGlobalWarehouseKeeper(user)
    || isWarehouseKeeperFor(user, request.siteWarehouseId)
    || canReceiveMaterialRequest(user, request);
  const canSubmit = canReceive && batch.status === 'issued';
  const hasInvalidQty = batch.lines.some(line => {
    const draft = receiveLines.find(item => item.lineId === line.id);
    const qty = parseQuantityInput(draft?.qty || 0);
    return qty < 0 || qty > Number(line.issuedQty || 0);
  });

  const getWarehouseName = (id?: string | null) => {
    if (!id) return 'Không xác định';
    return warehouses.find(warehouse => warehouse.id === id)?.name || id;
  };

  const getLineName = (requestLineId: string, itemId: string) => {
    const requestLine = request.items.find((item, index) => getRequestLineId(request, item, index) === requestLineId);
    return requestLine?.itemNameSnapshot || requestLine?.materialBudgetItemName || itemId;
  };

  const updateReceiveLine = (lineId: string, patch: Partial<ReceiveLineDraft>) => {
    setReceiveLines(prev => prev.map(line => line.lineId === lineId ? { ...line, ...patch } : line));
  };

  const updateReceiveQuantity = (lineId: string, rawValue: string, maxQty: number) => {
    setReceiveLines(prev => prev.map(line => line.lineId === lineId ? {
      ...line,
      qty: sanitizeQuantityInput(rawValue, {
        max: maxQty,
        previousValue: line.qty,
      }),
    } : line));
  };

  const handleConfirm = async () => {
    if (!canSubmit || saving) return;
    if (hasInvalidQty) {
      toast.warning('Kiểm tra số lượng', 'Số thực nhận không được âm hoặc vượt số lượng đã xuất.');
      return;
    }

    setSaving(true);
    try {
      const savedBatch = await materialRequestFulfillmentService.receiveBatch({
        request,
        batch,
        actorUserId: user.id,
        allowOverCommit: user.role === Role.ADMIN,
        lines: receiveLines.map(line => ({
          lineId: line.lineId,
          receivedQty: parseQuantityInput(line.qty) || 0,
          varianceReason: line.reason.trim() || undefined,
        })),
      });
      const freshBatches = await materialRequestFulfillmentService.listByRequest(request.id);
      const nextStatus = materialRequestFulfillmentService.nextRequestStatus(request, freshBatches);
      await updateRequestStatus(
        request.id,
        nextStatus,
        'Xác nhận nhận đợt cấp nội bộ bằng QR',
        undefined,
        request.sourceWarehouseId,
        request.overrideReason,
        'FULFILLMENT_RECEIVED',
      );
      await loadModuleData('wms', true);
      toast.success(
        receiveLines.some(line => {
          const batchLine = batch.lines.find(item => item.id === line.lineId);
          return parseQuantityInput(line.qty) !== Number(batchLine?.issuedQty || 0);
        }) ? 'Đã xác nhận nhận lệch' : 'Đã xác nhận nhập kho nội bộ',
        nextStatus === RequestStatus.COMPLETED ? 'Phiếu đề xuất đã nhận đủ số lượng yêu cầu.' : 'Đã cập nhật tồn kho và lũy kế thực nhận cho phiếu.',
      );
      onReceived?.();
      onClose();
    } catch (err: any) {
      logApiError('receiveFulfillmentBatch.confirm', err);
      toast.error('Không thể xác nhận nhập kho nội bộ', getApiErrorMessage(err, 'Không cập nhật được đợt cấp.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Nhập kho nội bộ theo phiếu xuất</div>
            <h3 className="font-black text-lg mt-0.5">{batch.batchNo}</h3>
            <p className="text-xs text-slate-300 mt-1">{request.code} • {getWarehouseName(batch.sourceWarehouseId)} → {batch.targetWarehouseId ? getWarehouseName(batch.targetWarehouseId) : 'Cấp thẳng sử dụng'}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {!canSubmit && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-bold flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              {batch.status !== 'issued'
                ? 'Đợt cấp này không còn ở trạng thái đang vận chuyển.'
                : 'Tài khoản của bạn không có quyền xác nhận nhận hàng cho phiếu này.'}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-100">
            <table className="w-full text-left min-w-[650px]">
              <thead className="bg-slate-50 text-[10px] uppercase text-slate-400 font-black tracking-widest border-b border-slate-100 whitespace-nowrap">
                <tr>
                  <th className="p-4">Vật tư</th>
                  <th className="p-4 text-right w-28">Đã xuất</th>
                  <th className="p-4 text-center w-44">Thực nhận</th>
                  <th className="p-4">Lý do lệch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batch.lines.map(line => {
                  const draft = receiveLines.find(item => item.lineId === line.id);
                  const qty = parseQuantityInput(draft?.qty || 0);
                  const invalid = qty < 0 || qty > Number(line.issuedQty || 0);
                  return (
                    <tr key={line.id}>
                      <td className="p-4 font-black text-sm text-slate-800">{getLineName(line.requestLineId, line.itemId)}</td>
                      <td className="p-4 text-right font-black text-indigo-600 whitespace-nowrap">{Number(line.issuedQty || 0).toLocaleString('vi-VN')} {line.unit || ''}</td>
                      <td className="p-4">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!canSubmit || saving}
                          value={draft?.qty || '0'}
                          onChange={event => updateReceiveQuantity(line.id, event.target.value, Number(line.issuedQty || 0))}
                          className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'}`}
                        />
                      </td>
                      <td className="p-4">
                        <input
                          disabled={!canSubmit || saving}
                          value={draft?.reason || ''}
                          onChange={event => updateReceiveLine(line.id, { reason: event.target.value })}
                          placeholder="Bắt buộc nếu nhận lệch"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold">Đóng</button>
          <button
            disabled={!canSubmit || saving || hasInvalidQty}
            onClick={handleConfirm}
            className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-black hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
            Xác nhận thực nhận
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiveFulfillmentBatchModal;
