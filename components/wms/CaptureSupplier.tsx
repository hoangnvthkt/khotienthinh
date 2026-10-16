import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, Check, Loader2, Search, UserPlus } from 'lucide-react';
import { Badge, inputCls } from '../procurement/hub/hubUi';
import { ENT } from '../finance/financeUi';
import { captureErrorMessage, wmsDeliveryCaptureService as svc, type CaptureSupplierOption, type DeliveryCapture } from '../../lib/wmsDeliveryCaptureService';
import { TEAL, WARN } from './wmsUi';

// Kho PR-2 (chủ SP 16/10): NCC trên phiếu ↔ danh mục Đối tác. Hệ thống tự chọn khi chắc chắn (MST trùng, tên đã học,
// phần lõi tên trùng); không thì gợi ý 3 NCC giống nhất + tìm; chưa có thì "NCC mới" — Mua hàng tạo, thủ kho không tạo.

const REASON: Record<CaptureSupplierOption['reason'], string> = { tax: 'MST trùng', learned: 'đã chọn trước đây', name: 'giống tên', search: '' };

export const CaptureSupplier: React.FC<{
  capture: DeliveryCapture; name: string; onName: (v: string) => void; locked?: boolean;
  onPick: (patch: { supplierId: string | null; supplierMatch?: 'new'; supplierTaxCode?: string | null; supplierAddress?: string | null }) => Promise<void>;
}> = ({ capture, name, onName, locked, onPick }) => {
  const matched = !!capture.supplierId;
  const isNew = capture.supplierMatch === 'new';
  const [open, setOpen] = useState(!matched && !isNew);
  const [opts, setOpts] = useState<CaptureSupplierOption[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [tax, setTax] = useState(capture.supplierTaxCode || '');
  const [addr, setAddr] = useState(capture.supplierAddress || '');

  useEffect(() => { setOpen(!capture.supplierId && capture.supplierMatch !== 'new'); }, [capture.supplierId, capture.supplierMatch]);
  useEffect(() => { setTax(capture.supplierTaxCode || ''); setAddr(capture.supplierAddress || ''); }, [capture.supplierTaxCode, capture.supplierAddress]);

  const load = useCallback(async (text?: string) => {
    setErr('');
    try { setOpts(await svc.suppliers(capture.id, text?.trim() || undefined)); }
    catch (e) { setOpts([]); setErr(captureErrorMessage(e)); }
  }, [capture.id]);
  // Gợi ý theo tên trên phiếu khi mở; gõ tìm thì chờ 350 ms.
  useEffect(() => { if (open) void load(); }, [open, load, capture.supplierName]);
  useEffect(() => {
    if (!open || !q.trim()) return;
    const t = setTimeout(() => void load(q), 350);
    return () => clearTimeout(t);
  }, [q, open, load]);

  const pick = async (key: string, patch: Parameters<typeof onPick>[0]) => {
    setBusy(key);
    try { await onPick(patch); setQ(''); } finally { setBusy(''); }
  };

  const nameField = <label className="col-span-2 block text-[12px] font-semibold text-muted-foreground">Tên trên phiếu
    <input value={name} disabled={locked} onChange={e => onName(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>;

  if (!open) return <div className="space-y-2">
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${isNew ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30' : 'border-border'}`}>
      {isNew ? <UserPlus size={16} className="mt-0.5 shrink-0 text-amber-700" /> : <Building2 size={16} className="mt-0.5 shrink-0 text-teal-700 dark:text-teal-300" />}
      <div className="min-w-0 flex-1">
        <p className={isNew ? 'font-semibold' : ENT}>{isNew ? capture.supplierName || 'NCC mới' : capture.supplierPartnerName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
          {isNew ? <Badge className={WARN}>NCC mới · chờ Mua hàng tạo</Badge> : <Badge className={TEAL}>{capture.supplierMatch === 'auto' ? 'Tự khớp' : 'Đã chọn'}</Badge>}
          {!isNew && capture.supplierName && capture.supplierName !== capture.supplierPartnerName && <span className="truncate">Trên phiếu: {capture.supplierName}</span>}</p>
      </div>
      {!locked && <button type="button" onClick={() => setOpen(true)} className="shrink-0 text-[13px] font-semibold text-teal-700 hover:underline dark:text-teal-300">Đổi</button>}
    </div>
    {isNew && !locked && <div className="grid grid-cols-2 gap-2">
      {nameField}
      <label className="block text-[12px] font-semibold text-muted-foreground">MST
        <input value={tax} inputMode="numeric" onChange={e => setTax(e.target.value)} onBlur={() => tax !== (capture.supplierTaxCode || '') && void onPick({ supplierId: null, supplierMatch: 'new', supplierTaxCode: tax })}
          className={`mt-1 w-full ${inputCls}`} /></label>
      <label className="col-span-2 block text-[12px] font-semibold text-muted-foreground">Địa chỉ
        <input value={addr} onChange={e => setAddr(e.target.value)} onBlur={() => addr !== (capture.supplierAddress || '') && void onPick({ supplierId: null, supplierMatch: 'new', supplierAddress: addr })}
          className={`mt-1 w-full ${inputCls}`} /></label>
    </div>}
  </div>;

  const best = opts?.[0];
  const sure = !!best && best.score >= 0.9;
  return <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/40 p-2.5 dark:border-amber-800 dark:bg-amber-950/20">
    {!q && <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle size={14} />
      {opts === null ? 'Đang tìm NCC…' : opts.length ? (sure ? 'Chọn NCC' : 'Chưa chắc NCC nào — chọn hoặc đánh dấu NCC mới') : 'Không thấy NCC giống tên'}</p>}
    {nameField}
    <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2"><Search size={14} className="text-muted-foreground" />
      <input type="search" value={q} onChange={e => { setQ(e.target.value); if (!e.target.value.trim()) void load(); }} placeholder="Tìm NCC trong danh mục, MST" aria-label="Tìm NCC"
        className="w-full bg-transparent py-2 text-sm outline-none" /></label>
    {err && <p className="text-[12px] text-rose-700">{err}</p>}
    <ul className="space-y-1">{(opts || []).slice(0, q ? 8 : 3).map(o =>
      <li key={o.id}><button type="button" disabled={!!busy} onClick={() => void pick(o.id, { supplierId: o.id })}
        className={`flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left hover:border-teal-400 disabled:opacity-60 ${capture.supplierId === o.id ? 'border-teal-500' : 'border-border'}`}>
        <span className="min-w-0 flex-1"><span className={`block ${ENT}`}>{o.name}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{[REASON[o.reason], o.taxCode && `MST ${o.taxCode}`, o.openOrders > 0 && `${o.openOrders} đơn đang mở về kho`].filter(Boolean).join(' · ')}</span></span>
        {busy === o.id ? <Loader2 size={15} className="animate-spin" /> : capture.supplierId === o.id ? <Check size={15} className="text-teal-700" /> : null}
      </button></li>)}</ul>
    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
      <button type="button" disabled={!!busy || !(name || capture.supplierName)} onClick={() => void pick('new', { supplierId: null, supplierMatch: 'new' })}
        title="NCC chưa có trong danh mục: Mua hàng tạo đối tác từ tên, MST trên phiếu"
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-800 hover:underline disabled:opacity-50 dark:text-amber-200">
        {busy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}NCC mới · Mua hàng tạo</button>
      {(matched || isNew) && <button type="button" onClick={() => { setOpen(false); setQ(''); }} className="text-[13px] font-semibold text-muted-foreground hover:underline">Giữ như cũ</button>}
    </div>
  </div>;
};
