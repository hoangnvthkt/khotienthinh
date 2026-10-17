import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpFromLine, BarChart3, CheckCircle2, Loader2, ClipboardList, FileText, Inbox, PackagePlus, Paperclip, Plus, RefreshCw, Search, Settings, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Badge, StateBox, money, primaryBtn, secondaryBtn } from '../../components/procurement/hub/hubUi';
import { ENT, NUM } from '../../components/finance/financeUi';
import { EmptyPanel, Split, dateVi } from '../../components/wms/wmsUi';
import { VppDetailPanel, VppStatusBadge } from '../../components/vpp/VppDetailPanel';
import { VppRequestForm } from '../../components/vpp/VppRequestForm';
import { VppReceiveForm } from '../../components/vpp/VppReceiveForm';
import { VppSettingsView } from '../../components/vpp/VppSettingsView';
import { VppReportView } from '../../components/vpp/VppReportView';
import {
  VPP_OPEN, officeSupplyService, vppErrorMessage,
  type VppDetail, type VppHome, type VppList, type VppReceipt, type VppView,
} from '../../lib/officeSupplyService';
import { foldVi } from '../../lib/wmsCatalogService';

// Văn phòng phẩm: mọi nhân viên đề xuất; trưởng phòng duyệt (duyệt thay, vượt ngưỡng); thủ kho cấp phát, nhập kho; quản trị thiết lập.

type Tab = VppView | 'receipts' | 'report' | 'settings';
const TAB_ICON: Record<Tab, React.ElementType> = { mine: Inbox, approve: ShieldCheck, issue: ArrowUpFromLine, all: ClipboardList, receipts: PackagePlus, report: BarChart3, settings: Settings };
const TAB_LABEL: Record<Tab, string> = { mine: 'Của tôi', approve: 'Chờ duyệt', issue: 'Cấp phát', all: 'Tất cả', receipts: 'Nhập kho', report: 'Báo cáo', settings: 'Thiết lập' };

const OfficeSupplies: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [home, setHome] = useState<VppHome | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  // Mở thẳng báo cáo từ Tài chính: #/vpp?tab=report&m=YYYY-MM.
  const [entry] = useState(() => { const sp = new URLSearchParams(location.search); return { report: sp.get('tab') === 'report', month: sp.get('m') }; });
  const [tab, setTab] = useState<Tab>(entry.report ? 'report' : 'mine');
  const [list, setList] = useState<VppList | null>(null);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [receipts, setReceipts] = useState<VppReceipt[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VppDetail | null>(null);
  const [form, setForm] = useState<'new' | 'edit' | 'receive' | null>(null);
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const loadHome = useCallback(async () => {
    try { setHome(await officeSupplyService.home()); setState('ready'); }
    catch (e) { setMessage(vppErrorMessage(e, 'Chưa tải được Văn phòng phẩm.')); setState('error'); }
  }, []);
  const loadList = useCallback(async (view: Tab) => {
    if (view === 'settings' || view === 'report') return;
    if (view === 'receipts') { officeSupplyService.receipts().then(setReceipts).catch(() => setReceipts([])); return; }
    setListState(s => s === 'ready' ? s : 'loading');
    try { setList(await officeSupplyService.list(view)); setListState('ready'); }
    catch (e) { setMessage(vppErrorMessage(e)); setListState('error'); }
  }, []);
  useEffect(() => { void loadHome(); }, [loadHome]);
  useEffect(() => { void loadList(tab); }, [loadList, tab]);

  // Mở đúng phiếu từ thông báo (#/vpp?r=…). Người duyệt / thủ kho mở thẳng tab việc của mình.
  useEffect(() => {
    const r = new URLSearchParams(location.search).get('r');
    if (r) setSelId(r);
  }, [location.search]);
  useEffect(() => {
    if (!selId) { setDetail(null); return; }
    let live = true;
    officeSupplyService.get(selId).then(d => { if (live) setDetail(d); }).catch(() => { if (live) { setDetail(null); setSelId(null); } });
    return () => { live = false; };
  }, [selId]);

  const can = home?.can;
  const tabs = useMemo<Tab[]>(() => !can ? ['mine'] : ([
    'mine', can.approve && 'approve', can.keeper && 'issue', (can.report || can.manage || can.keeper) && 'all',
    (can.keeper || can.report) && 'receipts', (can.report || can.manage || can.keeper || entry.report) && 'report', can.manage && 'settings',
  ].filter(Boolean) as Tab[]), [can, entry.report]);
  // Lần đầu: người có việc chờ mở thẳng tab đó.
  const [autoTab, setAutoTab] = useState(false);
  useEffect(() => {
    if (autoTab || !list || tab !== 'mine') return;
    setAutoTab(true);
    if (can?.keeper && list.counts.issue > 0) setTab('issue');
    else if (can?.approve && list.counts.approve > 0) setTab('approve');
  }, [autoTab, list, tab, can]);

  const refresh = () => { void loadHome(); void loadList(tab); if (selId) officeSupplyService.get(selId).then(setDetail).catch(() => undefined); };
  const onChanged = (d: VppDetail | null) => { setDetail(d); void loadList(tab); void loadHome(); };
  const select = (id: string | null) => { setSelId(id); if (!id && location.search) navigate('/vpp', { replace: true }); };

  const fq = foldVi(q.trim());
  const open = tab === 'approve' ? ['pending', 'pending_threshold'] : tab === 'issue' ? ['approved', 'partial'] : VPP_OPEN;
  const rows = (list?.rows || []).filter(r => (!openOnly || tab === 'mine' || open.includes(r.status))
    && (!fq || foldVi([r.code, r.requesterName, r.orgUnitName, r.summary, r.note].filter(Boolean).join(' ')).includes(fq)));
  const count = (t: Tab) => t === 'mine' ? list?.counts.mine : t === 'approve' ? list?.counts.approve : t === 'issue' ? list?.counts.issue : undefined;

  if (state === 'loading') return <div className="p-4"><StateBox kind="loading" /></div>;
  if (state === 'error' || !home) return <div className="p-4"><StateBox kind="error" message={message} onRetry={loadHome} /></div>;

  const listView = <div className="space-y-2">
    {tab !== 'mine' && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
      <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã, người, phòng, món" aria-label="Tìm phiếu" className="w-full bg-transparent py-1.5 text-sm outline-none" /></label>
      <div className="flex rounded-lg border border-border p-0.5 text-[13px]">
        {[true, false].map(v => <button key={String(v)} type="button" onClick={() => setOpenOnly(v)} aria-pressed={openOnly === v}
          className={`rounded-md px-2.5 py-1 font-semibold ${openOnly === v ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{v ? 'Đang mở' : 'Tất cả'}</button>)}
      </div>
    </div>}
    {listState === 'loading' && !list ? <StateBox kind="loading" />
      : listState === 'error' ? <StateBox kind="error" message={message} onRetry={() => loadList(tab)} />
      : rows.length === 0 ? <StateBox kind="empty" title={tab === 'mine' ? 'Chưa có đề xuất nào' : tab === 'approve' ? 'Không có phiếu chờ bạn duyệt' : tab === 'issue' ? 'Không có phiếu chờ cấp' : 'Không có phiếu khớp'} />
      : <ul className="space-y-2">{rows.map(r => <li key={r.id}>
        <button type="button" onClick={() => select(r.id)} aria-current={selId === r.id}
          className={`w-full rounded-2xl border bg-card px-3 py-2.5 text-left shadow-sm transition ${selId === r.id ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'} ${r.myTurn ? 'border-l-4 border-l-amber-400' : ''}`}>
          <span className="flex flex-wrap items-center gap-2"><span className={`font-mono text-[13px] ${ENT}`}>{r.code}</span><VppStatusBadge status={r.status} />
            {r.thresholdRequired && <Badge className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Vượt ngưỡng</Badge>}
            <span className="ml-auto text-[12px] text-muted-foreground">{dateVi(r.submittedAt)}</span></span>
          {tab !== 'mine' && <span className="mt-0.5 block text-sm"><span className={ENT}>{r.requesterName}</span>{r.orgUnitName && <span className="text-muted-foreground"> · {r.orgUnitName}</span>}</span>}
          <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{r.summary || '—'}</span>
          {(r.status === 'pending' || r.status === 'pending_threshold') && tab === 'mine' && <span className="mt-0.5 block text-[12px] text-muted-foreground">
            {r.approverName ? `Chờ ${r.approverName}` : 'Chưa có người duyệt'}</span>}
          {tab !== 'mine' && r.estimatedAmount != null && r.estimatedAmount > 0 && <span className="mt-0.5 block text-[12px]">≈ <b className={NUM}>{money(r.estimatedAmount)}</b> đ</span>}
        </button></li>)}</ul>}
  </div>;

  return <div className="mx-auto max-w-[1400px] space-y-3 p-3 md:p-4">
    <header className="flex flex-wrap items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-700 text-white"><Paperclip size={22} /></span>
      <div className="min-w-0 flex-1"><h1 className="text-xl font-bold md:text-2xl">Văn phòng phẩm</h1>
        <p className="text-[13px] text-muted-foreground">{home.warehouseName || 'Chưa thiết lập kho VPP'}</p></div>
      <div className="flex w-full gap-2 md:w-auto">
        <button type="button" onClick={refresh} aria-label="Làm mới" className={secondaryBtn}><RefreshCw size={15} /></button>
        {can?.keeper && <button type="button" onClick={() => setForm('receive')} className={`${secondaryBtn} flex-1 md:flex-none`}><PackagePlus size={15} />Nhập kho</button>}
        <button type="button" onClick={() => setForm('new')} disabled={!home.warehouseId} title={!home.warehouseId ? 'Chưa thiết lập kho VPP' : undefined}
          className={`${primaryBtn} flex-1 md:flex-none`}><Plus size={16} />Đề xuất VPP</button>
      </div>
    </header>

    {tabs.length > 1 && <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {tabs.map(t => { const Icon = TAB_ICON[t]; const n = count(t); return <button key={t} type="button" onClick={() => { setTab(t); select(null); }} aria-pressed={tab === t}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
        <Icon size={15} />{TAB_LABEL[t]}{n ? <span className={`rounded-full px-1.5 text-[11px] ${tab === t ? 'bg-white/25' : t === 'mine' ? 'bg-muted' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{n}</span> : null}</button>; })}
    </nav>}

    {tab === 'settings' ? <VppSettingsView />
      : tab === 'report' ? <VppReportView initialMonth={entry.month} />
      : tab === 'receipts' ? <ReceiptList receipts={receipts} canAttach={!!can?.keeper} actorUserId={home.me.id} onChanged={() => loadList('receipts')} />
      : <Split open={!!selId} selKey={selId} list={listView}
        detail={detail ? <VppDetailPanel detail={detail} catalog={home.catalog} onBack={() => select(null)} onChanged={onChanged} onEdit={() => setForm('edit')} />
          : selId ? <StateBox kind="loading" />
          : <EmptyPanel icon={tab === 'issue' ? ArrowUpFromLine : tab === 'approve' ? CheckCircle2 : FileText} title="Chọn một phiếu" text={tab === 'mine' ? 'Hoặc bấm Đề xuất VPP' : ''} />} />}

    {form === 'new' && <VppRequestForm home={home} onClose={() => setForm(null)} onSaved={d => { setForm(null); setTab('mine'); select(d.id); setDetail(d); void loadList('mine'); }} />}
    {form === 'edit' && detail && <VppRequestForm home={home} editing={detail} onClose={() => setForm(null)} onSaved={d => { setForm(null); onChanged(d); }} />}
    {form === 'receive' && <VppReceiveForm home={home} actorUserId={home.me.id} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTab('receipts'); void loadHome(); void loadList('receipts'); }} />}
  </div>;
};

const ReceiptList: React.FC<{ receipts: VppReceipt[] | null; canAttach: boolean; actorUserId: string; onChanged: () => void }> = ({ receipts, canAttach, actorUserId, onChanged }) => {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const attach = async (transactionId: string, files: File[]) => {
    if (!files.length) return;
    setBusy(transactionId);
    try { await officeSupplyService.attachReceiptFiles(transactionId, files, actorUserId); toast.success('Đã thêm ảnh hóa đơn'); onChanged(); }
    catch (e) { toast.error('Chưa thêm được ảnh', vppErrorMessage(e)); }
    finally { setBusy(null); }
  };
  if (!receipts) return <StateBox kind="loading" />;
  if (!receipts.length) return <StateBox kind="empty" title="Chưa có phiếu nhập VPP" />;
  return <ul className="space-y-2">{receipts.map(r => <li key={r.transactionId} className="rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <a href={`#/inventory?tx=${r.transactionId}`} className={`font-mono text-[13px] ${ENT} hover:underline`}>{r.code || r.transactionId.slice(-8)}</a>
      <span className="text-sm">{r.supplierName || 'Không ghi nơi mua'}{r.invoiceNo ? ` · HĐ ${r.invoiceNo}` : ''}</span>
      {r.attachments === 0 && <Badge className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Thiếu ảnh hóa đơn</Badge>}
      {r.attachments === 0 && canAttach && <label className="cursor-pointer text-[13px] font-semibold text-teal-700 dark:text-teal-300">
        {busy === r.transactionId ? <Loader2 size={14} className="inline animate-spin" /> : 'Thêm ảnh'}
        <input type="file" accept="image/*,application/pdf" multiple className="hidden" disabled={!!busy}
          onChange={e => { const f = Array.from(e.target.files || []); e.target.value = ''; void attach(r.transactionId, f); }} /></label>}
      <span className="ml-auto text-sm"><b className={NUM}>{money(r.amount)}</b> đ</span>
    </div>
    <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{dateVi(r.date)} · {r.byName} · {r.lines.map(l => `${l.name} ×${l.qty}`).join(', ')}</p>
  </li>)}</ul>;
};

export default OfficeSupplies;
