import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, PackageX, X } from 'lucide-react';
import { InventoryItem, PurchaseOrder, PurchaseOrderSupplierReturn, Warehouse } from '../../types';
import { purchaseOrderSupplierReturnService } from '../../lib/purchaseOrderSupplierReturnService';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { parseQuantityInput, sanitizeQuantityInput } from '../../lib/quantityInput';
import { useToast } from '../../context/ToastContext';
import {
  getPoLinePurchaseUnit,
  getPoLineStockUnit,
  poLinePurchaseToStockQty,
  poLineStockToPurchaseQty,
} from '../../lib/materialUnitConversion';

interface PurchaseOrderSupplierReturnDialogProps {
  purchaseOrder: PurchaseOrder | null;
  warehouses: Warehouse[];
  inventoryItems: InventoryItem[];
  existingReturns: PurchaseOrderSupplierReturn[];
  onClose: () => void;
  onCreated: (createdReturn: PurchaseOrderSupplierReturn, itemIds: string[]) => Promise<void> | void;
}

const PurchaseOrderSupplierReturnDialog: React.FC<PurchaseOrderSupplierReturnDialogProps> = ({
  purchaseOrder,
  warehouses,
  inventoryItems,
  existingReturns,
  onClose,
  onCreated,
}) => {
  const toast = useToast();
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const completedOrPendingReturns = useMemo(
    () => existingReturns.filter(item => item.status === 'pending' || item.status === 'completed'),
    [existingReturns],
  );
  const returnedByLine = useMemo(() => {
    const result = new Map<string, number>();
    completedOrPendingReturns.forEach(item => {
      item.lines.forEach(line => {
        result.set(line.purchaseOrderLineId, (result.get(line.purchaseOrderLineId) || 0) + Number(line.returnQty || 0));
      });
    });
    return result;
  }, [completedOrPendingReturns]);

  const lines = useMemo(() => (purchaseOrder?.items || []).map(item => {
    const lineId = item.lineId || item.itemId;
    const receivedQty = Number(item.receivedQty || 0);
    const returnedQty = returnedByLine.get(lineId) || Number(item.returnedQty || 0);
    return {
      ...item,
      lineId,
      receivedQty,
      returnedQty,
      returnableQty: Math.max(0, receivedQty - returnedQty),
    };
  }).filter(item => item.receivedQty > 0), [purchaseOrder, returnedByLine]);

  useEffect(() => {
    if (!purchaseOrder) return;
    const candidate = warehouses.find(warehouse =>
      lines.some(line => Number(inventoryItems.find(item => item.id === line.itemId)?.stockByWarehouse?.[warehouse.id] || 0) > 0)
    );
    setSourceWarehouseId(candidate?.id || purchaseOrder.targetWarehouseId || '');
    setQuantities(Object.fromEntries(lines.map(line => [line.lineId, String(line.returnableQty)])));
    setReason('');
    setNote('');
  }, [inventoryItems, lines, purchaseOrder, warehouses]);

  if (!purchaseOrder) return null;

  const selectedWarehouse = warehouses.find(warehouse => warehouse.id === sourceWarehouseId);
  const drafts = lines.map(line => {
    const quantity = parseQuantityInput(quantities[line.lineId]);
    const inventoryItem = inventoryItems.find(item => item.id === line.itemId);
    const onHand = Number(inventoryItem?.stockByWarehouse?.[sourceWarehouseId] || 0);
    const stockQuantity = poLinePurchaseToStockQty(line, quantity, inventoryItem);
    const maxByStock = poLineStockToPurchaseQty(line, onHand, inventoryItem);
    const purchaseUnit = getPoLinePurchaseUnit(line, inventoryItem);
    const stockUnit = getPoLineStockUnit(line, inventoryItem);
    return { ...line, quantity, stockQuantity, maxByStock, onHand, inventoryItem, purchaseUnit, stockUnit };
  });
  const invalidLine = drafts.find(line =>
    line.quantity < 0 || line.quantity > line.returnableQty || line.stockQuantity > line.onHand
  );
  const selectedLines = drafts
    .filter(line => line.quantity > 0)
    .map(line => ({ purchaseOrderLineId: line.lineId, quantity: line.quantity }));

  const handleCreate = async () => {
    if (!sourceWarehouseId) {
      toast.warning('Chưa chọn kho xuất', 'Chọn kho đang thực sự giữ hàng cần trả NCC.');
      return;
    }
    if (!reason.trim()) {
      toast.warning('Thiếu lý do trả hàng', 'Bắt buộc nhập lý do trả hàng NCC.');
      return;
    }
    if (invalidLine || selectedLines.length === 0) {
      toast.warning('Số lượng trả không hợp lệ', 'Số lượng trả phải nằm trong khối lượng còn có thể trả và tồn thực tế tại kho xuất.');
      return;
    }

    setSaving(true);
    try {
      const result = await purchaseOrderSupplierReturnService.create({
        purchaseOrderId: purchaseOrder.id,
        sourceWarehouseId,
        reason: reason.trim(),
        note: note.trim(),
        lines: selectedLines,
      });
      const touchedItemIds = selectedLines
        .map(line => purchaseOrder.items.find(item => (item.lineId || item.itemId) === line.purchaseOrderLineId)?.itemId)
        .filter(Boolean) as string[];
      toast.success('Đã tạo phiếu trả NCC', `${result.returnNo} đang chờ WMS duyệt phiếu xuất kho.`);
      await onCreated(result, touchedItemIds);
      onClose();
    } catch (error) {
      logApiError('purchaseOrderSupplierReturn.create', error);
      toast.error('Không thể tạo phiếu trả NCC', getApiErrorMessage(error, 'Không thể tạo phiếu xuất trả nhà cung cấp.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-rose-300">Trả hàng nhà cung cấp</div>
            <h3 className="mt-0.5 text-lg font-black">{purchaseOrder.poNumber} - {purchaseOrder.vendorName}</h3>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            Phiếu này tạo giao dịch xuất kho chờ duyệt. PO chỉ ghi nhận trả NCC sau khi phiếu xuất được WMS hoàn tất.
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Kho đang giữ hàng để xuất trả</label>
            <select value={sourceWarehouseId} onChange={event => setSourceWarehouseId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-rose-200">
              <option value="">Chọn kho xuất trả NCC</option>
              {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-3">Vật tư</th>
                  <th className="px-3 py-3 text-right">Đã nhận</th>
                  <th className="px-3 py-3 text-right">Đã/đang trả</th>
                  <th className="px-3 py-3 text-right">Tồn tại kho</th>
                  <th className="w-36 px-4 py-3 text-right">SL trả NCC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drafts.map(line => {
                  const invalid = line.quantity < 0 || line.quantity > line.returnableQty || line.stockQuantity > line.onHand;
                  return (
                    <tr key={line.lineId}>
                      <td className="px-4 py-3">
                        <div className="font-black text-slate-800">{line.name}</div>
                        <div className="text-[10px] font-bold text-slate-400">{line.sku} · {line.purchaseUnit || line.unit}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold">{line.receivedQty.toLocaleString('vi-VN')} {line.purchaseUnit || line.unit}</td>
                      <td className="px-3 py-3 text-right font-bold text-rose-600">{line.returnedQty.toLocaleString('vi-VN')} {line.purchaseUnit || line.unit}</td>
                      <td className="px-3 py-3 text-right font-bold text-blue-600">{line.onHand.toLocaleString('vi-VN')} {line.stockUnit || line.unit}</td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={quantities[line.lineId] ?? '0'}
                          onChange={event => setQuantities(previous => ({
                            ...previous,
                            [line.lineId]: sanitizeQuantityInput(event.target.value, {
                              max: Math.min(line.returnableQty, line.maxByStock),
                              previousValue: previous[line.lineId] || '0',
                            }),
                          }))}
                          className={`w-full rounded-lg border px-3 py-2 text-right font-black outline-none ${invalid ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 focus:ring-2 focus:ring-rose-200'}`}
                        />
                        <div className="mt-1 text-right text-[10px] font-bold text-slate-400">
                          Trừ kho: {line.stockQuantity.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {line.stockUnit || line.unit}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Lý do trả hàng *</label>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:ring-2 focus:ring-rose-200" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú</label>
              <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:ring-2 focus:ring-rose-200" />
            </div>
          </div>
          <div className="text-xs font-bold text-slate-500">Kho xuất: {selectedWarehouse?.name || 'Chưa chọn'} · {selectedLines.length} dòng sẽ tạo phiếu chờ duyệt.</div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button onClick={onClose} disabled={saving} className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-200">Đóng</button>
          <button onClick={handleCreate} disabled={saving || !!invalidLine || selectedLines.length === 0} className="flex items-center gap-2 rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageX size={16} />}
            {saving ? 'Đang tạo phiếu...' : 'Tạo phiếu trả NCC'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderSupplierReturnDialog;
