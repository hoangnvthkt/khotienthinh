import { useMemo, useRef, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { MaterialRequestFulfillmentMode, type PurchaseOrder, type PurchaseOrderDeliveryBatch } from '../../types';
import { purchasePackageService } from '../../lib/purchasePackageService';

interface PurchaseDeliveryBatchEditorProps {
  purchaseOrder: PurchaseOrder;
  actorUserId: string;
  targetWarehouseId: string;
  onSaved?(result: unknown): void;
  onCancel?(): void;
  cloneFromBatch?: PurchaseOrderDeliveryBatch | null;
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
}: PurchaseDeliveryBatchEditorProps) {
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState(purchaseOrder.vendorId || '');
  const [supplierName, setSupplierName] = useState(purchaseOrder.vendorName || '');
  const [vatRate, setVatRate] = useState(String(cloneFromBatch?.vatRate ?? purchaseOrder.vatRate ?? 0));
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState(cloneFromBatch?.plannedDeliveryDate || purchaseOrder.expectedDeliveryDate || '');
  const [note, setNote] = useState(cloneFromBatch?.note || '');
  const [lineDrafts, setLineDrafts] = useState(() => (purchaseOrder.items || []).map(item => ({
    purchaseOrderLineId: item.lineId || item.itemId,
    itemId: item.itemId,
    itemName: item.name || item.sku || item.itemId,
    purchaseQty: numberValue(item.qty) - numberValue(item.receivedQty) + numberValue(item.returnedQty),
    purchaseUnit: item.purchaseUnitSnapshot || item.unit,
    stockQty: numberValue(item.qty) - numberValue(item.receivedQty) + numberValue(item.returnedQty),
    stockUnit: item.stockUnitSnapshot || item.unit,
    purchaseUnitPrice: numberValue(cloneFromBatch?.lines?.find(line => line.purchaseOrderLineId === (item.lineId || item.itemId))?.deliveryUnitPrice ?? item.unitPrice),
    stockUnitPrice: numberValue(cloneFromBatch?.lines?.find(line => line.purchaseOrderLineId === (item.lineId || item.itemId))?.deliveryUnitPrice ?? item.unitPrice),
  })));

  const canSave = useMemo(() => (
    supplierName.trim()
    && targetWarehouseId
    && lineDrafts.some(line => numberValue(line.purchaseQty) > 0 && numberValue(line.purchaseUnitPrice) >= 0)
  ), [lineDrafts, supplierName, targetWarehouseId]);

  const updateLine = (purchaseOrderLineId: string, patch: Partial<typeof lineDrafts[number]>) => {
    setLineDrafts(prev => prev.map(line => line.purchaseOrderLineId === purchaseOrderLineId ? { ...line, ...patch } : line));
  };

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const result = await purchasePackageService.createDelivery({
        purchaseOrderId: purchaseOrder.id,
        idempotencyKey: idempotencyKeyRef.current,
        supplierId,
        supplierNameSnapshot: supplierName.trim(),
        fulfillmentMode: purchaseOrder.fulfillmentMode || MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
        vatRate: numberValue(vatRate),
        targetWarehouseId,
        plannedDeliveryDate: plannedDeliveryDate || null,
        note: note.trim() || null,
        actorUserId,
        lines: lineDrafts
          .filter(line => numberValue(line.purchaseQty) > 0)
          .map(line => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            itemId: line.itemId,
            purchaseQty: numberValue(line.purchaseQty),
            purchaseUnit: line.purchaseUnit || '',
            stockQty: numberValue(line.stockQty || line.purchaseQty),
            stockUnit: line.stockUnit || line.purchaseUnit || '',
            purchaseUnitPrice: numberValue(line.purchaseUnitPrice),
            stockUnitPrice: numberValue(line.stockUnitPrice || line.purchaseUnitPrice),
          })),
      });
      onSaved?.(result);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <input value={supplierName} onChange={event => setSupplierName(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold" placeholder="NCC" />
        <input value={supplierId} onChange={event => setSupplierId(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold" placeholder="Ma NCC" />
        <input type="date" value={plannedDeliveryDate} onChange={event => setPlannedDeliveryDate(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold" />
        <input value={vatRate} onChange={event => setVatRate(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold" placeholder="VAT %" />
      </div>
      <div className="divide-y divide-slate-100 rounded-md border border-slate-100">
        {lineDrafts.map(line => (
          <div key={line.purchaseOrderLineId} className="grid gap-2 px-2 py-2 text-xs sm:grid-cols-[1fr_110px_130px]">
            <div className="font-bold text-slate-700">{line.itemName}</div>
            <input value={line.purchaseQty} onChange={event => updateLine(line.purchaseOrderLineId, { purchaseQty: numberValue(event.target.value), stockQty: numberValue(event.target.value) })} className="rounded-md border border-slate-200 px-2 py-1 text-right font-bold" />
            <input value={line.purchaseUnitPrice} onChange={event => updateLine(line.purchaseOrderLineId, { purchaseUnitPrice: numberValue(event.target.value), stockUnitPrice: numberValue(event.target.value) })} className="rounded-md border border-slate-200 px-2 py-1 text-right font-bold" />
          </div>
        ))}
      </div>
      <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold" placeholder="Ghi chú đợt giao" />
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100">Hủy</button>}
        <button type="button" disabled={!canSave || saving} onClick={save} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu đợt giao
        </button>
      </div>
    </div>
  );
}
