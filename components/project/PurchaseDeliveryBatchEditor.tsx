import { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Loader2, Save } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderDeliveryBatch } from '../../types';
import {
  buildPurchaseDeliveryLineDrafts,
  getPurchaseDeliveryDraftSummary,
  getSelectedPurchaseDeliveryLinesForSave,
} from '../../lib/purchaseDeliveryBatchEditorModel';
import { purchasePackageService } from '../../lib/purchasePackageService';

interface PurchaseDeliveryBatchEditorProps {
  purchaseOrder: PurchaseOrder;
  actorUserId: string;
  targetWarehouseId: string;
  onSaved?(result: unknown): void;
  onCancel?(): void;
  cloneFromBatch?: PurchaseOrderDeliveryBatch | null;
  existingBatches?: PurchaseOrderDeliveryBatch[];
}

const numberValue = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function PurchaseDeliveryBatchEditor({
  purchaseOrder,
  actorUserId,
  targetWarehouseId,
  onSaved,
  onCancel,
  cloneFromBatch = null,
  existingBatches = [],
}: PurchaseDeliveryBatchEditorProps) {
  const [saving, setSaving] = useState(false);
  const [vatRate, setVatRate] = useState(String(cloneFromBatch?.vatRate ?? purchaseOrder.vatRate ?? 0));
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState(cloneFromBatch?.plannedDeliveryDate || purchaseOrder.expectedDeliveryDate || '');
  const [note, setNote] = useState(cloneFromBatch?.note || '');
  const [varianceReason, setVarianceReason] = useState(cloneFromBatch?.varianceReason || '');
  const [lineDrafts, setLineDrafts] = useState(() => buildPurchaseDeliveryLineDrafts({
    purchaseOrder,
    existingBatches,
    cloneFromBatch,
  }));
  const summary = useMemo(() => getPurchaseDeliveryDraftSummary({
    purchaseOrder,
    existingBatches,
    draftLines: lineDrafts,
  }), [existingBatches, lineDrafts, purchaseOrder]);
  const selectedLines = useMemo(
    () => getSelectedPurchaseDeliveryLinesForSave(lineDrafts),
    [lineDrafts],
  );

  const canSave = useMemo(() => (
    purchaseOrder.vendorId
    && targetWarehouseId
    && selectedLines.some(line => numberValue(line.purchaseQty) > 0 && numberValue(line.stockQty) > 0 && numberValue(line.purchaseUnitPrice) >= 0)
  ), [purchaseOrder.vendorId, selectedLines, targetWarehouseId]);

  const updateLine = (purchaseOrderLineId: string, patch: Partial<typeof lineDrafts[number]>) => {
    setLineDrafts(prev => prev.map(line => line.purchaseOrderLineId === purchaseOrderLineId ? { ...line, ...patch } : line));
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const result = await purchasePackageService.saveDeliveryBatchDraft({
        purchaseOrderId: purchaseOrder.id,
        deliveryBatchId: null,
        vatRate: numberValue(vatRate),
        plannedDeliveryDate: plannedDeliveryDate || null,
        varianceReason: summary.varianceQty > 0 ? varianceReason.trim() || null : null,
        note: note.trim() || null,
        actorUserId,
        lines: selectedLines
          .map(line => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            itemId: line.itemId,
            requestQty: numberValue(line.stockQty),
            requestUnit: line.stockUnit || '',
            purchaseQty: numberValue(line.purchaseQty),
            purchaseUnit: line.purchaseUnit || '',
            purchaseUnitPrice: numberValue(line.purchaseUnitPrice),
          })),
      });
      onSaved?.(result);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1 text-xs font-bold text-slate-600">
          <span className="block text-[10px] font-black uppercase text-slate-400">Nhà cung cấp</span>
          <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-800">{purchaseOrder.vendorName || purchaseOrder.vendorId}</div>
        </div>
        <label className="space-y-1 text-xs font-bold text-slate-600">
          <span className="block text-[10px] font-black uppercase text-slate-400">Ngày dự kiến giao</span>
          <input type="date" value={plannedDeliveryDate} onChange={event => setPlannedDeliveryDate(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm font-bold text-slate-900" />
        </label>
        <label className="space-y-1 text-xs font-bold text-slate-600">
          <span className="block text-[10px] font-black uppercase text-slate-400">VAT (%)</span>
          <input value={vatRate} inputMode="decimal" onChange={event => setVatRate(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 px-3 text-right text-sm font-bold text-slate-900" placeholder="0" />
        </label>
      </div>

      <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs sm:grid-cols-5">
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">Gốc PO</div>
          <div className="mt-0.5 font-black text-slate-800">{summary.orderedQty.toLocaleString('vi-VN')}</div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">Đã lập đợt</div>
          <div className="mt-0.5 font-black text-slate-800">{summary.alreadyReleasedQty.toLocaleString('vi-VN')}</div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">Đợt này</div>
          <div className="mt-0.5 font-black text-blue-700">{summary.draftQty.toLocaleString('vi-VN')}</div>
        </div>
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">Sau khi lưu</div>
          <div className={`mt-0.5 font-black ${summary.varianceQty > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{summary.nextReleasedQty.toLocaleString('vi-VN')}</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[10px] font-black uppercase text-slate-400"><Calculator size={12} /> Giá trị đợt</div>
          <div className="mt-0.5 font-black text-slate-800">{summary.draftAmount.toLocaleString('vi-VN')} đ</div>
        </div>
      </div>
      {summary.varianceQty > 0 && (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Vượt nhu cầu MR {summary.varianceQty.toLocaleString('vi-VN')}. Có thể lưu nháp; khi gửi duyệt bắt buộc có lý do.</span>
          </div>
          <input value={varianceReason} onChange={event => setVarianceReason(event.target.value)} className="h-9 w-full rounded-md border border-red-200 bg-white px-3 text-sm font-bold text-slate-900" placeholder="Lý do vượt nhu cầu MR" />
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Giao</th>
              <th className="px-3 py-2">Vật tư</th>
              <th className="px-3 py-2 text-right">Đã lập đợt</th>
              <th className="px-3 py-2 text-right">Còn lại</th>
              <th className="px-3 py-2 text-right">SL đáp ứng nhu cầu</th>
              <th className="px-3 py-2 text-right">SL mua</th>
              <th className="px-3 py-2 text-right">Đơn giá mua</th>
              <th className="px-3 py-2 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lineDrafts.map(line => (
              <tr key={line.purchaseOrderLineId} className={line.included ? '' : 'bg-slate-50/80 text-slate-400'}>
                <td className="px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    checked={line.included}
                    onChange={event => updateLine(line.purchaseOrderLineId, { included: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    aria-label={`Giao ${line.itemName} trong đợt này`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className={`font-black ${line.included ? 'text-slate-800' : 'text-slate-400'}`}>{line.itemName}</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">Nhu cầu: {line.orderedQty.toLocaleString('vi-VN')} {line.stockUnit}</div>
                  {line.purchaseUnit !== line.stockUnit && <div className="mt-0.5 text-[10px] font-bold text-cyan-600">Tham khảo: 1 {line.purchaseUnit} ≈ {line.conversionFactor.toLocaleString('vi-VN')} {line.stockUnit}</div>}
                </td>
                <td className="px-3 py-2 text-right font-bold text-slate-600">{line.alreadyReleasedQty.toLocaleString('vi-VN')}</td>
                <td className="px-3 py-2 text-right font-bold text-slate-600">{line.remainingQty.toLocaleString('vi-VN')}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <input value={line.stockQty} disabled={!line.included} inputMode="decimal" onChange={event => updateLine(line.purchaseOrderLineId, { stockQty: numberValue(event.target.value) })} className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right font-black text-slate-900 disabled:bg-slate-100 disabled:text-slate-400" />
                    <span className="w-10 text-[10px] font-bold text-slate-400">{line.stockUnit}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <input value={line.purchaseQty} disabled={!line.included} inputMode="decimal" onChange={event => updateLine(line.purchaseOrderLineId, { purchaseQty: numberValue(event.target.value) })} className="h-9 w-28 rounded-md border border-slate-200 px-2 text-right font-black text-slate-900 disabled:bg-slate-100 disabled:text-slate-400" />
                    <span className="w-10 text-[10px] font-bold text-slate-400">{line.purchaseUnit}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input value={line.purchaseUnitPrice} disabled={!line.included} inputMode="decimal" onChange={event => updateLine(line.purchaseOrderLineId, { purchaseUnitPrice: numberValue(event.target.value), stockUnitPrice: numberValue(event.target.value) })} className="h-9 w-32 rounded-md border border-slate-200 px-2 text-right font-black text-slate-900 disabled:bg-slate-100 disabled:text-slate-400" />
                </td>
                <td className={`px-3 py-2 text-right font-black ${line.included ? 'text-blue-700' : 'text-slate-400'}`}>{line.included ? (numberValue(line.purchaseQty) * numberValue(line.purchaseUnitPrice)).toLocaleString('vi-VN') : '0'} đ</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="block space-y-1 text-xs font-bold text-slate-600">
        <span className="block text-[10px] font-black uppercase text-slate-400">Ghi chú đợt giao</span>
        <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900" placeholder="Ví dụ: giao buổi sáng, xe 5 tấn..." />
      </label>
      <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3">
        {onCancel && <button type="button" onClick={onCancel} className="rounded-md px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Hủy</button>}
        <button type="button" disabled={!canSave || saving} onClick={save} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu nháp đợt
        </button>
      </div>
    </div>
  );
}
