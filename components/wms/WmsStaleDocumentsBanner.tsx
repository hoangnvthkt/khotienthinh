import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { WMS_TYPE_LABELS, wmsStaleDocumentsService, type WmsStaleDocuments } from '../../lib/wmsStaleDocumentsService';

// Cảnh báo phiếu kho treo quá 3 ngày ở đầu trang Nghiệp vụ kho; bấm từng phiếu để xử lý ngay.
export const WmsStaleDocumentsBanner: React.FC<{ onOpen: (transactionId: string) => void; reloadKey?: number }> = ({ onOpen, reloadKey = 0 }) => {
  const [data, setData] = useState<WmsStaleDocuments | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { wmsStaleDocumentsService.list(3).then(setData).catch(() => setData(null)); }, [reloadKey]);
  if (!data || data.total === 0) return null;
  return <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30">
    <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
      <AlertTriangle size={18} className="shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black text-amber-900 dark:text-amber-100">{data.total} phiếu kho chờ xử lý quá {data.minDays} ngày</span>
        <span className="block text-xs font-semibold text-amber-800/80 dark:text-amber-200/80">Cũ nhất {data.oldestDays} ngày. Nhận hàng, duyệt hoặc hủy để tồn kho và công nợ đúng thực tế.</span>
      </span>
      {open ? <ChevronDown size={18} className="text-amber-700" /> : <ChevronRight size={18} className="text-amber-700" />}
    </button>
    {open && <ul className="divide-y divide-amber-200/70 border-t border-amber-200 bg-white/70 dark:divide-amber-900 dark:border-amber-900 dark:bg-slate-950/40">
      {data.documents.map(d => <li key={d.id}>
        <button type="button" onClick={() => onOpen(d.id)} className="flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-amber-50 dark:hover:bg-amber-950/40 md:flex-row md:items-center md:gap-4">
          <span className="w-20 shrink-0 text-xs font-black text-rose-700 dark:text-rose-300">{d.ageDays} ngày</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{WMS_TYPE_LABELS[d.type] || d.type} · {d.note || d.id}</span>
            <span className="block text-xs text-slate-500">{d.warehouseName || 'Chưa rõ kho'} · {d.itemCount} dòng · lập bởi {d.requesterName || '—'}</span>
          </span>
          <span className="text-xs font-bold text-amber-800 dark:text-amber-200 md:w-64 md:text-right">{d.step}
            <span className="block font-medium text-slate-500">{d.keepers.length ? `Thủ kho: ${d.keepers.join(', ')}` : 'Kho chưa có thủ kho phụ trách'}</span></span>
        </button>
      </li>)}
    </ul>}
  </section>;
};

export default WmsStaleDocumentsBanner;
