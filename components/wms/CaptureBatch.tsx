import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Combine, FileText, Layers, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Badge, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT } from '../finance/financeUi';
import { captureErrorMessage, wmsDeliveryCaptureService as svc, type DeliveryCapture } from '../../lib/wmsDeliveryCaptureService';
import { findMerges, runLimited } from '../../lib/wmsCaptureBatch';
import type { StockOverview } from '../../lib/wmsCatalogService';
import { GREY, Panel, Section, TEAL, WARN } from './wmsUi';

// Xấp phiếu (chủ SP 16/10): nhiều ảnh → mỗi ảnh một phiếu giao, tải + AI đọc ở nền (3 luồng),
// đọc xong thì tự gộp ảnh cùng NCC + cùng số phiếu thành trang của một phiếu. Chạy tiếp khi thủ kho mở phiếu khác.

type Wh = StockOverview['warehouses'][number];
export type BatchState = 'wait' | 'upload' | 'read' | 'done' | 'manual' | 'failed' | 'merged';
export interface BatchItem { key: string; name: string; thumb: string; state: BatchState; capture?: DeliveryCapture; error?: string; mergedInto?: string }
export interface Batch { id: string; warehouseId: string; files: File[]; items: BatchItem[]; running: boolean; merged: number }

const AI_LANES = 3;

export const useCaptureBatch = (onSaved: (c: DeliveryCapture) => void) => {
  const toast = useToast();
  const [batch, setBatch] = useState<Batch | null>(null);
  const live = useRef<string>('');
  const patch = useCallback((id: string, key: string, p: Partial<BatchItem>) =>
    setBatch(b => b && b.id === id ? { ...b, items: b.items.map(it => it.key === key ? { ...it, ...p } : it) } : b), []);

  const run = useCallback(async (id: string, warehouseId: string, files: File[], keys: string[]) => {
    const done: Array<DeliveryCapture | null> = files.map(() => null);
    await runLimited(files, AI_LANES, async (file, i) => {
      const key = keys[i];
      patch(id, key, { state: 'upload' });
      let c: DeliveryCapture;
      try { c = await svc.addPhotos(await svc.create(warehouseId), [file]); onSaved(c); }
      catch (e) { patch(id, key, { state: 'failed', error: captureErrorMessage(e) }); return; }
      patch(id, key, { state: 'read', capture: c });
      const r = await svc.read(c);
      if (r.code === 'OK') { onSaved(r.capture); done[i] = r.capture; patch(id, key, { state: 'done', capture: r.capture }); }
      else { done[i] = c; patch(id, key, { state: 'manual', capture: c, error: r.code === 'AI_FAILED' ? r.error : 'Chưa bật AI' }); }
    });
    if (live.current !== id) return;
    // Gộp trang: phiếu sau vào phiếu đầu cùng giấy (theo thứ tự chụp).
    const byId = new Map(done.filter((c): c is DeliveryCapture => !!c).map(c => [c.id, c]));
    let merged = 0;
    for (const [targetId, sourceId] of findMerges([...byId.values()])) {
      const target = byId.get(targetId); const source = byId.get(sourceId);
      if (!target || !source) continue;
      try {
        const next = await svc.merge(target, source);
        byId.set(targetId, next); onSaved(next); merged++;
        const tKey = keys[done.findIndex(c => c?.id === targetId)]; const sKey = keys[done.findIndex(c => c?.id === sourceId)];
        patch(id, tKey, { capture: next });
        patch(id, sKey, { state: 'merged', mergedInto: tKey });
        onSaved({ ...source, status: 'discarded' });
      } catch (e) { toast.error('Chưa gộp được trang', captureErrorMessage(e)); }
    }
    setBatch(b => b && b.id === id ? { ...b, running: false, merged } : b);
  }, [onSaved, patch, toast]);

  const start = useCallback((files: File[], warehouseId: string) => {
    const id = `b-${Date.now()}`;
    const items = files.map((f, i) => ({ key: `${id}-${i}`, name: f.name, thumb: f.type.startsWith('image/') ? URL.createObjectURL(f) : '', state: 'wait' as const }));
    live.current = id;
    setBatch(prev => { prev?.items.forEach(it => it.thumb && URL.revokeObjectURL(it.thumb)); return { id, warehouseId, files, items, running: !!warehouseId, merged: 0 }; });
    if (warehouseId) void run(id, warehouseId, files, items.map(it => it.key));
  }, [run]);

  const pickWarehouse = useCallback((warehouseId: string) => {
    const b = batch;
    if (!b || b.warehouseId) return;
    setBatch({ ...b, warehouseId, running: true });
    void run(b.id, warehouseId, b.files, b.items.map(it => it.key));
  }, [batch, run]);

  /** Thủ kho gộp tay: ảnh này là trang tiếp theo của phiếu ngay trên. */
  const mergeUp = useCallback(async (key: string) => {
    const b = batch;
    if (!b) return;
    const idx = b.items.findIndex(it => it.key === key);
    const target = b.items.slice(0, idx).reverse().find(it => it.state !== 'merged' && it.capture);
    const source = b.items[idx];
    if (!target?.capture || !source?.capture) return;
    try {
      const next = await svc.merge(target.capture, source.capture);
      onSaved(next); onSaved({ ...source.capture, status: 'discarded' });
      patch(b.id, target.key, { capture: next });
      patch(b.id, source.key, { state: 'merged', mergedInto: target.key });
    } catch (e) { toast.error('Chưa gộp được', captureErrorMessage(e)); }
  }, [batch, onSaved, patch, toast]);

  const clear = useCallback(() => {
    live.current = '';
    setBatch(b => { b?.items.forEach(it => it.thumb && URL.revokeObjectURL(it.thumb)); return null; });
  }, []);
  useEffect(() => () => { live.current = ''; }, []);

  return { batch, start, pickWarehouse, mergeUp, clear };
};

const STATE: Record<BatchState, { label: string; cls: string }> = {
  wait: { label: 'Chờ', cls: GREY }, upload: { label: 'Đang tải', cls: GREY }, read: { label: 'AI đang đọc', cls: TEAL },
  done: { label: 'Đã đọc', cls: TEAL }, manual: { label: 'Nhập tay', cls: WARN }, failed: { label: 'Lỗi tải ảnh', cls: WARN }, merged: { label: 'Đã gộp', cls: GREY },
};

export const batchProgress = (b: Batch) => {
  const live = b.items.filter(it => it.state !== 'merged');
  const finished = b.items.filter(it => it.state === 'done' || it.state === 'manual' || it.state === 'failed' || it.state === 'merged').length;
  return { total: b.items.length, finished, papers: live.length };
};

export const CaptureBatchPanel: React.FC<{
  batch: Batch; warehouses: Wh[]; onBack: () => void; onOpen: (captureId: string) => void;
  onPickWarehouse: (id: string) => void; onMergeUp: (key: string) => Promise<void>; onClear: () => void;
}> = ({ batch, warehouses, onBack, onOpen, onPickWarehouse, onMergeUp, onClear }) => {
  const [merging, setMerging] = useState('');
  const { total, finished, papers } = batchProgress(batch);
  const whName = warehouses.find(w => w.id === batch.warehouseId)?.name;
  const operable = warehouses.filter(w => w.canOperate);
  const num = (key: string) => batch.items.findIndex(it => it.key === key) + 1;

  const head = <div>
    {whName && <p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{whName}</p>}
    <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold"><Layers size={18} />Xấp phiếu giao
      <span className="text-sm font-semibold text-muted-foreground tabular-nums">{total} ảnh</span></h2>
  </div>;

  if (!batch.warehouseId) return <Panel onBack={onBack} head={head}>
    <Section title="Kho nhận"><div className="flex flex-wrap gap-2">{operable.map(w =>
      <button key={w.id} type="button" onClick={() => onPickWarehouse(w.id)} className={secondaryBtn}>{w.name}</button>)}</div></Section>
  </Panel>;

  const pct = total ? Math.round((finished / total) * 100) : 0;
  return <Panel onBack={onBack} head={head}
    foot={<>
      {!batch.running && <button type="button" onClick={onClear} className="mr-auto text-sm font-semibold text-muted-foreground hover:underline">Đóng xấp</button>}
      {(() => { const first = batch.items.find(it => it.state !== 'merged' && it.state !== 'read' && (it.capture?.status === 'new' || it.capture?.status === 'read'));
        return <button type="button" onClick={() => first?.capture && onOpen(first.capture.id)} disabled={!first} className={`${primaryBtn} flex-1 md:flex-none`}>
          <CheckCircle2 size={15} />{first ? 'Xem từng phiếu' : 'Đã xử lý hết'}</button>; })()}
    </>}>
    <div className="rounded-xl border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-semibold">{batch.running ? <Loader2 size={15} className="animate-spin text-teal-600" /> : <Sparkles size={15} className="text-teal-600" />}
          {batch.running ? 'AI đang đọc' : 'Đã đọc xong'}</span>
        <span className="tabular-nums"><b>{finished}</b>/{total}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-leaf-500 transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
      {!batch.running && <p className="mt-1.5 text-[12px] text-muted-foreground"><b className="tabular-nums text-foreground">{papers}</b> phiếu{batch.merged > 0 && <> · gộp <b className="tabular-nums text-foreground">{batch.merged}</b> trang cùng số phiếu</>}</p>}
    </div>

    <ul className="space-y-1.5">{batch.items.map((it, i) => {
      const c = it.capture;
      const st = c?.status === 'received' ? { label: 'Đã nhận', cls: TEAL } : c?.status === 'discarded' && it.state !== 'merged' ? { label: 'Đã bỏ', cls: GREY } : STATE[it.state];
      const canOpen = !!c && it.state !== 'merged' && it.state !== 'read' && it.state !== 'upload';
      const prev = batch.items.slice(0, i).reverse().find(x => x.state !== 'merged' && x.capture);
      const canMerge = !batch.running && !!prev && !!c && (it.state === 'done' || it.state === 'manual');
      const lines = c?.lines.filter(l => l.name).length || 0;
      return <li key={it.key} className={`rounded-xl border border-border ${it.state === 'merged' ? 'opacity-60' : ''}`}>
        <button type="button" disabled={!canOpen} onClick={() => c && onOpen(c.id)} className="flex w-full min-w-0 items-center gap-2 p-2 text-left disabled:cursor-default">
          <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-cover" /> : <FileText size={18} className="m-auto mt-4 text-teal-700" />}
            <span className="absolute left-0 top-0 rounded-br-md bg-black/55 px-1 text-[10px] font-semibold tabular-nums text-white">{i + 1}</span></span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${c?.supplierName ? ENT : 'text-sm text-muted-foreground'}`}>{c?.supplierPartnerName || c?.supplierName || 'Phiếu giao'}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{it.state === 'merged' ? `Trang của ảnh ${num(it.mergedInto || '')}`
              : it.error && (it.state === 'failed' || it.state === 'manual') ? it.error
              : [c?.docNo && `Số ${c.docNo}`, c?.truckNo, lines ? `${lines} dòng` : '', c && c.photos.length > 1 ? `${c.photos.length} trang` : ''].filter(Boolean).join(' · ') || '—'}</span>
            <span className="mt-1 flex items-center gap-1.5">
              {it.state === 'read' || it.state === 'upload' ? <Loader2 size={13} className="animate-spin text-teal-600" /> : null}
              {it.state === 'failed' ? <AlertTriangle size={13} className="text-amber-600" /> : null}
              <Badge className={st.cls}>{st.label}</Badge>
              {c && it.state !== 'merged' && (c.supplierMatch === 'new' ? <Badge className={WARN}>NCC mới</Badge>
                : !c.supplierId && c.supplierName && it.state === 'done' ? <Badge className={WARN}>Chưa khớp NCC</Badge> : null)}</span>
          </span>
          {canOpen && <ChevronRight size={16} className="shrink-0 text-muted-foreground" />}
        </button>
        {canMerge && <div className="border-t border-border px-2 py-1">
          <button type="button" disabled={!!merging} onClick={async () => { setMerging(it.key); await onMergeUp(it.key); setMerging(''); }}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">
            {merging === it.key ? <Loader2 size={13} className="animate-spin" /> : <Combine size={13} />}Là trang tiếp của ảnh {num(prev!.key)} · Gộp</button></div>}
      </li>; })}</ul>
  </Panel>;
};
