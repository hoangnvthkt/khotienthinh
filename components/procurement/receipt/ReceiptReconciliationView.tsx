import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClock, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, History, Hourglass, Loader2, PackageCheck, PackageX, RefreshCw, Scale, Search,
  ShieldCheck, Undo2, UserCheck, X, XCircle,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { formatQuantityInput, parseQuantityInput } from '../../../lib/quantityInput';
import {
  RECON_DECISION_LABELS, RECON_EVENT_LABELS, RECON_STAGE_LABELS, receiptReconciliationService, reconNeedsMe, reconSearchText, reconStage, reconValue,
  type ReconDecision, type ReconItem, type ReconList, type ReconRemainder, type ReconSide, type ReconStage,
} from '../../../lib/receiptReconciliationService';
import { dateVi, fmt } from '../../project/work-plan/workPlanUi';
import { backdateHint } from '../../../lib/businessDate';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../hub/hubUi';

// Đối chiếu nhận hàng tồn đọng: Mua hàng và thủ kho cùng chốt đợt giao treo, thủ kho ghi sổ theo ngày hàng về.

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const STAGE_STYLE: Record<ReconStage, string> = {
  todo: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  waiting_buyer: 'bg-mint-50 text-mint-800 border-mint-200 dark:bg-mint-900/30 dark:text-mint-200 dark:border-mint-800',
  waiting_keeper: 'bg-mint-50 text-mint-800 border-mint-200 dark:bg-mint-900/30 dark:text-mint-200 dark:border-mint-800',
  ready: 'bg-leaf-50 text-leaf-800 border-leaf-200 dark:bg-leaf-900/30 dark:text-leaf-200 dark:border-leaf-800',
  posted: 'bg-leaf-600 text-white border-leaf-600',
};
// Dải màu bên trái mỗi đợt, theo bước — nhìn lướt biết đợt đang ở đâu.
const STAGE_STRIP: Record<ReconStage, string> = {
  todo: 'border-l-slate-300 dark:border-l-slate-600', rejected: 'border-l-rose-500', waiting_buyer: 'border-l-mint-500',
  waiting_keeper: 'border-l-mint-500', ready: 'border-l-leaf-500', posted: 'border-l-leaf-700',
};
const SIDE_LABEL: Record<ReconSide, string> = { buyer: 'Mua hàng', keeper: 'Thủ kho' };
const REASONS: Record<Exclude<ReconDecision, 'full'>, string[]> = {
  partial: ['NCC giao thiếu', 'Cân thực tế khác phiếu giao', 'Hàng lỗi, không nhận', 'Giao dư theo cân thực tế'],
  none: ['NCC chưa giao', 'NCC không giao nữa', 'Đợt giao lập trùng'],
};
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

type Filter = 'mine' | 'open' | 'posted';
type Sort = 'oldest' | 'newest' | 'value' | 'po';
type StageFilter = ReconStage | 'late30' | null;

const TILE: Record<string, { box: string; icon: string; num: string }> = {
  mine: { box: 'border-teal-200 bg-teal-50/70 dark:border-teal-900 dark:bg-teal-950/30', icon: 'bg-teal-600 text-white', num: 'text-teal-800 dark:text-teal-200' },
  todo: { box: 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60', icon: 'bg-slate-500 text-white', num: 'text-slate-800 dark:text-slate-100' },
  waiting: { box: 'border-mint-200 bg-mint-50/70 dark:border-mint-900 dark:bg-mint-950/30', icon: 'bg-mint-500 text-white', num: 'text-mint-800 dark:text-mint-200' },
  rejected: { box: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30', icon: 'bg-rose-500 text-white', num: 'text-rose-700 dark:text-rose-300' },
  ready: { box: 'border-leaf-200 bg-leaf-50/70 dark:border-leaf-900 dark:bg-leaf-950/30', icon: 'bg-leaf-600 text-white', num: 'text-leaf-800 dark:text-leaf-200' },
  late30: { box: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30', icon: 'bg-amber-500 text-white', num: 'text-amber-800 dark:text-amber-200' },
};

export const ReceiptReconciliationView: React.FC<{ currentUserId?: string | null }> = ({ currentUserId }) => {
  const [data, setData] = useState<ReconList | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<Filter>('mine');
  const [stageFilter, setStageFilter] = useState<StageFilter>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [vendor, setVendor] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('oldest');
  const [showHowTo, setShowHowTo] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus(s => s === 'ready' ? 'ready' : 'loading');
    try {
      setData(await receiptReconciliationService.list()); setStatus('ready');
    } catch (error) {
      const code = (error as { code?: string }).code;
      setMessage((error as Error).message);
      setStatus(code === 'RECEIPT_RECON_VIEW_DENIED' || code === '42501' ? 'denied' : 'error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const replace = (item: ReconItem) => setData(d => d && ({ ...d, items: d.items.map(x => x.deliveryBatchId === item.deliveryBatchId ? item : x) }));

  const all = data?.items || [];
  // Kho / NCC / tìm kiếm áp dụng trước, rồi mới đếm ô chỉ số để số trên ô khớp danh sách.
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(i => (!warehouseId || i.warehouseId === warehouseId) && (!vendor || i.vendorName === vendor)
      && (!q || q.split(/\s+/).every(w => reconSearchText(i).includes(w))));
  }, [all, warehouseId, vendor, search]);
  const vendors = useMemo(() => [...new Set(all.map(i => i.vendorName).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi')), [all]);
  const open = scoped.filter(i => i.open);
  const counts = {
    mine: scoped.filter(reconNeedsMe).length,
    todo: open.filter(i => reconStage(i) === 'todo').length,
    waiting: open.filter(i => ['waiting_buyer', 'waiting_keeper'].includes(reconStage(i))).length,
    rejected: open.filter(i => reconStage(i) === 'rejected').length,
    ready: open.filter(i => reconStage(i) === 'ready').length,
    late30: open.filter(i => i.ageDays >= 30).length,
    posted: scoped.filter(i => reconStage(i) === 'posted').length,
    value: open.reduce((s, i) => s + reconValue(i), 0),
  };
  const shown = useMemo(() => {
    const base = scoped.filter(i => {
      if (stageFilter === 'late30') return i.open && i.ageDays >= 30;
      if (stageFilter === 'waiting_buyer') return i.open && ['waiting_buyer', 'waiting_keeper'].includes(reconStage(i));
      if (stageFilter) return i.open && reconStage(i) === stageFilter;
      return filter === 'posted' ? reconStage(i) === 'posted' : filter === 'open' ? i.open : reconNeedsMe(i);
    });
    const by: Record<Sort, (a: ReconItem, b: ReconItem) => number> = {
      oldest: (a, b) => b.ageDays - a.ageDays,
      newest: (a, b) => a.ageDays - b.ageDays,
      value: (a, b) => reconValue(b) - reconValue(a),
      po: (a, b) => (a.poNumber || '').localeCompare(b.poNumber || '', 'vi', { numeric: true }) || (a.deliveryNo || 0) - (b.deliveryNo || 0),
    };
    return [...base].sort(by[sort]);
  }, [scoped, filter, stageFilter, sort]);

  if (status === 'denied') return <StateBox kind="denied" title="Bạn chưa có quyền đối chiếu nhận hàng" message={message} />;
  if (status === 'error' && !data) return <StateBox kind="error" title="Chưa tải được đối chiếu" message={message} onRetry={() => void load()} />;
  if (!data) return <StateBox kind="loading" title="Đang tải các đợt giao treo…" />;

  const role = data.role;
  const roleText = role.readOnly ? 'Chỉ xem' : [role.buyer && 'Mua hàng', role.keeper && 'Thủ kho', role.admin && 'Admin'].filter(Boolean).join(' · ');
  const tiles: Array<{ key: string; label: string; n: number; icon: React.ReactNode; onClick: () => void; active: boolean; blink?: boolean }> = [
    { key: 'mine', label: 'Cần bạn xử lý', n: counts.mine, icon: <UserCheck size={16} />, onClick: () => { setFilter('mine'); setStageFilter(null); }, active: filter === 'mine' && !stageFilter },
    { key: 'todo', label: 'Chưa đối chiếu', n: counts.todo, icon: <ClipboardCheck size={16} />, onClick: () => setStageFilter('todo'), active: stageFilter === 'todo' },
    { key: 'waiting', label: 'Chờ xác nhận', n: counts.waiting, icon: <Hourglass size={16} />, onClick: () => setStageFilter('waiting_buyer'), active: stageFilter === 'waiting_buyer' },
    { key: 'rejected', label: 'Bị từ chối', n: counts.rejected, icon: <XCircle size={16} />, onClick: () => setStageFilter('rejected'), active: stageFilter === 'rejected', blink: counts.rejected > 0 },
    { key: 'ready', label: 'Chờ ghi sổ', n: counts.ready, icon: <ShieldCheck size={16} />, onClick: () => setStageFilter('ready'), active: stageFilter === 'ready' },
    { key: 'late30', label: 'Treo trên 30 ngày', n: counts.late30, icon: <AlarmClock size={16} />, onClick: () => setStageFilter('late30'), active: stageFilter === 'late30', blink: counts.late30 > 0 },
  ];

  return <section className="space-y-4">
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-mint-500 text-white shadow-sm"><ClipboardCheck size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-foreground">Đối chiếu nhận hàng tồn đọng</h2>
          <p className="text-sm text-muted-foreground">Mua hàng và thủ kho cùng chốt từng đợt giao treo; thủ kho ghi sổ theo ngày hàng về.
            {' '}<button type="button" onClick={() => setShowHowTo(v => !v)} className="font-semibold text-teal-700 hover:underline dark:text-teal-300">{showHowTo ? 'Ẩn cách làm' : 'Cách làm'}</button></p>
        </div>
        <div className="flex w-full items-end justify-between gap-2 sm:block sm:w-auto sm:text-right">
          <div><p className="text-xs text-muted-foreground">Còn mở <span className={NUM}>{open.length}</span> đợt · gồm VAT</p>
            <p className={`whitespace-nowrap text-xl ${NUM}`}>{money(counts.value)} đ</p></div>
          <Badge className={role.readOnly ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200'}>Vai trò: {roleText}</Badge>
        </div>
      </div>
      {showHowTo && <ol className="mt-3 grid gap-2 text-sm md:grid-cols-3">
        {([['1', 'bg-teal-600', 'Mua hàng', 'chọn về đủ / thiếu hoặc dư / không về, theo hóa đơn và biên bản giao.'],
          ['2', 'bg-mint-500', 'Thủ kho', 'xác nhận hoặc từ chối (kèm lý do). Sửa nội dung thì xác nhận cũ mất hiệu lực.'],
          ['3', 'bg-leaf-600', 'Thủ kho ghi sổ', 'khi đủ 2 xác nhận: nhập kho, chi phí dự án, công nợ NCC theo ngày hàng về.']] as const).map(([n, c, t, d]) =>
          <li key={n} className="flex gap-2 rounded-xl bg-muted/50 p-2.5"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${c}`}>{n}</span>
            <span><b>{t}</b> {d}</span></li>)}
      </ol>}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(t => <button key={t.key} type="button" onClick={t.onClick} aria-pressed={t.active}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition hover:shadow-sm ${TILE[t.key].box} ${t.active ? 'ring-2 ring-teal-500/60' : ''}`}>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TILE[t.key].icon} ${t.blink ? 'overdue-blink' : ''}`}>{t.icon}</span>
          <span className="min-w-0"><span className={`block text-xl font-bold tabular-nums leading-tight ${TILE[t.key].num}`}>{t.n}</span>
            <span className="block truncate text-xs text-muted-foreground">{t.label}</span></span>
        </button>)}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
      <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm PO, NCC, vật tư, dự án, người lập…"
          className="w-full bg-transparent py-1.5 text-sm focus:outline-none" aria-label="Tìm kiếm" />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>}
      </label>
      {data.warehouses.length > 1 && <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} aria-label="Kho" className={`${inputCls} min-w-[9rem] flex-1 sm:max-w-[12rem] sm:flex-none`}>
        <option value="">Tất cả kho</option>{data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}</select>}
      <select value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Nhà cung cấp" className={`${inputCls} min-w-[9rem] flex-1 sm:max-w-[14rem] sm:flex-none`}>
        <option value="">Tất cả NCC</option>{vendors.map(v => <option key={v} value={v}>{v}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sắp xếp" className={inputCls}>
        <option value="oldest">Treo lâu nhất trước</option><option value="newest">Mới nhất trước</option>
        <option value="value">Giá trị lớn nhất</option><option value="po">Theo số PO</option></select>
      <button type="button" onClick={() => void load()} className={secondaryBtn} title="Tải lại"><RefreshCw size={15} /><span className="hidden sm:inline">Tải lại</span></button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" role="tablist" aria-label="Lọc đối chiếu">
        {([['mine', 'Cần bạn xử lý', counts.mine], ['open', 'Tất cả còn mở', open.length], ['posted', 'Đã ghi sổ', counts.posted]] as const).map(([k, l, n]) =>
          <button key={k} type="button" role="tab" aria-selected={filter === k && !stageFilter} onClick={() => { setFilter(k); setStageFilter(null); }}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === k && !stageFilter ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
            {l} <span className="tabular-nums opacity-80">{n}</span></button>)}
      </div>
      {stageFilter && <button type="button" onClick={() => setStageFilter(null)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
        Đang lọc: {tiles.find(t => t.active)?.label}<X size={12} /></button>}
      <span className="ml-auto text-xs text-muted-foreground">{shown.length} đợt</span>
    </div>

    {shown.length === 0 ? <StateBox kind="empty"
      title={search || vendor || warehouseId ? 'Không có đợt nào khớp bộ lọc' : filter === 'mine' && !stageFilter ? 'Không còn đợt nào chờ bạn' : filter === 'posted' ? 'Chưa ghi sổ đợt nào' : 'Không có đợt nào'}
      message={filter === 'mine' && !stageFilter && open.length > 0 ? 'Các đợt còn lại đang chờ người khác — xem ở "Tất cả còn mở".' : undefined} />
      : <ul className="space-y-2">
        {shown.map(item => <ReconRow key={item.deliveryBatchId} item={item} currentUserId={currentUserId}
          expanded={openId === item.deliveryBatchId} onToggle={() => setOpenId(id => id === item.deliveryBatchId ? null : item.deliveryBatchId)}
          onChange={replace} onStale={() => void load()} />)}
      </ul>}
  </section>;
};

const ReconRow: React.FC<{ item: ReconItem; currentUserId?: string | null; expanded: boolean; onToggle: () => void; onChange: (i: ReconItem) => void; onStale: () => void }> =
  ({ item, currentUserId, expanded, onToggle, onChange, onStale }) => {
  const stage = reconStage(item);
  const value = reconValue(item);
  const title = `${item.poNumber || 'PO'} · Đợt ${item.deliveryNo ?? '?'}`;
  return <li className={`overflow-hidden rounded-2xl border border-l-4 border-border bg-card ${STAGE_STRIP[stage]}`}>
    <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-mint-50/50 dark:hover:bg-mint-950/20">
      {expanded ? <ChevronDown size={16} className="mt-1 text-muted-foreground" /> : <ChevronRight size={16} className="mt-1 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`font-semibold ${item.open && item.ageDays >= 3 ? 'text-rose-600 dark:text-rose-400' : 'text-mint-700 dark:text-mint-300'}`}>{title}</span>
          {item.open && <span className="overdue-blink rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Treo {item.ageDays} ngày</span>}
          {item.stocked && <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Kho đã nhập, PO chưa ghi</Badge>}
        </span>
        <span className={`block truncate text-sm ${ENT}`}>{item.vendorName || 'Nhà cung cấp'}</span>
        <span className="block text-xs text-muted-foreground">
          {item.projectCode && <><span className={ENT}>{item.projectCode}</span> · </>}<span className={ENT}>{item.warehouseName}</span>
          {' · '}{item.lines.length} dòng · phiếu kho {dateVi(item.docDate)}{item.createdByName && <> · lập bởi <span className={ENT}>{item.createdByName}</span></>}
        </span>
      </span>
      <span className="flex w-full items-center justify-between gap-2 pl-7 sm:w-auto sm:flex-col sm:items-end sm:pl-0">
        <Badge className={STAGE_STYLE[stage]}>{RECON_STAGE_LABELS[stage]}</Badge>
        <span className={`text-sm ${NUM}`}>{money(value)} đ</span>
      </span>
    </button>
    {expanded && <ReconEditor key={`${item.recon?.revision ?? 0}-${item.recon?.status ?? 'new'}`} item={item} currentUserId={currentUserId} onChange={onChange} onStale={onStale} />}
  </li>;
};

const ReconEditor: React.FC<{ item: ReconItem; currentUserId?: string | null; onChange: (i: ReconItem) => void; onStale: () => void }> =
  ({ item, currentUserId, onChange, onStale }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const r = item.recon;
  const posted = r?.status === 'posted';
  const initialQty = useCallback((lineId: string) => {
    const saved = r?.lines.find(x => x.deliveryLineId === lineId)?.receivedQty;
    const line = item.lines.find(l => l.deliveryLineId === lineId)!;
    return formatQuantityInput(round3(saved ?? line.checkedQty ?? (line.stockedQty ? line.stockedQty : null) ?? line.plannedQty));
  }, [item.lines, r]);
  const [decision, setDecision] = useState<ReconDecision | null>(r?.decision ?? null);
  const [arrival, setArrival] = useState(r?.arrivalDate || '');
  const [reason, setReason] = useState(r?.reason || '');
  const [remainder, setRemainder] = useState<ReconRemainder>(r?.remainder || 'keep_open');
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(item.lines.map(l => [l.deliveryLineId, initialQty(l.deliveryLineId)])));
  const bothRoles = item.can.buyer && item.can.keeper;
  const [side, setSide] = useState<ReconSide>(item.can.keeper && !item.can.buyer ? 'keeper' : bothRoles && r?.buyer && !r.keeper ? 'keeper' : 'buyer');
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const received = (lineId: string) => {
    const line = item.lines.find(l => l.deliveryLineId === lineId)!;
    if (decision === 'full') return line.plannedQty;
    if (decision === 'none') return 0;
    return parseQuantityInput(qty[lineId]);
  };
  const rows = item.lines.map(l => ({ ...l, got: received(l.deliveryLineId) }));
  const badLine = decision === 'partial' && rows.some(l => !Number.isFinite(l.got) || l.got < 0);
  const belowStocked = rows.some(l => l.stockedQty != null && Number.isFinite(l.got) && l.got < l.stockedQty - 0.000001);
  const shortfall = decision === 'none' || rows.some(l => l.got < l.plannedQty - 0.000001);
  const differs = decision === 'partial' && rows.some(l => Math.abs(l.got - l.plannedQty) > 0.000001);
  const gross = rows.reduce((s, l) => s + (Number.isFinite(l.got) ? l.got : 0) * l.unitPrice, 0) * (1 + item.vatRate / 100);
  const canDecideRemainder = item.otherOpenDeliveries === 0 && (shortfall || item.poUnscheduled.length > 0);
  const needReason = decision === 'none' || differs;
  const arrivalBeforeOrder = !!arrival && !!item.orderDate && arrival < item.orderDate.slice(0, 10);

  const payloadLines = rows.map(l => ({ deliveryLineId: l.deliveryLineId, receivedQty: Number.isFinite(l.got) ? l.got : 0 }));
  const effectiveRemainder: ReconRemainder = canDecideRemainder ? remainder : 'keep_open';
  const dirty = !r || r.decision !== decision || (r.arrivalDate || '') !== (decision === 'none' ? '' : arrival) || (r.reason || '') !== reason.trim()
    || r.remainder !== effectiveRemainder
    // Inputs show 3 decimals, so a saved 1298.624998 still counts as unchanged.
    || (decision !== 'none' && payloadLines.some(p => Math.abs((r.lines.find(x => x.deliveryLineId === p.deliveryLineId)?.receivedQty ?? -1) - p.receivedQty) > 0.0005));
  const problem = !decision ? 'Chọn hàng về đủ, thiếu/dư hay không về.'
    : decision !== 'none' && !arrival ? 'Nhập ngày hàng về thực tế.'
    : decision !== 'none' && arrival > today() ? 'Ngày hàng về không được sau hôm nay.'
    : badLine ? 'Nhập SL thực nhận hợp lệ cho mọi dòng.'
    : belowStocked ? 'SL thực nhận không được thấp hơn số kho đã nhập.'
    : needReason && !reason.trim() ? 'Nhập lý do lệch / không về.' : null;

  const docName = `${item.poNumber || 'PO'} · Đợt ${item.deliveryNo ?? '?'}`;
  const otherSide: ReconSide = side === 'buyer' ? 'keeper' : 'buyer';
  // Tóm tắt nội dung để người bấm biết mình đang xác nhận cái gì.
  const summary = !decision ? '' : decision === 'none' ? `Không về — ${reason.trim() || 'chưa có lý do'}`
    : `${RECON_DECISION_LABELS[decision]}, về ngày ${dateVi(arrival)}, giá trị ${money(gross)} đ (gồm VAT)`
      + (canDecideRemainder ? (effectiveRemainder === 'close' ? '; chốt thiếu phần còn lại' : '; phần còn lại chờ NCC giao tiếp') : '');

  const run = async (key: string, fn: () => Promise<ReconItem>, done: [string, string]) => {
    setBusy(key);
    try { onChange(await fn()); toast.success(done[0], done[1]); }
    catch (error) {
      const code = (error as { code?: string }).code;
      toast.error(`Chưa thực hiện được — ${docName}`, (error as Error).message);
      if (code === 'RECEIPT_RECON_REVISION_CONFLICT' || code === 'RECEIPT_RECON_BATCH_CLOSED' || code === 'RECEIPT_RECON_NOT_FOUND') onStale();
    } finally { setBusy(null); }
  };
  const save = async () => {
    const ok = await confirm({ title: `Lưu & xác nhận phía ${SIDE_LABEL[side]}?`, confirmText: 'Xác nhận đối chiếu', targetName: docName,
      warningText: `${summary}.${r ? ' Nội dung đã đổi nên xác nhận cũ của cả hai phía sẽ mất hiệu lực.' : ''} Sau đó chờ ${SIDE_LABEL[otherSide]} xác nhận.`,
      actionLabel: 'Lưu & xác nhận', cancelLabel: 'Xem lại', intent: 'success', countdownSeconds: 0 });
    if (!ok) return;
    void run('save', () => receiptReconciliationService.save({
      deliveryBatchId: item.deliveryBatchId, expectedRevision: r?.revision ?? null, decision: decision!, remainder: effectiveRemainder,
      arrivalDate: decision === 'none' ? null : arrival, reason: reason.trim(), lines: payloadLines, confirmAs: side,
    }), [`Đã lưu và xác nhận phía ${SIDE_LABEL[side]}`, `${docName}: ${summary}. Đang chờ ${SIDE_LABEL[otherSide]} xác nhận.`]);
  };
  const confirmSide = async () => {
    const ok = await confirm({ title: `Xác nhận phía ${SIDE_LABEL[side]}?`, confirmText: 'Đồng ý đối chiếu', targetName: docName,
      warningText: `${summary}.${(side === 'buyer' ? r?.keeper : r?.buyer) ? ' Đủ 2 xác nhận — thủ kho có thể ghi sổ ngay.' : ''}`,
      actionLabel: 'Xác nhận', cancelLabel: 'Xem lại', intent: 'success', countdownSeconds: 0 });
    if (!ok) return;
    void run('confirm', () => receiptReconciliationService.confirm({ reconciliationId: r!.id, side, revision: r!.revision }),
      [`Đã xác nhận phía ${SIDE_LABEL[side]}`, `${docName}${(side === 'buyer' ? r?.keeper : r?.buyer) ? ' đủ 2 xác nhận, chờ thủ kho ghi sổ.' : ` — chờ ${SIDE_LABEL[otherSide]} xác nhận.`}`]);
  };
  const revoke = async () => {
    const ok = await confirm({ title: 'Bỏ xác nhận?', confirmText: 'Bỏ xác nhận của bạn cho', targetName: docName,
      warningText: 'Đợt này sẽ quay lại chờ bạn xác nhận. Nội dung đối chiếu giữ nguyên.', actionLabel: 'Bỏ xác nhận', intent: 'warning', countdownSeconds: 0 });
    if (!ok) return;
    void run('revoke', () => receiptReconciliationService.confirm({ reconciliationId: r!.id, side, revision: r!.revision, revoke: true }),
      ['Đã bỏ xác nhận', `${docName} quay lại chờ ${SIDE_LABEL[side]} xác nhận.`]);
  };
  const reject = async () => {
    const reasonText = await reasonConfirm({ title: `Từ chối đối chiếu?`, targetName: docName,
      subtitle: `${SIDE_LABEL[otherSide]} đã xác nhận: ${summary}.`,
      warningText: `Xác nhận của ${SIDE_LABEL[otherSide]} sẽ bị gỡ; họ sẽ thấy lý do để sửa lại.`,
      reasonLabel: 'Lý do từ chối', reasonPlaceholder: 'VD: biên bản giao ghi ngày 31/07, SL thép D8 thực nhận 4.200 kg…',
      actionLabel: 'Từ chối', intent: 'danger' });
    if (!reasonText) return;
    void run('reject', () => receiptReconciliationService.reject({ reconciliationId: r!.id, side, revision: r!.revision, reason: reasonText }),
      ['Đã từ chối', `${docName} trả về ${SIDE_LABEL[otherSide]} kèm lý do: ${reasonText}`]);
  };
  const post = async () => {
    if (!r) return;
    const warning = r.decision === 'none'
      ? 'Đợt giao và phiếu kho sẽ bị hủy. Không ảnh hưởng tồn kho.'
      : `Nhập kho ngày ${dateVi(r.arrivalDate)}${item.stocked ? ' (chỉ phần kho chưa ghi)' : ''}; công nợ NCC ${money(gross)} đ ghi ngày ${dateVi(r.arrivalDate)}.`;
    const ok = await confirm({ title: 'Ghi sổ đối chiếu?', confirmText: 'Ghi sổ đợt giao', targetName: docName,
      warningText: warning + (r.remainder === 'close' ? ' PO sẽ chốt thiếu, phần còn lại về Cần mua.' : '') + ' Không hoàn tác được.', actionLabel: 'Ghi sổ', intent: 'success' });
    if (ok) void run('post', () => receiptReconciliationService.post({ reconciliationId: r.id, revision: r.revision }),
      ['Đã ghi sổ', r.decision === 'none' ? `${docName}: đã hủy đợt giao và phiếu kho.` : `${docName}: đã nhập kho và ghi công nợ ${money(gross)} đ ngày ${dateVi(r.arrivalDate)}. Xem lại ở mục "Đã ghi sổ".`]);
  };

  const mySig = r ? r[side] : null;
  const iSigned = !!mySig && !!currentUserId && mySig.id === currentUserId;
  const canConfirmMine = side === 'buyer' ? item.can.confirmBuyer : item.can.confirmKeeper;
  const canRejectMine = side === 'buyer' ? item.can.rejectBuyer : item.can.rejectKeeper;
  const locked = posted || !item.can.edit;

  return <div className="space-y-4 border-t border-border px-4 py-4">
    {r?.rejection && !posted && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
      <XCircle size={18} className="mt-0.5 shrink-0 text-rose-600" />
      <div><p className="font-semibold">{SIDE_LABEL[r.rejection.side]} <span className={ENT}>{r.rejection.byName}</span> từ chối lúc {new Date(r.rejection.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</p>
        <p>Lý do: {r.rejection.reason}</p>
        <p className="text-xs text-rose-700 dark:text-rose-300">Sửa lại nội dung rồi "Lưu & xác nhận", hoặc xác nhận lại nếu vẫn giữ nguyên.</p></div>
    </div>}
    {item.checked && !posted && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <span className={ENT}>{item.checked.byName}</span> đã kiểm SL/CL ngày {dateVi(item.checked.at)} nhưng chưa nhập kho — SL đã kiểm được điền sẵn.</p>}
    {item.stocked && !posted && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      Kho đã nhập phiếu này nhưng PO và công nợ chưa ghi nhận. Ghi sổ sẽ không nhập kho lại — chỉ nhập bổ sung phần kho chưa ghi (nếu có).</p>}

    {!locked && <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Hàng về thế nào">
      {(['full', 'partial', 'none'] as ReconDecision[]).map(k => {
        const Icon = k === 'full' ? PackageCheck : k === 'partial' ? Scale : PackageX;
        const disabled = k === 'none' && item.stocked;
        return <button key={k} type="button" role="radio" aria-checked={decision === k} disabled={disabled} onClick={() => setDecision(k)}
          title={disabled ? 'Kho đã nhập phiếu này — không chọn Không về' : undefined}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${decision === k
            ? k === 'none' ? 'border-slate-400 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100' : 'border-leaf-500 bg-leaf-50 text-leaf-800 dark:bg-leaf-900/30 dark:text-leaf-100'
            : 'border-border text-muted-foreground hover:bg-muted'}`}><Icon size={16} />{RECON_DECISION_LABELS[k]}</button>;
      })}
    </div>}

    {(decision || posted) && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        {decision !== 'none' ? <>
          <table className="hidden w-full text-sm sm:table">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-semibold">Vật tư</th><th className="px-2 font-semibold">ĐVT</th>
              <th className="px-2 text-right font-semibold">SL đợt</th>
              {item.lines.some(l => l.checkedQty != null) && <th className="px-2 text-right font-semibold">Đã kiểm</th>}
              {item.stocked && <th className="px-2 text-right font-semibold">Kho đã nhập</th>}
              <th className="px-2 text-right font-semibold">SL thực nhận</th><th className="pl-2 text-right font-semibold">Chênh</th>
            </tr></thead>
            <tbody className="divide-y divide-border">{rows.map(l => {
              const diff = Number.isFinite(l.got) ? l.got - l.plannedQty : 0;
              return <tr key={l.deliveryLineId}>
                <td className="py-1.5 pr-2"><span className={ENT}>{l.name}</span>{l.specification && <span className="block text-xs text-muted-foreground">{l.specification}</span>}</td><td className="px-2 text-muted-foreground">{l.unit}</td>
                <td className={`px-2 text-right ${NUM}`}>{fmt(l.plannedQty, 3)}</td>
                {item.lines.some(x => x.checkedQty != null) && <td className="px-2 text-right tabular-nums text-muted-foreground">{l.checkedQty != null ? fmt(l.checkedQty, 3) : ''}</td>}
                {item.stocked && <td className="px-2 text-right tabular-nums text-muted-foreground">{fmt(l.stockedQty ?? 0, 3)}</td>}
                <td className="px-2 py-1 text-right">{decision === 'partial' && !locked
                  ? <input inputMode="decimal" value={qty[l.deliveryLineId] ?? ''} aria-label={`SL thực nhận ${l.name}${l.specification ? ` ${l.specification}` : ''}`}
                    onChange={e => setQty(q => ({ ...q, [l.deliveryLineId]: e.target.value }))}
                    className={`${inputCls} w-28 text-right tabular-nums ${diff < 0 ? 'border-amber-300' : ''}`} />
                  : <span className={NUM}>{fmt(l.got, 3)}</span>}</td>
                <td className={`pl-2 text-right tabular-nums ${diff < -0.000001 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{Math.abs(diff) > 0.000001 ? `${diff > 0 ? '+' : ''}${fmt(diff, 3)}` : ''}</td>
              </tr>;
            })}</tbody>
          </table>
          <ul className="divide-y divide-border sm:hidden">{rows.map(l => {
            const diff = Number.isFinite(l.got) ? l.got - l.plannedQty : 0;
            return <li key={l.deliveryLineId} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1"><p className={ENT}>{l.name}</p>{l.specification && <p className="text-xs text-muted-foreground">{l.specification}</p>}
                <p className="text-xs text-muted-foreground">Đợt <span className={NUM}>{fmt(l.plannedQty, 3)}</span> {l.unit}
                  {l.checkedQty != null && <> · đã kiểm {fmt(l.checkedQty, 3)}</>}{item.stocked && <> · kho đã nhập {fmt(l.stockedQty ?? 0, 3)}</>}</p>
                {diff < -0.000001 && <p className="text-xs text-amber-700 dark:text-amber-300">Thiếu {fmt(-diff, 3)} {l.unit}</p>}</div>
              {decision === 'partial' && !locked
                ? <input inputMode="decimal" value={qty[l.deliveryLineId] ?? ''} aria-label={`SL thực nhận ${l.name}${l.specification ? ` ${l.specification}` : ''}`}
                  onChange={e => setQty(q => ({ ...q, [l.deliveryLineId]: e.target.value }))} className={`${inputCls} w-28 text-right tabular-nums`} />
                : <span className={NUM}>{fmt(l.got, 3)}</span>}
            </li>;
          })}</ul>
          {decision === 'partial' && !locked && item.lines.some(l => l.checkedQty != null) && <button type="button" className="mt-1 text-xs font-semibold text-mint-700 hover:underline dark:text-mint-300"
            onClick={() => setQty(Object.fromEntries(item.lines.map(l => [l.deliveryLineId, formatQuantityInput(round3(l.checkedQty ?? l.plannedQty))])))}>Lấy theo SL thủ kho đã kiểm</button>}
          <p className="mt-2 text-right text-sm">Giá trị thực nhận (gồm VAT) <span className={`text-base ${NUM}`}>{money(gross)} đ</span></p>
        </> : <p className="rounded-lg bg-muted/60 px-3 py-3 text-sm text-muted-foreground">Đợt giao và phiếu kho sẽ bị hủy khi ghi sổ; phần chưa giao mở lại cho PO. Không ảnh hưởng tồn kho.</p>}
      </div>

      <aside className="space-y-3 text-sm">
        {decision !== 'none' && <label className="block"><span className="text-xs font-semibold text-muted-foreground">Ngày hàng về thực tế *</span>
          <input type="date" value={arrival} max={today()} disabled={locked} onChange={e => setArrival(e.target.value)} className={`${inputCls} mt-1 w-full`} />
          {arrivalBeforeOrder && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Trước ngày đặt PO ({dateVi(item.orderDate)}) — kiểm tra lại.</span>}
          {!locked && backdateHint(arrival) && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">{backdateHint(arrival)}</span>}</label>}
        {(needReason || reason) && <label className="block"><span className="text-xs font-semibold text-muted-foreground">Lý do {needReason ? '*' : ''}</span>
          {!locked && decision && decision !== 'full' && <span className="mt-1 flex flex-wrap gap-1">{REASONS[decision].map(x =>
            <button key={x} type="button" onClick={() => setReason(x)} className="rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted">{x}</button>)}</span>}
          <textarea rows={2} value={reason} disabled={locked} onChange={e => setReason(e.target.value)} className={`${inputCls} mt-1 w-full resize-none`} /></label>}
        {canDecideRemainder && !posted ? <fieldset className="space-y-1.5">
          <legend className="text-xs font-semibold text-muted-foreground">Phần PO chưa giao</legend>
          {item.poUnscheduled.length > 0 && <p className="text-xs text-muted-foreground">Ngoài đợt này PO còn: {item.poUnscheduled.map((u, i) =>
            <span key={i}>{i > 0 && ', '}<span className={ENT}>{u.name}</span>{u.specification && <span> ({u.specification})</span>} <span className={NUM}>{fmt(u.qty, 3)}</span> {u.unit}</span>)}</p>}
          {([['keep_open', 'Chờ NCC giao tiếp — PO vẫn mở'], ['close', 'Chốt thiếu — đóng PO, phần còn lại về Cần mua']] as const).map(([k, l]) =>
            <label key={k} className="flex items-start gap-2 text-sm"><input type="radio" name={`rem-${item.deliveryBatchId}`} checked={remainder === k} disabled={locked}
              onChange={() => setRemainder(k)} className="mt-1 accent-leaf-600" />{l}</label>)}
        </fieldset> : shortfall && item.otherOpenDeliveries > 0 && !posted
          ? <p className="text-xs text-muted-foreground">PO còn {item.otherOpenDeliveries} đợt giao khác đang mở — quyết định phần còn thiếu ở đợt cuối.</p> : null}

        <div className="grid grid-cols-2 gap-2">
          {(['buyer', 'keeper'] as ReconSide[]).map(s => {
            const sig = r?.[s];
            return <div key={s} className={`rounded-xl border px-2.5 py-2 ${sig ? 'border-leaf-300 bg-leaf-50 dark:border-leaf-800 dark:bg-leaf-900/30' : 'border-dashed border-border'}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{SIDE_LABEL[s]}</p>
              {sig ? <p className="text-xs"><CheckCircle2 size={12} className="mr-1 inline text-leaf-600" /><span className={ENT}>{sig.name}</span><br />
                <span className="text-muted-foreground">{new Date(sig.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</span></p>
                : <p className="text-xs text-muted-foreground">Chờ xác nhận</p>}
            </div>;
          })}
        </div>
      </aside>
    </div>}

    {posted && r && <div className="rounded-xl border border-leaf-200 bg-leaf-50 px-3 py-2 text-sm text-leaf-900 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-100">
      <ShieldCheck size={15} className="mr-1 inline" />Đã ghi sổ bởi <span className={ENT}>{r.postedByName}</span> lúc {r.postedAt && new Date(r.postedAt).toLocaleString('vi-VN')}.
      {r.decision !== 'none' && <> Nhập kho và công nợ ngày {dateVi(r.arrivalDate)}{r.result?.acceptedGross != null && <>, giá trị <span className={NUM}>{money(r.result.acceptedGross)} đ</span></>}.</>}
      {r.result?.closedShort && <> PO đã chốt thiếu.</>}
    </div>}

    {r && r.events.length > 0 && <div>
      <button type="button" onClick={() => setShowHistory(v => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <History size={14} />Lịch sử ({r.events.length}){showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
      {showHistory && <ol className="mt-2 space-y-1 border-l-2 border-mint-200 pl-3 text-xs dark:border-mint-900">
        {r.events.map((e, i) => <li key={i}><span className="font-semibold">{RECON_EVENT_LABELS[e.action] || e.action}</span> — <span className={ENT}>{e.actorName || 'Hệ thống'}</span>
          <span className="text-muted-foreground"> · {new Date(e.at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })} · bản {e.revision}</span>
          {e.action === 'save' && e.before && e.after && <span className="block text-muted-foreground">{describeChange(e.before, e.after)}</span>}
          {e.note && <span className="block text-rose-700 dark:text-rose-300">Lý do: {e.note}</span>}</li>)}
      </ol>}
    </div>}

    {!posted && item.open && (item.can.edit || item.can.post) && <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <p className={`mr-auto text-xs ${problem && dirty ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
        {dirty ? problem || `Lưu sẽ xác nhận phía ${SIDE_LABEL[side]}; phía còn lại xác nhận sau.`
          : item.can.post ? 'Đủ 2 xác nhận. Ghi sổ để nhập kho và ghi công nợ.'
          : r && !canConfirmMine ? `Đã xác nhận phía ${SIDE_LABEL[side]}. Chờ phía còn lại.` : 'Kiểm tra rồi xác nhận.'}</p>
      {bothRoles && item.can.edit && <select value={side} onChange={e => setSide(e.target.value as ReconSide)} aria-label="Xác nhận với vai trò" className={inputCls}>
        <option value="buyer">Vai trò: Mua hàng</option><option value="keeper">Vai trò: Thủ kho</option></select>}
      {iSigned && !dirty && <button type="button" onClick={() => void revoke()} disabled={!!busy} className={secondaryBtn}>
        {busy === 'revoke' ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}Bỏ xác nhận</button>}
      {item.can.edit && dirty && <button type="button" onClick={() => void save()} disabled={!!busy || !!problem} className={item.can.post ? secondaryBtn : primaryBtn}>
        {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Lưu & xác nhận ({SIDE_LABEL[side]})</button>}
      {!dirty && r && canRejectMine && <button type="button" onClick={() => void reject()} disabled={!!busy}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40">
        {busy === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}Từ chối</button>}
      {!dirty && r && canConfirmMine && <button type="button" onClick={() => void confirmSide()} disabled={!!busy} className={primaryBtn}>
        {busy === 'confirm' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Xác nhận ({SIDE_LABEL[side]})</button>}
      {!dirty && item.can.post && <button type="button" onClick={() => void post()} disabled={!!busy} className={primaryBtn}>
        {busy === 'post' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Ghi sổ</button>}
    </footer>}
  </div>;
};

const describeChange = (before: Record<string, unknown>, after: Record<string, unknown>) => {
  const parts: string[] = [];
  if (before.decision !== after.decision) parts.push(`${RECON_DECISION_LABELS[before.decision as ReconDecision] || '—'} → ${RECON_DECISION_LABELS[after.decision as ReconDecision] || '—'}`);
  if (before.arrivalDate !== after.arrivalDate) parts.push(`ngày về ${dateVi(before.arrivalDate as string) || '—'} → ${dateVi(after.arrivalDate as string) || '—'}`);
  if (JSON.stringify(before.lines) !== JSON.stringify(after.lines)) parts.push('đổi SL thực nhận');
  if (before.remainder !== after.remainder) parts.push(after.remainder === 'close' ? 'chuyển sang chốt thiếu' : 'chuyển sang chờ giao tiếp');
  if ((before.reason || '') !== (after.reason || '')) parts.push(`lý do: ${after.reason || '—'}`);
  return parts.join('; ');
};
