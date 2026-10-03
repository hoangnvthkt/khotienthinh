import React, { useState } from 'react';
import { Layers, Loader2, Warehouse } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { procurementInboxService, type ProcurementGroupSite, type ProcurementOrderDetail } from '../../../lib/procurementInboxService';
import { dateVi, fmt } from '../../project/work-plan/workPlanUi';
import { Badge, inputCls, primaryBtn } from './hubUi';

// Đơn gom nhiều dự án (việc 2): SL đặt / đã nhận / còn phải giao theo từng công trường và từng dòng nhu cầu.
// Phần giao thừa ở một công trường là tồn kho; Mua hàng có thể gán sang đề xuất khác cùng dự án (bắt buộc lý do).

const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';

const ExcessForm: React.FC<{ order: ProcurementOrderDetail; site: ProcurementGroupSite; line: ProcurementGroupSite['lines'][number]; unit: string; onDone: () => void }> = ({ order, site, line, unit, onDone }) => {
  const toast = useToast();
  const candidates = line.excessCandidates || [];
  const excess = line.excessStockQty || 0;
  const [pick, setPick] = useState(candidates[0] ? `${candidates[0].sourceId}|${candidates[0].lineId}` : '');
  const target = candidates.find(c => `${c.sourceId}|${c.lineId}` === pick);
  const [qty, setQty] = useState(String(Math.round(Math.min(excess, target?.shortQty ?? excess) * 1000) / 1000));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!candidates.length) return <p className="text-xs text-muted-foreground">Thừa <b className={NUM}>{fmt(excess, 3)} {unit}</b> — là tồn kho {site.warehouseName}. Chưa có đề xuất nào cùng dự án, cùng vật tư đang thiếu để gán.</p>;
  const q = Number(qty.replace(',', '.')) || 0;
  return <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
    <p>Thừa <b className={NUM}>{fmt(excess, 3)} {unit}</b> — mặc định là tồn kho {site.warehouseName}. Gán cho đề xuất khác của {site.projectCode}:</p>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Đề xuất nhận phần thừa" value={pick} onChange={e => setPick(e.target.value)} className={inputCls}>
        {candidates.map(c => <option key={`${c.sourceId}|${c.lineId}`} value={`${c.sourceId}|${c.lineId}`}>{c.code} · thiếu {fmt(c.shortQty, 3)}</option>)}</select>
      <input aria-label="SL gán" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} className={`w-24 text-right ${inputCls}`} /> {unit}
      <input aria-label="Lý do gán" value={reason} onChange={e => setReason(e.target.value)} placeholder="Lý do (bắt buộc)" className={`min-w-[12rem] flex-1 ${inputCls}`} />
      <button type="button" className={primaryBtn} disabled={busy || !target || !reason.trim() || q <= 0 || q > excess + 0.0005} onClick={async () => {
        if (!target) return;
        setBusy(true);
        try {
          await procurementInboxService.assignGroupExcess({ purchaseOrderId: order.id, warehouseId: site.warehouseId, poLineId: line.lineId, sourceId: target.sourceId, lineId: target.lineId, qty: q, reason: reason.trim() });
          toast.success(`Đã gán ${fmt(q, 3)} ${unit} cho ${target.code}`, 'Dòng đề xuất đó tính là đã nhận phần này.');
          onDone();
        } catch (e) { toast.error('Chưa gán được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
      }}>{busy && <Loader2 size={14} className="animate-spin" />}Gán phần thừa</button>
    </div>
  </div>;
};

export const GroupSitesSection: React.FC<{ order: ProcurementOrderDetail; canManage: boolean; onChanged: () => void }> = ({ order, canManage, onChanged }) => {
  const sites = order.sites || [];
  if (!order.isGroup || !sites.length) return null;
  const lineOf = (id: string) => order.lines.find(l => l.lineId === id);
  return <section className="space-y-2">
    <h3 className="flex items-center gap-1.5 font-semibold text-foreground"><Layers size={16} className="text-teal-700 dark:text-teal-300" />Giao theo công trường ({sites.length})</h3>
    <p className="text-xs text-muted-foreground">Mỗi đợt giao về một công trường. Hàng nhận chia cho các đề xuất của công trường theo ngày cần sớm nhất (hoặc tỷ lệ nếu chọn ở đợt giao). Công nợ + chi phí ghi cho dự án của công trường.</p>
    {sites.map(site => <div key={site.warehouseId} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-l-4 border-l-teal-500 bg-teal-50/60 px-3 py-2 text-sm dark:bg-teal-950/20">
        <Warehouse size={14} /><b className="text-foreground">{site.warehouseName}</b><Badge className="border-border bg-card text-foreground">{site.projectCode || '—'}</Badge>
      </div>
      <ul className="divide-y divide-border">{site.lines.map(sl => { const line = lineOf(sl.lineId); const unit = line?.stockUnit || line?.unit || '';
        const excess = sl.excessStockQty || 0;
        return <li key={sl.lineId} className="space-y-1.5 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-foreground">{line?.name || sl.lineId}</span>
            <span className="text-xs text-muted-foreground">đặt <b className="text-foreground tabular-nums">{fmt(sl.orderedStockQty, 3)}</b> · đã nhận <b className={NUM}>{fmt(sl.receivedStockQty, 3)}</b>
              {sl.undeliveredStockQty > 0.0005 && <> · còn phải giao <b className="text-amber-700 tabular-nums dark:text-amber-300">{fmt(sl.undeliveredStockQty, 3)}</b></>} {unit}</span>
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground">{sl.allocations.map(a => <li key={a.linkId}>
            · <b className="text-mint-700 dark:text-mint-300">{a.code || '—'}</b>{a.neededDate ? ` cần ${dateVi(a.neededDate)}` : ''}: nhận <span className={NUM}>{fmt(a.receivedQty, 3)}</span> / {fmt(a.orderedQty, 3)} {unit}
            {a.excess && <span className="ml-1 text-amber-700 dark:text-amber-300">(gán phần thừa: {a.excessReason})</span>}</li>)}</ul>
          {excess > 0.0005 && (canManage ? <ExcessForm order={order} site={site} line={sl} unit={unit} onDone={onChanged} />
            : <p className="text-xs text-muted-foreground">Thừa {fmt(excess, 3)} {unit} — tồn kho {site.warehouseName}.</p>)}
        </li>; })}</ul>
    </div>)}
  </section>;
};

export default GroupSitesSection;
