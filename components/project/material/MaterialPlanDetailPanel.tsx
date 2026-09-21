import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileClock,
  History,
  RefreshCcw,
  Save,
  X,
} from 'lucide-react';
import { formatDecimal6, parseQuantity6 } from '../../../lib/procurement/decimal';
import type {
  MaterialPlanDetail,
  MaterialPlanLineDraft,
  MaterialPlanStatus,
} from '../../../types/materialPlanning';

interface MaterialPlanDetailPanelProps {
  plan: MaterialPlanDetail;
  siteWarehouseId?: string;
  saving: boolean;
  converting: boolean;
  error: string | null;
  onClose: () => void;
  onReload: () => void;
  onSaveRevision: (input: {
    title: string;
    periodStart: string;
    periodEnd: string;
    note: string | null;
    status: Extract<MaterialPlanStatus, 'draft' | 'confirmed'>;
    lines: MaterialPlanLineDraft[];
  }) => Promise<void>;
  onConvert: (input: {
    fulfillmentMode: 'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION';
    allocations: Array<{ allocationId: string; quantity: string }>;
  }) => Promise<void>;
  onOpenRequest: (requestId: string) => void;
}

const statusLabel: Record<MaterialPlanStatus, string> = {
  draft: 'Bản nháp',
  confirmed: 'Đã xác nhận',
  superseded: 'Đã thay thế',
  cancelled: 'Đã hủy',
};

const positive = (value: string): boolean => {
  try { return parseQuantity6(value) > 0n; } catch { return false; }
};

export const MaterialPlanDetailPanel: React.FC<MaterialPlanDetailPanelProps> = ({
  plan,
  siteWarehouseId,
  saving,
  converting,
  error,
  onClose,
  onReload,
  onSaveRevision,
  onConvert,
  onOpenRequest,
}) => {
  const [title, setTitle] = useState(plan.title);
  const [periodStart, setPeriodStart] = useState(plan.periodStart);
  const [periodEnd, setPeriodEnd] = useState(plan.periodEnd);
  const [note, setNote] = useState(plan.note || '');
  const [status, setStatus] = useState<Extract<MaterialPlanStatus, 'draft' | 'confirmed'>>(
    plan.status === 'confirmed' ? 'confirmed' : 'draft',
  );
  const [revisionQty, setRevisionQty] = useState<Record<string, string>>({});
  const [convertQty, setConvertQty] = useState<Record<string, string>>({});
  const [selectedAllocations, setSelectedAllocations] = useState<Set<string>>(new Set());
  const [fulfillmentMode, setFulfillmentMode] = useState<'RECEIVE_TO_STOCK' | 'DIRECT_CONSUMPTION'>('RECEIVE_TO_STOCK');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(plan.title);
    setPeriodStart(plan.periodStart);
    setPeriodEnd(plan.periodEnd);
    setNote(plan.note || '');
    setStatus(plan.status === 'confirmed' ? 'confirmed' : 'draft');
    setRevisionQty(Object.fromEntries(plan.lines.flatMap(line => line.allocations.map(allocation => [allocation.id, allocation.quantity]))));
    setConvertQty(Object.fromEntries(plan.lines.flatMap(line => line.allocations.map(allocation => [allocation.id, allocation.remainingQty]))));
    setSelectedAllocations(new Set(plan.lines.flatMap(line => line.allocations)
      .filter(allocation => parseQuantity6(allocation.remainingQty) > 0n)
      .map(allocation => allocation.id)));
    setLocalError(null);
  }, [plan]);

  const remainingAllocations = useMemo(
    () => plan.lines.flatMap(line => line.allocations.map(allocation => ({ line, allocation })))
      .filter(({ allocation }) => parseQuantity6(allocation.remainingQty) > 0n),
    [plan],
  );
  const requestGroups = useMemo(() => {
    const grouped = new Map<string, typeof plan.conversions>();
    plan.conversions.forEach(conversion => {
      const rows = grouped.get(conversion.requestId) || [];
      rows.push(conversion);
      grouped.set(conversion.requestId, rows);
    });
    return [...grouped.entries()];
  }, [plan.conversions]);

  const saveRevision = async () => {
    try {
      if (!title.trim() || !periodStart || !periodEnd || periodEnd < periodStart) throw new Error('metadata');
      const lines = plan.lines.map(line => {
        let total = 0n;
        const allocations = line.allocations.map(allocation => {
          const quantity = revisionQty[allocation.id] || '';
          const parsed = parseQuantity6(quantity);
          if (parsed <= 0n || parsed < parseQuantity6(allocation.convertedQty)) throw new Error('quantity');
          total += parsed;
          return {
            id: allocation.id,
            sourceBudgetLineId: allocation.sourceBudgetLineId,
            sourceWorkBoqItemId: allocation.sourceWorkBoqItemId,
            sourceTaskId: allocation.sourceTaskId,
            quantity: formatDecimal6(parsed),
            neededDate: allocation.neededDate,
            destination: allocation.destination,
          };
        });
        return {
          id: line.id,
          itemId: line.itemId,
          sku: line.sku,
          itemName: line.itemName,
          unit: line.unit,
          quantity: formatDecimal6(total),
          neededDate: [...allocations].sort((left, right) => left.neededDate.localeCompare(right.neededDate))[0].neededDate,
          destination: new Set(allocations.map(allocation => allocation.destination)).size === 1
            ? allocations[0].destination
            : 'Nhiều điểm nhận',
          allocations,
        };
      });
      setLocalError(null);
      await onSaveRevision({ title: title.trim(), periodStart, periodEnd, note: note.trim() || null, status, lines });
    } catch (caught) {
      if (caught instanceof Error && ['metadata', 'quantity'].includes(caught.message)) {
        setLocalError(caught.message === 'metadata'
          ? 'Kiểm tra tên và khoảng thời gian của kế hoạch.'
          : 'Số lượng mới phải hợp lệ và không nhỏ hơn phần đã chuyển sang MR.');
        return;
      }
      throw caught;
    }
  };

  const convert = async () => {
    try {
      const allocations = remainingAllocations
        .filter(({ allocation }) => selectedAllocations.has(allocation.id))
        .map(({ allocation }) => {
          const quantity = convertQty[allocation.id] || '';
          const parsed = parseQuantity6(quantity);
          if (parsed <= 0n || parsed > parseQuantity6(allocation.remainingQty)) throw new Error('quantity');
          return { allocationId: allocation.id, quantity: formatDecimal6(parsed) };
        });
      if (allocations.length === 0) throw new Error('empty');
      setLocalError(null);
      await onConvert({ fulfillmentMode, allocations });
    } catch (caught) {
      if (caught instanceof Error && ['empty', 'quantity'].includes(caught.message)) {
        setLocalError(caught.message === 'empty'
          ? 'Chọn ít nhất một dòng còn lại để tạo MR nháp.'
          : 'Số lượng chuyển phải lớn hơn 0 và không vượt phần còn lại.');
        return;
      }
      throw caught;
    }
  };

  const editable = plan.capabilities.canEdit && ['draft', 'confirmed'].includes(plan.status);
  const canConvert = plan.capabilities.canConvert && remainingAllocations.length > 0;

  return (
    <section aria-label={`Kế hoạch ${plan.planNo}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-[10px] font-black text-blue-700">{plan.planNo}</span>
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{statusLabel[plan.status]}</span>
            <span className="text-[10px] font-bold text-slate-400">Phiên bản {plan.version}</span>
          </div>
          <h3 className="mt-2 text-lg font-black text-slate-900">{plan.title}</h3>
          <p className="mt-1 text-xs text-slate-500">{plan.periodStart} → {plan.periodEnd} · Cập nhật {new Date(plan.updatedAt).toLocaleString('vi-VN')}</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={onReload} aria-label="Tải lại kế hoạch" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCcw size={15} /></button>
          <button type="button" onClick={onClose} aria-label="Đóng kế hoạch" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
        </div>
      </header>

      <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Vật tư và nguồn BOQ</h4>
            <div className="mt-2 space-y-3">
              {plan.lines.map(line => (
                <article key={line.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><div className="text-sm font-black text-slate-800">{line.itemName}</div><div className="text-[10px] font-bold text-slate-400">{line.sku || line.itemId}</div></div>
                    <div className="text-right text-xs"><div className="font-black text-slate-800">{line.quantity} {line.unit}</div><div className="mt-0.5 font-bold text-emerald-700">Còn {line.remainingQty} {line.unit}</div></div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {line.allocations.map(allocation => (
                      <div key={allocation.id} className="grid items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                        <div><div className="font-bold text-slate-700">BOQ {allocation.sourceBudgetLineId}</div><div className="text-slate-400">{allocation.neededDate} · {allocation.destination}</div></div>
                        {editable ? (
                          <label className="font-bold text-slate-500"><span className="sr-only">Số lượng kế hoạch cho {line.itemName}</span><input value={revisionQty[allocation.id] || ''} onChange={event => setRevisionQty(current => ({ ...current, [allocation.id]: event.target.value }))} inputMode="decimal" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-black outline-none focus:border-blue-400" /></label>
                        ) : <span className="text-right font-black text-slate-700">{allocation.quantity}</span>}
                        <span className="text-right font-bold text-slate-500">{line.unit}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>

          {editable && (
            <details className="rounded-xl border border-slate-200" open>
              <summary className="cursor-pointer px-4 py-3 text-xs font-black text-slate-700">Điều chỉnh và tạo phiên bản mới</summary>
              <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600 sm:col-span-2">Tên kế hoạch<input value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" /></label>
                <label className="text-xs font-bold text-slate-600">Từ ngày<input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400" /></label>
                <label className="text-xs font-bold text-slate-600">Đến ngày<input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400" /></label>
                <label className="text-xs font-bold text-slate-600">Trạng thái<select value={status} onChange={event => setStatus(event.target.value as 'draft' | 'confirmed')} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-400"><option value="draft">Bản nháp</option><option value="confirmed">Đã xác nhận</option></select></label>
                <label className="text-xs font-bold text-slate-600 sm:col-span-2">Ghi chú<textarea rows={2} value={note} onChange={event => setNote(event.target.value)} className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400" /></label>
                <button type="button" disabled={saving} onClick={() => void saveRevision()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50 sm:col-span-2"><Save size={14} /> {saving ? 'Đang lưu phiên bản…' : 'Lưu phiên bản mới'}</button>
              </div>
            </details>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /><h4 className="text-sm font-black text-slate-900">Tạo MR nháp</h4></div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">Chọn lượng cần xử lý ở đợt này. MR vẫn cần được gửi duyệt theo quy trình hiện hành.</p>
            {remainingAllocations.length > 0 ? (
              <div className="mt-3 space-y-2">
                {remainingAllocations.map(({ line, allocation }) => (
                  <label key={allocation.id} className="grid grid-cols-[auto_1fr_6rem] items-center gap-2 rounded-xl border border-emerald-100 bg-white p-2.5">
                    <input type="checkbox" checked={selectedAllocations.has(allocation.id)} onChange={event => setSelectedAllocations(current => { const next = new Set(current); if (event.target.checked) next.add(allocation.id); else next.delete(allocation.id); return next; })} />
                    <span className="min-w-0"><span className="block truncate text-[11px] font-black text-slate-700">{line.itemName}</span><span className="block text-[9px] font-bold text-slate-400">Còn {allocation.remainingQty} {line.unit}</span></span>
                    <input aria-label={`Số lượng chuyển ${line.itemName}`} value={convertQty[allocation.id] || ''} disabled={!selectedAllocations.has(allocation.id)} onChange={event => setConvertQty(current => ({ ...current, [allocation.id]: event.target.value }))} inputMode="decimal" className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right text-[11px] font-black outline-none focus:border-emerald-400 disabled:bg-slate-100" />
                  </label>
                ))}
                <label className="block text-[11px] font-bold text-slate-600">Cách thực hiện<select value={fulfillmentMode} onChange={event => setFulfillmentMode(event.target.value as typeof fulfillmentMode)} className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs outline-none"><option value="RECEIVE_TO_STOCK">Nhận vào kho công trường</option><option value="DIRECT_CONSUMPTION">Giao dùng trực tiếp</option></select></label>
                {!siteWarehouseId && <div className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-800">Chưa xác định kho công trường để tạo MR.</div>}
                <button type="button" disabled={!canConvert || !siteWarehouseId || converting} onClick={() => void convert()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{converting ? 'Đang tạo MR…' : 'Tạo MR nháp'} <ArrowRight size={14} /></button>
              </div>
            ) : <div className="mt-3 rounded-xl bg-white px-3 py-3 text-xs font-bold text-emerald-800">Toàn bộ lượng trong kế hoạch đã được chuyển sang MR.</div>}
          </section>

          {(localError || error) && <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{localError || error}</div>}

          <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-black text-slate-700"><History size={14} /> Lịch sử phiên bản <span className="ml-auto text-slate-400">{plan.revisions.length}</span></summary>
            <div className="space-y-2 border-t border-slate-100 p-3">{plan.revisions.map(revision => <div key={revision.version} className="rounded-lg bg-slate-50 px-3 py-2 text-[10px]"><span className="font-black text-slate-700">Phiên bản {revision.version}</span><span className="ml-2 text-slate-400">{new Date(revision.createdAt).toLocaleString('vi-VN')}</span></div>)}</div>
          </details>

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs font-black text-slate-700"><FileClock size={14} /> MR đã tạo</div>
            {requestGroups.length === 0 ? <p className="mt-2 text-[11px] text-slate-400">Chưa có MR nào từ kế hoạch này.</p> : (
              <div className="mt-2 space-y-2">{requestGroups.map(([requestId, rows]) => <button key={requestId} type="button" onClick={() => onOpenRequest(requestId)} className="flex w-full items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-left hover:bg-blue-50"><span className="min-w-0 flex-1"><span className="block text-[11px] font-black text-slate-700">{rows[0].requestCode}</span><span className="block text-[9px] font-bold text-slate-400">Từ phiên bản {rows[0].planVersion} · {rows.length} dòng</span></span><span className="text-[10px] font-black text-blue-700">Mở MR để gửi duyệt</span><ChevronRight size={13} className="text-blue-500" /></button>)}</div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
};
