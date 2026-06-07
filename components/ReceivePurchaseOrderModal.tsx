import React, { useEffect, useMemo, useState } from 'react';
import { X, PackageCheck, Loader2, AlertTriangle, Building2 } from 'lucide-react';
import { PurchaseOrder, Role } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { usePermission } from '../hooks/usePermission';
import { parseQuantityInput, sanitizeQuantityInput } from '../lib/quantityInput';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  hasPurchaseUnitConversion,
  poLinePurchaseToStockQty,
} from '../lib/materialUnitConversion';

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
  const { warehouses, items, user, refreshWmsRecords } = useApp();
  const { canManage } = usePermission();
  const toast = useToast();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
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
      const inventoryItem = items.find(candidate => candidate.id === item.itemId);
      const purchaseUnit = getPoLinePurchaseUnit(item, inventoryItem);
      const stockUnit = getPoLineStockUnit(item, inventoryItem);
      const hasUnitConversion = hasPurchaseUnitConversion({
        unit: stockUnit,
        purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor ?? inventoryItem?.purchaseConversionFactor ?? 1,
      });
      return { ...item, key, orderedQty, receivedQty, remainingQty, inventoryItem, purchaseUnit, stockUnit, hasUnitConversion };
    });
  }, [items, po]);

  useEffect(() => {
    if (!po || !isOpen) return;
    const defaults: Record<string, string> = {};
    po.items.forEach((item, index) => {
      const remainingQty = Math.max((Number(item.qty) || 0) - (Number(item.receivedQty) || 0), 0);
      defaults[`${item.itemId}-${index}`] = String(remainingQty);
    });
    setQuantities(defaults);
  }, [po, isOpen]);

  if (!isOpen || !po) return null;

  const totalRemaining = lines.reduce((sum, line) => sum + line.remainingQty, 0);
  const hasReceivableLine = totalRemaining > 0;
  const hasInvalidQty = lines.some(line => {
    const qty = parseQuantityInput(quantities[line.key]);
    return line.remainingQty > 0 && (qty <= 0 || qty > line.remainingQty);
  });
  const receiptLines = lines
    .map(line => ({ itemId: line.itemId, lineId: line.lineId, quantity: parseQuantityInput(quantities[line.key]) || 0, price: Number(line.unitPrice) || 0 }))
    .filter(line => line.quantity > 0);
  const unlinkedReceiptLines = receiptLines.filter(line => !items.some(item => item.id === line.itemId));

  const updateReceiptQuantity = (lineKey: string, rawValue: string, maxQty: number) => {
    setQuantities(prev => ({
      ...prev,
      [lineKey]: sanitizeQuantityInput(rawValue, {
        max: maxQty,
        previousValue: prev[lineKey] ?? String(maxQty),
      }),
    }));
  };

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
      toast.warning('Kiểm tra số lượng', 'Mỗi dòng đang giao phải có số lượng thực nhận lớn hơn 0 và không vượt phần còn lại.');
      return;
    }
    if (unlinkedReceiptLines.length > 0) {
      toast.warning('Chưa liên kết mã kho', 'PO có dòng chưa có mã vật tư trong hệ thống. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước khi nhập kho.');
      return;
    }

    setSaving(true);
    try {
      const result = await materialRequestFulfillmentService.preparePoReceiptForQualityReview({
        po,
        receiptLines,
      });
      await refreshWmsRecords({
        itemIds: receiptLines.map(line => line.itemId),
        transactionIds: result.transactionIds,
        requestIds: result.materialRequestIds,
      });
      toast.success(
        'Đã ghi nhận thực nhận',
        `${po.poNumber} đã cập nhật ${result.transactionIds.length} phiếu chờ Duyệt SL/CL. PO và tồn kho chưa được kết thúc.`,
      );
      onReceived?.(po);
      onClose();
    } catch (error: any) {
      logApiError('receivePurchaseOrder.confirm', error);
      toast.error('Không thể ghi nhận thực nhận', getApiErrorMessage(error, 'Không thể cập nhật phiếu chờ duyệt SL/CL.'));
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
          <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-bold flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            Xác nhận QR chỉ ghi nhận số lượng thực nhận. Phiếu vẫn phải qua Duyệt SL/CL và xác nhận nhận lần cuối trước khi cộng tồn, kết thúc đợt cấp và PO.
          </div>

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
                    const qty = parseQuantityInput(quantities[line.key]) || 0;
                    const invalid = qty < 0 || qty > line.remainingQty;
                    const stockQty = poLinePurchaseToStockQty(line, qty, line.inventoryItem);
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
                        <td className="p-4 text-right font-black text-slate-700">{line.orderedQty.toLocaleString()} {line.purchaseUnit || line.unit}</td>
                        <td className="p-4 text-right font-bold text-slate-500">{line.receivedQty.toLocaleString()} {line.purchaseUnit || line.unit}</td>
                        <td className="p-4 text-right font-black text-emerald-600">{line.remainingQty.toLocaleString()} {line.purchaseUnit || line.unit}</td>
                        <td className="p-4">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={line.remainingQty <= 0 || saving}
                            value={quantities[line.key] ?? '0'}
                            onChange={(event) => updateReceiptQuantity(line.key, event.target.value, line.remainingQty)}
                            className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                              invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                            }`}
                          />
                          {line.hasUnitConversion && (
                            <div className="mt-1 text-[10px] font-bold text-cyan-700 text-center">
                              Nhập kho: {stockQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {line.stockUnit}
                            </div>
                          )}
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
                const qty = parseQuantityInput(quantities[line.key]) || 0;
                const invalid = qty < 0 || qty > line.remainingQty;
                const stockQty = poLinePurchaseToStockQty(line, qty, line.inventoryItem);
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
                        <div className="text-xs font-black text-slate-700 mt-0.5 truncate">{line.orderedQty.toLocaleString()} {line.purchaseUnit || line.unit}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Đã nhận</div>
                        <div className="text-xs font-bold text-slate-500 mt-0.5 truncate">{line.receivedQty.toLocaleString()} {line.purchaseUnit || line.unit}</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Còn lại</div>
                        <div className="text-xs font-black text-emerald-600 mt-0.5 truncate">{line.remainingQty.toLocaleString()} {line.purchaseUnit || line.unit}</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="text-xs font-black text-slate-500 uppercase tracking-wider">Thực nhận:</div>
                      <div className="w-32 shrink-0">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={line.remainingQty <= 0 || saving}
                          value={quantities[line.key] ?? '0'}
                          onChange={(event) => updateReceiptQuantity(line.key, event.target.value, line.remainingQty)}
                          className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                            invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                          }`}
                        />
                        {line.hasUnitConversion && (
                          <div className="mt-1 text-[10px] font-bold text-cyan-700 text-right">
                            Nhập kho: {stockQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {line.stockUnit}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
            {saving ? 'Đang ghi nhận...' : 'Ghi nhận thực nhận'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceivePurchaseOrderModal;
