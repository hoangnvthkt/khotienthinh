import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Camera, FilePlus2, Loader2, Search, Truck, UserPlus, Warehouse } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from './hubUi';
import { ENT, NUM } from '../../finance/financeUi';
import {
  PartnerDuplicateError, captureErrorMessage, wmsDeliveryCaptureService as svc,
  type CaptureQueue, type CaptureQueueItem, type CaptureSupplierOption,
} from '../../../lib/wmsDeliveryCaptureService';

// Mua hàng · Phiếu giao chờ (chủ SP 16/10/2026): thủ kho chụp phiếu giao nhưng chưa nhận được vì
//   (1) NCC chưa có / chưa khớp danh mục → Mua hàng tạo NCC 1 chạm (điền sẵn tên, MST, địa chỉ trên phiếu) hoặc chọn NCC có sẵn;
//   (2) đã biết NCC nhưng không có đơn mở về kho đó → Mua hàng lập đơn. Lập đơn xong, thủ kho nhận theo phiếu như thường.

const AMBER = 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
const SKY = 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200';
const ROSE = 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200';
const fmtQty = (n: number | null) => n == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const viDate = (d?: string | null) => d ? d.slice(0, 10).split('-').reverse().join('/') : '—';
const ageOf = (iso: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(iso.slice(0, 10))) / 86_400_000));

const Thumb: React.FC<{ path?: string; big?: boolean }> = ({ path, big }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; if (path) svc.photoUrl(path).then(u => { if (live) setUrl(u); }).catch(() => undefined); return () => { live = false; }; }, [path]);
  const cls = big ? 'h-40 w-32' : 'h-14 w-11';
  return <span className={`${cls} grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted`}>
    {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Camera size={16} className="text-muted-foreground" />}</span>;
};

export const useCaptureQueue = () => {
  const [queue, setQueue] = useState<CaptureQueue | null>(null);
  const [error, setError] = useState('');
  const load = React.useCallback(async () => {
    try { setQueue(await svc.queue()); setError(''); } catch (e) { setError(captureErrorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { queue, error, load };
};

export const CaptureQueueView: React.FC<{
  queue: CaptureQueue | null; error: string; onReload: () => Promise<void>;
  onCreateOrder: (seed: { vendor: { id: string; name: string }; note: string }) => void;
}> = ({ queue, error, onReload, onCreateOrder }) => {
  const [tab, setTab] = useState<'all' | 'supplier' | 'order'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const items = useMemo(() => queue?.items || [], [queue]);
  const counts = { supplier: items.filter(i => i.queue === 'supplier').length, order: items.filter(i => i.queue === 'order').length };
  const shown = items.filter(i => tab === 'all' || i.queue === tab);
  const groups = useMemo(() => {
    const m = new Map<string, CaptureQueueItem[]>();
    shown.forEach(i => m.set(i.warehouseName, [...(m.get(i.warehouseName) || []), i]));
    return Array.from(m.entries());
  }, [shown]);
  const open = items.find(i => i.id === openId) || null;

  if (error && !queue) return <StateBox kind="error" title="Chưa tải được phiếu giao chờ" message={error} onRetry={() => void onReload()} />;
  if (!queue) return <StateBox kind="loading" title="Đang tải phiếu giao chờ…" />;

  const card = (k: 'supplier' | 'order', n: number, label: string, hint: string, Icon: React.ElementType, tone: string) =>
    <button type="button" onClick={() => setTab(t => t === k ? 'all' : k)} aria-pressed={tab === k}
      className={`min-w-[11rem] flex-1 rounded-2xl border bg-card px-3 py-2.5 text-left shadow-sm ${tab === k ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
      <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><span className={`grid h-7 w-7 place-items-center rounded-lg border ${tone}`}><Icon size={15} /></span>{label}</span>
      <span className="mt-1.5 block text-2xl font-bold tabular-nums">{n}</span>
      <span className="block text-[12px] text-muted-foreground">{hint}</span>
    </button>;

  return <div className="space-y-3">
    <div className="flex gap-2 overflow-x-auto pb-1">
      {card('supplier', counts.supplier, 'Cần NCC', 'NCC mới · chưa khớp danh mục', UserPlus, AMBER)}
      {card('order', counts.order, 'Cần lập đơn', 'đã có NCC, chưa có đơn về kho', FilePlus2, SKY)}
    </div>
    {!queue.canManage && <p className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground"><AlertTriangle size={15} />Bạn chỉ xem được — tạo NCC, lập đơn cần quyền Mua hàng — Quản trị.</p>}
    {shown.length === 0 ? <StateBox kind="empty" title={items.length ? 'Không có phiếu ở mục này' : 'Không có phiếu giao chờ'} message={items.length ? undefined : 'Thủ kho chụp phiếu giao mà chưa có NCC hoặc chưa có đơn sẽ hiện ở đây.'} />
      : groups.map(([wh, list]) => <section key={wh} className="overflow-hidden rounded-2xl border border-border border-l-4 border-l-teal-600 bg-card shadow-sm">
        <h3 className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-bold"><Warehouse size={15} className="text-teal-700" />{wh}<span className="text-[12px] font-semibold text-muted-foreground tabular-nums">{list.length}</span></h3>
        <ul className="divide-y divide-border">{list.map(i => {
          const age = ageOf(i.createdAt, queue.today);
          const names = i.lines.filter(l => l.name);
          return <li key={i.id} className="flex items-center gap-2 px-3 py-2.5">
            <button type="button" onClick={() => setOpenId(i.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Thumb path={i.photos[0]?.path} />
              <span className="min-w-0 flex-1">
                <span className={`line-clamp-1 ${ENT}`}>{i.supplierPartnerName || i.supplierName || 'Phiếu giao'}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                  {i.queue === 'supplier' ? <Badge className={AMBER}>{i.supplierMatch === 'new' ? 'NCC mới' : 'Chưa khớp NCC'}</Badge> : <Badge className={SKY}>Chưa có đơn</Badge>}
                  <span className="truncate">{[i.docNo && `Số ${i.docNo}`, i.truckNo, viDate(i.docDate)].filter(Boolean).join(' · ')}</span></span>
                <span className="block truncate text-[12px]">{names.slice(0, 2).map(l => `${l.name} ${fmtQty(l.qty)} ${l.unit || ''}`.trim()).join(' · ') || <span className="text-muted-foreground">Chưa có dòng hàng</span>}{names.length > 2 ? ` +${names.length - 2}` : ''}</span>
              </span>
            </button>
            <Badge className={age >= 3 ? ROSE : 'border-border bg-muted text-muted-foreground'}>{age === 0 ? 'hôm nay' : `chờ ${age} ngày`}</Badge>
          </li>; })}</ul>
      </section>)}
    {open && <CaptureQueueDrawer item={open} canManage={queue.canManage} onClose={() => setOpenId(null)} onReload={onReload}
      onCreateOrder={seed => { setOpenId(null); onCreateOrder(seed); }} />}
  </div>;
};

const REASON: Record<string, string> = { tax: 'MST trùng', learned: 'thủ kho đã chọn trước đây', name: 'tên rất giống', search: '' };

const CaptureQueueDrawer: React.FC<{
  item: CaptureQueueItem; canManage: boolean; onClose: () => void; onReload: () => Promise<void>;
  onCreateOrder: (seed: { vendor: { id: string; name: string }; note: string }) => void;
}> = ({ item, canManage, onClose, onReload, onCreateOrder }) => {
  const toast = useToast();
  const [name, setName] = useState(item.supplierName || '');
  const [tax, setTax] = useState(item.supplierTaxCode || '');
  const [addr, setAddr] = useState(item.supplierAddress || '');
  const [dup, setDup] = useState<PartnerDuplicateError['partner'] | null>(null);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<CaptureSupplierOption[] | null>(null);
  const [busy, setBusy] = useState('');
  const note = `Theo phiếu giao${item.docNo ? ` số ${item.docNo}` : ''}${item.truckNo ? `, xe ${item.truckNo}` : ''} — ${item.warehouseName}`;

  useEffect(() => {
    if (item.queue !== 'supplier') return;
    const t = setTimeout(() => { svc.suppliers(item.id, q.trim() || undefined).then(setOpts).catch(() => setOpts([])); }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [item.id, item.queue, q]);

  const done = async (msg: string, sub?: string) => { toast.success(msg, sub); await onReload(); };
  const create = async (force = false) => {
    setBusy('create');
    try {
      const r = await svc.createSupplier({ captureId: item.id, name, taxCode: tax || undefined, address: addr || undefined, force });
      setDup(null);
      await done(`Đã tạo NCC ${r.partnerCode}`, r.linked > 1 ? `Gắn cho ${r.linked} phiếu cùng NCC.` : 'Phiếu chuyển sang Cần lập đơn.');
    } catch (e) {
      if (e instanceof PartnerDuplicateError) setDup(e.partner);
      else toast.error('Chưa tạo được NCC', captureErrorMessage(e));
    } finally { setBusy(''); }
  };
  const use = async (id: string, label: string) => {
    setBusy(id);
    try { const r = await svc.resolveSupplier(item.id, id); setDup(null); await done(`Đã chọn ${label}`, r.linked > 1 ? `Gắn cho ${r.linked} phiếu cùng NCC.` : undefined); }
    catch (e) { toast.error('Chưa chọn được NCC', captureErrorMessage(e)); }
    finally { setBusy(''); }
  };

  const vendor = item.supplierId ? { id: item.supplierId, name: item.supplierPartnerName || item.supplierName || '' } : null;
  return <Drawer label="Phiếu giao chờ" onClose={onClose}
    header={<div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{item.warehouseName}</p>
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold"><Truck size={18} />Phiếu giao{item.docNo && <span className="font-mono text-teal-700 dark:text-teal-300">{item.docNo}</span>}</h2>
      <p className="text-[12px] text-muted-foreground">{[item.truckNo, viDate(item.docDate), item.createdBy && `chụp bởi ${item.createdBy}`].filter(Boolean).join(' · ')}</p>
    </div>}
    footer={item.queue === 'order' && vendor ? <button type="button" disabled={!canManage} title={canManage ? undefined : 'Cần quyền Mua hàng — Quản trị'}
      onClick={() => onCreateOrder({ vendor, note })} className={`${primaryBtn} flex-1 md:flex-none`}><FilePlus2 size={15} />Lập đơn {vendor.name ? `· ${vendor.name}` : ''}</button> : undefined}>
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">{item.photos.map(p => <button key={p.path} type="button" onClick={async () => { try { window.open(await svc.photoUrl(p.path), '_blank', 'noopener'); } catch { /* ảnh lỗi */ } }}><Thumb path={p.path} big /></button>)}</div>

      <section><h3 className="mb-1.5 text-sm font-bold">Hàng trên phiếu</h3>
        <ul className="divide-y divide-border rounded-xl border border-border">{item.lines.length ? item.lines.map((l, i) =>
          <li key={i} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm"><span className="min-w-0">{l.name}</span>
            <span className="whitespace-nowrap"><b className={NUM}>{fmtQty(l.qty)}</b> <span className="text-[12px] text-muted-foreground">{l.unit}</span></span></li>)
          : <li className="px-3 py-3 text-sm text-muted-foreground">Thủ kho chưa nhập dòng hàng</li>}</ul></section>

      {item.queue === 'order' ? <section className="flex items-start gap-2 rounded-xl border border-border px-3 py-2.5">
        <Building2 size={16} className="mt-0.5 text-teal-700" />
        <div><p className={ENT}>{item.supplierPartnerName}</p><p className="text-[12px] text-muted-foreground">Không có đơn mở của NCC này về {item.warehouseName}</p></div>
      </section> : <section className="space-y-2">
        <h3 className="text-sm font-bold">Nhà cung cấp</h3>
        {dup && <div className={`rounded-xl border px-3 py-2.5 text-sm ${AMBER}`}>
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} />Đã có NCC {REASON[dup.reason] ? `(${REASON[dup.reason]})` : ''}</p>
          <p className={`mt-0.5 ${ENT}`}>{dup.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={!!busy} onClick={() => void use(dup.id, dup.name)} className={primaryBtn}>{busy === dup.id && <Loader2 size={14} className="animate-spin" />}Dùng NCC này</button>
            <button type="button" disabled={!!busy} onClick={() => void create(true)} className={secondaryBtn}>Vẫn tạo NCC mới</button>
          </div></div>}
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block text-[12px] font-semibold text-muted-foreground">Tên NCC
            <input value={name} disabled={!canManage} onChange={e => { setName(e.target.value); setDup(null); }} className={`mt-1 w-full ${inputCls}`} /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">MST
            <input value={tax} inputMode="numeric" disabled={!canManage} onChange={e => { setTax(e.target.value); setDup(null); }} className={`mt-1 w-full ${inputCls}`} /></label>
          <label className="block text-[12px] font-semibold text-muted-foreground">Địa chỉ
            <input value={addr} disabled={!canManage} onChange={e => setAddr(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></label>
        </div>
        {canManage && !dup && <button type="button" disabled={!!busy || !name.trim()} onClick={() => void create()} className={`${primaryBtn} w-full`}>
          {busy === 'create' ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}Tạo NCC từ phiếu</button>}
        {canManage && <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-[12px] font-semibold text-muted-foreground">Hoặc chọn NCC có sẵn</p>
          <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2"><Search size={14} className="text-muted-foreground" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên, MST" aria-label="Tìm NCC" className="w-full bg-transparent py-1.5 text-sm outline-none" /></label>
          <ul className="space-y-1">{(opts || []).slice(0, q ? 8 : 3).map(o => <li key={o.id}>
            <button type="button" disabled={!!busy} onClick={() => void use(o.id, o.name)} className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left hover:border-teal-400 disabled:opacity-60">
              <span className="min-w-0 flex-1"><span className={`block ${ENT}`}>{o.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{[o.reason === 'name' ? 'giống tên' : REASON[o.reason], o.taxCode && `MST ${o.taxCode}`, o.openOrders > 0 && `${o.openOrders} đơn đang mở`].filter(Boolean).join(' · ') || '—'}</span></span>
              {busy === o.id && <Loader2 size={14} className="animate-spin" />}</button></li>)}
            {opts && opts.length === 0 && <li className="text-[12px] text-muted-foreground">Không thấy NCC giống</li>}</ul>
        </div>}
      </section>}
    </div>
  </Drawer>;
};
