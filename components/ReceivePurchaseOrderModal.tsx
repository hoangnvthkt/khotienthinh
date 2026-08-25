import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, PackageCheck, Loader2, AlertTriangle, Building2 } from 'lucide-react';
import { PurchaseOrder, PurchaseOrderDeliveryBatch, Transaction, Role } from '../types';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { purchaseReceiptService } from '../lib/purchaseReceiptService';
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
  deliveryBatch?: PurchaseOrderDeliveryBatch | null;
  transaction?: Transaction | null;
  onClose: () => void;
  onReceived?: (po: PurchaseOrder) => void;
}

const ReceivePurchaseOrderModal: React.FC<ReceivePurchaseOrderModalProps> = ({
  isOpen,
  po,
  deliveryBatch = null,
  transaction = null,
  onClose,
  onReceived,
}) => {
  const { warehouses, items, user, refreshWmsRecords } = useApp();
  const { canManage } = usePermission();
  const toast = useToast();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [deliveredPurchaseQuantities, setDeliveredPurchaseQuantities] = useState<Record<string, string>>({});
  const [deliveredStockQuantities, setDeliveredStockQuantities] = useState<Record<string, string>>({});
  const [acceptedStockQuantities, setAcceptedStockQuantities] = useState<Record<string, string>>({});
  const [varianceReasons, setVarianceReasons] = useState<Record<string, string>>({});
  const [receiptCount, setReceiptCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const receiptIdempotencyKeyRef = useRef<string | null>(null);
  const isFlowV3Receipt = po?.procurementFlowVersion === 3 && !!deliveryBatch;

  const targetWarehouse = warehouses.find(warehouse => warehouse.id === po?.targetWarehouseId);
  const canReceive = !!po?.targetWarehouseId && (
    user.role === Role.ADMIN ||
    canManage('/inventory') ||
    user.assignedWarehouseId === po.targetWarehouseId
  );

  const lines = useMemo(() => {
    if (!po) return [];
    if (deliveryBatch) {
      return deliveryBatch.lines.map((deliveryLine, index) => {
        const poItem = po.items.find(item => (item.lineId || item.itemId) === deliveryLine.purchaseOrderLineId) || po.items[index];
        const orderedQty = Number(deliveryLine.plannedQty) || 0;
        const receivedQty = Number(deliveryLine.acceptedQty) || 0;
        const remainingQty = Math.max(orderedQty - receivedQty, 0);
        const plannedStockQty = Number(deliveryLine.stockPlannedQty || deliveryLine.plannedQty || 0);
        const receivedStockQty = Number(deliveryLine.acceptedStockQty) || 0;
        const remainingStockQty = Math.max(plannedStockQty - receivedStockQty, 0);
        const key = deliveryLine.id;
        const inventoryItem = items.find(candidate => candidate.id === deliveryLine.itemId);
        const purchaseUnit = deliveryLine.unit || getPoLinePurchaseUnit(poItem, inventoryItem);
        const stockUnit = deliveryLine.stockUnit || getPoLineStockUnit(poItem, inventoryItem);
        const hasUnitConversion = hasPurchaseUnitConversion({
          unit: stockUnit,
          purchaseUnit,
          purchaseConversionFactor: poItem?.purchaseConversionFactor ?? inventoryItem?.purchaseConversionFactor ?? 1,
        });
        return {
          ...(poItem || {}),
          key,
          deliveryLineId: deliveryLine.id,
          itemId: deliveryLine.itemId,
          orderedQty,
          receivedQty,
          remainingQty,
          inventoryItem,
          purchaseUnit,
          stockUnit,
          hasUnitConversion,
          plannedStockQty,
          receivedStockQty,
          remainingStockQty,
        };
      });
    }
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
      return {
        ...item,
        key,
        orderedQty,
        receivedQty,
        remainingQty,
        inventoryItem,
        purchaseUnit,
        stockUnit,
        hasUnitConversion,
        plannedStockQty: orderedQty,
        receivedStockQty: receivedQty,
        remainingStockQty: remainingQty,
      };
    });
  }, [deliveryBatch, items, po]);

  useEffect(() => {
    if (!po || !isOpen) return;
    const defaults: Record<string, string> = {};
    const purchaseDeliveredDefaults: Record<string, string> = {};
    const stockDeliveredDefaults: Record<string, string> = {};
    const stockAcceptedDefaults: Record<string, string> = {};
    if (deliveryBatch) {
      deliveryBatch.lines.forEach(line => {
        const remainingQty = Math.max((Number(line.plannedQty) || 0) - (Number(line.acceptedQty) || 0), 0);
        const remainingStockQty = Math.max(
          Number(line.stockPlannedQty || line.plannedQty || 0) - Number(line.acceptedStockQty || 0),
          0,
        );
        defaults[line.id] = String(remainingQty);
        purchaseDeliveredDefaults[line.id] = String(remainingQty);
        stockDeliveredDefaults[line.id] = String(remainingStockQty);
        stockAcceptedDefaults[line.id] = String(remainingStockQty);
      });
    } else {
      po.items.forEach((item, index) => {
      const remainingQty = Math.max((Number(item.qty) || 0) - (Number(item.receivedQty) || 0), 0);
      defaults[`${item.itemId}-${index}`] = String(remainingQty);
      });
    }
    setQuantities(defaults);
    setDeliveredPurchaseQuantities(purchaseDeliveredDefaults);
    setDeliveredStockQuantities(stockDeliveredDefaults);
    setAcceptedStockQuantities(stockAcceptedDefaults);
    setVarianceReasons({});
    receiptIdempotencyKeyRef.current = null;
  }, [deliveryBatch, po, isOpen]);

  useEffect(() => {
    if (!isOpen || !isFlowV3Receipt || !deliveryBatch) {
      setReceiptCount(0);
      return;
    }
    let active = true;
    purchaseReceiptService.listReceipts(deliveryBatch.id)
      .then(receipts => { if (active) setReceiptCount(receipts.length); })
      .catch(error => logApiError('receivePurchaseOrder.listReceipts', error));
    return () => { active = false; };
  }, [deliveryBatch, isFlowV3Receipt, isOpen]);

  if (!isOpen || !po) return null;

  const isDeliveryReceipt = !!deliveryBatch && (!!transaction || isFlowV3Receipt);
  const totalRemaining = lines.reduce((sum, line) => sum + line.remainingQty + Number(line.remainingStockQty || 0), 0);
  const hasReceivableLine = totalRemaining > 0;
  const hasInvalidQty = isFlowV3Receipt ? lines.some(line => {
    const deliveredPurchaseQty = parseQuantityInput(deliveredPurchaseQuantities[line.key]);
    const acceptedPurchaseQty = parseQuantityInput(quantities[line.key]);
    const deliveredStockQty = line.hasUnitConversion
      ? parseQuantityInput(deliveredStockQuantities[line.key])
      : deliveredPurchaseQty;
    const acceptedStockQty = line.hasUnitConversion
      ? parseQuantityInput(acceptedStockQuantities[line.key])
      : acceptedPurchaseQty;
    const needsReason = acceptedPurchaseQty !== deliveredPurchaseQty
      || acceptedStockQty !== deliveredStockQty
      || deliveredPurchaseQty > line.remainingQty
      || deliveredStockQty > Number(line.remainingStockQty || 0);
    return acceptedPurchaseQty > deliveredPurchaseQty
      || acceptedStockQty > deliveredStockQty
      || (needsReason && !(varianceReasons[line.key] || '').trim());
  }) : lines.some(line => {
    const qty = parseQuantityInput(quantities[line.key]);
    const reason = (varianceReasons[line.key] || '').trim();
    if (line.remainingQty <= 0) return false;
    if (qty < 0) return true;
    if (isDeliveryReceipt && qty === 0) return !reason;
    return line.remainingQty > 0 && (qty <= 0 || (qty !== line.remainingQty && !reason));
  });
  const receiptLines = lines
    .map(line => ({
      itemId: line.itemId,
      lineId: line.lineId,
      quantity: parseQuantityInput(quantities[line.key]) || 0,
      price: Number(line.unitPrice) || 0,
      varianceReason: (varianceReasons[line.key] || '').trim() || undefined,
    }))
    .filter(line => line.quantity > 0);
  const submittedItemIds = isDeliveryReceipt ? lines.map(line => line.itemId) : receiptLines.map(line => line.itemId);
  const hasSubmittedQuantity = isFlowV3Receipt
    ? lines.some(line => parseQuantityInput(deliveredPurchaseQuantities[line.key]) > 0 || parseQuantityInput(deliveredStockQuantities[line.key]) > 0)
    : isDeliveryReceipt ? lines.length > 0 : receiptLines.length > 0;
  const unlinkedReceiptLines = submittedItemIds.filter(itemId => !items.some(item => item.id === itemId));

  const updateReceiptQuantity = (lineKey: string, rawValue: string) => {
    setQuantities(prev => ({
      ...prev,
      [lineKey]: sanitizeQuantityInput(rawValue, {
        previousValue: prev[lineKey] ?? '0',
      }),
    }));
  };

  const updateQuantityMap = (
    setter: React.Dispatch<React.SetStateAction<Record<string, string>>>,
    lineKey: string,
    rawValue: string,
  ) => setter(previous => ({
    ...previous,
    [lineKey]: sanitizeQuantityInput(rawValue, { previousValue: previous[lineKey] ?? '0' }),
  }));

  const handleConfirm = async (finalizeV3 = false) => {
    if (saving || !po.targetWarehouseId) return;
    if (!canReceive) {
      toast.error('Không có quyền nhận hàng', 'Tài khoản của bạn không được phân công kho nhận của PO này.');
      return;
    }
    if (!hasReceivableLine) {
      toast.warning('PO đã nhận đủ', 'Không còn khối lượng cần nhập kho.');
      return;
    }
    if (hasInvalidQty || !hasSubmittedQuantity) {
      toast.warning('Kiểm tra số lượng', isDeliveryReceipt
        ? 'Số thực nhận không được âm; nếu lệch hoặc bằng 0, cần nhập lý do.'
        : 'Số thực nhận phải lớn hơn 0; nếu lệch phần còn lại, cần nhập lý do.');
      return;
    }
    if (unlinkedReceiptLines.length > 0) {
      toast.warning('Chưa liên kết mã kho', 'PO có dòng chưa có mã vật tư trong hệ thống. Vui lòng tạo Đề xuất cấp mã vật tư/vật liệu trước khi nhập kho.');
      return;
    }

    setSaving(true);
    try {
      if (isFlowV3Receipt && deliveryBatch) {
        receiptIdempotencyKeyRef.current ||= crypto.randomUUID();
        const commandLines = lines.map(line => {
          const deliveredPurchaseQty = parseQuantityInput(deliveredPurchaseQuantities[line.key]) || 0;
          const acceptedPurchaseQty = parseQuantityInput(quantities[line.key]) || 0;
          const deliveredStockQty = line.hasUnitConversion
            ? parseQuantityInput(deliveredStockQuantities[line.key]) || 0
            : deliveredPurchaseQty;
          const acceptedStockQty = line.hasUnitConversion
            ? parseQuantityInput(acceptedStockQuantities[line.key]) || 0
            : acceptedPurchaseQty;
          return {
            deliveryLineId: line.deliveryLineId || '',
            itemId: line.itemId,
            deliveredPurchaseQty,
            acceptedPurchaseQty,
            deliveredStockQty,
            acceptedStockQty,
            varianceReason: (varianceReasons[line.key] || '').trim() || null,
          };
        });
        const allRejected = commandLines.every(line => line.acceptedPurchaseQty === 0 && line.acceptedStockQty === 0);
        const allPassed = commandLines.every(line =>
          line.acceptedPurchaseQty === line.deliveredPurchaseQty
          && line.acceptedStockQty === line.deliveredStockQty,
        );
        const result = await purchaseReceiptService.recordReceiptV3({
          deliveryBatchId: deliveryBatch.id,
          idempotencyKey: receiptIdempotencyKeyRef.current,
          actorUserId: user.id,
          qualityResult: allRejected ? 'rejected' : allPassed ? 'passed' : 'partial',
          isFinal: finalizeV3,
          varianceReason: commandLines.map(line => line.varianceReason).filter(Boolean).join(' | ') || null,
          attachments: [],
          lines: commandLines,
        });
        await refreshWmsRecords({
          itemIds: lines.map(line => line.itemId),
          transactionIds: [result.wmsTransactionId],
        });
        setReceiptCount(current => current + (result.idempotentReplay ? 0 : 1));
        receiptIdempotencyKeyRef.current = null;
        toast.success(
          finalizeV3 ? 'Đã nhập và kết thúc đợt' : 'Đã xác nhận lần nhập',
          result.financeStatus === 'variance_pending'
            ? 'Tồn kho đã cập nhật; phần vượt đang chờ mua hàng xác nhận trước khi ghi công nợ.'
            : `Đã tạo phiếu WMS lần nhập số ${result.receiptNo}.`,
        );
        onReceived?.(po);
        onClose();
        return;
      }
      if (deliveryBatch && transaction) {
        const acceptedLines = lines.map(line => parseQuantityInput(quantities[line.key]) || 0);
        const qualityResult = acceptedLines.every(qty => qty === 0)
          ? 'rejected'
          : lines.every((line, index) => acceptedLines[index] === line.remainingQty) ? 'passed' : 'partial';
        const result = await purchaseReceiptService.approveQuality({
          deliveryBatchId: deliveryBatch.id,
          wmsTransactionId: transaction.id,
          actorUserId: user.id,
          qualityResult,
          lines: lines.map(line => {
            const acceptedPurchaseQty = parseQuantityInput(quantities[line.key]) || 0;
            const acceptedStockQty = line.plannedStockQty && line.orderedQty > 0
              ? acceptedPurchaseQty * (Number(line.plannedStockQty) / Number(line.orderedQty))
              : poLinePurchaseToStockQty(line, acceptedPurchaseQty, line.inventoryItem);
            return {
              deliveryLineId: line.deliveryLineId || '',
              itemId: line.itemId,
              acceptedPurchaseQty,
              acceptedStockQty,
              varianceReason: (varianceReasons[line.key] || '').trim() || null,
            };
          }),
          attachments: [],
        });
        await refreshWmsRecords({
          itemIds: lines.map(line => line.itemId),
          transactionIds: [result.wmsTransactionId],
        });
        toast.success('Đã duyệt SL/CL', 'Số liệu đã khóa. Mở phiếu WMS để xác nhận nhập kho.');
        onReceived?.(po);
        onClose();
        return;
      }

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
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
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
            {isFlowV3Receipt
              ? 'Mỗi lần xác nhận tạo một phiếu WMS và cộng tồn theo SL đạt. ĐVT mua và ĐVT kho được nhập độc lập; hệ số quy đổi chỉ để tham khảo.'
              : 'Xác nhận QR chỉ ghi nhận số lượng thực nhận. Phiếu vẫn phải qua Duyệt SL/CL và xác nhận nhận lần cuối trước khi cộng tồn, kết thúc đợt cấp và PO.'}
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

          {isFlowV3Receipt && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                <span>Đợt đã duyệt • {receiptCount} lần nhập trước</span>
                <span>{deliveryBatch?.deliveryNo ? `Đợt ${deliveryBatch.deliveryNo}` : ''}</span>
              </div>
              {lines.map(line => {
                const deliveredPurchaseQty = parseQuantityInput(deliveredPurchaseQuantities[line.key]) || 0;
                const acceptedPurchaseQty = parseQuantityInput(quantities[line.key]) || 0;
                const deliveredStockQty = line.hasUnitConversion
                  ? parseQuantityInput(deliveredStockQuantities[line.key]) || 0
                  : deliveredPurchaseQty;
                const acceptedStockQty = line.hasUnitConversion
                  ? parseQuantityInput(acceptedStockQuantities[line.key]) || 0
                  : acceptedPurchaseQty;
                const hasVariance = deliveredPurchaseQty !== acceptedPurchaseQty
                  || deliveredStockQty !== acceptedStockQty
                  || deliveredPurchaseQty > line.remainingQty
                  || deliveredStockQty > Number(line.remainingStockQty || 0);
                return (
                  <div key={line.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-black text-slate-800">{line.name}</div>
                        <div className="font-mono text-[10px] font-bold text-slate-400">{line.sku}</div>
                      </div>
                      <div className="text-right text-[11px] font-bold text-slate-500">
                        <div>Mua: đã nhận {line.receivedQty.toLocaleString('vi-VN')} / đặt {line.orderedQty.toLocaleString('vi-VN')} {line.purchaseUnit}</div>
                        <div>Kho: đã nhận {Number(line.receivedStockQty || 0).toLocaleString('vi-VN')} / kế hoạch {Number(line.plannedStockQty || 0).toLocaleString('vi-VN')} {line.stockUnit}</div>
                      </div>
                    </div>
                    <div className={`mt-3 grid gap-3 ${line.hasUnitConversion ? 'md:grid-cols-4' : 'md:grid-cols-2'}`}>
                      <label className="space-y-1 text-[10px] font-black uppercase text-slate-500">
                        <span>SL giao theo ĐVT mua ({line.purchaseUnit})</span>
                        <input value={deliveredPurchaseQuantities[line.key] ?? '0'} onChange={event => updateQuantityMap(setDeliveredPurchaseQuantities, line.key, event.target.value)} inputMode="decimal" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-slate-800" />
                      </label>
                      <label className="space-y-1 text-[10px] font-black uppercase text-slate-500">
                        <span>SL đạt theo ĐVT mua ({line.purchaseUnit})</span>
                        <input value={quantities[line.key] ?? '0'} onChange={event => updateReceiptQuantity(line.key, event.target.value)} inputMode="decimal" className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-sm font-black text-emerald-800" />
                      </label>
                      {line.hasUnitConversion && (
                        <>
                          <label className="space-y-1 text-[10px] font-black uppercase text-slate-500">
                            <span>SL giao theo ĐVT kho ({line.stockUnit})</span>
                            <input value={deliveredStockQuantities[line.key] ?? '0'} onChange={event => updateQuantityMap(setDeliveredStockQuantities, line.key, event.target.value)} inputMode="decimal" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm font-black text-slate-800" />
                          </label>
                          <label className="space-y-1 text-[10px] font-black uppercase text-slate-500">
                            <span>SL đạt nhập kho ({line.stockUnit})</span>
                            <input value={acceptedStockQuantities[line.key] ?? '0'} onChange={event => updateQuantityMap(setAcceptedStockQuantities, line.key, event.target.value)} inputMode="decimal" className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right text-sm font-black text-emerald-800" />
                          </label>
                        </>
                      )}
                    </div>
                    {hasVariance && (
                      <input
                        value={varianceReasons[line.key] || ''}
                        onChange={event => setVarianceReasons(previous => ({ ...previous, [line.key]: event.target.value }))}
                        placeholder="Lý do lệch/vượt số lượng (bắt buộc)"
                        className="mt-3 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isFlowV3Receipt && <div className="border border-slate-100 rounded-2xl overflow-hidden">
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
                    const reason = (varianceReasons[line.key] || '').trim();
                    const hasVariance = qty !== line.remainingQty;
                    const canRejectLine = isDeliveryReceipt && qty === 0 && !!reason;
                    const invalid = qty < 0 || ((qty <= 0 && line.remainingQty > 0) && !canRejectLine) || (hasVariance && !reason);
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
                            onChange={(event) => updateReceiptQuantity(line.key, event.target.value)}
                            className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                              invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                            }`}
                          />
                          {line.hasUnitConversion && (
                            <div className="mt-1 text-[10px] font-bold text-cyan-700 text-center">
                              Nhập kho: {stockQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {line.stockUnit}
                            </div>
                          )}
                          {hasVariance && (qty > 0 || isDeliveryReceipt) && (
                            <input
                              type="text"
                              value={varianceReasons[line.key] || ''}
                              onChange={(event) => setVarianceReasons(prev => ({ ...prev, [line.key]: event.target.value }))}
                              placeholder="Lý do lệch số lượng"
                              className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 outline-none focus:border-amber-400"
                            />
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
                const reason = (varianceReasons[line.key] || '').trim();
                const hasVariance = qty !== line.remainingQty;
                const canRejectLine = isDeliveryReceipt && qty === 0 && !!reason;
                const invalid = qty < 0 || ((qty <= 0 && line.remainingQty > 0) && !canRejectLine) || (hasVariance && !reason);
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
                          onChange={(event) => updateReceiptQuantity(line.key, event.target.value)}
                          className={`w-full px-3 py-2 rounded-xl border text-center font-black outline-none focus:ring-2 ${
                            invalid ? 'border-red-300 bg-red-50 text-red-600 focus:ring-red-200' : 'border-slate-200 focus:ring-emerald-200'
                          }`}
                        />
                        {line.hasUnitConversion && (
                          <div className="mt-1 text-[10px] font-bold text-cyan-700 text-right">
                            Nhập kho: {stockQty.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} {line.stockUnit}
                          </div>
                        )}
                        {hasVariance && (qty > 0 || isDeliveryReceipt) && (
                          <input
                            type="text"
                            value={varianceReasons[line.key] || ''}
                            onChange={(event) => setVarianceReasons(prev => ({ ...prev, [line.key]: event.target.value }))}
                            placeholder="Lý do lệch số lượng"
                            className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-semibold text-amber-900 outline-none focus:border-amber-400"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>}

        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50">
            Đóng
          </button>
          {isFlowV3Receipt ? (
            <>
              <button
                onClick={() => void handleConfirm(false)}
                disabled={saving || !canReceive || !hasReceivableLine || hasInvalidQty || !hasSubmittedQuantity}
                className="px-6 py-2.5 rounded-xl text-sm font-black text-emerald-700 border border-emerald-300 bg-white hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                Xác nhận lần nhập
              </button>
              <button
                onClick={() => void handleConfirm(true)}
                disabled={saving || !canReceive || !hasReceivableLine || hasInvalidQty || !hasSubmittedQuantity}
                className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
                Xác nhận &amp; kết thúc đợt
              </button>
            </>
          ) : (
            <button
              onClick={() => void handleConfirm(false)}
              disabled={saving || !canReceive || !hasReceivableLine || hasInvalidQty || !hasSubmittedQuantity}
              className="px-6 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
              {saving ? 'Đang ghi nhận...' : 'Ghi nhận thực nhận'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReceivePurchaseOrderModal;
