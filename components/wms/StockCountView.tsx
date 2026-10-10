import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, EyeOff, History, Hourglass, Loader2, PackagePlus, Plus,
  RefreshCw, Save, Search, Send, ShieldCheck, Warehouse, X, XCircle,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { formatQuantityInput, parseQuantityInput } from '../../lib/quantityInput';
import { SpecCountRows, specCountInvalid, specCountTotal, type SpecCountRow } from './SpecCountRows';
import {
  REASON_LABEL, SHORTAGE_REASONS, STOCK_COUNT_EVENT_LABEL, STOCK_COUNT_STATUS_LABEL, SURPLUS_REASONS, stockCountService,
  type StockCountDetail, type StockCountList, type StockCountStatus, type StockCountSummary, type VarianceReason,
} from '../../lib/stockCountService';

// K5 — Kiểm kê kho có duyệt, một màn hình: phiên kiểm bên trái, phiên đang chọn (đếm / giải trình / duyệt) bên phải.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const money = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(n));
const qtyFmt = (n: number | null | undefined) => n == null ? '' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(n);
const dt = (s?: string | null) => s ? new Date(s).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '';
const inputCls = 'rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-mint-500/40';
const primaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50';
const dangerBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300';

const STATUS_STYLE: Record<StockCountStatus, string> = {
  counting: 'bg-mint-50 text-mint-800 border-mint-200 dark:bg-mint-900/30 dark:text-mint-200 dark:border-mint-800',
  submitted: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800',
  posted: 'bg-leaf-600 text-white border-leaf-600',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};
const STRIP: Record<StockCountStatus, string> = {
  counting: 'border-l-mint-500', submitted: 'border-l-teal-600', posted: 'border-l-leaf-600', cancelled: 'border-l-slate-300',
};
const Pill: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) =>
  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;

type Tile = 'counting' | 'submitted' | 'rejected' | 'posted';

export const StockCountView: React.FC<{ items: Array<{ id: string; name: string; sku?: string; unit?: string }> }> = ({ items }) => {
  const toast = useToast();
  const [data, setData] = useState<StockCountList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [tile, setTile] = useState<Tile | null>(null);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try { setData(await stockCountService.list()); setStatus('ready'); }
    catch (error) { setMessage((error as Error).message); setStatus('error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    stockCountService.get(selectedId).then(d => { if (live) setDetail(d); }).catch(error => toast.error('Không mở được phiên kiểm', (error as Error).message));
    return () => { live = false; };
  }, [selectedId, toast]);

  const onDetail = (d: StockCountDetail) => { setDetail(d); setSelectedId(d.id); void load(); };
  const counts = data?.counts || [];
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return counts.filter(c => (!warehouseId || c.warehouseId === warehouseId)
      && (!q || q.split(/\s+/).every(w => [c.countNo, c.warehouseName, c.reason, c.createdByName, STOCK_COUNT_STATUS_LABEL[c.status]].join(' ').toLowerCase().includes(w))));
  }, [counts, search, warehouseId]);
  const tileTest: Record<Tile, (c: StockCountSummary) => boolean> = {
    counting: c => c.status === 'counting' && !c.rejected, submitted: c => c.status === 'submitted',
    rejected: c => c.status === 'counting' && c.rejected, posted: c => c.status === 'posted',
  };
  const shown = tile ? scoped.filter(tileTest[tile]) : scoped;
  const waiting = counts.filter(c => c.status === 'submitted').length;

  if (status === 'error' && !data) return <div role="alert" className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm">
    <AlertTriangle className="mx-auto mb-2 text-amber-600" />{message}<div><button type="button" onClick={() => void load()} className={`${secondaryBtn} mt-3`}>Thử lại</button></div></div>;
  if (!data) return <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} />Đang tải kiểm kê…</div>;

  const tiles: Array<{ key: Tile; label: string; icon: React.ReactNode; box: string; ic: string; num: string; blink?: boolean }> = [
    { key: 'counting', label: 'Đang đếm', icon: <ClipboardList size={16} />, box: 'border-mint-200 bg-mint-50/70 dark:border-mint-900 dark:bg-mint-950/30', ic: 'bg-mint-500', num: 'text-mint-800 dark:text-mint-200' },
    { key: 'submitted', label: data.canApprove ? 'Chờ bạn duyệt' : 'Chờ duyệt', icon: <Hourglass size={16} />, box: 'border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30', ic: 'bg-teal-600', num: 'text-teal-800 dark:text-teal-200', blink: data.canApprove && waiting > 0 },
    { key: 'rejected', label: 'Bị từ chối — đếm lại', icon: <XCircle size={16} />, box: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30', ic: 'bg-rose-500', num: 'text-rose-700 dark:text-rose-300' },
    { key: 'posted', label: 'Đã ghi sổ', icon: <ShieldCheck size={16} />, box: 'border-leaf-200 bg-leaf-50/70 dark:border-leaf-900 dark:bg-leaf-950/30', ic: 'bg-leaf-600', num: 'text-leaf-800 dark:text-leaf-200' },
  ];

  return <section className="space-y-3">
    <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white"><ClipboardList size={20} /></span>
      <div className="min-w-[200px] flex-1">
        <h2 className="text-lg font-bold">Kiểm kê kho</h2>
        <p className="text-sm text-muted-foreground">Chụp tồn sổ → đếm (mặc định đếm mù) → nộp → giải trình chênh lệch → người duyệt ghi sổ. Người đếm không tự duyệt.</p>
      </div>
      {data.warehouses.length > 0 && <button type="button" onClick={() => setCreating(true)} className={primaryBtn}><Plus size={16} />Lập phiên kiểm kê</button>}
    </div>

    <div className={`${selectedId ? 'hidden lg:grid' : 'grid'} grid-cols-2 gap-2 lg:grid-cols-4`}>
      {tiles.map(t => { const n = scoped.filter(tileTest[t.key]).length; return <button key={t.key} type="button" aria-pressed={tile === t.key}
        onClick={() => setTile(cur => cur === t.key ? null : t.key)}
        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition hover:shadow-sm ${t.box} ${tile === t.key ? 'ring-2 ring-teal-500/60' : ''}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${t.ic} ${t.blink ? 'overdue-blink' : ''}`}>{t.icon}</span>
        <span className="min-w-0"><span className={`block text-xl font-bold leading-tight tabular-nums ${t.num}`}>{n}</span><span className="block truncate text-xs text-muted-foreground">{t.label}</span></span>
      </button>; })}
    </div>

    <div className={`${selectedId ? 'hidden lg:flex' : 'flex'} flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2`}>
      <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Tìm phiên kiểm" placeholder="Tìm số phiên, kho, lý do, người lập…" className="w-full bg-transparent py-1.5 text-sm focus:outline-none" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
      </label>
      {data.warehouses.length > 1 && <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} aria-label="Kho" className={inputCls}>
        <option value="">Tất cả kho</option>{data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
      <button type="button" onClick={() => void load()} className={secondaryBtn}><RefreshCw size={15} /><span className="hidden sm:inline">Tải lại</span></button>
    </div>

    <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className={`${selectedId ? 'hidden lg:block' : ''} overflow-hidden rounded-2xl border border-border bg-card`} aria-label="Phiên kiểm kê">
        {shown.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground"><ClipboardList size={24} className="mx-auto mb-2 text-mint-500" />
          {counts.length === 0 ? 'Chưa có phiên kiểm kê nào. Bấm "Lập phiên kiểm kê" để bắt đầu.' : 'Không có phiên khớp bộ lọc.'}</div>
          : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{shown.map(c => {
            const pct = c.lineCount ? Math.round(c.countedCount / c.lineCount * 100) : 0;
            return <li key={c.id}><button type="button" onClick={() => setSelectedId(c.id)} aria-current={selectedId === c.id}
              className={`w-full border-l-4 px-3 py-3 text-left hover:bg-mint-50/60 dark:hover:bg-mint-950/20 ${STRIP[c.status]} ${selectedId === c.id ? 'bg-mint-50 dark:bg-mint-950/30' : ''}`}>
              <span className="flex items-center gap-2"><span className={`text-sm ${ENT}`}>{c.countNo}</span>
                <span className="ml-auto">{c.rejected && c.status === 'counting'
                  ? <Pill className="border-rose-200 bg-rose-50 text-rose-700">Bị từ chối</Pill> : <Pill className={STATUS_STYLE[c.status]}>{STOCK_COUNT_STATUS_LABEL[c.status]}</Pill>}</span></span>
              <span className={`block text-sm ${ENT}`}>{c.warehouseName}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.reason} · {dt(c.createdAt)} · <span className={ENT}>{c.createdByName}</span></span>
              {c.status === 'counting' && <span className="mt-1.5 flex items-center gap-2 text-xs"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-leaf-500" style={{ width: `${pct}%` }} /></span><span className="tabular-nums text-muted-foreground">{c.countedCount}/{c.lineCount}</span></span>}
              {c.varianceCount != null && <span className="mt-1 block text-xs text-muted-foreground"><span className={NUM}>{c.varianceCount}</span> dòng chênh · {' '}
                <span className={`font-semibold tabular-nums ${(c.varianceValue || 0) < 0 ? 'text-rose-600' : 'text-leaf-700'}`}>{money(c.varianceValue || 0)} đ</span></span>}
            </button></li>;
          })}</ul>}
      </section>
      <section className={`${selectedId ? '' : 'hidden lg:block'} min-w-0`} aria-label="Chi tiết phiên kiểm">
        {selectedId && <button type="button" onClick={() => setSelectedId(null)} className="mb-2 text-sm font-semibold text-teal-700 hover:underline lg:hidden">← Danh sách phiên</button>}
        {selectedId && !detail ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang mở phiên…</div>
          : detail ? <CountPanel key={`${detail.id}-${detail.revision}`} detail={detail} items={items} onChange={onDetail} onStale={() => { setSelectedId(null); void load(); }} />
          : <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            <ClipboardList size={28} className="mb-2 text-mint-500" />Chọn một phiên kiểm bên trái, hoặc lập phiên mới.</div>}
      </section>
    </div>

    {creating && <StartDialog warehouses={data.warehouses} onClose={() => setCreating(false)} onStarted={d => { setCreating(false); onDetail(d); }} />}
  </section>;
};

const StartDialog: React.FC<{ warehouses: StockCountList['warehouses']; onClose: () => void; onStarted: (d: StockCountDetail) => void }> = ({ warehouses, onClose, onStarted }) => {
  const toast = useToast();
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].id : '');
  const [reason, setReason] = useState('Kiểm kê định kỳ');
  const [blind, setBlind] = useState(true);
  const [busy, setBusy] = useState(false);
  const w = warehouses.find(x => x.id === wh);
  const start = async () => {
    setBusy(true);
    try {
      const d = await stockCountService.start({ warehouseId: wh, reason: reason.trim(), blind });
      toast.success('Đã lập phiên kiểm kê', `${d.countNo} · ${d.warehouseName}: chụp tồn sổ ${d.lines.length} vật tư lúc ${dt(d.snapshotAt)}. Bắt đầu đếm.`);
      onStarted(d);
    } catch (error) { toast.error('Chưa lập được phiên kiểm', (error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-label="Lập phiên kiểm kê">
    <div className="w-full max-w-lg space-y-4 rounded-2xl bg-card p-5 shadow-2xl">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Lập phiên kiểm kê</h3>
        <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 hover:bg-muted"><X size={18} /></button></div>
      <label className="block text-sm"><span className="text-xs font-semibold text-muted-foreground">Kho *</span>
        <select value={wh} onChange={e => setWh(e.target.value)} className={`${inputCls} mt-1 w-full`}><option value="">Chọn kho…</option>
          {warehouses.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {w && (w.openDocs > 0 || w.openReconciliations > 0) && <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle size={16} className="shrink-0 text-amber-600" /><span>Kho còn <b>{w.openDocs}</b> phiếu chưa xử lý{w.openReconciliations > 0 && <> và <b>{w.openReconciliations}</b> đợt giao treo chưa đối chiếu</>}.
        Nên xử lý trước để chênh lệch kiểm kê phản ánh đúng thực tế. Vẫn có thể kiểm — phát sinh trong lúc đếm được tính đúng.</span></p>}
      <label className="block text-sm"><span className="text-xs font-semibold text-muted-foreground">Lý do *</span>
        <input value={reason} onChange={e => setReason(e.target.value)} className={`${inputCls} mt-1 w-full`} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} className="mt-1 accent-leaf-600" />
        <span><b>Đếm mù</b> (khuyên dùng): người đếm không thấy số trên sổ khi đang đếm, tránh "đếm cho khớp".</span></label>
      <p className="text-xs text-muted-foreground">Hệ thống chụp tồn SỔ KHO của mọi vật tư đang có trong kho tại thời điểm lập. Có thể thêm vật tư ngoài sổ khi đếm.</p>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
        <button type="button" disabled={busy || !wh || !reason.trim()} onClick={() => void start()} className={primaryBtn}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Lập phiên & chụp tồn</button></div>
    </div>
  </div>;
};

type LineFilter = 'all' | 'uncounted' | 'variance';

const CountPanel: React.FC<{ detail: StockCountDetail; items: Array<{ id: string; name: string; sku?: string; unit?: string }>; onChange: (d: StockCountDetail) => void; onStale: () => void }> =
  ({ detail: d, items, onChange, onStale }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(d.lines.map(l => [l.id, l.countedQty == null ? '' : formatQuantityInput(l.countedQty)])));
  // V4: dòng đếm theo quy cách (mã có quy cách tại kho, hoặc người đếm tách quy cách) — số đếm của mã = cộng các quy cách.
  const specRowsOf = (l: typeof d.lines[number]): SpecCountRow[] | null => l.specCounts?.length
    ? l.specCounts.map(s => ({ specification: s.specification, value: s.countedQty == null ? '' : formatQuantityInput(s.countedQty), snapshotQty: s.snapshotQty, added: s.added }))
    : null;
  const [specRows, setSpecRows] = useState<Record<string, SpecCountRow[]>>(() =>
    Object.fromEntries(d.lines.flatMap(l => { const r = specRowsOf(l); return r ? [[l.id, r]] : []; })));
  const setLineSpecs = (lineId: string, rows: SpecCountRow[]) => {
    setSpecRows(s => ({ ...s, [lineId]: rows }));
    setQty(s => ({ ...s, [lineId]: specCountTotal(rows) }));
  };
  const specDirty = (l: typeof d.lines[number]) => !!specRows[l.id]
    && JSON.stringify(specRows[l.id].map(r => [r.specification, r.value])) !== JSON.stringify((specRowsOf(l) || []).map(r => [r.specification, r.value]));
  const [reasons, setReasons] = useState<Record<string, VarianceReason | ''>>(() => Object.fromEntries(d.lines.map(l => [l.id, l.varianceReason || ''])));
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(d.lines.map(l => [l.id, l.note || ''])));
  const [filter, setFilter] = useState<LineFilter>(d.status === 'counting' ? 'all' : 'variance');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const dirtyCounts = d.lines.filter(l => specDirty(l) || (!specRows[l.id] && (qty[l.id] ?? '') !== (l.countedQty == null ? '' : formatQuantityInput(l.countedQty))));
  const dirtyExplain = d.lines.filter(l => (reasons[l.id] || '') !== (l.varianceReason || '') || (notes[l.id] || '') !== (l.note || ''));
  const counted = d.lines.filter(l => (qty[l.id] ?? '').trim() !== '').length;
  const invalid = d.lines.some(l => specRows[l.id] ? specCountInvalid(specRows[l.id]) : (qty[l.id] ?? '').trim() !== '' && !(parseQuantityInput(qty[l.id]) >= 0));
  const variance = d.lines.filter(l => (l.varianceQty || 0) !== 0);
  const unexplained = variance.filter(l => !reasons[l.id]).length;
  const valueOf = (l: typeof d.lines[number]) => (l.varianceQty || 0) * (l.unitCost || 0);
  const shortValue = variance.filter(l => (l.varianceQty || 0) < 0 && reasons[l.id] !== 'UNRECORDED_ISSUE').reduce((s, l) => s + valueOf(l), 0);
  const issueValue = variance.filter(l => reasons[l.id] === 'UNRECORDED_ISSUE').reduce((s, l) => s + valueOf(l), 0);
  const surplusValue = variance.filter(l => (l.varianceQty || 0) > 0).reduce((s, l) => s + valueOf(l), 0);
  const lines = d.lines.filter(l => (filter === 'all' || (filter === 'uncounted' ? (qty[l.id] ?? '').trim() === '' : (l.varianceQty || 0) !== 0))
    && (!q.trim() || `${l.name} ${l.sku || ''}`.toLowerCase().includes(q.trim().toLowerCase())));

  const run = async (key: string, fn: () => Promise<StockCountDetail>, ok: [string, string]) => {
    setBusy(key);
    try { onChange(await fn()); toast.success(ok[0], ok[1]); return true; }
    catch (error) {
      const code = (error as { code?: string }).code;
      toast.error(`Chưa thực hiện được — ${d.countNo}`, (error as Error).message);
      if (code === 'STOCK_COUNT_REVISION_CONFLICT' || code === 'STOCK_COUNT_NOT_COUNTING' || code === 'STOCK_COUNT_NOT_SUBMITTED') onStale();
      return false;
    } finally { setBusy(null); }
  };
  const saveCounts = () => run('save', () => stockCountService.saveLines({ countId: d.id,
    lines: dirtyCounts.map(l => specRows[l.id]
      ? { lineId: l.id, specCounts: specRows[l.id].map(r => ({ specification: r.specification, countedQty: r.value.trim() === '' ? null : parseQuantityInput(r.value) })) }
      : { lineId: l.id, countedQty: (qty[l.id] ?? '').trim() === '' ? null : parseQuantityInput(qty[l.id]) }) }),
    ['Đã lưu số đếm', `${dirtyCounts.length} dòng · đã đếm ${counted}/${d.lines.length}.`]);
  const saveExplain = () => run('explain', () => stockCountService.saveLines({ countId: d.id,
    lines: dirtyExplain.map(l => ({ lineId: l.id, varianceReason: (reasons[l.id] || null) as VarianceReason | null, note: notes[l.id] || '' })) }),
    ['Đã lưu giải trình', `${dirtyExplain.length} dòng. ${unexplained ? `Còn ${unexplained} dòng chênh chưa có nguyên nhân.` : 'Mọi dòng chênh đã có nguyên nhân — chờ người duyệt.'}`]);
  const submit = async () => {
    if (dirtyCounts.length && !(await saveCounts())) return;
    const ok = await confirm({ title: 'Nộp kết quả đếm?', confirmText: 'Nộp phiên', targetName: d.countNo,
      warningText: `${d.lines.length} dòng. Sau khi nộp, số đếm KHÓA; hệ thống tính chênh lệch theo tồn sổ lúc nộp và hiện số sổ để bạn giải trình nguyên nhân.`,
      actionLabel: 'Nộp', cancelLabel: 'Xem lại', intent: 'success', countdownSeconds: 0 });
    if (!ok) return;
    const fresh = await stockCountService.get(d.id).catch(() => d);
    void run('submit', () => stockCountService.submit({ countId: d.id, revision: fresh.revision }),
      ['Đã nộp kết quả đếm', `${d.countNo}: số đếm đã khóa. Kiểm tra các dòng chênh lệch và chọn nguyên nhân.`]);
  };
  const approve = async () => {
    const ok = await confirm({ title: 'Duyệt và ghi sổ kiểm kê?', confirmText: 'Duyệt phiên', targetName: d.countNo,
      warningText: `${variance.length} dòng chênh: thiếu ${money(-shortValue)} đ, xuất dùng thi công ${money(-issueValue)} đ, dư ${money(surplusValue)} đ. `
        + 'Tạo phiếu điều chỉnh / xuất dùng và đồng bộ tồn. Không hoàn tác được.',
      actionLabel: 'Duyệt & ghi sổ', cancelLabel: 'Xem lại', intent: 'success', countdownSeconds: 0 });
    if (ok) void run('approve', () => stockCountService.decide({ countId: d.id, revision: d.revision, action: 'approve' }),
      ['Đã duyệt và ghi sổ kiểm kê', `${d.countNo} · ${d.warehouseName}: ${variance.length} dòng chênh đã vào sổ; tồn kho khớp số đếm.`]);
  };
  const reject = async () => {
    const reason = await reasonConfirm({ title: 'Từ chối kết quả kiểm kê?', targetName: d.countNo, subtitle: `${variance.length} dòng chênh lệch.`,
      warningText: 'Phiên quay về bước đếm để người đếm đếm lại / sửa số. Số đã đếm được giữ lại.', reasonLabel: 'Lý do từ chối',
      reasonPlaceholder: 'VD: đếm lại thép D10 theo bó; Base B cân lại…', actionLabel: 'Từ chối', intent: 'danger' });
    if (reason) void run('reject', () => stockCountService.decide({ countId: d.id, revision: d.revision, action: 'reject', reason }),
      ['Đã từ chối', `${d.countNo} quay về bước đếm kèm lý do: ${reason}`]);
  };
  const cancel = async () => {
    const reason = await reasonConfirm({ title: 'Hủy phiên kiểm kê?', targetName: d.countNo, warningText: 'Phiên bị hủy, không ghi sổ gì. Số đếm vẫn lưu trong lịch sử.',
      reasonLabel: 'Lý do hủy', actionLabel: 'Hủy phiên', intent: 'danger' });
    if (reason) void run('cancel', () => stockCountService.cancel({ countId: d.id, reason }), ['Đã hủy phiên kiểm', `${d.countNo}: ${reason}`]);
  };
  const addItem = async () => {
    if (!adding) return;
    const ok = await run('add', () => stockCountService.addItem({ countId: d.id, itemId: adding }), ['Đã thêm vật tư', `${items.find(i => i.id === adding)?.name || adding} — nhập số đếm.`]);
    if (ok) setAdding('');
  };
  const inCount = new Set(d.lines.map(l => l.itemId));

  return <div className="overflow-clip rounded-2xl border border-border bg-card">
    <header className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className={`text-lg ${ENT}`}>{d.countNo}</h3><Pill className={STATUS_STYLE[d.status]}>{STOCK_COUNT_STATUS_LABEL[d.status]}</Pill>
          {d.blind && d.status === 'counting' && <Pill className="border-slate-200 bg-slate-50 text-slate-600"><EyeOff size={12} />Đếm mù</Pill>}</div>
        <p className="text-sm"><Warehouse size={13} className="mr-1 inline text-mint-600" /><span className={ENT}>{d.warehouseName}</span> · {d.reason}</p>
        <p className="text-xs text-muted-foreground">Lập bởi <span className={ENT}>{d.createdBy.name}</span> · chụp tồn {dt(d.snapshotAt)}
          {d.submittedBy && <> · nộp bởi <span className={ENT}>{d.submittedBy.name}</span> {dt(d.submittedBy.at)}</>}
          {d.approvedBy && <> · duyệt bởi <span className={ENT}>{d.approvedBy.name}</span> {dt(d.approvedBy.at)}</>}</p>
      </div>
    </header>

    <div className="space-y-3 p-4">
      {d.rejection && d.status === 'counting' && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
        <XCircle size={18} className="shrink-0 text-rose-600" /><div><b>Bị từ chối</b> bởi <span className={ENT}>{d.rejection.byName}</span> {dt(d.rejection.at)}<br />Lý do: {d.rejection.reason}</div></div>}
      {d.cancelled && <p className="rounded-xl bg-muted p-3 text-sm">Đã hủy bởi <span className={ENT}>{d.cancelled.name}</span> {dt(d.cancelled.at)} — {d.cancelled.reason}</p>}
      {!!d.metadata.openDocsAtStart && d.status !== 'posted' && <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle size={14} className="shrink-0 text-amber-600" />Lúc lập phiên kho còn {d.metadata.openDocsAtStart} phiếu chưa xử lý{d.metadata.openReconciliationsAtStart ? ` và ${d.metadata.openReconciliationsAtStart} đợt giao treo` : ''}.</p>}

      {d.status === 'counting' && <div className="flex items-center gap-3 text-sm"><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-leaf-500 transition-all" style={{ width: `${d.lines.length ? counted / d.lines.length * 100 : 0}%` }} /></span>
        <span className="tabular-nums">Đã đếm <span className={NUM}>{counted}</span>/{d.lines.length}</span></div>}

      {d.status !== 'counting' && d.status !== 'cancelled' && <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-2.5 dark:border-rose-900 dark:bg-rose-950/30"><p className="text-xs text-muted-foreground">Thiếu (hao hụt, mất…)</p><p className="font-bold tabular-nums text-rose-700 dark:text-rose-300">{money(-shortValue)} đ</p></div>
        <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-2.5 dark:border-teal-900 dark:bg-teal-950/30"><p className="text-xs text-muted-foreground">Xuất dùng thi công</p><p className="font-bold tabular-nums text-teal-800 dark:text-teal-200">{money(-issueValue)} đ</p></div>
        <div className="rounded-xl border border-leaf-200 bg-leaf-50/70 p-2.5 dark:border-leaf-900 dark:bg-leaf-950/30"><p className="text-xs text-muted-foreground">Dư</p><p className={NUM}>{money(surplusValue)} đ</p></div>
      </div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-0.5 text-xs">
          {([['all', `Tất cả ${d.lines.length}`], ...(d.status === 'counting' ? [['uncounted', `Chưa đếm ${d.lines.length - counted}`]] : [['variance', `Chênh lệch ${variance.length}`]])] as Array<[LineFilter, string]>).map(([k, l]) =>
            <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 font-semibold ${filter === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{l}</button>)}
        </div>
        <label className="flex min-w-[160px] flex-1 items-center gap-1.5 rounded-lg border border-border px-2"><Search size={14} className="text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm vật tư trong phiên" aria-label="Tìm vật tư trong phiên" className="w-full bg-transparent py-1 text-sm focus:outline-none" /></label>
      </div>

      {d.can.count && <ul className="divide-y divide-border rounded-xl border border-border sm:hidden" aria-label="Dòng đếm">{lines.map(l =>
        <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1"><p className={ENT}>{l.name}</p>
            <p className="text-[11px] text-muted-foreground">{l.sku}{l.unit && ` · ${l.unit}`}{d.systemVisible && l.snapshotQty != null && ` · sổ ${qtyFmt(l.snapshotQty)}`}{l.addedDuringCount && ' · ngoài sổ'}</p>
            {specRows[l.id] ? <SpecCountRows rows={specRows[l.id]} editable systemVisible={d.systemVisible} unit={l.unit} itemId={l.itemId} itemName={l.name} onChange={rows => setLineSpecs(l.id, rows)} />
              : <button type="button" onClick={() => setLineSpecs(l.id, [{ specification: null, value: qty[l.id] ?? '', snapshotQty: l.snapshotQty }])} className="mt-0.5 text-[11px] font-semibold text-teal-700">Đếm theo quy cách</button>}</div>
          {specRows[l.id] ? <span className={`w-20 text-right ${NUM}`}>{qty[l.id] || '—'}</span>
            : <input inputMode="decimal" value={qty[l.id] ?? ''} onChange={e => setQty(s => ({ ...s, [l.id]: e.target.value }))} aria-label={`Số đếm ${l.name}`}
            placeholder="—" className={`${inputCls} w-28 text-right tabular-nums text-leaf-800`} />}
        </li>)}{lines.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Không có dòng nào.</li>}</ul>}
      <div className={`max-h-[55vh] overflow-auto rounded-xl border border-border ${d.can.count ? 'hidden sm:block' : ''}`}>
        <table className={`w-full text-sm ${d.status === 'counting' ? 'min-w-[520px]' : 'min-w-[820px]'}`}>
          <thead className="sticky top-0 whitespace-nowrap bg-muted/90 text-left text-xs text-muted-foreground backdrop-blur"><tr>
            <th className="px-3 py-2 font-semibold">Vật tư</th><th className="px-2 font-semibold">ĐVT</th>
            {d.systemVisible && <th className="px-2 text-right font-semibold">{d.status === 'counting' ? 'Tồn sổ lúc chụp' : 'Tồn sổ lúc nộp'}</th>}
            <th className="px-2 text-right font-semibold">Số đếm</th>
            {d.status !== 'counting' && <><th className="px-2 text-right font-semibold">Chênh</th><th className="px-2 text-right font-semibold">Giá trị</th><th className="px-2 font-semibold">Nguyên nhân</th></>}
          </tr></thead>
          <tbody className="divide-y divide-border">{lines.map(l => {
            const v = l.varianceQty || 0;
            return <tr key={l.id} className="align-top">
              <td className="px-3 py-2"><span className={ENT}>{l.name}</span>{l.addedDuringCount && <span className="ml-1 text-[11px] text-amber-700">ngoài sổ</span>}
                <span className="block text-[11px] text-muted-foreground">{l.sku}{l.countedBy && ` · đếm: ${l.countedBy}`}
                  {d.systemVisible && l.cacheQtyAtSnapshot != null && l.snapshotQty != null && Math.abs(l.cacheQtyAtSnapshot - l.snapshotQty) > 0.0005 && <span className="text-amber-700"> · danh mục ghi {qtyFmt(l.cacheQtyAtSnapshot)}</span>}</span>
                {specRows[l.id] ? <SpecCountRows rows={specRows[l.id]} editable={d.can.count} systemVisible={d.systemVisible} unit={l.unit} itemId={l.itemId} itemName={l.name} onChange={rows => setLineSpecs(l.id, rows)} />
                  : d.can.count && <button type="button" onClick={() => setLineSpecs(l.id, [{ specification: null, value: qty[l.id] ?? '', snapshotQty: l.snapshotQty }])}
                    className="mt-0.5 text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-300" title="Kho có nhiều quy cách của mã này — đếm riêng từng quy cách">Đếm theo quy cách</button>}</td>
              <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{l.unit}</td>
              {d.systemVisible && <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{qtyFmt(d.status === 'counting' ? l.snapshotQty : l.expectedQty)}</td>}
              <td className="px-2 py-1.5 text-right">{d.can.count && specRows[l.id]
                ? <span className={`whitespace-nowrap ${NUM}`} title="Cộng các quy cách">{qty[l.id] || '—'}</span>
                : d.can.count
                ? <input inputMode="decimal" value={qty[l.id] ?? ''} onChange={e => setQty(s => ({ ...s, [l.id]: e.target.value }))} aria-label={`Số đếm ${l.name}`}
                  placeholder="—" className={`${inputCls} w-28 text-right tabular-nums text-leaf-800`} />
                : <span className={`whitespace-nowrap ${NUM}`}>{qtyFmt(l.countedQty)}</span>}</td>
              {d.status !== 'counting' && <>
                <td className={`whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums ${v < 0 ? 'text-rose-600' : v > 0 ? 'text-leaf-700' : 'text-muted-foreground'}`}>{v ? `${v > 0 ? '+' : ''}${qtyFmt(v)}` : 'khớp'}</td>
                <td className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${v < 0 ? 'text-rose-600' : 'text-leaf-700'}`}>{!v ? '' : l.unitCost ? money(valueOf(l)) : <span className="text-xs text-amber-700" title="Kho chưa có giá vốn cho vật tư này">chưa có giá</span>}</td>
                <td className="min-w-[220px] px-2 py-1.5">{v === 0 ? '' : d.can.explain
                  ? <div className="space-y-1"><select value={reasons[l.id] || ''} onChange={e => setReasons(s => ({ ...s, [l.id]: e.target.value as VarianceReason }))}
                      aria-label={`Nguyên nhân ${l.name}`} className={`${inputCls} w-full ${reasons[l.id] ? '' : 'border-amber-300'}`}>
                      <option value="">Chọn nguyên nhân…</option>{(v < 0 ? SHORTAGE_REASONS : SURPLUS_REASONS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                    <input value={notes[l.id] || ''} onChange={e => setNotes(s => ({ ...s, [l.id]: e.target.value }))} placeholder="Ghi chú (tùy chọn)" className={`${inputCls} w-full text-xs`} /></div>
                  : <span className={l.varianceReason ? '' : 'text-amber-700'}>{l.varianceReason ? REASON_LABEL[l.varianceReason] : 'Chưa giải trình'}{l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}</span>}</td>
              </>}
            </tr>;
          })}{lines.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Không có dòng nào.</td></tr>}</tbody>
        </table>
      </div>

      {d.can.count && <div className="flex flex-wrap items-center gap-2 text-sm">
        <PackagePlus size={16} className="text-mint-600" />
        <select value={adding} onChange={e => setAdding(e.target.value)} aria-label="Thêm vật tư ngoài sổ" className={`${inputCls} min-w-[12rem] flex-1`}>
          <option value="">Thêm vật tư có thực tế nhưng ngoài sổ…</option>
          {items.filter(i => !inCount.has(i.id)).slice(0, 400).map(i => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ''}</option>)}</select>
        <button type="button" disabled={!adding || !!busy} onClick={() => void addItem()} className={secondaryBtn}>Thêm</button>
      </div>}
      {variance.some(l => (l.varianceQty || 0) > 0 && reasons[l.id] === 'UNRECORDED_RECEIPT') && <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        "Hàng về chưa nhập sổ": nếu là hàng NCC giao theo đơn, nên nhận qua đợt giao / Đối chiếu nhận hàng để ghi công nợ — kiểm kê chỉ điều chỉnh tồn.</p>}

      {d.events.length > 0 && <div><button type="button" onClick={() => setShowHistory(v => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <History size={14} />Lịch sử ({d.events.length}){showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        {showHistory && <ol className="mt-2 space-y-1 border-l-2 border-mint-200 pl-3 text-xs">{d.events.map((e, i) =>
          <li key={i}><b>{STOCK_COUNT_EVENT_LABEL[e.action] || e.action}</b> — <span className={ENT}>{e.actorName}</span> · {dt(e.at)}{e.note && <span className="block text-muted-foreground">{e.note}</span>}</li>)}</ol>}</div>}
    </div>

    {(d.can.count || d.can.explain || d.can.approve || d.can.reject || d.can.cancel) && <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
      <p className={`mr-auto text-xs ${invalid || (d.status === 'submitted' && unexplained) ? 'text-amber-700' : 'text-muted-foreground'}`}>
        {d.status === 'counting' ? invalid ? 'Có số đếm không hợp lệ.' : counted < d.lines.length ? `Còn ${d.lines.length - counted} dòng chưa đếm.` : 'Đã đếm đủ — nộp để xem chênh lệch.'
          : unexplained ? `Còn ${unexplained} dòng chênh chưa có nguyên nhân.` : d.can.approve ? 'Đủ giải trình — có thể duyệt ghi sổ.' : 'Đủ giải trình — chờ người duyệt (Admin / quản trị kho).'}</p>
      {d.can.cancel && <button type="button" onClick={() => void cancel()} disabled={!!busy} className={dangerBtn}>Hủy phiên</button>}
      {d.can.count && <button type="button" onClick={() => void saveCounts()} disabled={!!busy || !dirtyCounts.length || invalid} className={secondaryBtn}>
        {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu{dirtyCounts.length ? ` (${dirtyCounts.length})` : ''}</button>}
      {d.can.submit && <button type="button" onClick={() => void submit()} disabled={!!busy || invalid || counted < d.lines.length} className={primaryBtn}>
        {busy === 'submit' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Nộp kết quả đếm</button>}
      {d.can.explain && <button type="button" onClick={() => void saveExplain()} disabled={!!busy || !dirtyExplain.length} className={d.can.approve ? secondaryBtn : primaryBtn}>
        {busy === 'explain' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu giải trình{dirtyExplain.length ? ` (${dirtyExplain.length})` : ''}</button>}
      {d.can.reject && <button type="button" onClick={() => void reject()} disabled={!!busy} className={dangerBtn}><XCircle size={15} />Từ chối</button>}
      {d.can.approve && <button type="button" onClick={() => void approve()} disabled={!!busy || unexplained > 0 || dirtyExplain.length > 0} className={primaryBtn}>
        {busy === 'approve' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Duyệt & ghi sổ</button>}
    </footer>}
  </div>;
};

export default StockCountView;
