import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CircleSlash, Loader2, ShoppingCart, Truck } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import {
  MATERIAL_REQUEST_END_REASONS, materialRequestSupplyService,
  type MaterialRequestSupply, type MaterialRequestSupplyLineState,
} from '../../../lib/materialRequestSupplyService';
import { Badge, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { TRANSFER_STATUS_LABELS } from '../../procurement/hub/SupplyFromStockDrawer';
import { fmt } from '../work-plan/workPlanUi';

// Đề xuất đã duyệt: "Đang cung ứng" (Mua hàng mua mới / cấp từ kho) → tự "Hoàn tất" khi nhận đủ,
// hoặc CHT / người lập "Kết thúc đề xuất" có lý do. Không còn bước tạo đợt giao.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const OK = 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200';
const TEAL = 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200';
const WARN = 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const GREY = 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';

const LINE_BADGE: Record<MaterialRequestSupplyLineState, [string, string]> = {
  done: ['Đã nhận', OK], waiting: ['Chờ hàng', TEAL], none: ['Chưa có nguồn', WARN], closed: ['Đã đóng', GREY],
};
export const SUPPLY_PHASE_BADGE = {
  supplying: ['Đang cung ứng', TEAL], completed: ['Hoàn tất', OK], ended: ['Đã kết thúc', GREY],
} as const;

/** Hộp xác nhận kết thúc: lý do chọn nhanh + ô lý do bắt buộc. */
export const EndSupplyDialog: React.FC<{
  title: string; openLines?: number; busy?: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}> = ({ title, openLines, busy, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  return <div className="fixed inset-0 z-[1030] grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-lg rounded-2xl bg-card p-5 text-foreground shadow-2xl">
      <h3 className="font-bold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {openLines != null ? `${openLines} dòng còn thiếu sẽ đóng và rời khỏi Cần mua.` : 'Các dòng còn thiếu sẽ đóng và rời khỏi Cần mua.'} Hàng đã nhận giữ nguyên.
        PO đang chờ hàng vẫn giao bình thường (phần giao về thành tồn kho công trường).</p>
      <div className="mt-3 flex flex-wrap gap-2">{MATERIAL_REQUEST_END_REASONS.map(x =>
        <button key={x} type="button" onClick={() => setReason(x)} aria-pressed={reason === x}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${reason === x ? 'border-teal-600 bg-teal-600 text-white' : 'border-border hover:border-teal-300'}`}>{x}</button>)}</div>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Lý do (bắt buộc)" aria-label="Lý do kết thúc" className={`mt-2 w-full ${inputCls}`} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryBtn} onClick={onCancel} disabled={busy}>Hủy, giữ lại</button>
        <button type="button" disabled={!reason.trim() || busy} className={primaryBtn} onClick={() => onConfirm(reason.trim())}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CircleSlash size={15} />}Kết thúc đề xuất</button>
      </div>
    </div>
  </div>;
};

export const MaterialRequestSupplyPanel: React.FC<{ requestId: string; requestCode: string; onEnded: () => void }> = ({ requestId, requestCode, onEnded }) => {
  const toast = useToast();
  const [data, setData] = useState<MaterialRequestSupply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError(null);
    materialRequestSupplyService.get(requestId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [requestId]);
  useEffect(load, [load]);

  if (error) return <StateBox kind="error" title="Chưa tải được tiến độ cung ứng" message={error} onRetry={load} />;
  if (!data) return <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />Đang tải tiến độ cung ứng…</div>;
  if (data.phase === 'other') return null;

  const open = data.lines.filter(l => l.state === 'waiting' || l.state === 'none');
  const done = data.lines.length - open.length;
  const [phaseLabel, phaseTone] = SUPPLY_PHASE_BADGE[data.phase];
  const end = async (reason: string) => {
    setBusy(true);
    try {
      const r = await materialRequestSupplyService.end({ requestIds: [requestId], reason });
      toast.success(`Đã kết thúc ${requestCode}`, r.closedLines > 0 ? `${r.closedLines} dòng còn thiếu đã rời Cần mua.` : undefined);
      setEnding(false); onEnded();
    } catch (e) { toast.error('Chưa kết thúc được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  const sources = (l: MaterialRequestSupply['lines'][number]) => <>
    {l.orders.map(o => <span key={o.id} className="mr-2 inline-flex items-center gap-1"><ShoppingCart size={11} /><b className={ENT}>{o.poNumber || 'PO'}</b> {fmt(o.qty, 3)}</span>)}
    {l.transfers.map(t => <span key={t.id} className={`mr-2 inline-flex items-center gap-1 ${t.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''}`}>
      <Truck size={11} />Chuyển kho {fmt(t.qty, 3)} · {t.sourceWarehouseName || 'kho gửi'} · {TRANSFER_STATUS_LABELS[t.status] || t.status}</span>)}
    {!l.orders.length && !l.transfers.length && (l.state === 'none'
      ? <span className="text-amber-700 dark:text-amber-300">Chưa có — Mua hàng chọn Mua mới hoặc Cấp từ kho</span>
      : <span className="text-muted-foreground">—</span>)}
  </>;
  const note = (l: MaterialRequestSupply['lines'][number]) => <>
    {l.state === 'done' && l.receivedQty < l.needQty && <span className="block text-xs text-muted-foreground">lệch {fmt(l.needQty - l.receivedQty, 3)} ≤ 2%</span>}
    {l.state === 'closed' && <span className="block text-xs text-muted-foreground">đóng {fmt(l.closedQty, 3)}</span>}
  </>;

  return <section className="space-y-3 rounded-2xl border border-border bg-card p-4 text-foreground shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold">Tiến độ cung ứng <Badge className={phaseTone}>{phaseLabel}</Badge></h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{done}/{data.lines.length} dòng đã nhận đủ hoặc đã đóng · dòng đủ khi nhận ≥ 98% số cần</p>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Các bước sau duyệt">
        {(['Đã duyệt', 'Đang cung ứng', data.phase === 'ended' ? 'Đã kết thúc' : 'Hoàn tất'] as const).map((step, i) => {
          const reached = i < 2 || data.phase !== 'supplying';
          return <li key={step} className="flex items-center gap-1.5">{i > 0 && <ArrowRight size={12} className="text-muted-foreground" />}
            <span className={`rounded-full border px-2 py-0.5 font-semibold ${reached ? (i === 2 && data.phase === 'ended' ? GREY : OK) : GREY}`}>{step}</span></li>;
        })}
      </ol>
    </div>

    {data.ending && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <b>Đã kết thúc:</b> “{data.ending.reason}”<span className="text-muted-foreground"> · {data.ending.byName || '—'}, {new Date(data.ending.at).toLocaleDateString('vi-VN')}. Các dòng còn thiếu đã rời Cần mua.</span></p>}

    <ul className="divide-y divide-border rounded-xl border border-border md:hidden">{data.lines.map(l => {
      const [label, tone] = LINE_BADGE[l.state];
      return <li key={l.lineId} className="space-y-1 px-3 py-2.5 text-sm">
        <div className="flex items-start justify-between gap-2"><span className="font-medium">{l.itemName}</span><Badge className={tone}>{label}</Badge></div>
        <p className="text-xs text-muted-foreground">Cần {fmt(l.needQty, 3)} {l.unit} · đã nhận <span className={NUM}>{fmt(l.receivedQty, 3)}</span>
          {l.state === 'waiting' || l.state === 'none' ? ` · thiếu ${fmt(Math.max(0, l.needQty - l.receivedQty), 3)}` : ''}</p>
        <p className="text-xs">{sources(l)}</p>{note(l)}
      </li>;
    })}</ul>

    <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>
          <th className="px-3 py-2 font-medium">Vật tư</th><th className="px-2 py-2 text-right font-medium">Cần</th><th className="px-2 py-2 font-medium">Nguồn cung</th>
          <th className="px-2 py-2 text-right font-medium">Đã nhận</th><th className="px-2 py-2 text-right font-medium">Còn thiếu</th><th className="px-3 py-2 font-medium">Trạng thái</th></tr></thead>
        <tbody>{data.lines.map(l => {
          const [label, tone] = LINE_BADGE[l.state];
          const short = Math.max(0, l.needQty - l.receivedQty);
          return <tr key={l.lineId} className="border-t border-border align-top">
            <td className="px-3 py-2"><span className="font-medium">{l.itemName}</span>{l.sku && <span className="block text-xs text-muted-foreground">{l.sku}</span>}</td>
            <td className="!whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmt(l.needQty, 3)} {l.unit}</td>
            <td className="px-2 py-2 text-xs">{sources(l)}</td>
            <td className={`!whitespace-nowrap px-2 py-2 text-right ${NUM}`}>{fmt(l.receivedQty, 3)}</td>
            <td className="!whitespace-nowrap px-2 py-2 text-right tabular-nums">{l.state === 'done' || l.state === 'closed' ? '—' : fmt(short, 3)}</td>
            <td className="px-3 py-2"><Badge className={tone}>{label}</Badge>{note(l)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    {data.phase === 'supplying' && <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">{open.length} dòng còn thiếu — Mua hàng đang xử lý ở Cần mua. Đủ hàng thì đề xuất tự hoàn tất.</span>
      {data.canEnd && <button type="button" className={secondaryBtn} onClick={() => setEnding(true)}><CircleSlash size={15} />Kết thúc đề xuất</button>}
    </div>}
    {ending && <EndSupplyDialog title={`Kết thúc đề xuất ${requestCode}?`} openLines={open.length} busy={busy} onCancel={() => setEnding(false)} onConfirm={reason => void end(reason)} />}
  </section>;
};

export type StaleSupplyRequest = { id: string; code: string; title: string; lineCount: number; createdDate: string; requesterName: string; canEnd: boolean };

const ageDays = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));

/** Đề xuất đã duyệt nhưng chưa có PO hay phiếu chuyển nào: CHT chọn giữ (vẫn ở Cần mua) hoặc kết thúc hàng loạt. */
export const StaleSupplyRequestsDialog: React.FC<{
  requests: StaleSupplyRequest[]; onClose: () => void; onOpen: (id: string) => void; onEnded: () => void;
}> = ({ requests, onClose, onOpen, onEnded }) => {
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = [...requests].sort((a, b) => a.createdDate.localeCompare(b.createdDate));
  const endable = list.filter(r => r.canEnd);
  const end = async (reason: string) => {
    setBusy(true);
    try {
      const r = await materialRequestSupplyService.end({ requestIds: [...sel], reason });
      toast.success(`Đã kết thúc ${r.ended} đề xuất`, `${r.closedLines} dòng còn thiếu đã rời Cần mua.`);
      setConfirming(false); setSel(new Set()); onEnded();
    } catch (e) { toast.error('Chưa kết thúc được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Đề xuất treo cần quyết">
    <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card text-foreground shadow-2xl sm:rounded-2xl">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h3 className="text-base font-bold">Đề xuất treo cần quyết</h3>
        <p className="mt-0.5 text-sm text-muted-foreground"><b className="text-foreground">{list.length} đề xuất đã duyệt nhưng chưa có PO hay phiếu chuyển nào.</b> Không tick là <b>Giữ</b> (vẫn ở Cần mua). Tick rồi bấm <b>Kết thúc</b> kèm lý do. Xếp từ cũ nhất.</p>
      </header>
      <ul className="flex-1 divide-y divide-border overflow-y-auto">{list.map(r => {
        const days = ageDays(r.createdDate);
        return <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <input type="checkbox" disabled={!r.canEnd} checked={sel.has(r.id)} aria-label={`Chọn ${r.code}`} title={r.canEnd ? undefined : 'Chỉ CHT hoặc người lập phiếu được kết thúc'}
            onChange={() => setSel(cur => { const next = new Set(cur); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; })} className="h-4 w-4 accent-teal-600" />
          <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left">
            <span className={ENT}>{r.code}</span> <span className="text-sm">{r.title}</span>
            <span className="block text-xs text-muted-foreground">{r.lineCount} dòng · lập {new Date(r.createdDate).toLocaleDateString('vi-VN')} · {r.requesterName}</span>
          </button>
          <Badge className={days > 60 ? WARN : GREY}>{days} ngày</Badge>
        </li>;
      })}</ul>
      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-5">
        <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1">Đã chọn {sel.size}{endable.length < list.length ? ` · ${list.length - endable.length} phiếu bạn không có quyền kết thúc` : ''}</span>
        {endable.length > 0 && <button type="button" className={secondaryBtn} onClick={() => setSel(sel.size === endable.length ? new Set() : new Set(endable.map(r => r.id)))}>
          {sel.size === endable.length ? 'Bỏ chọn' : 'Chọn tất cả'}</button>}
        <button type="button" className={secondaryBtn} onClick={onClose}>Đóng, giữ lại</button>
        <button type="button" className={primaryBtn} disabled={sel.size === 0} onClick={() => setConfirming(true)}><CircleSlash size={15} />Kết thúc {sel.size || ''} đã chọn</button>
      </footer>
    </div>
    {confirming && <EndSupplyDialog title={`Kết thúc ${sel.size} đề xuất?`} busy={busy} onCancel={() => setConfirming(false)} onConfirm={reason => void end(reason)} />}
  </div>;
};

export default MaterialRequestSupplyPanel;
