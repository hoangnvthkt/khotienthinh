import React, { useMemo, useState } from 'react';
import { CalendarRange, Eye, Save, X } from 'lucide-react';
import type { BoqMaterialPlanPreview } from '../../../types/materialPlanning';

export interface MaterialPlanSaveMetadata {
  title: string;
  periodStart: string;
  periodEnd: string;
  note: string | null;
}

interface BoqMaterialPlanPreviewProps {
  preview: BoqMaterialPlanPreview;
  canSave: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (metadata: MaterialPlanSaveMetadata) => Promise<void>;
}

export const BoqMaterialPlanPreviewPanel: React.FC<BoqMaterialPlanPreviewProps> = ({
  preview,
  canSave,
  saving,
  error,
  onClose,
  onSave,
}) => {
  const dates = useMemo(
    () => preview.groups.flatMap(group => group.allocations.map(allocation => allocation.neededDate)).sort(),
    [preview],
  );
  const [title, setTitle] = useState(() => `Kế hoạch vật tư ${dates[0] || ''}`.trim());
  const [periodStart, setPeriodStart] = useState(dates[0] || '');
  const [periodEnd, setPeriodEnd] = useState(dates[dates.length - 1] || '');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !periodStart || !periodEnd || periodEnd < periodStart) {
      setLocalError('Nhập tên và khoảng thời gian hợp lệ trước khi lưu.');
      return;
    }
    setLocalError(null);
    await onSave({ title: title.trim(), periodStart, periodEnd, note: note.trim() || null });
  };

  return (
    <section aria-label="Preview kế hoạch vật tư" className="overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/40 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-blue-100 px-4 py-3 sm:px-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-900"><Eye size={16} className="text-blue-600" /> Kiểm tra và lưu kế hoạch</h3>
          <p className="mt-1 text-[11px] font-medium text-slate-500">Xác nhận thời gian, số lượng và nguồn BOQ trước khi tạo bản kế hoạch có phiên bản.</p>
        </div>
        <button type="button" aria-label="Đóng preview" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white"><X size={16} /></button>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-3">
          {preview.groups.map(group => (
            <article key={group.key} className="rounded-xl border border-white bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-black text-slate-800">{group.itemName}</div>
                  <div className="text-[10px] font-bold text-slate-400">{group.sku || group.itemId}</div>
                </div>
                <div className="text-sm font-black text-blue-700">{group.totalQty} {group.unit}</div>
              </div>
              <div className="mt-3 space-y-1.5">
                {group.allocations.map((allocation, index) => (
                  <div key={`${allocation.sourceBudgetLineId}:${index}`} className="grid gap-1 rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-600 sm:grid-cols-[1fr_auto_auto]">
                    <span className="font-bold">BOQ {allocation.sourceBudgetLineId}</span>
                    <span>{allocation.quantity} {group.unit}</span>
                    <span>{allocation.neededDate} · {allocation.destination}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
          <div className="rounded-xl border border-dashed border-blue-300 bg-white px-4 py-3 text-center text-xs font-black text-blue-800">
            Chưa tạo MR · Lưu kế hoạch không giữ tồn và không tạo cam kết mua
          </div>
        </div>

        <div className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-400">Thông tin kế hoạch</div>
            <p className="mt-1 text-xs text-slate-500">Dùng tên và kỳ dễ nhận biết khi quay lại điều chỉnh hoặc tạo MR.</p>
          </div>
          <label className="block text-xs font-bold text-slate-700">
            Tên kế hoạch
            <input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400" />
          </label>
          <fieldset>
            <legend className="text-xs font-bold text-slate-700">Khoảng thời gian</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <label className="relative">
                <span className="sr-only">Từ ngày</span>
                <CalendarRange size={14} className="pointer-events-none absolute left-3 top-3 text-slate-400" />
                <input type="date" value={periodStart} onChange={event => setPeriodStart(event.target.value)} className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-2 text-xs outline-none focus:border-blue-400" />
              </label>
              <label>
                <span className="sr-only">Đến ngày</span>
                <input type="date" value={periodEnd} onChange={event => setPeriodEnd(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-blue-400" />
              </label>
            </div>
          </fieldset>
          <label className="block text-xs font-bold text-slate-700">
            Ghi chú <span className="font-medium text-slate-400">(không bắt buộc)</span>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-400" placeholder="Mục đích, mốc thi công hoặc lưu ý giao nhận…" />
          </label>
          {(localError || error) && <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{localError || error}</div>}
          {!canSave && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Bạn có thể xem preview nhưng chưa có quyền sửa Kế hoạch vật tư.</div>}
          <button type="button" disabled={!canSave || saving} onClick={() => void submit()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Save size={15} /> {saving ? 'Đang lưu…' : 'Lưu kế hoạch'}
          </button>
        </div>
      </div>
    </section>
  );
};
