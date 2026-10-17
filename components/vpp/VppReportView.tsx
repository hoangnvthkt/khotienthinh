import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ChevronDown, ChevronLeft, ChevronRight, FileSpreadsheet, Landmark, Loader2, PackageCheck, Search, Undo2 } from 'lucide-react';
import { Badge, StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM } from '../finance/financeUi';
import { BAD, GREY, OK, Tile, WARN, fmtQty } from '../wms/wmsUi';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { isVppConflict, officeSupplyService, vppErrorMessage, type VppPosting, type VppReport } from '../../lib/officeSupplyService';
import { currentMonth, exportVppReport, monthLabel, shiftMonth, xntActive } from '../../lib/officeSupplyReport';
import { foldVi } from '../../lib/wmsCatalogService';

// Báo cáo VPP tháng: Nhập–Xuất–Tồn (mẫu XNT thủ kho), theo người, theo phòng ban, xuất Excel; kế toán chốt chi phí sang Tài chính.

type View = 'xnt' | 'people' | 'dept';
const th = 'whitespace-nowrap px-2 py-2 text-right font-semibold';
const td = 'whitespace-nowrap px-2 py-2 text-right tabular-nums';
const vnd = (n: number) => `${money(n)} đ`;

export const VppReportView: React.FC<{ initialMonth?: string | null }> = ({ initialMonth }) => {
  const toast = useToast();
  const [month, setMonth] = useState(() => /^\d{4}-\d{2}$/.test(initialMonth || '') ? initialMonth! : currentMonth());
  const [report, setReport] = useState<VppReport | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [view, setView] = useState<View>('xnt');
  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (m: string) => {
    setState(s => s === 'ready' ? s : 'loading');
    try { setReport(await officeSupplyService.report(m)); setState('ready'); }
    catch (e) { setMessage(vppErrorMessage(e, 'Chưa tải được báo cáo.')); setState((e as { code?: string })?.code === '42501' ? 'denied' : 'error'); }
  }, []);
  useEffect(() => { void load(month); }, [load, month]);

  const now = currentMonth();
  const first = report?.firstMonth || null;
  const go = (delta: number) => { setOpen(null); setMonth(m => shiftMonth(m, delta)); };

  const doExport = async () => {
    if (!report) return;
    setExporting(true);
    try { await exportVppReport(report); }
    catch (e) { toast.error('Chưa xuất được Excel', vppErrorMessage(e)); }
    finally { setExporting(false); }
  };

  if (state === 'loading' && !report) return <StateBox kind="loading" />;
  if (state === 'denied') return <StateBox kind="denied" message={message} />;
  if (state === 'error' || !report) return <StateBox kind="error" message={message} onRetry={() => load(month)} />;

  const t = report.totals;
  const stale = report.month !== month;
  const fq = foldVi(q.trim());
  const xnt = report.xnt.filter(r => (!activeOnly || xntActive(r)) && (!fq || foldVi(`${r.sku} ${r.name} ${r.note || ''}`).includes(fq)));
  const people = report.people.filter(p => !fq || foldVi(`${p.name} ${p.orgUnitName}`).includes(fq));
  const depts = report.departments.filter(d => !fq || foldVi(d.name).includes(fq));

  return <div className={`space-y-3 ${stale ? 'opacity-60' : ''}`}>
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2">
      <div className="flex items-center rounded-lg border border-border">
        <button type="button" onClick={() => go(-1)} disabled={!!first && month <= first} aria-label="Tháng trước" className="rounded-l-lg p-2 hover:bg-muted disabled:opacity-40"><ChevronLeft size={16} /></button>
        <span className="min-w-[7.5rem] px-2 text-center text-sm font-semibold">Tháng {monthLabel(month)}</span>
        <button type="button" onClick={() => go(1)} disabled={month >= now} aria-label="Tháng sau" className="rounded-r-lg p-2 hover:bg-muted disabled:opacity-40"><ChevronRight size={16} /></button>
      </div>
      {stale && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
      <button type="button" onClick={doExport} disabled={exporting || stale} className={`${secondaryBtn} ml-auto`}>
        {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}Xuất Excel</button>
    </div>

    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <Tile active={false} onClick={() => setView('xnt')} icon={Boxes} label="Tồn đầu" value={vnd(t.openValue)} hint={report.warehouseName || ''} tone="text-foreground" ic="bg-slate-500" />
      <Tile active={false} onClick={() => setView('xnt')} icon={ArrowDownToLine} label="Nhập" value={vnd(t.inValue)} hint={!t.returned ? 'mua về' : t.returned >= t.inValue ? 'trả lại kho' : `gồm trả lại ${money(t.returned)} đ`} tone="text-sky-700 dark:text-sky-300" ic="bg-sky-600" />
      <Tile active={false} onClick={() => setView('dept')} icon={ArrowUpFromLine} label="Đã cấp" value={vnd(t.cost)} hint={`${t.issuedRequestCount} phiếu · ${t.requestCount} đề xuất`} tone="text-leaf-700 dark:text-leaf-300" ic="bg-leaf-600" />
      <Tile active={false} onClick={() => setView('xnt')} icon={PackageCheck} label="Tồn cuối" value={vnd(t.closeValue)} hint={`${report.xnt.filter(r => r.closeQty > 0).length} mã còn hàng`} tone="text-mint-700 dark:text-mint-300" ic="bg-mint-600" />
    </div>

    <CostPostingCard posting={report.posting} can={report.can} onChanged={() => load(month)} />

    <div className="flex flex-wrap items-center gap-2">
      <nav className="flex w-full rounded-xl border border-border bg-card p-1 text-sm sm:w-auto">
        {([['xnt', 'XNT', 'Nhập–Xuất–Tồn', null], ['people', 'Người', 'Theo người', report.people.length], ['dept', 'Phòng ban', 'Theo phòng ban', report.departments.length]] as const).map(([k, short, long, n]) =>
          <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold sm:flex-none ${view === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted'}`}>
            <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{long}</span>{n != null && ` · ${n}`}</button>)}
      </nav>
      <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2">
        <Search size={15} className="text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={view === 'xnt' ? 'Tìm mã, tên, người nhận' : view === 'people' ? 'Tìm người, phòng' : 'Tìm phòng ban'}
          aria-label="Tìm trong báo cáo" className="w-full bg-transparent py-1.5 text-sm outline-none" /></label>
      {view === 'xnt' && <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="h-4 w-4 accent-teal-700" />Ẩn mã không tồn, không phát sinh</label>}
    </div>

    {view === 'xnt' ? (xnt.length === 0 ? <StateBox kind="empty" title="Không có mã khớp" /> : <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-sm md:block">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>
            <th className="w-10 px-2 py-2 text-left font-semibold">STT</th><th className="px-2 py-2 text-left font-semibold">Mã</th><th className="px-2 py-2 text-left font-semibold">Tên vật tư</th>
            <th className="px-2 py-2 text-left font-semibold">ĐVT</th><th className={th}>Tồn đầu</th><th className={th}>Nhập</th><th className={th}>Xuất</th><th className={th}>Tồn cuối</th>
            <th className="px-2 py-2 text-left font-semibold">Ghi chú</th><th className={th}>Đơn giá</th><th className={th}>Thành tiền</th></tr></thead>
          <tbody className="divide-y divide-border">{xnt.map((r, i) => <tr key={r.itemId} className="hover:bg-muted/30">
            <td className="px-2 py-2 text-muted-foreground">{i + 1}</td><td className={`whitespace-nowrap px-2 py-2 font-mono text-[13px] ${ENT}`}>{r.sku || '—'}</td>
            <td className="min-w-[11rem] px-2 py-2">{r.name}</td><td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{r.unit}</td>
            <td className={td}>{fmtQty(r.openQty)}</td><td className={td}>{r.inQty ? fmtQty(r.inQty) : ''}</td><td className={td}>{r.outQty ? fmtQty(r.outQty) : ''}</td>
            <td className={`${td} font-semibold ${r.closeQty < 0 ? 'text-rose-600' : ''}`}>{fmtQty(r.closeQty)}</td>
            <td className="min-w-[10rem] max-w-[18rem] px-2 py-2 text-[13px] text-muted-foreground">{r.note}</td>
            <td className={td}>{money(r.unitPrice)}</td><td className={`${td} ${NUM}`}>{money(r.closeValue)}</td></tr>)}</tbody>
          <tfoot className="border-t-2 border-border bg-muted/30"><tr><td colSpan={10} className="px-2 py-2 text-right font-semibold">Cộng</td>
            <td className={`${td} ${NUM}`}>{money(xnt.reduce((s, r) => s + r.closeValue, 0))}</td></tr></tfoot>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">{xnt.map(r => <li key={r.itemId} className="rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
        <div className="flex items-baseline gap-2"><span className={`font-mono text-[12px] ${ENT}`}>{r.sku}</span><span className="min-w-0 flex-1 font-semibold">{r.name}</span>
          <span className={`text-sm ${NUM}`}>{money(r.closeValue)}</span></div>
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[12px]">
          {([['Đầu', r.openQty], ['Nhập', r.inQty], ['Xuất', r.outQty], ['Cuối', r.closeQty]] as const).map(([l, v]) =>
            <span key={l} className="rounded-lg bg-muted/60 py-1"><span className="block text-muted-foreground">{l}</span><b className="tabular-nums">{fmtQty(v)}</b></span>)}
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">{r.unit} · {money(r.unitPrice)} đ{r.note ? ` · ${r.note}` : ''}</p>
      </li>)}</ul>
    </>)

    : view === 'people' ? (people.length === 0 ? <StateBox kind="empty" title={report.people.length ? 'Không có người khớp' : 'Tháng này chưa có đề xuất / cấp phát'} />
      : <ul className="space-y-2">{people.map(p => { const isOpen = open === p.userId; return <li key={p.userId} className="rounded-2xl border border-border bg-card shadow-sm">
        <button type="button" onClick={() => setOpen(isOpen ? null : p.userId)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left">
          <span className="min-w-0 flex-1"><span className={`block ${ENT}`}>{p.name || '—'}</span><span className="block text-[12px] text-muted-foreground">{p.orgUnitName}</span></span>
          <span className="text-[12px] text-muted-foreground">{p.requestCount} phiếu · đề xuất {fmtQty(p.requestedQty)} · cấp {fmtQty(p.issuedQty)}</span>
          <span className={`w-28 text-right ${NUM}`}>{money(p.value)} đ</span>
          <ChevronDown size={16} className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && <div className="overflow-x-auto border-t border-border"><table className="w-full min-w-[30rem] text-[13px]">
          <thead className="text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-semibold">Món</th><th className="px-2 text-left font-semibold">ĐVT</th>
            <th className={th}>Đề xuất</th><th className={th}>Đã cấp</th><th className={`${th} pr-3`}>Giá trị</th></tr></thead>
          <tbody className="divide-y divide-border">{(p.items || []).map(it => <tr key={`${it.name}-${it.unit}`}>
            <td className="px-3 py-1.5">{it.name}</td><td className="px-2 text-muted-foreground">{it.unit}</td>
            <td className={td}>{it.requestedQty ? fmtQty(it.requestedQty) : ''}</td><td className={td}>{it.issuedQty ? fmtQty(it.issuedQty) : ''}</td>
            <td className={`${td} pr-3`}>{it.value ? money(it.value) : ''}</td></tr>)}</tbody></table></div>}
      </li>; })}</ul>)

    : (depts.length === 0 ? <StateBox kind="empty" title={report.departments.length ? 'Không có phòng khớp' : 'Tháng này chưa có đề xuất / cấp phát'} />
      : <>
      <ul className="space-y-2 md:hidden">{depts.map(d => <li key={d.orgUnitId || 'none'} className="rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
        <div className="flex items-baseline gap-2"><span className={`min-w-0 flex-1 ${d.orgUnitId ? ENT : 'font-semibold text-amber-700 dark:text-amber-300'}`}>{d.name}</span>
          <span className={NUM}>{money(d.value)} đ</span></div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{d.people} người · {d.requestCount} phiếu · đề xuất {fmtQty(d.requestedQty)} · cấp {fmtQty(d.issuedQty)}{d.returnedValue ? ` · trả lại ${money(d.returnedValue)} đ` : ''}</p>
      </li>)}</ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card shadow-sm md:block"><table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-semibold">Phòng ban</th><th className={th}>Người</th><th className={th}>Phiếu</th>
          <th className={th}>SL đề xuất</th><th className={th}>SL đã cấp</th><th className={th}>Trả lại</th><th className={`${th} pr-3`}>Chi phí</th></tr></thead>
        <tbody className="divide-y divide-border">{depts.map(d => <tr key={d.orgUnitId || 'none'}>
          <td className={`px-3 py-2 ${d.orgUnitId ? ENT : 'text-amber-700 dark:text-amber-300'}`}>{d.name}</td><td className={td}>{d.people}</td><td className={td}>{d.requestCount}</td>
          <td className={td}>{fmtQty(d.requestedQty)}</td><td className={td}>{fmtQty(d.issuedQty)}</td><td className={td}>{d.returnedValue ? money(d.returnedValue) : ''}</td>
          <td className={`${td} pr-3 ${NUM}`}>{money(d.value)}</td></tr>)}</tbody>
        <tfoot className="border-t-2 border-border bg-muted/30"><tr><td colSpan={6} className="px-3 py-2 text-right font-semibold">Cộng</td>
          <td className={`${td} pr-3 ${NUM}`}>{money(depts.reduce((s, d) => s + d.value, 0))}</td></tr></tfoot>
      </table></div></>)}
  </div>;
};

/** Chi phí VPP tháng sang Tài chính: chưa hết tháng / chưa chốt / đã chốt / phát sinh sau chốt. */
const CostPostingCard: React.FC<{ posting: VppPosting; can: VppReport['can']; onChanged: () => void }> = ({ posting: p, can, onChanged }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(false);
  const m = monthLabel(p.month);
  const locked = p.allocation && p.allocation.status !== 'draft' ? p.allocation : null;
  const diff = p.posted ? p.liveTotal - p.posted.total : 0;
  const nextMonthStart = `01/${monthLabel(shiftMonth(p.month, 1))}`;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onChanged(); }
    catch (e) { toast.error('Chưa thực hiện được', vppErrorMessage(e)); if (isVppConflict(e)) onChanged(); }
    finally { setBusy(false); }
  };
  const post = async () => {
    if (p.posted) {
      const reason = await askReason({ title: 'Chốt lại chi phí VPP', targetName: `Tháng ${m} · ${vnd(p.liveTotal)}`, reasonLabel: 'Lý do chốt lại', actionLabel: 'Chốt lại', intent: 'warning' });
      if (reason) await run(() => officeSupplyService.postCosts({ month: p.month, expectedTotal: p.liveTotal, reason }), `Đã chốt lại chi phí VPP tháng ${m}`);
      return;
    }
    if (await confirm({ title: 'Chốt chi phí VPP', targetName: `Tháng ${m} · ${vnd(p.liveTotal)}`, confirmText: 'Chốt chi phí VPP',
      warningText: `Ghi theo phòng ban sang Tài chính, vào Chi phí chung của Phân bổ tháng ${m}.`, actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0 }))
      await run(() => officeSupplyService.postCosts({ month: p.month, expectedTotal: p.liveTotal }), `Đã chốt chi phí VPP tháng ${m} sang Tài chính`);
  };
  const reverse = async () => {
    const reason = await askReason({ title: 'Đảo chi phí VPP đã chốt', targetName: `${p.posted?.code} · ${vnd(p.posted?.total || 0)}`, reasonLabel: 'Lý do đảo', actionLabel: 'Đảo', intent: 'danger' });
    if (reason) await run(() => officeSupplyService.reverseCosts({ month: p.month, reason }), `Đã đảo chi phí VPP tháng ${m}`);
  };

  const tone = !p.closed ? GREY : p.posted ? (diff ? WARN : OK) : p.liveTotal ? WARN : GREY;
  const status = !p.closed ? `Chốt được từ ${nextMonthStart}` : p.posted ? (diff ? `Phát sinh sau chốt ${diff > 0 ? '+' : ''}${money(diff)} đ` : 'Đã chốt')
    : p.liveTotal ? 'Chưa chốt' : 'Không có chi phí';
  const lockTitle = locked ? `Phân bổ ${locked.code} đã ${locked.status === 'confirmed' ? 'chốt' : 'gửi chốt'}` : undefined;

  return <section className="rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"><Landmark size={18} /></span>
      <div className="min-w-0 flex-1">
        <b className="block text-sm">Chi phí sang Tài chính · tháng {m}</b>
        <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <Badge className={tone}>{status}</Badge>
          {p.posted ? <span className="text-muted-foreground"><span className={`font-mono ${ENT}`}>{p.posted.code}</span> · <b className={NUM}>{money(p.posted.total)}</b> đ · {p.posted.postedByName}</span>
            : <span className="text-muted-foreground">Theo sổ kho <b className={NUM}>{money(p.liveTotal)}</b> đ{p.liveReturned ? ` (đã trừ trả lại ${money(p.liveReturned)} đ)` : ''}</span>}
          {locked && <Badge className={BAD}>{lockTitle}</Badge>}
        </span>
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        {p.posted && <button type="button" onClick={() => setDetail(v => !v)} aria-expanded={detail} className={`${secondaryBtn} flex-1 sm:flex-none`}>Theo phòng<ChevronDown size={14} className={detail ? 'rotate-180' : ''} /></button>}
        {p.posted && can.reverse && <button type="button" onClick={reverse} disabled={busy || !!locked} title={lockTitle} className={`${secondaryBtn} flex-1 sm:flex-none`}><Undo2 size={14} />Đảo</button>}
        {can.post && p.closed && (!p.posted || diff !== 0) && (p.liveTotal !== 0 || p.posted) &&
          <button type="button" onClick={post} disabled={busy || !!locked} title={lockTitle} className={`${primaryBtn} flex-1 sm:flex-none`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Landmark size={15} />}{p.posted ? 'Chốt lại' : `Chốt chi phí tháng ${m}`}</button>}
      </div>
    </div>
    {detail && p.posted && <ul className="mt-2 divide-y divide-border border-t border-border text-[13px]">
      {(p.posted.lines || []).map(l => <li key={l.orgUnitId || 'none'} className="flex items-center gap-2 py-1.5">
        <span className="min-w-0 flex-1">{l.name} <span className="text-muted-foreground">· {l.people} người · {l.requestCount} phiếu</span></span>
        {l.returnedValue > 0 && <span className="text-muted-foreground">trả {money(l.returnedValue)}</span>}
        <b className={NUM}>{money(l.value)} đ</b></li>)}
      {p.history.map(h => <li key={h.code} className="py-1.5 text-muted-foreground"><span className="font-mono line-through">{h.code}</span> {money(h.total)} đ · đảo bởi {h.reversedByName}: {h.reverseReason}</li>)}
    </ul>}
  </section>;
};
