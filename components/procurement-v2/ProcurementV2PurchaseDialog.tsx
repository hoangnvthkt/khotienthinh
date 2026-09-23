import React, { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Supplier, Warehouse } from '../../types';
import type { ProcurementPurchaseCandidate } from '../../lib/procurement/procurementPurchaseOrderService';

export interface PurchaseDialogInput {
  supplierId: string;
  warehouseId: string;
  expectedDeliveryDate: string;
  note: string;
  lines: Array<{ demandLineId: string; selected: boolean; needQty: string;
    purchaseUnit: string; conversionNumerator: string; conversionDenominator: string;
    unitPrice: string }>;
}

const initialLines = (candidates: ProcurementPurchaseCandidate[]): PurchaseDialogInput['lines'] =>
  candidates.map(line => ({
    demandLineId: line.demandLineId, selected: line.availableQty !== null && Number(line.availableQty) > 0,
    needQty: line.availableQty ?? '', purchaseUnit: line.purchaseUnit ?? line.unit,
    conversionNumerator: line.conversionNumerator ?? '',
    conversionDenominator: line.conversionDenominator ?? '1', unitPrice: '',
  }));

const errorMessage = (cause: unknown) => {
  const raw = cause instanceof Error ? cause.message : String(cause || '');
  if (raw.includes('PROCUREMENT_AVAILABLE_EXCEEDED') || raw.includes('PROCUREMENT_VERSION_CONFLICT')
    || raw.includes('SOURCE_REVISION_STALE')) return 'Nhu cầu đã thay đổi. Đóng màn này và tải lại hồ sơ trước khi lập PO.';
  if (raw.includes('PROCUREMENT_PURCHASE_ORDER_IDEMPOTENCY_CONFLICT'))
    return 'Thông tin PO đã thay đổi trong lần thử lại. Vui lòng đóng và mở lại màn lập PO.';
  if (raw.includes('PURCHASE_QUANTITY_UNKNOWN')) return 'Số lượng còn cần mua chưa rõ. Cần đối chiếu hồ sơ.';
  if (raw.startsWith('PURCHASE_')) return 'Kiểm tra số lượng, đơn vị mua, quy đổi và đơn giá của các dòng đã chọn.';
  return 'Không lập được PO. Vui lòng kiểm tra kết nối và thử lại.';
};

export const ProcurementV2PurchaseDialog: React.FC<{
  open: boolean;
  candidates: ProcurementPurchaseCandidate[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  onClose: () => void;
  onCreate: (input: PurchaseDialogInput) => Promise<void>;
}> = ({ open, candidates, suppliers, warehouses, onClose, onCreate }) => {
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<PurchaseDialogInput['lines']>(() => initialLines(candidates));
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setLines(initialLines(candidates));
    setWarehouseId(candidates[0]?.destinationId ?? '');
    setError('');
  }, [open, candidates]);
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled])'));
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault(); controls[controls.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault(); controls[0].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [open]);
  if (!open) return null;
  const edit = (index: number, change: Partial<PurchaseDialogInput['lines'][number]>) =>
    setLines(current => current.map((line, at) => at === index ? { ...line, ...change } : line));
  const selectedCount = lines.filter(line => line.selected).length;
  const excludedCount = candidates.length - selectedCount;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCount || !supplierId || !warehouseId || !expectedDeliveryDate) {
      setError('Chọn vật tư, nhà cung cấp, kho nhận và ngày giao dự kiến.'); return;
    }
    setSubmitting(true); setError('');
    try { await onCreate({ supplierId, warehouseId, expectedDeliveryDate, note, lines }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSubmitting(false); }
  };
  const field = 'mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-slate-600 dark:bg-slate-950 dark:text-white';
  return <div className="fixed inset-0 z-[70] grid place-items-end bg-slate-950/60 sm:place-items-center sm:p-4">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="purchase-dialog-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 dark:text-white sm:max-w-4xl sm:rounded-3xl sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Đơn mua hàng</p><h2 id="purchase-dialog-title" className="mt-1 text-2xl font-bold">Lập PO từ nhu cầu đã duyệt</h2><p className="mt-1 text-sm text-slate-500">Chọn số lượng còn cần mua. Mỗi dòng giữ nguyên liên kết với chứng từ nguồn.</p></div><button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng lập PO" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100"><X size={20} /></button></div>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-semibold">Nhà cung cấp<select required value={supplierId} onChange={e => setSupplierId(e.target.value)} className={field}><option value="">Chọn nhà cung cấp</option>{suppliers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="text-sm font-semibold">Kho nhận<select required value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className={field}><option value="">Chọn kho nhận</option>{warehouses.filter(row => !row.isArchived).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="text-sm font-semibold">Ngày giao dự kiến<input required type="date" value={expectedDeliveryDate} onChange={e => setExpectedDeliveryDate(e.target.value)} className={field} /></label>
        </div>
        <div className="space-y-3">{candidates.map((candidate, index) => { const line = lines[index]; if (!line) return null; const unavailable = candidate.availableQty === null || Number(candidate.availableQty) <= 0 || !candidate.canAllocate; return <fieldset key={candidate.demandLineId} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700" disabled={unavailable || submitting}>
          <legend className="sr-only">{candidate.itemName}</legend><label className="flex items-start gap-3 text-sm font-semibold"><input type="checkbox" checked={line.selected && !unavailable} onChange={e => edit(index, { selected: e.target.checked })} className="mt-1 h-5 w-5 accent-emerald-700" /><span>{candidate.itemName}<span className="mt-1 block text-xs font-normal text-slate-500">{candidate.sourceCode} · Còn có thể mua: {candidate.availableQty ?? 'Chưa rõ'} {candidate.unit}</span></span></label>
          {unavailable ? <p className="mt-2 text-sm text-amber-700">Dòng này cần đối chiếu trước khi mua.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs font-semibold">Số lượng cần mua<input type="number" min="0.000001" step="0.000001" max={candidate.availableQty ?? undefined} required={line.selected} value={line.needQty} onChange={e => edit(index, { needQty: e.target.value })} className={field} /></label><label className="text-xs font-semibold">Đơn vị mua<input required={line.selected} value={line.purchaseUnit} onChange={e => edit(index, { purchaseUnit: e.target.value })} className={field} /></label><div className="text-xs font-semibold">Quy đổi<div className="mt-1 flex items-center gap-1"><input aria-label="Tử số quy đổi" type="number" min="0.000001" step="0.000001" required={line.selected} value={line.conversionNumerator} onChange={e => edit(index, { conversionNumerator: e.target.value })} className={field} /><span>/</span><input aria-label="Mẫu số quy đổi" type="number" min="0.000001" step="0.000001" required={line.selected} value={line.conversionDenominator} onChange={e => edit(index, { conversionDenominator: e.target.value })} className={field} /></div></div><label className="text-xs font-semibold">Đơn giá{candidate.canViewPrice ? <input type="number" min="0" step="0.000001" required={line.selected} value={line.unitPrice} onChange={e => edit(index, { unitPrice: e.target.value })} className={field} /> : <span className="mt-2 block text-amber-700">Không có quyền xem giá</span>}</label><div className="text-xs text-slate-500 lg:pt-5">{candidate.unit} / {line.purchaseUnit || 'đơn vị mua'}</div></div>}
        </fieldset>; })}</div>
        <label className="block text-sm font-semibold">Ghi chú<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={field} /></label>
        <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800"><strong>{selectedCount} dòng</strong> sẽ lập thành 1 PO cho nhà cung cấp đã chọn.{excludedCount > 0 && <span className="mt-1 block text-amber-700">{excludedCount} dòng chưa chọn hoặc cần đối chiếu sẽ không được đưa vào PO.</span>}</div>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl border border-slate-300 px-5 font-semibold">Hủy</button><button type="submit" disabled={submitting || !selectedCount || candidates.some((row, i) => lines[i]?.selected && !row.canViewPrice)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold text-white disabled:opacity-50">{submitting && <Loader2 size={18} className="animate-spin" />}Lập PO</button></div>
      </form>
    </section>
  </div>;
};
